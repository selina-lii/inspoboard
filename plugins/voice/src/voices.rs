//! The voices and the two engines.
//! - Kokoro (offline): sherpa-onnx with the Kokoro English pack. All 11 voices are in one pack.
//! - Edge (online): the Microsoft Edge read-aloud service. The text goes to Microsoft.

use std::path::Path;
use std::sync::Mutex;

use msedge_tts::tts::SpeechConfig;
use msedge_tts::tts::client::{MSEdgeTTSClient, connect};
use sherpa_onnx::{GenerationConfig, OfflineTts, OfflineTtsConfig, OfflineTtsKokoroModelConfig, OfflineTtsModelConfig};

use crate::audio;

pub enum Engine {
    Kokoro,
    Edge,
}

pub struct Voice {
    /// The option value, for example "kokoro:1" or "edge:en-US-AvaNeural".
    pub id: &'static str,
    pub label: &'static str,
    /// About the middle pitch of the voice, in Hz. A pitch change in Hz is a part of this.
    pub base_hz: f32,
}

const LOW: f32 = 120.0;
const HIGH: f32 = 210.0;

pub const DEFAULT_VOICE: &str = "kokoro:1";

pub const VOICES: &[Voice] = &[
    Voice { id: "kokoro:1", label: "Bella · US · offline", base_hz: HIGH },
    Voice { id: "kokoro:0", label: "Default · US · offline", base_hz: HIGH },
    Voice { id: "kokoro:2", label: "Nicole · US · offline", base_hz: HIGH },
    Voice { id: "kokoro:3", label: "Sarah · US · offline", base_hz: HIGH },
    Voice { id: "kokoro:4", label: "Sky · US · offline", base_hz: HIGH },
    Voice { id: "kokoro:5", label: "Adam · US · offline", base_hz: LOW },
    Voice { id: "kokoro:6", label: "Michael · US · offline", base_hz: LOW },
    Voice { id: "kokoro:7", label: "Emma · UK · offline", base_hz: HIGH },
    Voice { id: "kokoro:8", label: "Isabella · UK · offline", base_hz: HIGH },
    Voice { id: "kokoro:9", label: "George · UK · offline", base_hz: LOW },
    Voice { id: "kokoro:10", label: "Lewis · UK · offline", base_hz: LOW },
    Voice { id: "edge:en-US-AvaNeural", label: "Ava · US · online (Microsoft)", base_hz: HIGH },
    Voice { id: "edge:en-US-AndrewNeural", label: "Andrew · US · online (Microsoft)", base_hz: LOW },
    Voice { id: "edge:en-US-EmmaNeural", label: "Emma · US · online (Microsoft)", base_hz: HIGH },
    Voice { id: "edge:en-US-BrianNeural", label: "Brian · US · online (Microsoft)", base_hz: LOW },
    Voice { id: "edge:en-US-AriaNeural", label: "Aria · US · online (Microsoft)", base_hz: HIGH },
    Voice { id: "edge:en-US-JennyNeural", label: "Jenny · US · online (Microsoft)", base_hz: HIGH },
    Voice { id: "edge:en-GB-SoniaNeural", label: "Sonia · UK · online (Microsoft)", base_hz: HIGH },
    Voice { id: "edge:en-GB-RyanNeural", label: "Ryan · UK · online (Microsoft)", base_hz: LOW },
];

/// The largest pitch change, in Hz (up or down).
pub const MAX_PITCH_HZ: f32 = 80.0;
/// The pattern of a pitch value: "+2 Hz", "-1.5hz", "0", "−3 Hz". The app checks values with it.
pub const PITCH_PATTERN: &str = r"^\s*[+\-−]?\s*\d+(\.\d+)?\s*(hz)?\s*$";

/// A pitch change in Hz from an option value such as "+2 Hz". Not valid: None. A number without "Hz" is also Hz.
pub fn parse_pitch(value: &str) -> Option<f32> {
    let lower = value.trim().to_lowercase().replace('−', "-");
    let number = lower.strip_suffix("hz").unwrap_or(&lower).trim().replace(' ', "");
    let hz: f32 = number.strip_prefix('+').unwrap_or(&number).parse().ok()?;
    hz.is_finite().then(|| hz.clamp(-MAX_PITCH_HZ, MAX_PITCH_HZ))
}

/// The pitch factor of a change in Hz for a voice: (base + change) / base.
pub fn pitch_factor(voice: &str, hz: f32) -> f32 {
    let base = VOICES.iter().find(|entry| entry.id == voice).map_or(HIGH, |entry| entry.base_hz);
    ((base + hz) / base).max(0.3)
}

/// The engine and the engine voice of an option value.
pub fn parse(id: &str) -> Result<(Engine, &str), String> {
    if !VOICES.iter().any(|voice| voice.id == id) {
        return Err(format!("Unknown voice \"{id}\"."));
    }
    match id.split_once(':') {
        Some(("kokoro", speaker)) => Ok((Engine::Kokoro, speaker)),
        Some(("edge", name)) => Ok((Engine::Edge, name)),
        _ => Err(format!("Unknown voice \"{id}\".")),
    }
}

/// How to say a text.
pub struct Style {
    pub rate: f32,
    pub volume: f32,
    /// Pitch change in Hz. 0: the natural voice.
    pub pitch_hz: f32,
}

pub enum Audio {
    /// 16-bit WAV.
    Wav { samples: Vec<f32>, sample_rate: u32 },
    Mp3(Vec<u8>),
}

/// Offline models that make clips at the same time.
const KOKORO_SLOTS: usize = 2;

