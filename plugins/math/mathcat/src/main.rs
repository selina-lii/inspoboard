//! Helper of the "Math to words" plugin: MathML to words with MathCAT (ClearSpeak, English).
//! Protocol: one JSON line in, one JSON line out (the plugin program starts this helper and keeps it running).
//! - In: `{"mathml": "<math>…</math>", "prefs": {"ClearSpeak_Paren": "Silent", …}}`. `prefs` is optional.
//! - Out: `{"text": "…"}` or `{"error": "…"}`.

use std::collections::HashMap;
use std::io::{BufRead, Write};

use libmathcat::*;
use serde_json::{Value, json};

fn main() {
    if let Err(error) = set_rules_dir("Rules".to_string()).and_then(|_| set_preference("Language".to_string(), "en".to_string())).and_then(|_| set_preference("TTS".to_string(), "None".to_string())) {
        eprintln!("MathCAT did not start: {}", errors_to_string(&error));
        std::process::exit(1);
    }
    let mut current: HashMap<String, String> = HashMap::new();
    let stdout = std::io::stdout();
    for line in std::io::stdin().lock().lines() {
        let Ok(line) = line else { break };
        let reply = match serde_json::from_str::<Value>(&line) {
            Ok(request) => {
                for (key, value) in request.get("prefs").and_then(Value::as_object).into_iter().flatten() {
                    let Some(value) = value.as_str() else { continue };
                    if current.get(key).map(String::as_str) != Some(value) {
                        if set_preference(key.clone(), value.to_string()).is_ok() {
                            current.insert(key.clone(), value.to_string());
                        }
                    }
                }
                let mathml = request.get("mathml").and_then(Value::as_str).unwrap_or("").to_string();
                match set_mathml(mathml).and_then(|_| get_spoken_text()) {
                    Ok(text) => json!({ "text": text }),
                    Err(error) => json!({ "error": errors_to_string(&error) }),
                }
            }
            Err(_) => json!({ "error": "The request is not JSON." }),
        };
        let mut out = stdout.lock();
        let _ = writeln!(out, "{reply}");
        let _ = out.flush();
    }
}
