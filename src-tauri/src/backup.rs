//! Backups: a full copy of the vault data in `<vault>/.backup/<time>/`. See docs/SPEC.md section 6.
//!
//! - A backup holds the same files as a time machine snapshot: vault.json and the data folders.
//! - Each backup is a plain folder. To restore, the user copies its files back into the vault.
//! - The folder name is the UTC time, "YYYY-MM-DD_HH-MM-SS". A second backup in the same second gets "-2", "-3", ...
//!   The migration scripts put their backup here too ("<time>_before-migration").
//! - The backup menu lists the backups (name, size) and deletes one: for good (to free disk space), after the user
//!   confirms. Only a folder directly in .backup can be deleted.

use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::history::snapshot_files;
use crate::vault_fs::describe;

pub const BACKUP_FOLDER: &str = ".backup";

#[derive(Debug, serde::Serialize)]
pub struct BackupInfo {
    /// The full path of the backup folder.
    pub path: String,
    /// The size of this backup in bytes.
    pub bytes: u64,
    /// The number of files.
    pub files: usize,
}

/// Copies the vault data into a new backup folder.
pub fn backup(root: &Path) -> Result<BackupInfo, String> {
    let base = root.join(BACKUP_FOLDER);
    let name = time_name(SystemTime::now().duration_since(UNIX_EPOCH).map(|time| time.as_secs()).unwrap_or(0));
    let mut target = base.join(&name);
    let mut number = 2;
    while target.exists() {
        target = base.join(format!("{name}-{number}"));
        number += 1;
    }
    let files = snapshot_files(root)?;
    let mut bytes = 0;
    for relative in &files {
        let from = root.join(relative);
        let to = target.join(relative);
        if let Some(parent) = to.parent() {
            fs::create_dir_all(parent).map_err(|error| describe(parent, error))?;
        }
        bytes += fs::copy(&from, &to).map_err(|error| describe(&from, error))?;
    }
    fs::create_dir_all(&target).map_err(|error| describe(&target, error))?;
    Ok(BackupInfo { path: target.to_string_lossy().to_string(), bytes, files: files.len() })
}

#[derive(Debug, serde::Serialize)]
pub struct BackupEntry {
    /// The folder name (for example "2026-10-11_12-00-00").
    pub name: String,
    pub path: String,
    pub bytes: u64,
    pub files: usize,
}

/// The backups of the vault, the newest first (by name: the names start with the time).
pub fn list(root: &Path) -> Result<Vec<BackupEntry>, String> {
    let base = root.join(BACKUP_FOLDER);
    let entries = match fs::read_dir(&base) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(describe(&base, error)),
    };
    let mut list = Vec::new();
    for entry in entries.flatten() {
        let Ok(kind) = entry.file_type() else { continue };
        if !kind.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let (bytes, files) = size_of(&entry.path());
        list.push(BackupEntry { path: entry.path().to_string_lossy().to_string(), name, bytes, files });
    }
    list.sort_by(|a, b| b.name.cmp(&a.name));
    Ok(list)
}

/// The size and the number of files of a folder (links are not followed).
fn size_of(folder: &Path) -> (u64, usize) {
    let mut bytes = 0;
    let mut files = 0;
    let mut stack = vec![folder.to_path_buf()];
    while let Some(current) = stack.pop() {
        let Ok(entries) = fs::read_dir(&current) else { continue };
        for entry in entries.flatten() {
            let Ok(meta) = entry.path().symlink_metadata() else { continue };
            if meta.is_dir() {
                stack.push(entry.path());
            } else {
                bytes += meta.len();
                files += 1;
            }
        }
    }
    (bytes, files)
}

/// Deletes one backup folder for good. `name` must be a folder directly in .backup (no path, not a link).
pub fn delete(root: &Path, name: &str) -> Result<(), String> {
    if name.is_empty() || name.starts_with('.') || name.contains(['/', '\\']) {
        return Err(format!("\"{name}\" is not a backup."));
    }
    let target = root.join(BACKUP_FOLDER).join(name);
    let meta = target.symlink_metadata().map_err(|error| describe(&target, error))?;
    if !meta.is_dir() {
        return Err(format!("\"{name}\" is not a backup folder."));
    }
    fs::remove_dir_all(&target).map_err(|error| describe(&target, error))
}

/// "YYYY-MM-DD_HH-MM-SS" (UTC) of seconds since 1970.
fn time_name(seconds: u64) -> String {
    let days = (seconds / 86_400) as i64;
    let rest = seconds % 86_400;
    // Civil date from days (Howard Hinnant's algorithm).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let day_of_era = z - era * 146_097;
    let year_of_era = (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let mp = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    format!("{year:04}-{month:02}-{day:02}_{:02}-{:02}-{:02}", rest / 3600, rest % 3600 / 60, rest % 60)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault_fs::write_atomic;

    #[test]
    fn names_by_utc_time() {
        assert_eq!(time_name(0), "1970-01-01_00-00-00");
        assert_eq!(time_name(1_788_000_000), "2026-08-29_10-40-00");
        assert_eq!(time_name(951_782_400), "2000-02-29_00-00-00");
    }

    #[test]
    fn copies_the_data_files_only() {
        let folder = tempfile::tempdir().unwrap();
        write_atomic(folder.path(), "vault.json", "{}\n").unwrap();
        write_atomic(folder.path(), "items/a1b2c3d4e5f6.md", "text").unwrap();
        fs::create_dir_all(folder.path().join(".inspoboard")).unwrap();
        fs::write(folder.path().join(".inspoboard/x"), "cache").unwrap();
        let first = backup(folder.path()).unwrap();
        assert_eq!(first.files, 2);
        assert_eq!(first.bytes, 7);
        let target = Path::new(&first.path);
        assert_eq!(fs::read_to_string(target.join("items/a1b2c3d4e5f6.md")).unwrap(), "text");
        assert!(!target.join(".inspoboard").exists());
        // A second backup does not hold the first one, and has its own folder.
        let second = backup(folder.path()).unwrap();
        assert_ne!(first.path, second.path);
        assert_eq!(second.files, 2);
    }

    #[test]
    fn lists_and_deletes_backups_only() {
        let folder = tempfile::tempdir().unwrap();
        write_atomic(folder.path(), "vault.json", "{}\n").unwrap();
        write_atomic(folder.path(), "items/a1b2c3d4e5f6.md", "text").unwrap();
        let made = backup(folder.path()).unwrap();
        let listed = list(folder.path()).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].path, made.path);
        assert_eq!((listed[0].bytes, listed[0].files), (7, 2));
        // Names with a path, or outside .backup, are refused. The vault stays.
        assert!(delete(folder.path(), "../items").is_err());
        assert!(delete(folder.path(), "..").is_err());
        assert!(delete(folder.path(), "").is_err());
        assert!(delete(folder.path(), "no-such-backup").is_err());
        delete(folder.path(), &listed[0].name).unwrap();
        assert!(list(folder.path()).unwrap().is_empty());
        assert!(folder.path().join("items/a1b2c3d4e5f6.md").is_file());
    }
}
