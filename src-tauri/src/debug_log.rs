//! The session log (SPEC 10): what the app did, for debugging. One file for each app session, in the vault:
//! `.inspoboard/logs/session-<UTC time>.log`. The last LOG_COUNT logs stay; older ones are removed.
//! - Each line is written and flushed at once: after a crash or a force quit, the log has the lines up to then.
//! - It has no text of notes or pages: only events, item IDs, durations, and errors.
//! - A watchdog: the UI sends a heartbeat each second (with its events). No heartbeat for HANG_SECONDS: the log
//!   says that the UI does not respond, and later how long it did not respond.
//! - Before a vault opens, lines wait in memory; they go into the log of the first vault that opens.

use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const LOG_COUNT: usize = 10;
const HANG_SECONDS: u64 = 5;
const EXIT_LINE: &str = "Exit: normal.";

#[derive(Default)]
struct Log {
    file: Option<File>,
    path: Option<PathBuf>,
    waiting: Vec<String>,
    heartbeat: Option<Instant>,
    hanging_since: Option<Instant>,
}

fn log() -> &'static Mutex<Log> {
    static LOG: OnceLock<Mutex<Log>> = OnceLock::new();
    LOG.get_or_init(Mutex::default)
}

/// Writes one line: "<UTC time> <source>: <text>".
pub fn write(source: &str, text: &str) {
    let line = format!("{} {source}: {}", time_text(SystemTime::now(), true), text.replace('\n', " ⏎ "));
    if let Ok(mut log) = log().lock() {
        put(&mut log, line);
    }
}

fn put(log: &mut Log, line: String) {
    match log.file.as_mut() {
        Some(file) => {
            let _ = writeln!(file, "{line}");
            let _ = file.flush();
        }
        None if log.waiting.len() < 1000 => log.waiting.push(line),
        None => {}
    }
}

/// Starts the log of this session in the vault (once: a second vault in the same session keeps the first log).
pub fn start(root: &Path) {
    let Ok(mut log) = log().lock() else { return };
    if log.file.is_some() {
        return;
    }
    let folder = root.join(".inspoboard/logs");
    if fs::create_dir_all(&folder).is_err() {
        return;
    }
    let previous = last_log(&folder);
    let path = folder.join(format!("session-{}.log", time_text(SystemTime::now(), false)));
    let Ok(file) = OpenOptions::new().create(true).append(true).open(&path) else { return };
    log.file = Some(file);
    log.path = Some(path.clone());
    let header = format!(
        "{} app: Inspoboard {} on {} {}. Times are UTC.",
        time_text(SystemTime::now(), true),
        env!("CARGO_PKG_VERSION"),
        std::env::consts::OS,
        std::env::consts::ARCH
    );
    put(&mut log, header);
    if let Some(previous) = previous
        && !ended_normally(&previous)
    {
        let name = previous.file_name().map(|name| name.to_string_lossy().to_string()).unwrap_or_default();
        put(&mut log, format!("{} app: The last session did not end normally (a crash or a force quit). Its log: {name}", time_text(SystemTime::now(), true)));
    }
    for line in std::mem::take(&mut log.waiting) {
        put(&mut log, line);
    }
    drop(log);
    remove_old(&folder);
}

/// The UI is alive (it calls this each second).
pub fn heartbeat() {
    let Ok(mut log) = log().lock() else { return };
    log.heartbeat = Some(Instant::now());
    if let Some(since) = log.hanging_since.take() {
        let line = format!("{} watchdog: The UI responds again, after {:.1} s.", time_text(SystemTime::now(), true), since.elapsed().as_secs_f64() + HANG_SECONDS as f64);
        put(&mut log, line);
    }
}

/// The watchdog thread: it looks at the heartbeat each second.
pub fn start_watchdog() {
    std::thread::spawn(|| {
        loop {
            std::thread::sleep(Duration::from_secs(1));
            let Ok(mut log) = log().lock() else { return };
            let late = log.heartbeat.is_some_and(|beat| beat.elapsed() >= Duration::from_secs(HANG_SECONDS));
            if late && log.hanging_since.is_none() {
                log.hanging_since = Some(Instant::now());
                let line = format!("{} watchdog: The UI does not respond (no heartbeat for {HANG_SECONDS} s).", time_text(SystemTime::now(), true));
                put(&mut log, line);
            }
        }
    });
}

