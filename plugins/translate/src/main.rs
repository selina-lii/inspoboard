//! Inspoboard translate plugin. Offline translation for view only.
//!
//! - Protocol: JSON lines on stdin and stdout (see docs/PLUGINS.md in the app repository).
//! - Chinese ↔ English: Tencent Hy-MT 1.5 (1.8B). Other pairs: Google TranslateGemma (4B).
//! - Models are language packs. A pack downloads only when the user runs its action.
//! - The plugin saves nothing except the pack files. Translations stay in memory only.

mod engine;
mod langs;
mod packs;
mod prompts;
mod segments;

use std::collections::HashMap;
use std::io::{BufRead, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde_json::{Value, json};

use crate::engine::Engine;
use crate::langs::{DETECT, LANGS, Route, ZH_EN_SWAP};
use crate::packs::{PACKS, Pack};

struct Plugin {
    out: Mutex<std::io::Stdout>,
    engine: Mutex<Option<Engine>>,
    cancel: AtomicBool,
    /// (source, target, text) → translation. Memory only.
    cache: Mutex<HashMap<(String, String, String), String>>,
    packs: PathBuf,
}

impl Plugin {
    fn send(&self, message: Value) {
        if let Ok(mut out) = self.out.lock() {
            let _ = writeln!(out, "{message}");
            let _ = out.flush();
        }
    }

    fn progress(&self, done: f64, total: f64, label: &str) {
        self.send(json!({ "method": "progress", "params": { "done": done, "total": total, "label": label } }));
    }

    fn handle(&self, method: &str, params: &Value) -> Result<Value, String> {
        match method {
            "info" => Ok(self.info()),
            "transform" => self.transform(params),
            "run_action" => self.run_action(params.get("id").and_then(Value::as_str).unwrap_or("")),
            "cancel" => {
                self.cancel.store(true, Ordering::SeqCst);
                Ok(Value::Null)
            }
            _ => Err(format!("Unknown method \"{method}\".")),
        }
    }

    fn info(&self) -> Value {
        // Alphabetical by name. "Detect" and "Chinese ↔ English" stay at the top.
        let mut sorted: Vec<&langs::Lang> = LANGS.iter().collect();
        sorted.sort_by_key(|lang| lang.name);
        let languages: Vec<Value> = sorted.iter().map(|lang| json!({ "value": lang.code, "label": lang.name })).collect();
        let mut sources = vec![json!({ "value": DETECT, "label": "Detect" })];
        sources.extend(languages.iter().cloned());
        let mut targets = vec![json!({ "value": ZH_EN_SWAP, "label": "Chinese ↔ English" })];
        targets.extend(languages);
        let actions: Vec<Value> = PACKS
            .iter()
            .map(|pack| {
                let size = packs::size_text(pack.bytes);
                if packs::is_installed(&self.packs, pack) {
                    json!({ "id": format!("delete:{}", pack.id), "label": format!("Delete pack: {}", pack.name), "detail": format!("Installed · {size} · {}", pack.license) })
                } else {
                    json!({ "id": format!("download:{}", pack.id), "label": format!("Download pack: {}", pack.name), "detail": format!("{size} · {}", pack.license) })
                }
            })
            .collect();
        json!({
            "title": "Translate",
            "icon": "languages",
            "description": "Offline translation. Chinese ↔ English uses Tencent Hy-MT 1.5. Other languages use Google TranslateGemma. Download a pack before first use.",
            "options": [
                { "key": "source", "label": "From", "choices": sources, "default": DETECT },
                { "key": "target", "label": "To", "choices": targets, "default": ZH_EN_SWAP },
            ],
            "actions": actions,
        })
    }

    fn transform(&self, params: &Value) -> Result<Value, String> {
        self.cancel.store(false, Ordering::SeqCst);
        let texts: Vec<String> = params
            .get("texts")
            .and_then(Value::as_array)
            .ok_or("\"texts\" is missing.")?
            .iter()
            .map(|text| text.as_str().unwrap_or("").to_string())
            .collect();
        let option = |key: &str, fallback: &str| params.get("options").and_then(|options| options.get(key)).and_then(Value::as_str).unwrap_or(fallback).to_string();
        let source_option = option("source", DETECT);
        let target_option = option("target", ZH_EN_SWAP);

        // Each line to translate is one job.
        struct Job {
            text: usize,
            route: Route,
            source: String,
            target: String,
            line: String,
        }
        let split: Vec<Vec<segments::Line>> = texts.iter().map(|text| segments::split(text)).collect();
        let mut jobs: Vec<Job> = Vec::new();
        for (index, lines) in split.iter().enumerate() {
            let (source, target) = langs::resolve(&source_option, &target_option, &texts[index]);
            let route = langs::route(&source, &target);
            for line in segments::texts(lines) {
                jobs.push(Job { text: index, route, source: source.clone(), target: target.clone(), line: line.to_string() });
            }
        }
        let mut results: Vec<Option<String>> = vec![None; jobs.len()];
        {
            let cache = self.cache.lock().map_err(|_| "Internal lock error.")?;
            for (index, job) in jobs.iter().enumerate() {
                if job.route == Route::Same {
                    results[index] = Some(job.line.clone());
                } else if let Some(hit) = cache.get(&(job.source.clone(), job.target.clone(), job.line.clone())) {
                    results[index] = Some(hit.clone());
                }
            }
        }

        let total_jobs = jobs.len().max(1) as f64;
        let mut finished = results.iter().filter(|result| result.is_some()).count();
        for route in [Route::ZhEn, Route::Multi] {
            let pending: Vec<usize> = (0..jobs.len()).filter(|&index| results[index].is_none() && jobs[index].route == route).collect();
            if pending.is_empty() {
                continue;
            }
            let pack = packs::pack_for(route).ok_or("No pack for this language pair.")?;
            if !packs::is_installed(&self.packs, pack) {
                return Err(format!("The language pack \"{}\" is not installed. Download it in Settings → Plugins.", pack.name));
            }
            let prompts: Vec<Vec<prompts::Part>> = pending.iter().map(|&index| prompts::build(route, &jobs[index].source, &jobs[index].target, &jobs[index].line)).collect();
            // The engine starts in the background when the plugin starts (see main). If it is not ready yet, say so.
            let mut engine = match self.engine.try_lock() {
                Ok(engine) => engine,
                Err(_) => {
                    self.progress(0.0, texts.len() as f64, STARTING);
                    self.engine.lock().map_err(|_| "Internal lock error.")?
                }
            };
            if engine.is_none() {
                self.progress(0.0, texts.len() as f64, STARTING);
                *engine = Some(Engine::new()?);
            }
            let path = packs::path_of(&self.packs, pack);
            engine.as_mut().expect("engine exists").run(pack.id, &path, prompts::add_start_token(route), &prompts, &self.cancel, &mut |at, output| {
                let index = pending[at];
                let job = &jobs[index];
                let text = output.unwrap_or_else(|| job.line.clone());
                if let Ok(mut cache) = self.cache.lock() {
                    cache.insert((job.source.clone(), job.target.clone(), job.line.clone()), text.clone());
                }
                results[index] = Some(text);
                finished += 1;
                // Progress counts texts. A text is done when all its lines are done.
                // `partial`: the text so far (done lines translated, others original), so the app can show it at once.
                let text_index = job.text;
                let translated: Vec<String> = jobs
                    .iter()
                    .zip(results.iter())
                    .filter(|(other, _)| other.text == text_index)
                    .map(|(other, result)| result.clone().unwrap_or_else(|| other.line.clone()))
                    .collect();
                let partial = segments::join(&split[text_index], &translated);
                self.send(json!({ "method": "progress", "params": {
                    "done": texts.len() as f64 * finished as f64 / total_jobs,
                    "total": texts.len() as f64,
                    "label": "",
                    "partial": { "index": text_index, "text": partial },
                } }));
            })?;
        }

        let mut by_text: Vec<Vec<String>> = vec![Vec::new(); texts.len()];
        for (index, job) in jobs.iter().enumerate() {
            by_text[job.text].push(results[index].clone().unwrap_or_else(|| job.line.clone()));
        }
        let output: Vec<String> = split.iter().zip(by_text).map(|(lines, translated)| segments::join(lines, &translated)).collect();
        Ok(json!({ "texts": output }))
    }

    fn run_action(&self, id: &str) -> Result<Value, String> {
        self.cancel.store(false, Ordering::SeqCst);
        let (kind, pack_id) = id.split_once(':').ok_or_else(|| format!("Unknown action \"{id}\"."))?;
        let pack: &Pack = packs::by_id(pack_id).ok_or_else(|| format!("Unknown pack \"{pack_id}\"."))?;
        match kind {
            "download" => {
                let label = |done: u64, total: u64| format!("{}: {:.2} / {}", pack.name, done as f64 / 1e9, packs::size_text(total));
                packs::download(&self.packs, pack, &self.cancel, &|done, total| self.progress(done as f64, total as f64, &label(done, total)))?;
                Ok(Value::Null)
            }
            "delete" => {
                if let Ok(mut engine) = self.engine.lock()
                    && let Some(engine) = engine.as_mut()
                {
                    engine.unload();
                }
                let path = packs::path_of(&self.packs, pack);
                std::fs::remove_file(&path).map_err(|error| format!("{}: {error}", path.display()))?;
                Ok(Value::Null)
            }
            _ => Err(format!("Unknown action \"{id}\".")),
        }
    }
}

/// The progress label while the engine starts. It compiles its GPU programs: about one minute on an Apple M4.
const STARTING: &str = "Starting the translation engine (about 1 minute after the app starts)…";

fn main() {
    let plugin = Arc::new(Plugin {
        out: Mutex::new(std::io::stdout()),
        engine: Mutex::new(None),
        cancel: AtomicBool::new(false),
        cache: Mutex::new(HashMap::new()),
        packs: packs::folder(),
    });
    // Start the engine now, in the background, if a pack is installed: the first translation then need not wait for it.
    // The app starts the plugin when it starts. The model itself loads at the first translation.
    if PACKS.iter().any(|pack| packs::is_installed(&plugin.packs, pack)) {
        let warm = plugin.clone();
        std::thread::spawn(move || {
            if let Ok(mut engine) = warm.engine.lock()
                && engine.is_none()
            {
                *engine = Engine::new().ok();
            }
        });
    }
    // Each request runs on its own thread. Thus "cancel" works while a translation runs.
    for line in std::io::stdin().lock().lines() {
        let Ok(line) = line else { break };
        let Ok(request) = serde_json::from_str::<Value>(&line) else { continue };
        let plugin = plugin.clone();
        std::thread::spawn(move || {
            let id = request.get("id").cloned().unwrap_or(Value::Null);
            let method = request.get("method").and_then(Value::as_str).unwrap_or("");
            let params = request.get("params").cloned().unwrap_or(Value::Null);
            // A panic must not leave the app without a reply.
            let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| plugin.handle(method, &params)))
                .unwrap_or_else(|_| Err("The plugin failed (internal error).".to_string()));
            let reply = match outcome {
                Ok(result) => json!({ "id": id, "result": result }),
                Err(message) => json!({ "id": id, "error": { "message": message } }),
            };
            plugin.send(reply);
        });
    }
    // The app closed our input: stop now, also if work still runs.
    std::process::exit(0);
}
