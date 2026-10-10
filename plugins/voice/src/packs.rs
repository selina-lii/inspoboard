//! The offline voice pack: a fixed archive with a fixed SHA-256. The download runs only on a user action.

use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use sha2::{Digest, Sha256};

pub struct Pack {
    pub id: &'static str,
    pub name: &'static str,
    pub url: &'static str,
    pub sha256: &'static str,
    pub bytes: u64,
    /// The folder in the archive. It holds the model files.
    pub folder: &'static str,
    pub license: &'static str,
}

/// The full-precision model. On Apple CPUs it speaks about two times faster than the int8 model.
pub const KOKORO: Pack = Pack {
    id: "kokoro-en",
    name: "Offline English voices (Kokoro, 11 voices)",
    url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-en-v0_19.tar.bz2",
    sha256: "912804855a04745fa77a30be545b3f9a5d15c4d66db00b88cbcd4921df605ac7",
    bytes: 319_625_534,
    folder: "kokoro-en-v0_19",
    license: "Kokoro 82M",
};

/// The folder of the int8 pack of version 0.1.0. A new install removes it.
pub const OLD_FOLDER: &str = "kokoro-int8-en-v0_19";

/// Written after a complete extraction. Without it, the pack is not installed.
const COMPLETE: &str = ".complete";

/// The folder for packs: `packs` next to the plugin program.
pub fn root() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf))
        .unwrap_or_else(|| PathBuf::from("."))
        .join("packs")
}

pub fn model_folder(root: &Path, pack: &Pack) -> PathBuf {
    root.join(pack.folder)
}

pub fn is_installed(root: &Path, pack: &Pack) -> bool {
    model_folder(root, pack).join(COMPLETE).is_file()
}

pub fn size_text(bytes: u64) -> String {
    format!("{:.0} MB", bytes as f64 / 1_000_000.0)
}

/// Downloads, checks, and extracts the pack. Then it deletes the archive.
pub fn install(root: &Path, pack: &Pack, cancel: &AtomicBool, progress: &dyn Fn(u64, u64)) -> Result<(), String> {
    fs::create_dir_all(root).map_err(|error| format!("{}: {error}", root.display()))?;
    let archive = root.join(format!("{}.tar.bz2.part", pack.id));
    let result = download(pack, &archive, cancel, progress).and_then(|()| extract(root, pack, &archive));
    let _ = fs::remove_file(&archive);
    result
}

fn download(pack: &Pack, archive: &Path, cancel: &AtomicBool, progress: &dyn Fn(u64, u64)) -> Result<(), String> {
    let config = ureq::Agent::config_builder().https_only(true).timeout_connect(Some(Duration::from_secs(30))).build();
    let agent: ureq::Agent = config.into();
    let response = agent.get(pack.url).call().map_err(|error| format!("The download failed: {error}"))?;
    save(response.into_body().into_reader(), archive, pack, cancel, progress)
}

/// Writes the stream to `path` and checks its size and hash.
pub fn save(mut reader: impl Read, path: &Path, pack: &Pack, cancel: &AtomicBool, progress: &dyn Fn(u64, u64)) -> Result<(), String> {
    let mut file = File::create(path).map_err(|error| format!("{}: {error}", path.display()))?;
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
        file.write_all(&buffer[..count]).map_err(|error| format!("{}: {error}", path.display()))?;
        done += count as u64;
        if last.elapsed() > Duration::from_millis(250) {
            progress(done, pack.bytes);
            last = Instant::now();
        }
    }
    file.sync_all().map_err(|error| format!("{}: {error}", path.display()))?;
    progress(done, pack.bytes);
    let hash: String = hasher.finalize().iter().map(|b| format!("{b:02x}")).collect();
    if done != pack.bytes || hash != pack.sha256 {
        return Err(format!("The downloaded file is not correct (size {done}, SHA-256 {hash}). It was deleted."));
    }
    Ok(())
}

/// Extracts into a temporary folder, then renames it. A part extraction never looks installed.
fn extract(root: &Path, pack: &Pack, archive: &Path) -> Result<(), String> {
    let temporary = root.join(format!(".{}.extract", pack.id));
    let _ = fs::remove_dir_all(&temporary);
    let file = File::open(archive).map_err(|error| format!("{}: {error}", archive.display()))?;
    tar::Archive::new(bzip2::read::BzDecoder::new(file))
        .unpack(&temporary)
        .map_err(|error| format!("The voice pack could not be extracted: {error}"))?;
    let extracted = temporary.join(pack.folder);
    if !extracted.join("model.onnx").is_file() && !extracted.join("model.int8.onnx").is_file() {
        let _ = fs::remove_dir_all(&temporary);
        return Err("The voice pack does not have the expected files.".to_string());
    }
    fs::write(extracted.join(COMPLETE), "").map_err(|error| error.to_string())?;
    let target = model_folder(root, pack);
    let _ = fs::remove_dir_all(&target);
    fs::rename(&extracted, &target).map_err(|error| format!("{}: {error}", target.display()))?;
    let _ = fs::remove_dir_all(&temporary);
    let _ = fs::remove_dir_all(root.join(OLD_FOLDER));
    Ok(())
}

pub fn delete(root: &Path, pack: &Pack) -> Result<(), String> {
    let folder = model_folder(root, pack);
    fs::remove_dir_all(&folder).map_err(|error| format!("{}: {error}", folder.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checks_hash_and_size() {
        let pack = Pack { sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824", bytes: 5, ..KOKORO };
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("x.part");
        let cancel = AtomicBool::new(false);
        assert!(save(&b"hello"[..], &path, &pack, &cancel, &|_, _| ()).is_ok());
        assert!(save(&b"hellO"[..], &path, &pack, &cancel, &|_, _| ()).is_err());
        assert!(!is_installed(folder.path(), &pack));
    }
}