/// Runs `work`. A run of `slow_ms` or more, or an error, goes into the log with its time.
pub fn timed<T>(source: &str, what: &str, slow_ms: u128, work: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    let start = Instant::now();
    let result = work();
    let ms = start.elapsed().as_millis();
    match &result {
        Err(error) => write(source, &format!("{what} failed after {ms} ms: {error}")),
        Ok(_) if ms >= slow_ms => write(source, &format!("{what}: {ms} ms")),
        Ok(_) => {}
    }
    result
}

/// The last line of a clean exit.
pub fn exit() {
    write("app", EXIT_LINE);
}

/// The log file of this session (None before a vault opens).
pub fn path() -> Option<PathBuf> {
    log().lock().ok()?.path.clone()
}

/// Events of the UI (each call is also a heartbeat). The UI sends them in groups, about each second.
#[tauri::command]
pub fn log_events(lines: Vec<String>) {
    heartbeat();
    for line in lines.iter().take(200) {
        let text: String = line.chars().take(500).collect();
        write("ui", &text);
    }
}

/// The log file of this session, for "Show Log in Finder".
#[tauri::command]
pub fn log_path() -> Option<String> {
    path().map(|path| path.to_string_lossy().to_string())
}

fn logs_in(folder: &Path) -> Vec<PathBuf> {
    let mut logs: Vec<PathBuf> = fs::read_dir(folder)
        .map(|entries| entries.filter_map(Result::ok).map(|entry| entry.path()).filter(|path| path.extension().is_some_and(|extension| extension == "log")).collect())
        .unwrap_or_default();
    // The names have the time: the name order is the time order.
    logs.sort();
    logs
}

fn last_log(folder: &Path) -> Option<PathBuf> {
    logs_in(folder).pop()
}

fn ended_normally(path: &Path) -> bool {
    fs::read_to_string(path).is_ok_and(|text| text.lines().last().is_some_and(|line| line.ends_with(EXIT_LINE)))
}

fn remove_old(folder: &Path) {
    let logs = logs_in(folder);
    for old in logs.iter().take(logs.len().saturating_sub(LOG_COUNT)) {
        let _ = fs::remove_file(old);
    }
}

/// "2026-10-15 17:40:02.123" (`exact`) or "2026-10-15-174002" (for a file name). UTC.
fn time_text(time: SystemTime, exact: bool) -> String {
    let since = time.duration_since(UNIX_EPOCH).unwrap_or_default();
    let seconds = since.as_secs();
    let (year, month, day) = civil_date((seconds / 86_400) as i64);
    let (hour, minute, second) = (seconds / 3600 % 24, seconds / 60 % 60, seconds % 60);
    if exact {
        format!("{year:04}-{month:02}-{day:02} {hour:02}:{minute:02}:{second:02}.{:03}", since.subsec_millis())
    } else {
        format!("{year:04}-{month:02}-{day:02}-{hour:02}{minute:02}{second:02}")
    }
}

/// The date of a day number (days since 1970-01-01). Howard Hinnant's algorithm.
fn civil_date(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (yoe + era * 400 + i64::from(month <= 2), month, day)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dates() {
        assert_eq!(civil_date(0), (1970, 1, 1));
        assert_eq!(civil_date(20_376), (2025, 10, 15));
        assert_eq!(time_text(UNIX_EPOCH + Duration::from_millis(86_400_000 + 3_723_045), true), "1970-01-02 01:02:03.045");
        assert_eq!(time_text(UNIX_EPOCH, false), "1970-01-01-000000");
    }

    #[test]
    fn finds_a_session_that_did_not_end() {
        let folder = tempfile::tempdir().unwrap();
        fs::write(folder.path().join("session-1.log"), format!("a\nb {EXIT_LINE}\n")).unwrap();
        fs::write(folder.path().join("session-2.log"), "a\nwatchdog: The UI does not respond\n").unwrap();
        assert!(ended_normally(&folder.path().join("session-1.log")));
        assert_eq!(last_log(folder.path()), Some(folder.path().join("session-2.log")));
        assert!(!ended_normally(&folder.path().join("session-2.log")));
    }
}
