//! Language packs: model files that the user downloads when necessary.
//! Each pack has a fixed URL and a fixed SHA-256. A file with a different hash is never used.

use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use sha2::{Digest, Sha256};

use crate::langs::Route;

pub struct Pack {
    pub id: &'static str,
    pub name: &'static str,
    pub route: Route,
    pub file: &'static str,
    pub url: &'static str,
    pub sha256: &'static str,
    pub bytes: u64,
    pub license: &'static str,
}

pub const PACKS: &[Pack] = &[
    Pack {
        id: "zh-en",
        name: "Chinese ↔ English",
        route: Route::ZhEn,
        file: "HY-MT1.5-1.8B-Q4_K_M.gguf",
        url: "https://huggingface.co/tencent/HY-MT1.5-1.8B-GGUF/resolve/main/HY-MT1.5-1.8B-Q4_K_M.gguf",
        sha256: "4383ac0c3c8e476de98ff979c2a3f069f8c4fb385e7860cf2d28da896cc477c7",
        bytes: 1_133_080_512,
        license: "Tencent Hy-MT 1.5",
    },
    Pack {
        id: "multi",
        name: "Other languages",
        route: Route::Multi,
        file: "translategemma-4b-it.Q4_K_M.gguf",
        url: "https://huggingface.co/mradermacher/translategemma-4b-it-GGUF/resolve/main/translategemma-4b-it.Q4_K_M.gguf",
        sha256: "81200d03e843d2ec1ece6eeafe7d13cb6e5211e1fcd336ade55790b683a08330",
        bytes: 2_489_909_760,
        license: "Google TranslateGemma 4B",
    },
];

pub fn pack_for(route: Route) -> Option<&'static Pack> {
    PACKS.iter().find(|pack| pack.route == route)
}

pub fn by_id(id: &str) -> Option<&'static Pack> {
    PACKS.iter().find(|pack| pack.id == id)
}

/// The folder for packs: `packs` next to the plugin program.
pub fn folder() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf))
        .unwrap_or_else(|| PathBuf::from("."))
        .join("packs")
}

pub fn path_of(folder: &Path, pack: &Pack) -> PathBuf {
    folder.join(pack.file)
}

/// A pack is installed if its file has the right size. The hash was checked at download.
pub fn is_installed(folder: &Path, pack: &Pack) -> bool {
    fs::metadata(path_of(folder, pack)).is_ok_and(|meta| meta.len() == pack.bytes)
}

pub fn size_text(bytes: u64) -> String {
    format!("{:.1} GB", bytes as f64 / 1_000_000_000.0)
}

/// Downloads a pack. The data goes to `<file>.part`. After the hash check, a rename makes it the pack file.
/// A cancel or an error removes the part file.
pub fn download(folder: &Path, pack: &Pack, cancel: &AtomicBool, progress: &dyn Fn(u64, u64)) -> Result<(), String> {
    fs::create_dir_all(folder).map_err(|error| format!("{}: {error}", folder.display()))?;
    let config = ureq::Agent::config_builder().https_only(true).timeout_connect(Some(Duration::from_secs(30))).build();
    let agent: ureq::Agent = config.into();
    let response = agent.get(pack.url).call().map_err(|error| format!("The download failed: {error}"))?;
    let reader = response.into_body().into_reader();
    let part = folder.join(format!("{}.part", pack.file));
    let result = save(reader, &part, pack, cancel, progress);
    match result {
        Ok(()) => fs::rename(&part, path_of(folder, pack)).map_err(|error| format!("{}: {error}", part.display())),
        Err(error) => {
            let _ = fs::remove_file(&part);
            Err(error)
        }
    }
}

/// Writes the stream to `part` and checks its size and hash.
pub fn save(mut reader: impl Read, part: &Path, pack: &Pack, cancel: &AtomicBool, progress: &dyn Fn(u64, u64)) -> Result<(), String> {
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
            progress(done, pack.bytes);
            last = Instant::now();
        }
    }
    file.sync_all().map_err(|error| format!("{}: {error}", part.display()))?;
    progress(done, pack.bytes);
    let hash = hex(&hasher.finalize());
    if done != pack.bytes || hash != pack.sha256 {
        return Err(format!("The downloaded file is not correct (size {done}, SHA-256 {hash}). It was deleted."));
    }
    Ok(())
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_PACK: Pack = Pack {
        id: "test",
        name: "Test",
        route: Route::Multi,
        file: "test.bin",
        url: "https://example.invalid/",
        // SHA-256 of "hello".
        sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
        bytes: 5,
        license: "",
    };

    #[test]
    fn checks_hash_and_size() {
        let folder = tempfile::tempdir().unwrap();
        let part = folder.path().join("test.bin.part");
        let cancel = AtomicBool::new(false);
        assert!(save(&b"hello"[..], &part, &TEST_PACK, &cancel, &|_, _| ()).is_ok());
        assert!(save(&b"hellO"[..], &part, &TEST_PACK, &cancel, &|_, _| ()).is_err());
        cancel.store(true, Ordering::SeqCst);
        assert_eq!(save(&b"hello"[..], &part, &TEST_PACK, &cancel, &|_, _| ()).unwrap_err(), "Cancelled.");
    }

    #[test]
    fn each_route_has_a_pack() {
        assert_eq!(pack_for(Route::ZhEn).unwrap().id, "zh-en");
        assert_eq!(pack_for(Route::Multi).unwrap().id, "multi");
        assert!(pack_for(Route::Same).is_none());
        assert!(PACKS.iter().all(|pack| pack.url.starts_with("https://") && pack.sha256.len() == 64));
    }
}
