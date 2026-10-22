//! Inspoboard "Ask the vault" plugin: answers questions from the passages that the app sends.
//!
//! - Protocol: JSON lines on stdin and stdout (see docs/PLUGINS.md in the app repository). Capability `ask-vault`.
//! - `embed`: the vectors of passages or of a question (EmbeddingGemma 300M), for search by meaning. The app keeps
//!   the index; the plugin keeps nothing.
//! - `answer`: an answer from the numbered passages only, with their numbers as citations (Gemma 3 4B). The text so
//!   far comes in progress notes (`partial`).
//! - Models are packs. A pack downloads only when the user runs its action.

mod engine;
mod packs;
mod prompts;

use std::io::{BufRead, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use base64::Engine as _;
use serde_json::{Value, json};

use crate::engine::Engine;
use crate::packs::{PACKS, Pack, Role};
use crate::prompts::Passage;

/// The answer model is freed when it was not used for this long (it takes about 3 GB of memory).
const CHAT_IDLE: Duration = Duration::from_secs(5 * 60);
/// The longest answer (tokens).
const MAX_ANSWER_TOKENS: usize = 1024;
/// Partial answers go to the app at most this often.
const PARTIAL_EVERY: Duration = Duration::from_millis(120);

struct Plugin {
    out: Mutex<std::io::Stdout>,
    engine: Mutex<Option<Engine>>,
    /// Counts the cancels. A call stops when the count changes while it runs: a cancel stops all running calls.
    cancels: AtomicU64,
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
            "embed" => self.embed(params),
            "answer" => self.answer(params),
            "run_action" => self.run_action(params.get("id").and_then(Value::as_str).unwrap_or("")),
            "cancel" => {
                self.cancels.fetch_add(1, Ordering::SeqCst);
                Ok(Value::Null)
            }
            _ => Err(format!("Unknown method \"{method}\".")),
        }
    }

    fn info(&self) -> Value {
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
            "title": "Ask the vault",
            "icon": "sparkles",
            "description": "Ask a question about your notes, saved pages, and PDFs. The answer comes from your own texts only, with links to the passages. Offline: download both packs before first use.",
            "options": [
                { "key": "language", "label": "Answer in", "default": "auto", "choices": [
                    { "value": "auto", "label": "The language of the question" },
                    { "value": "English", "label": "English" },
                    { "value": "Simplified Chinese", "label": "Simplified Chinese" },
                    { "value": "Traditional Chinese", "label": "Traditional Chinese" },
                ] },
                { "key": "passages", "label": "Passages for each answer", "default": "8", "choices": [
                    { "value": "6", "label": "6" },
                    { "value": "8", "label": "8" },
                    { "value": "12", "label": "12" },
                ] },
            ],
            "actions": actions,
        })
    }

    /// The pack of a role, or an error that says what to download.
    fn installed(&self, role: Role) -> Result<&'static Pack, String> {
        let pack = packs::pack_for(role);
        if packs::is_installed(&self.packs, pack) {
            Ok(pack)
        } else {
            Err(format!("The pack \"{}\" is not installed. Download it in Settings → Plugins.", pack.name))
        }
    }

    /// The engine, started if necessary. Its lock: one call uses the models at a time.
    fn engine(&self) -> Result<std::sync::MutexGuard<'_, Option<Engine>>, String> {
        let mut engine = self.engine.lock().map_err(|_| "Internal lock error.")?;
        if engine.is_none() {
            *engine = Some(Engine::new()?);
        }
        Ok(engine)
    }

    /// `{texts, titles?, query?}` → `{dims, vectors}`: each vector is base64 of little-endian f32 values (unit length).
    fn embed(&self, params: &Value) -> Result<Value, String> {
        let start = self.cancels.load(Ordering::SeqCst);
        let texts: Vec<&str> = params.get("texts").and_then(Value::as_array).ok_or("\"texts\" is missing.")?.iter().map(|text| text.as_str().unwrap_or("")).collect();
        let titles = params.get("titles").and_then(Value::as_array);
        let query = params.get("query").and_then(Value::as_bool).unwrap_or(false);
        let inputs: Vec<String> = texts
            .iter()
            .enumerate()
            .map(|(index, text)| prompts::embed_text(text, titles.and_then(|titles| titles.get(index)).and_then(Value::as_str), query))
            .collect();
        let pack = self.installed(Role::Embed)?;
        let mut engine = self.engine()?;
        let vectors = engine.as_mut().expect("engine exists").embed(&packs::path_of(&self.packs, pack), &inputs, &|| self.cancels.load(Ordering::SeqCst) != start)?;
        let dims = vectors.first().map_or(0, Vec::len);
        let encoded: Vec<String> = vectors
            .iter()
            .map(|vector| base64::engine::general_purpose::STANDARD.encode(vector.iter().flat_map(|value| value.to_le_bytes()).collect::<Vec<u8>>()))
            .collect();
        Ok(json!({ "dims": dims, "vectors": encoded }))
    }

    /// `{question, passages: [{n, title, text}], options}` → `{text}`. The text so far comes in progress notes.
    fn answer(&self, params: &Value) -> Result<Value, String> {
        let start = self.cancels.load(Ordering::SeqCst);
        let question = params.get("question").and_then(Value::as_str).unwrap_or("").trim();
        if question.is_empty() {
            return Err("The question is empty.".to_string());
        }
        let passages: Vec<Passage> = params
            .get("passages")
            .and_then(Value::as_array)
            .map(|list| {
                list.iter()
                    .enumerate()
                    .map(|(index, passage)| Passage {
                        n: passage.get("n").and_then(Value::as_u64).unwrap_or(index as u64 + 1),
                        title: passage.get("title").and_then(Value::as_str).unwrap_or("").to_string(),
                        text: passage.get("text").and_then(Value::as_str).unwrap_or("").to_string(),
                    })
                    .collect()
            })
            .unwrap_or_default();
        let language = params.get("options").and_then(|options| options.get("language")).and_then(Value::as_str).unwrap_or("auto");
        let message = prompts::answer_message(question, &passages, language);
        let pack = self.installed(Role::Chat)?;
        let mut engine = self.engine()?;
        let engine = engine.as_mut().expect("engine exists");
        if !engine.has_chat() {
            self.progress(0.0, 1.0, "Loading the answer model…");
        }
        let mut last = Instant::now() - PARTIAL_EVERY;
        let text = engine.answer(&packs::path_of(&self.packs, pack), &message, MAX_ANSWER_TOKENS, &|| self.cancels.load(Ordering::SeqCst) != start, &mut |text| {
            if last.elapsed() >= PARTIAL_EVERY {
                last = Instant::now();
                self.send(json!({ "method": "progress", "params": { "done": 0, "total": 1, "label": "", "partial": { "index": 0, "text": text } } }));
            }
        })?;
        Ok(json!({ "text": text }))
    }

    fn run_action(&self, id: &str) -> Result<Value, String> {
        let start = self.cancels.load(Ordering::SeqCst);
        let (kind, pack_id) = id.split_once(':').ok_or_else(|| format!("Unknown action \"{id}\"."))?;
        let pack: &Pack = packs::by_id(pack_id).ok_or_else(|| format!("Unknown pack \"{pack_id}\"."))?;
        match kind {
            "download" => {
                let cancel = std::sync::atomic::AtomicBool::new(false);
                let label = |done: u64, total: u64| format!("{}: {:.2} / {}", pack.name, done as f64 / 1e9, packs::size_text(total));
                packs::download(&self.packs, pack, &cancel, &|done, total| {
                    if self.cancels.load(Ordering::SeqCst) != start {
                        cancel.store(true, Ordering::SeqCst);
                    }
                    self.progress(done as f64, total as f64, &label(done, total));
                })?;
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

fn main() {
    let plugin = Arc::new(Plugin { out: Mutex::new(std::io::stdout()), engine: Mutex::new(None), cancels: AtomicU64::new(0), packs: packs::folder() });
    // Start the engine now, in the background, if a pack is installed: the first question then need not wait for it.
    if PACKS.iter().any(|pack| packs::is_installed(&plugin.packs, pack)) {
        let warm = plugin.clone();
        std::thread::spawn(move || {
            drop(warm.engine());
        });
    }
    // Free the answer model when it is not used for some time. It loads again at the next question.
    let idle = plugin.clone();
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(Duration::from_secs(30));
            if let Ok(mut engine) = idle.engine.try_lock()
                && let Some(engine) = engine.as_mut()
                && engine.has_chat()
                && engine.chat_used.elapsed() > CHAT_IDLE
            {
                engine.unload_chat();
            }
        }
    });
    // Each request runs on its own thread. Thus "cancel" works while an answer is written.
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
