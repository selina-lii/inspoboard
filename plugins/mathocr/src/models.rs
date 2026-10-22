//! The model files: the user downloads them when necessary (one action for all files).
//! Each file has a fixed URL (a fixed revision) and a fixed SHA-256. A file with a different hash is never used.

use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use sha2::{Digest, Sha256};

pub struct ModelFile {
    pub file: &'static str,
    pub url: &'static str,
    pub sha256: &'static str,
    pub bytes: u64,
}

/// Pix2Text 1.5: formula detection (MFD) and formula recognition (MFR). Revisions of 2025.
pub const FILES: &[ModelFile] = &[
    ModelFile {
        file: "pix2text-mfd-1.5.onnx",
        url: "https://huggingface.co/breezedeus/pix2text-mfd-1.5/resolve/f470a885e0fca1d3d2bfa2a54991db7ae01f1861/pix2text-mfd-1.5.onnx",
        sha256: "40d4fc852d99bcbf25a9478897d2f49fbbb8f7fdd6569c088cd1c31386293bd7",
        bytes: 80_311_115,
    },
    ModelFile {
        file: "mfr-encoder.onnx",
        url: "https://huggingface.co/breezedeus/pix2text-mfr-1.5/resolve/1cef9f0bdcd6a4c63df7de1311fb0894593340cc/encoder_model.onnx",
        sha256: "080a3f660f08bc9ebcacdd96e34be6b6400f8c7e62d7cd0dd8251badc37f610b",
        bytes: 87_510_770,
    },
    ModelFile {
        file: "mfr-decoder.onnx",
        url: "https://huggingface.co/breezedeus/pix2text-mfr-1.5/resolve/1cef9f0bdcd6a4c63df7de1311fb0894593340cc/decoder_model.onnx",
        sha256: "917deb98e91a0453c5f234f58a0f32f9fb037de8527c7eb4ed394daf9e692f2a",
        bytes: 32_026_253,
    },
    ModelFile {
        file: "mfr-tokenizer.json",
        url: "https://huggingface.co/breezedeus/pix2text-mfr-1.5/resolve/1cef9f0bdcd6a4c63df7de1311fb0894593340cc/tokenizer.json",
        sha256: "4ffbeb2143e6a38324bb6111b7a8109530d38a076a8439aa5777535f0a32758a",
        bytes: 113_168,
    },
];

pub const DETECTOR: usize = 0;
pub const ENCODER: usize = 1;
pub const DECODER: usize = 2;
pub const TOKENIZER: usize = 3;

pub fn total_bytes() -> u64 {
    FILES.iter().map(|file| file.bytes).sum()
}

/// The folder for the models: `models` next to the plugin program.
pub fn folder() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf))
        .unwrap_or_else(|| PathBuf::from("."))
        .join("models")
}

pub fn path_of(folder: &Path, index: usize) -> PathBuf {
    folder.join(FILES[index].file)
}

/// The models are installed if each file has the right size. The hash was checked at download.
pub fn is_installed(folder: &Path) -> bool {
    FILES.iter().all(|file| fs::metadata(folder.join(file.file)).is_ok_and(|meta| meta.len() == file.bytes))
}

pub fn size_text(bytes: u64) -> String {
    format!("{} MB", (bytes as f64 / 1_000_000.0).round())
}

/// Downloads the files that are not installed. Each goes to `<file>.part`; after the hash check, a rename makes it the
/// model file. A cancel or an error removes the part file. `progress`: bytes done of all files.
pub fn download(folder: &Path, cancel: &AtomicBool, progress: &dyn Fn(u64, u64)) -> Result<(), String> {
    fs::create_dir_all(folder).map_err(|error| format!("{}: {error}", folder.display()))?;
    let config = ureq::Agent::config_builder().https_only(true).timeout_connect(Some(Duration::from_secs(30))).build();
    let agent: ureq::Agent = config.into();
    let total = total_bytes();
    let mut before: u64 = 0;
    for file in FILES {
        let target = folder.join(file.file);
        if fs::metadata(&target).is_ok_and(|meta| meta.len() == file.bytes) {
            before += file.bytes;
            progress(before, total);
            continue;
        }
        let response = agent.get(file.url).call().map_err(|error| format!("The download failed: {error}"))?;
        let reader = response.into_body().into_reader();
        let part = folder.join(format!("{}.part", file.file));
        match save(reader, &part, file, cancel, &|done| progress(before + done, total)) {
            Ok(()) => fs::rename(&part, &target).map_err(|error| format!("{}: {error}", part.display()))?,
            Err(error) => {
                let _ = fs::remove_file(&part);
                return Err(error);
            }
        }
        before += file.bytes;
    }
    Ok(())
}

/// Removes the model files (and part files of a stopped download).
pub fn delete(folder: &Path) -> Result<(), String> {
    for file in FILES {
        for path in [folder.join(file.file), folder.join(format!("{}.part", file.file))] {
            if path.exists() {
                fs::remove_file(&path).map_err(|error| format!("{}: {error}", path.display()))?;
            }
        }
    }
    Ok(())
}

/// Writes the stream to `part` and checks its size and hash.
pub fn save(mut reader: impl Read, part: &Path, model: &ModelFile, cancel: &AtomicBool, progress: &dyn Fn(u64)) -> Result<(), String> {
    let mut file = File::create(part).map_err(|error| format!("{}: {error}", part.display()))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1 << 20];
    let mut done: u64 = 0;
    let mut last = Instant::now();
    loop {
        if cancel.load(Ordering::SeqCst) {
            return Err("Cancelled.".to_string());
        }
        let count = reader.read(&mut buffer).map_err(|error| format!("The download failed: {error}"))?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
        file.write_all(&buffer[..count]).map_err(|error| format!("{}: {error}", part.display()))?;
        done += count as u64;
        if last.elapsed() > Duration::from_millis(250) {
            progress(done);
            last = Instant::now();
        }
    }
    file.sync_all().map_err(|error| format!("{}: {error}", part.display()))?;
    progress(done);
    let hash: String = hasher.finalize().iter().map(|b| format!("{b:02x}")).collect();
    if done != model.bytes || hash != model.sha256 {
        return Err(format!("The downloaded file is not correct (size {done}, SHA-256 {hash}). It was deleted."));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_FILE: ModelFile = ModelFile {
        file: "test.bin",
        url: "https://example.invalid/",
        // SHA-256 of "hello".
        sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
        bytes: 5,
    };

    #[test]
    fn checks_hash_and_size() {
        let folder = tempfile::tempdir().unwrap();
        let part = folder.path().join("test.bin.part");
        let cancel = AtomicBool::new(false);
        assert!(save(&b"hello"[..], &part, &TEST_FILE, &cancel, &|_| ()).is_ok());
        assert!(save(&b"hellO"[..], &part, &TEST_FILE, &cancel, &|_| ()).is_err());
        cancel.store(true, Ordering::SeqCst);
        assert_eq!(save(&b"hello"[..], &part, &TEST_FILE, &cancel, &|_| ()).unwrap_err(), "Cancelled.");
    }

    #[test]
    fn files_are_pinned() {
        assert!(FILES.iter().all(|file| file.url.starts_with("https://") && file.sha256.len() == 64 && !file.url.contains("/main/")));
    }
}
