//! File access inside a vault. See docs/SPEC.md sections 3 and 4.1.
//!
//! Rules:
//! - The app writes only to paths on the allow list (`is_writable_path`).
//! - Each write is atomic: temporary file, flush, rename.
//! - A delete moves the file to `.inspoboard/trash`. It never removes data.

use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub const APP_FOLDER: &str = ".inspoboard";
const VAULT_FILE: &str = "vault.json";
const TABLE_FILES: [&str; 4] = ["table/items.jsonl", "table/links.jsonl", "table/stamps.jsonl", "table/outlines.jsonl"];
const ITEMS_FOLDER: &str = "items";
/// App state that is not core data: the time each item was last opened, and the vault settings.
/// Not in history snapshots.
const APP_STATE_FILES: [&str; 2] = [".inspoboard/opened.json", ".inspoboard/settings.json"];
const ID_LENGTH: usize = 12;

/// One file of the vault. `path` is relative to the vault and uses `/`.
#[derive(Debug, Clone, serde::Serialize)]
pub struct VaultFile {
    pub path: String,
    pub content: String,
}

#[derive(Debug, Default, serde::Serialize)]
pub struct VaultRead {
    pub files: Vec<VaultFile>,
    /// Files that are not valid UTF-8. The app opens the vault as read-only.
    pub unreadable: Vec<String>,
}

/// True for the paths that the app can write: vault.json, the tables, `items/<id>.md`, and the app state files.
pub fn is_writable_path(relative: &str) -> bool {
    if relative == VAULT_FILE || TABLE_FILES.contains(&relative) || APP_STATE_FILES.contains(&relative) {
        return true;
    }
    let Some(name) = relative.strip_prefix("items/") else { return false };
    let Some(id) = name.strip_suffix(".md") else { return false };
    id.len() == ID_LENGTH && id.bytes().all(|b| b.is_ascii_digit() || b.is_ascii_lowercase())
}

/// Converts an allowed relative path to a full path in the vault.
pub fn resolve(root: &Path, relative: &str) -> Result<PathBuf, String> {
    if !is_writable_path(relative) {
        return Err(format!("The path \"{relative}\" is not a vault data file."));
    }
    Ok(relative.split('/').fold(root.to_path_buf(), |path, part| path.join(part)))
}

/// Reads vault.json, the tables, and all files directly in `items/`.
/// Other files (assets, the app folder, user files) are not read.
pub fn read_vault(root: &Path) -> Result<VaultRead, String> {
    let mut result = VaultRead::default();
    let mut candidates: Vec<String> = Vec::new();
    candidates.push(VAULT_FILE.to_string());
    candidates.extend(TABLE_FILES.iter().map(|path| path.to_string()));
    candidates.extend(APP_STATE_FILES.iter().map(|path| path.to_string()));
    let items_folder = root.join(ITEMS_FOLDER);
    if items_folder.is_dir() {
        let entries = fs::read_dir(&items_folder).map_err(|error| describe(&items_folder, error))?;
        for entry in entries {
            let entry = entry.map_err(|error| describe(&items_folder, error))?;
            if !entry.file_type().map_err(|error| describe(&entry.path(), error))?.is_file() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.starts_with('.') {
                candidates.push(format!("{ITEMS_FOLDER}/{name}"));
            }
        }
    }
    for relative in candidates {
        let full = relative.split('/').fold(root.to_path_buf(), |path, part| path.join(part));
        if !full.is_file() {
            continue;
        }
        let bytes = fs::read(&full).map_err(|error| describe(&full, error))?;
        match String::from_utf8(bytes) {
            Ok(content) => result.files.push(VaultFile { path: relative, content }),
            Err(_) => result.unreadable.push(relative),
        }
    }
    Ok(result)
}

