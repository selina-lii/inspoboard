//! Backups: a full copy of the vault data in `<vault>/.backup/<time>/`. See docs/SPEC.md section 6.
//!
//! - A backup holds the same files as a time machine snapshot: vault.json and the data folders.
//! - Each backup is a plain folder. To restore, the user copies its files back into the vault.
//! - The folder name is the UTC time, "YYYY-MM-DD_HH-MM-SS". A second backup in the same second gets "-2", "-3", ...

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
}
