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
#[derive(Clone, Copy)]
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
            let config = kokoro_config(folder, kokoro_threads(), None);
            *slot = Some(OfflineTts::create(&config).ok_or("The offline voice could not start. Download the voice pack again.")?);
        }
        let tts = slot.as_ref().expect("voice is loaded");
        // Speak slower by the pitch factor, then resample: the pitch changes, the speed stays.
        let generation = GenerationConfig { sid: speaker, speed: style.rate / factor, ..Default::default() };
        let generated = tts.generate_with_config(text, &generation, None::<fn(&[f32], f32) -> bool>).ok_or("The offline voice failed.")?;
        // The caller trims the silence at the ends (see audio::trim_silence).
        Ok(Audio::Wav { samples: audio::resample(generated.samples(), factor), sample_rate: generated.sample_rate() as u32 })
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

/// CPU threads for each offline model: the cores less two (for the app and the system), shared by the models.
/// Measured on an Apple M4 (10 cores): 2 models × 4 threads make speech 1.6 times as fast as 2 × 2, and nearly as
/// fast as 4 × 2 with half the memory. More threads for one model help less (see the test "bench").
fn kokoro_threads() -> i32 {
    let cores = std::thread::available_parallelism().map_or(4, |count| count.get());
    (cores.saturating_sub(2) / KOKORO_SLOTS).max(1) as i32
}

/// The settings of one offline model: the pack files, the CPU threads, and the provider ("cpu", "coreml"; None: CPU).
fn kokoro_config(folder: &Path, threads: i32, provider: Option<&str>) -> OfflineTtsConfig {
    let file = |name: &str| Some(folder.join(name).to_string_lossy().to_string());
    OfflineTtsConfig {
        model: OfflineTtsModelConfig {
            kokoro: OfflineTtsKokoroModelConfig {
                // The pack has one model file: int8 or fp32.
                model: file(if folder.join("model.onnx").is_file() { "model.onnx" } else { "model.int8.onnx" }),
                voices: file("voices.bin"),
                tokens: file("tokens.txt"),
                data_dir: file("espeak-ng-data"),
                ..Default::default()
            },
            num_threads: threads,
            provider: provider.map(str::to_string),
            ..Default::default()
        },
        max_num_sentences: 1,
        ..Default::default()
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

    /// Speed of the offline voice for models × threads (and CoreML). Not a normal test: it needs the voice pack.
    /// BENCH_PACK=<pack folder> BENCH_TEXT=<text file> cargo test --release bench -- --ignored --nocapture
    #[test]
    #[ignore]
    fn bench() {
        let folder = std::path::PathBuf::from(std::env::var("BENCH_PACK").expect("BENCH_PACK"));
        let text = std::fs::read_to_string(std::env::var("BENCH_TEXT").expect("BENCH_TEXT")).unwrap();
        let count: usize = std::env::var("BENCH_COUNT").ok().and_then(|value| value.parse().ok()).unwrap_or(40);
        let sentences: Vec<String> = crate::sentences::split(&text).into_iter().map(|sentence| sentence.speech).filter(|speech| speech.len() > 20).skip(20).take(count).collect();
        let configs: Vec<(usize, i32, Option<&str>)> = std::env::var("BENCH_CONFIGS")
            .unwrap_or_else(|_| "1x4,2x2,1x8,2x4,4x2,3x3,4x1,1x4c".to_string())
            .split(',')
            .map(|entry| {
                let coreml = entry.ends_with('c');
                let (models, threads) = entry.trim_end_matches('c').split_once('x').unwrap();
                (models.parse().unwrap(), threads.parse().unwrap(), coreml.then_some("coreml"))
            })
            .collect();
        for (models, threads, provider) in configs {
            let engines: Vec<OfflineTts> = (0..models).map(|_| OfflineTts::create(&kokoro_config(&folder, threads, provider)).expect("model")).collect();
            // Warm up each model once.
            for tts in &engines {
                tts.generate_with_config("Hello there.", &GenerationConfig { sid: 1, ..Default::default() }, None::<fn(&[f32], f32) -> bool>);
            }
            let next = std::sync::atomic::AtomicUsize::new(0);
            let audio = Mutex::new(0.0f64);
            let start = std::time::Instant::now();
            std::thread::scope(|scope| {
                for tts in &engines {
                    scope.spawn(|| {
                        loop {
                            let index = next.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                            let Some(sentence) = sentences.get(index) else { break };
                            let generated = tts.generate_with_config(sentence, &GenerationConfig { sid: 1, ..Default::default() }, None::<fn(&[f32], f32) -> bool>).unwrap();
                            *audio.lock().unwrap() += generated.samples().len() as f64 / generated.sample_rate() as f64;
                        }
                    });
                }
            });
            let seconds = start.elapsed().as_secs_f64();
            let audio = *audio.lock().unwrap();
            println!("{models} models x {threads} threads {}: {:.2} s per sentence, {:.1} s of speech per second", provider.unwrap_or("cpu"), seconds / sentences.len() as f64, audio / seconds);
        }
    }

    /// The silence at the start and the end of clips (ms). Needs the voice pack, as "bench".
    #[test]
    #[ignore]
    fn silence_at_ends() {
        let folder = std::path::PathBuf::from(std::env::var("BENCH_PACK").expect("BENCH_PACK"));
        let tts = OfflineTts::create(&kokoro_config(&folder, 4, None)).expect("model");
        for text in ["The cells fire in a burst.", "However, the effect was small, and it did not last.", "Results are shown in Table 2."] {
            let generated = tts.generate_with_config(text, &GenerationConfig { sid: 1, ..Default::default() }, None::<fn(&[f32], f32) -> bool>).unwrap();
            let samples = generated.samples();
            let rate = generated.sample_rate() as f32;
            let loud = |sample: &&f32| sample.abs() > 0.01;
            let start = samples.iter().position(|sample| loud(&sample)).unwrap_or(0);
            let end = samples.len() - samples.iter().rposition(|sample| loud(&sample)).unwrap_or(samples.len());
            println!("{text}: {:.0} ms at the start, {:.0} ms at the end, {:.0} ms in all", start as f32 / rate * 1000.0, end as f32 / rate * 1000.0, samples.len() as f32 / rate * 1000.0);
        }
    }

    #[test]
    fn escapes_text_for_ssml() {
        assert_eq!(escape_xml("a < b & 'c'"), "a &lt; b &amp; &apos;c&apos;");
    }
}