/// Writes a file atomically. A crash leaves the old file or the new file, never a part.
pub fn write_atomic(root: &Path, relative: &str, content: &str) -> Result<(), String> {
    let target = resolve(root, relative)?;
    let folder = target.parent().ok_or_else(|| format!("No parent folder for \"{relative}\"."))?;
    fs::create_dir_all(folder).map_err(|error| describe(folder, error))?;
    let file_name = target.file_name().map(|name| name.to_string_lossy().to_string()).unwrap_or_default();
    let temporary = folder.join(format!(".{file_name}.tmp-{}", std::process::id()));

    let write_result = (|| -> Result<(), String> {
        let mut file = File::create(&temporary).map_err(|error| describe(&temporary, error))?;
        file.write_all(content.as_bytes()).map_err(|error| describe(&temporary, error))?;
        file.sync_all().map_err(|error| describe(&temporary, error))?;
        fs::rename(&temporary, &target).map_err(|error| describe(&target, error))?;
        sync_folder(folder);
        Ok(())
    })();
    if write_result.is_err() {
        // The old file is not changed. Remove the temporary file if it exists.
        let _ = fs::remove_file(&temporary);
    }
    write_result
}

/// Moves a data file to `.inspoboard/trash`. The file is never removed.
pub fn move_to_trash(root: &Path, relative: &str) -> Result<(), String> {
    let source = resolve(root, relative)?;
    if !source.exists() {
        return Ok(());
    }
    let trash = root.join(APP_FOLDER).join("trash");
    fs::create_dir_all(&trash).map_err(|error| describe(&trash, error))?;
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map(|time| time.as_millis()).unwrap_or(0);
    let target = trash.join(format!("{stamp}-{}", relative.replace('/', "_")));
    fs::rename(&source, &target).map_err(|error| describe(&source, error))?;
    sync_folder(source.parent().unwrap_or(root));
    Ok(())
}

/// Flushes the folder entry after a rename. Only Unix systems support this.
fn sync_folder(folder: &Path) {
    #[cfg(unix)]
    if let Ok(handle) = File::open(folder) {
        let _ = handle.sync_all();
    }
    #[cfg(not(unix))]
    let _ = folder;
}

pub fn describe(path: &Path, error: std::io::Error) -> String {
    format!("{}: {error}", path.display())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_only_data_files() {
        assert!(is_writable_path("vault.json"));
        assert!(is_writable_path("table/links.jsonl"));
        assert!(is_writable_path("items/a1b2c3d4e5f6.md"));
        assert!(!is_writable_path("items/../../etc.md"));
        assert!(!is_writable_path("items/A1B2C3D4E5F6.md"));
        assert!(!is_writable_path(".inspoboard/lock"));
        assert!(is_writable_path(".inspoboard/opened.json"));
        assert!(is_writable_path(".inspoboard/settings.json"));
        assert!(!is_writable_path(".inspoboard/history/HEAD"));
        assert!(!is_writable_path("assets/photo.png"));
        assert!(!is_writable_path("/vault.json"));
    }

    #[test]
    fn writes_atomically_and_reads_back() {
        let folder = tempfile::tempdir().unwrap();
        write_atomic(folder.path(), "items/a1b2c3d4e5f6.md", "one\r\ntwo").unwrap();
        write_atomic(folder.path(), "items/a1b2c3d4e5f6.md", "three").unwrap();
        let read = read_vault(folder.path()).unwrap();
        assert_eq!(read.files.len(), 1);
        assert_eq!(read.files[0].content, "three");
        let leftovers: Vec<_> = fs::read_dir(folder.path().join("items")).unwrap().collect();
        assert_eq!(leftovers.len(), 1, "no temporary file stays");
    }

    #[test]
    fn trash_keeps_the_file() {
        let folder = tempfile::tempdir().unwrap();
        write_atomic(folder.path(), "items/a1b2c3d4e5f6.md", "keep me").unwrap();
        move_to_trash(folder.path(), "items/a1b2c3d4e5f6.md").unwrap();
        assert!(!folder.path().join("items/a1b2c3d4e5f6.md").exists());
        let trash: Vec<_> = fs::read_dir(folder.path().join(".inspoboard/trash")).unwrap().collect();
        assert_eq!(trash.len(), 1);
    }

    #[test]
    fn reports_files_that_are_not_utf8() {
        let folder = tempfile::tempdir().unwrap();
        fs::create_dir_all(folder.path().join("items")).unwrap();
        fs::write(folder.path().join("items/a1b2c3d4e5f6.md"), [0xff, 0xfe, 0x00]).unwrap();
        let read = read_vault(folder.path()).unwrap();
        assert_eq!(read.unreadable, vec!["items/a1b2c3d4e5f6.md".to_string()]);
    }
}
