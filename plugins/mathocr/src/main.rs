//! Inspoboard plugin "Math from images": finds the formulas on a page image (a page of a PDF, an image of a web page)
//! and gives their LaTeX. The "Math to words" plugin then makes words of the LaTeX for read-aloud.
//!
//! - Protocol: JSON lines on stdin and stdout (see docs/PLUGINS.md in the app repository).
//! - Capability "math-image": method "formulas" (find and read the formulas on an image) and "recognize" (read images
//!   that each show one formula).
//! - Models: Pix2Text 1.5 (MFD + MFR, ONNX). They download only when the user runs the action.
//! - The plugin saves nothing except the model files. Images and results stay in memory only.

mod engine;
mod latex;
mod models;

use std::io::{BufRead, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use base64::Engine as _;
use serde_json::{Value, json};

use crate::engine::Engine;

struct Plugin {
    out: Mutex<std::io::Stdout>,
    engine: Mutex<Engine>,
    cancel: AtomicBool,
    models: PathBuf,
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
            "formulas" => self.formulas(params),
            "recognize" => self.recognize(params),
            "run_action" => self.run_action(params.get("id").and_then(Value::as_str).unwrap_or("")),
            "cancel" => {
                self.cancel.store(true, Ordering::SeqCst);
                Ok(Value::Null)
            }
            _ => Err(format!("Unknown method \"{method}\".")),
        }
    }

    fn info(&self) -> Value {
        let size = models::size_text(models::total_bytes());
        let action = if models::is_installed(&self.models) {
            json!({ "id": "delete", "label": "Delete the formula models", "detail": format!("Installed · {size} · Pix2Text 1.5 (MIT)") })
        } else {
            json!({ "id": "download", "label": "Download the formula models", "detail": format!("{size} · Pix2Text 1.5 (MIT)") })
        };
        json!({
            "title": "Math from images",
            "icon": "scan",
            "description": "Finds formulas in PDF pages and reads them as LaTeX, for read-aloud and the formula notes. Offline after the model download. Needs the plugin \"Math to words\" for the words.",
            "options": [],
            "actions": [action],
        })
    }

    /// `{image}` (PNG, JPEG, or WebP as base64; or a data URL) → `{width, height, formulas: [{box, display, score, tex, texScore}]}`.
    /// `box`: left, top, right, bottom in pixels of the image. `{read: false}`: boxes only (no LaTeX).
    fn formulas(&self, params: &Value) -> Result<Value, String> {
        self.cancel.store(false, Ordering::SeqCst);
        let image = decode_image(params.get("image").and_then(Value::as_str).ok_or("\"image\" is missing.")?)?;
        let read = params.get("read").and_then(Value::as_bool).unwrap_or(true);
        let mut engine = self.engine.lock().map_err(|_| "Internal lock error.")?;
        let found = engine.detect(&self.models, &image)?;
        let crops: Vec<_> = if read { found.iter().map(|item| engine::crop(&image, &item.bounds)).collect() } else { Vec::new() };
        let total = crops.len() as f64;
        let texts = engine.recognize(&self.models, &crops, &self.cancel, &mut |done| self.progress(done as f64, total, ""))?;
        let formulas: Vec<Value> = found
            .iter()
            .enumerate()
            .map(|(index, item)| {
                let mut entry = json!({ "box": item.bounds.iter().map(|value| (value * 10.0).round() / 10.0).collect::<Vec<f32>>(), "display": item.display, "score": item.score });
                if let Some((tex, score)) = texts.get(index) {
                    entry["tex"] = json!(tex);
                    entry["texScore"] = json!(score);
                }
                entry
            })
            .collect();
        Ok(json!({ "width": image.width(), "height": image.height(), "formulas": formulas }))
    }

    /// `{images: [base64]}` (each image shows one formula) → `{texts: [LaTeX]}`.
    fn recognize(&self, params: &Value) -> Result<Value, String> {
        self.cancel.store(false, Ordering::SeqCst);
        let images = params
            .get("images")
            .and_then(Value::as_array)
            .ok_or("\"images\" is missing.")?
            .iter()
            .map(|value| decode_image(value.as_str().unwrap_or("")))
            .collect::<Result<Vec<_>, _>>()?;
        let total = images.len() as f64;
        let mut engine = self.engine.lock().map_err(|_| "Internal lock error.")?;
        let texts = engine.recognize(&self.models, &images, &self.cancel, &mut |done| self.progress(done as f64, total, ""))?;
        Ok(json!({ "texts": texts.into_iter().map(|(tex, _)| tex).collect::<Vec<_>>() }))
    }

    fn run_action(&self, id: &str) -> Result<Value, String> {
        self.cancel.store(false, Ordering::SeqCst);
        match id {
            "download" => {
                let label = |done: u64, total: u64| format!("Formula models: {} / {}", models::size_text(done), models::size_text(total));
                models::download(&self.models, &self.cancel, &|done, total| self.progress(done as f64, total as f64, &label(done, total)))?;
                Ok(Value::Null)
            }
            "delete" => {
                if let Ok(mut engine) = self.engine.lock() {
                    engine.unload();
                }
                models::delete(&self.models)?;
                Ok(Value::Null)
            }
            _ => Err(format!("Unknown action \"{id}\".")),
        }
    }
}

/// An image from base64 (or a data URL).
fn decode_image(text: &str) -> Result<image::DynamicImage, String> {
    let data = text.split_once(";base64,").map_or(text, |(_, data)| data);
    let bytes = base64::engine::general_purpose::STANDARD.decode(data.trim()).map_err(|_| "The image is not correct base64.".to_string())?;
    image::load_from_memory(&bytes).map_err(|error| format!("The image cannot be read: {error}"))
}

fn main() {
    let plugin = Arc::new(Plugin { out: Mutex::new(std::io::stdout()), engine: Mutex::new(Engine::new()), cancel: AtomicBool::new(false), models: models::folder() });
    // Each request runs on its own thread. Thus "cancel" works while a request runs. The engine runs one request at a
    // time (its lock).
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
