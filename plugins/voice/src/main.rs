//! Inspoboard voice plugin: read notes and pages aloud, in English.
//!
//! - Protocol: JSON lines on stdin and stdout (see docs/PLUGINS.md in the app repository).
//! - Offline voices: Kokoro (a 103 MB pack that downloads only on a user action).
//! - Online voices: Microsoft Edge. Only when the user selects an Edge voice. The text then goes to Microsoft.
//! - The plugin keeps no text and no audio. "export" writes one file where the user selected.

mod audio;
mod packs;
mod sentences;
mod voices;

use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use base64::Engine as _;
use serde_json::{Value, json};

use crate::packs::KOKORO;
use crate::voices::{Audio, DEFAULT_VOICE, Engine, Engines, PITCH_PATTERN, Style, VOICES};

struct Plugin {
    out: Mutex<std::io::Stdout>,
    engines: Engines,
    cancel: AtomicBool,
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
            "sentences" => Ok(json!({ "sentences": sentences::split(text_of(params)?) })),
            "speak" => self.speak(params),
            "export" => self.export(params),
            "run_action" => self.run_action(params.get("id").and_then(Value::as_str).unwrap_or("")),
            "cancel" => {
                self.cancel.store(true, Ordering::SeqCst);
                Ok(Value::Null)
            }
            _ => Err(format!("Unknown method \"{method}\".")),
        }
    }

    fn info(&self) -> Value {
        let voices: Vec<Value> = VOICES.iter().map(|voice| json!({ "value": voice.id, "label": voice.label })).collect();
        let size = packs::size_text(KOKORO.bytes);
        let action = if packs::is_installed(&self.packs, &KOKORO) {
            json!({ "id": format!("delete:{}", KOKORO.id), "label": format!("Delete pack: {}", KOKORO.name), "detail": format!("Installed · {size} · {}", KOKORO.license) })
        } else {
            json!({ "id": format!("download:{}", KOKORO.id), "label": format!("Download pack: {}", KOKORO.name), "detail": format!("{size} · {}", KOKORO.license) })
        };
        json!({
            "title": "Read aloud",
            "icon": "speech",
            "description": "Reads text aloud in English. Offline voices need the voice pack.",
            "options": [
                { "key": "voice", "label": "Voice", "choices": voices, "default": DEFAULT_VOICE },
                { "key": "pitch", "kind": "text", "label": "Pitch", "default": "0", "placeholder": "+20 or −15 (0 is natural; ±10 Hz or more is easy to hear)", "pattern": PITCH_PATTERN, "unit": "Hz" },
            ],
            "actions": [action],
        })
    }

    fn voice_and_style(&self, params: &Value, rate: f32, volume: f32) -> Result<(String, Style), String> {
        let option = |key: &str| params.get("options").and_then(|options| options.get(key)).and_then(Value::as_str);
        let voice = option("voice").unwrap_or(DEFAULT_VOICE).to_string();
        let pitch = option("pitch").unwrap_or("0");
        let pitch_hz = voices::parse_pitch(pitch).ok_or_else(|| format!("\"{pitch}\" is not a pitch. Type for example +20 Hz or -15 Hz."))?;
        if matches!(voices::parse(&voice)?.0, Engine::Kokoro) && !packs::is_installed(&self.packs, &KOKORO) {
            return Err("The offline voice pack is not installed. Download it in Settings → Plugins, or select an online voice.".to_string());
        }
        Ok((voice, Style { rate: rate.clamp(0.25, 4.0), volume: volume.clamp(0.0, 2.0), pitch_hz }))
    }

    fn kokoro_folder(&self) -> PathBuf {
        packs::model_folder(&self.packs, &KOKORO)
    }

    /// One sentence: `text`, or `parts: [{text, rate}]` (each part at its own speed, for example a formula slower;
    /// the parts make one clip). Volume and the main speed stay normal: the app changes them while it plays.
    fn speak(&self, params: &Value) -> Result<Value, String> {
        let (voice, style) = self.voice_and_style(params, 1.0, 1.0)?;
        let parts: Vec<(String, f32)> = match params.get("parts").and_then(Value::as_array) {
            Some(parts) => parts
                .iter()
                .filter_map(|part| Some((part.get("text")?.as_str()?.to_string(), part.get("rate").and_then(Value::as_f64).unwrap_or(1.0) as f32)))
                .filter(|(text, _)| !text.trim().is_empty())
                .collect(),
            None => vec![(text_of(params)?.to_string(), 1.0)],
        };
        if parts.is_empty() {
            return Err("There is no text to say.".to_string());
        }
        let mut samples: Vec<f32> = Vec::new();
        let mut sample_rate = 24_000;
        let mut mp3: Vec<u8> = Vec::new();
        let last = parts.len() - 1;
        for (index, (text, rate)) in parts.iter().enumerate() {
            let part_style = Style { rate: (style.rate * rate).clamp(0.25, 4.0), ..style };
            match self.engines.speak(&voice, text, &part_style, &self.kokoro_folder())? {
                Audio::Wav { samples: part, sample_rate: rate } => {
                    sample_rate = rate;
                    let start = if index == 0 { audio::KEEP_START_MS } else { audio::KEEP_JOIN_MS };
                    let end = if index == last { audio::KEEP_END_MS } else { audio::KEEP_JOIN_MS };
                    samples.extend(audio::trim_silence(&part, rate, start, end));
                }
                // MP3 frames can follow each other: the parts make one file.
                Audio::Mp3(bytes) => mp3.extend(bytes),
            }
        }
        let encoded = if mp3.is_empty() { ("audio/wav", audio::wav(&samples, sample_rate, 1.0)) } else { ("audio/mpeg", mp3) };
        Ok(json!({ "mime": encoded.0, "audio": base64::engine::general_purpose::STANDARD.encode(encoded.1) }))
    }

    /// The whole text into one audio file, with the speed and volume of the settings.
    fn export(&self, params: &Value) -> Result<Value, String> {
        self.cancel.store(false, Ordering::SeqCst);
        let rate = params.get("rate").and_then(Value::as_f64).unwrap_or(1.0) as f32;
        let volume = params.get("volume").and_then(Value::as_f64).unwrap_or(1.0) as f32;
        let (voice, style) = self.voice_and_style(params, rate, volume)?;
        let path = params.get("path").and_then(Value::as_str).ok_or("\"path\" is missing.")?;
        // The app can send the words to say (after its skip rules). Else the plugin splits the text.
        let list: Vec<String> = match params.get("speeches").and_then(Value::as_array) {
            Some(speeches) => speeches.iter().filter_map(Value::as_str).filter(|speech| !speech.trim().is_empty()).map(str::to_string).collect(),
            None => sentences::split(text_of(params)?).into_iter().map(|sentence| sentence.speech).collect(),
        };
        if list.is_empty() {
            return Err("This item has no text to read.".to_string());
        }
        let mut samples: Vec<f32> = Vec::new();
        let mut sample_rate = 24_000;
        let mut mp3: Vec<u8> = Vec::new();
        for (index, sentence) in list.iter().enumerate() {
            if self.cancel.load(Ordering::SeqCst) {
                return Err("Cancelled.".to_string());
            }
            match self.engines.speak(&voice, sentence, &style, &self.kokoro_folder())? {
                Audio::Wav { samples: part, sample_rate: rate } => {
                    sample_rate = rate;
                    samples.extend(audio::trim_silence(&part, rate, audio::KEEP_START_MS, audio::KEEP_END_MS));
                }
                // MP3 frames can follow each other: the parts make one file.
                Audio::Mp3(bytes) => mp3.extend(bytes),
            }
            self.progress((index + 1) as f64, list.len() as f64, &format!("Sentence {} of {}", index + 1, list.len()));
        }
        let (bytes, extension) = if mp3.is_empty() { (audio::wav(&samples, sample_rate, style.volume), "wav") } else { (mp3, "mp3") };
        let target = Path::new(path).with_extension(extension);
        write_atomic(&target, &bytes)?;
        Ok(json!({ "path": target.to_string_lossy() }))
    }

    fn run_action(&self, id: &str) -> Result<Value, String> {
        self.cancel.store(false, Ordering::SeqCst);
        match id.split_once(':') {
            Some(("download", pack)) if pack == KOKORO.id => {
                let label = |done: u64, total: u64| format!("Voice pack: {} / {}", packs::size_text(done), packs::size_text(total));
                packs::install(&self.packs, &KOKORO, &self.cancel, &|done, total| self.progress(done as f64, total as f64, &label(done, total)))?;
                Ok(Value::Null)
            }
            Some(("delete", pack)) if pack == KOKORO.id => {
                self.engines.unload();
                packs::delete(&self.packs, &KOKORO)?;
                Ok(Value::Null)
            }
            _ => Err(format!("Unknown action \"{id}\".")),
        }
    }
}

/// ureq and msedge-tts link two TLS crypto backends. rustls then needs one selected.
fn install_crypto() {
    let _ = rustls::crypto::ring::default_provider().install_default();
}

fn text_of(params: &Value) -> Result<&str, String> {
    params.get("text").and_then(Value::as_str).ok_or_else(|| "\"text\" is missing.".to_string())
}

/// Writes a file atomically: a temporary file, then a rename.
fn write_atomic(target: &Path, bytes: &[u8]) -> Result<(), String> {
    let temporary = target.with_extension("part");
    std::fs::write(&temporary, bytes).map_err(|error| format!("{}: {error}", temporary.display()))?;
    std::fs::rename(&temporary, target).map_err(|error| format!("{}: {error}", target.display()))
}

fn main() {
    install_crypto();
    let plugin = Arc::new(Plugin {
        out: Mutex::new(std::io::stdout()),
        engines: Engines::default(),
        cancel: AtomicBool::new(false),
        packs: packs::root(),
    });
    // Each request runs on its own thread. Thus "cancel" works while an export runs.
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
