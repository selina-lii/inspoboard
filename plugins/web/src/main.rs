//! Inspoboard web plugin: saves a web page as one HTML file, to read it offline in the app.
//!
//! - Protocol: JSON lines on stdin and stdout (see docs/PLUGINS.md in the app repository).
//! - "save_page" gets the page and its images, styles, and fonts. They go into the page as data.
//!   Scripts, frames, and forms are removed. The app stores the result in the vault.
//! - Network: only for the page that the user asks to save. The plugin keeps nothing.

mod css;
mod fetch;
mod page;

use std::io::{BufRead, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use base64::Engine as _;
use serde_json::{Value, json};

struct Plugin {
    out: Mutex<std::io::Stdout>,
    cancel: AtomicBool,
}

impl Plugin {
    fn send(&self, message: Value) {
        if let Ok(mut out) = self.out.lock() {
            let _ = writeln!(out, "{message}");
            let _ = out.flush();
        }
    }

    fn progress(&self, done: usize, total: usize, label: &str) {
        self.send(json!({ "method": "progress", "params": { "done": done, "total": total, "label": label } }));
    }

    fn handle(&self, method: &str, params: &Value) -> Result<Value, String> {
        match method {
            "info" => Ok(json!({
                "title": "Web pages",
                "icon": "globe",
                "description": "Saves a web page as one file in the vault, to read it offline.",
                "options": [],
                "actions": [],
            })),
            "save_page" => {
                self.cancel.store(false, Ordering::SeqCst);
                let url = params.get("url").and_then(Value::as_str).ok_or("\"url\" is missing.")?;
                let saved = page::save(url, &self.cancel, &|done, total| self.progress(done, total, &format!("Saving the page: {done} of {total} files")))?;
                Ok(match saved.pdf {
                    Some(bytes) => json!({ "title": saved.title, "url": saved.url, "kind": "pdf", "data": base64::engine::general_purpose::STANDARD.encode(bytes) }),
                    None => json!({ "title": saved.title, "url": saved.url, "kind": "html", "html": saved.html }),
                })
            }
            "cancel" => {
                self.cancel.store(true, Ordering::SeqCst);
                Ok(Value::Null)
            }
            _ => Err(format!("Unknown method \"{method}\".")),
        }
    }
}

fn main() {
    let plugin = Arc::new(Plugin { out: Mutex::new(std::io::stdout()), cancel: AtomicBool::new(false) });
    // Each request runs on its own thread. Thus "cancel" works while a page saves.
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
    std::process::exit(0);
}