#[derive(Default)]
pub struct Engines {
    /// Offline voices: KOKORO_SLOTS models, so that two clips are made at the same time (the app asks for the
    /// current sentence and the next one together). Each model loads at its first use.
    kokoro: [Mutex<Option<OfflineTts>>; KOKORO_SLOTS],
    edge: Mutex<Option<MSEdgeTTSClient<std::net::TcpStream>>>,
}

impl Engines {
    pub fn speak(&self, voice: &str, text: &str, style: &Style, kokoro_folder: &Path) -> Result<Audio, String> {
        match parse(voice)? {
            (Engine::Kokoro, speaker) => self.kokoro(speaker.parse().unwrap_or(0), pitch_factor(voice, style.pitch_hz), text, style, kokoro_folder),
            (Engine::Edge, name) => self.edge(name, text, style),
        }
    }

    /// Frees the offline model, for example before its pack is deleted.
    pub fn unload(&self) {
        for slot in &self.kokoro {
            if let Ok(mut kokoro) = slot.lock() {
                *kokoro = None;
            }
        }
    }

    fn kokoro(&self, speaker: i32, factor: f32, text: &str, style: &Style, folder: &Path) -> Result<Audio, String> {
        // A free model, else wait for the first one.
        let mut slot = match self.kokoro.iter().find_map(|slot| slot.try_lock().ok()) {
            Some(slot) => slot,
            None => self.kokoro[0].lock().map_err(|_| "Internal lock error.")?,
        };
        if slot.is_none() {
            let file = |name: &str| Some(folder.join(name).to_string_lossy().to_string());
            let config = OfflineTtsConfig {
                model: OfflineTtsModelConfig {
                    kokoro: OfflineTtsKokoroModelConfig {
                        // The pack has one model file: int8 or fp32.
                        model: file(if folder.join("model.onnx").is_file() { "model.onnx" } else { "model.int8.onnx" }),
                        voices: file("voices.bin"),
                        tokens: file("tokens.txt"),
                        data_dir: file("espeak-ng-data"),
                        ..Default::default()
                    },
                    // The CPU threads are shared by the models.
                    num_threads: (4 / KOKORO_SLOTS as i32).max(1),
                    ..Default::default()
                },
                max_num_sentences: 1,
                ..Default::default()
            };
            *slot = Some(OfflineTts::create(&config).ok_or("The offline voice could not start. Download the voice pack again.")?);
        }
        let tts = slot.as_ref().expect("voice is loaded");
        // Speak slower by the pitch factor, then resample: the pitch changes, the speed stays.
        let generation = GenerationConfig { sid: speaker, speed: style.rate / factor, ..Default::default() };
        let generated = tts.generate_with_config(text, &generation, None::<fn(&[f32], f32) -> bool>).ok_or("The offline voice failed.")?;
        let samples = audio::resample(generated.samples(), factor);
        Ok(Audio::Wav { samples, sample_rate: generated.sample_rate() as u32 })
    }

    fn edge(&self, name: &str, text: &str, style: &Style) -> Result<Audio, String> {
        let config = SpeechConfig {
            voice_name: name.to_string(),
            audio_format: "audio-24khz-48kbitrate-mono-mp3".to_string(),
            // Edge takes the pitch change in Hz.
            pitch: style.pitch_hz.round() as i32,
            rate: ((style.rate - 1.0) * 100.0).round() as i32,
            volume: ((style.volume - 1.0) * 100.0).round() as i32,
        };
        let ssml_text = escape_xml(text);
        let mut slot = self.edge.lock().map_err(|_| "Internal lock error.")?;
        // A kept connection can close. Then connect one time again.
        for attempt in 0..2 {
            if slot.is_none() {
                *slot = Some(connect().map_err(|error| format!("The Microsoft voice service is not available: {error}"))?);
            }
            match slot.as_mut().expect("client exists").synthesize(&ssml_text, &config) {
                Ok(result) if !result.audio_bytes.is_empty() => return Ok(Audio::Mp3(result.audio_bytes)),
                Ok(_) | Err(_) if attempt == 0 => *slot = None,
                Ok(_) => return Err("The Microsoft voice service gave no audio.".to_string()),
                Err(error) => return Err(format!("The Microsoft voice service failed: {error}")),
            }
        }
        Err("The Microsoft voice service failed.".to_string())
    }
}

fn escape_xml(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&apos;")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_voices() {
        assert!(matches!(parse("kokoro:3"), Ok((Engine::Kokoro, "3"))));
        assert!(matches!(parse("edge:en-US-AvaNeural"), Ok((Engine::Edge, "en-US-AvaNeural"))));
        assert!(parse("edge:../x").is_err());
        assert!(parse(DEFAULT_VOICE).is_ok());
    }

    #[test]
    fn parses_pitch_in_hz() {
        assert_eq!(parse_pitch("+2 Hz"), Some(2.0));
        assert_eq!(parse_pitch("-1.5hz"), Some(-1.5));
        assert_eq!(parse_pitch("−3 Hz"), Some(-3.0));
        assert_eq!(parse_pitch("0"), Some(0.0));
        assert_eq!(parse_pitch("+500 Hz"), Some(MAX_PITCH_HZ));
        assert_eq!(parse_pitch("high"), None);
        assert!((pitch_factor("kokoro:5", 12.0) - 1.1).abs() < 1e-6);
        assert!((pitch_factor("kokoro:1", 0.0) - 1.0).abs() < 1e-6);
    }

    #[test]
    fn escapes_text_for_ssml() {
        assert_eq!(escape_xml("a < b & 'c'"), "a &lt; b &amp; &apos;c&apos;");
    }
}
