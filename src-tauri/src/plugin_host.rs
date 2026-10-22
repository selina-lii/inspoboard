//! Plugin host. See docs/PLUGINS.md.
//!
//! - A plugin is a separate program in the plugins folder. The core app does not compile it.
//! - The user installs a plugin by hand: `<plugins folder>/<name>/plugin.json` and its program.
//! - The host starts the program when the first call comes. Messages are JSON lines on stdin and stdout.
//! - The host has no data access for plugins. A plugin gets only the texts in its calls.
//! - Development builds use only `data/plugins` in the repository. They never read the app config folder.

use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};

use serde_json::{Value, json};
use tauri::{AppHandle, Emitter, Manager, State};

/// The protocol version of this host. A plugin with a different version does not start.
pub const PROTOCOL: u64 = 1;
const MANIFEST_FILE: &str = "plugin.json";
/// The release app keeps the plugins folder path here, in the app config folder.
const CONFIG_FILE: &str = "plugins.json";

/// `plugin.json`. Unknown fields are ignored.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct Manifest {
    pub protocol: u64,
    pub title: String,
    pub version: String,
    /// The program file name, in the plugin folder. On Windows, ".exe" is added if necessary.
    pub exec: String,
    #[serde(default)]
    pub capabilities: Vec<String>,
    /// A lab plugin: experimental. The app marks it as such.
    #[serde(default)]
    pub lab: bool,
}

/// A plugin as the frontend sees it.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginInfo {
    /// The folder name. It identifies the plugin.
    pub name: String,
    pub title: String,
    pub version: String,
    pub capabilities: Vec<String>,
    pub lab: bool,
    /// Why the plugin cannot start, or None.
    pub problem: Option<String>,
}

type Pending = Arc<Mutex<HashMap<u64, Sender<Result<Value, String>>>>>;

/// One request-reply link to a plugin. It works on any reader and writer, so tests can use pipes.
pub struct Connection {
    writer: Mutex<Box<dyn Write + Send>>,
    pending: Pending,
    next_id: AtomicU64,
    alive: Arc<AtomicBool>,
}

impl Connection {
    /// Starts a thread that reads replies and notifications. `on_notify` gets each notification.
    pub fn start(reader: impl BufRead + Send + 'static, writer: Box<dyn Write + Send>, on_notify: Box<dyn Fn(Value) + Send>) -> Self {
        let pending: Pending = Arc::default();
        let alive = Arc::new(AtomicBool::new(true));
        let thread_pending = pending.clone();
        let thread_alive = alive.clone();
        std::thread::spawn(move || {
            for line in reader.lines() {
                let Ok(line) = line else { break };
                let Ok(message) = serde_json::from_str::<Value>(&line) else {
                    eprintln!("plugin: a line is not JSON: {line}");
                    continue;
                };
                if let Some(id) = message.get("id").and_then(Value::as_u64) {
                    let sender = thread_pending.lock().ok().and_then(|mut map| map.remove(&id));
                    if let Some(sender) = sender {
                        let _ = sender.send(reply_of(&message));
                    }
                } else if message.get("method").is_some() {
                    on_notify(message);
                }
            }
            // The plugin stopped. All open calls fail.
            thread_alive.store(false, Ordering::SeqCst);
            if let Ok(mut map) = thread_pending.lock() {
                for (_, sender) in map.drain() {
                    let _ = sender.send(Err("The plugin stopped.".to_string()));
                }
            }
        });
        Connection { writer: Mutex::new(writer), pending, next_id: AtomicU64::new(1), alive }
    }

    pub fn is_alive(&self) -> bool {
        self.alive.load(Ordering::SeqCst)
    }

    /// Sends a request and waits for its reply. Many calls can wait at the same time.
    pub fn call(&self, method: &str, params: Value) -> Result<Value, String> {
        if !self.is_alive() {
            return Err("The plugin stopped.".to_string());
        }
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (sender, receiver) = mpsc::channel();
        self.pending.lock().map_err(|_| "Internal lock error.".to_string())?.insert(id, sender);
        let line = json!({ "id": id, "method": method, "params": params }).to_string();
        {
            let mut writer = self.writer.lock().map_err(|_| "Internal lock error.".to_string())?;
            let sent = writeln!(writer, "{line}").and_then(|()| writer.flush());
            if let Err(error) = sent {
                if let Ok(mut map) = self.pending.lock() {
                    map.remove(&id);
                }
                return Err(format!("The plugin does not accept input: {error}"));
            }
        }
        receiver.recv().unwrap_or_else(|_| Err("The plugin stopped.".to_string()))
    }
}

fn reply_of(message: &Value) -> Result<Value, String> {
    if let Some(error) = message.get("error") {
        let text = error.get("message").and_then(Value::as_str).map(str::to_string).unwrap_or_else(|| error.to_string());
        return Err(text);
    }
    Ok(message.get("result").cloned().unwrap_or(Value::Null))
}

/// A running plugin program.
struct Running {
    child: Child,
    connection: Arc<Connection>,
}

impl Drop for Running {
    fn drop(&mut self) {
        // A plugin stops when its input closes. Kill it also, in case it does not.
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[derive(Default)]
pub struct PluginState {
    running: Mutex<HashMap<String, Running>>,
}

impl PluginState {
    pub fn stop_all(&self) {
        if let Ok(mut running) = self.running.lock() {
            running.clear();
        }
    }
}

/// Development builds: always `data/plugins` in the repository.
#[cfg(debug_assertions)]
fn plugins_folder(_app: &AppHandle) -> Option<PathBuf> {
    Some(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("data").join("plugins"))
}

/// Release builds: the folder that the user selected, from the app config folder.
#[cfg(not(debug_assertions))]
fn plugins_folder(app: &AppHandle) -> Option<PathBuf> {
    let config = app.path().app_config_dir().ok()?.join(CONFIG_FILE);
    let text = fs::read_to_string(config).ok()?;
    let value: Value = serde_json::from_str(&text).ok()?;
    value.get("folder").and_then(Value::as_str).map(PathBuf::from)
}

/// Reads and checks the manifest of one plugin folder.
pub fn read_manifest(folder: &Path) -> Result<Manifest, String> {
    let path = folder.join(MANIFEST_FILE);
    let text = fs::read_to_string(&path).map_err(|error| format!("{}: {error}", path.display()))?;
    let manifest: Manifest = serde_json::from_str(&text).map_err(|error| format!("{}: {error}", path.display()))?;
    if manifest.protocol != PROTOCOL {
        return Err(format!("The plugin uses protocol {}. This app uses protocol {PROTOCOL}.", manifest.protocol));
    }
    program_path(folder, &manifest)?;
    Ok(manifest)
}

/// The program of a plugin. It must be a file directly in the plugin folder.
fn program_path(folder: &Path, manifest: &Manifest) -> Result<PathBuf, String> {
    let exec = manifest.exec.as_str();
    if exec.is_empty() || exec.contains(['/', '\\']) || exec == "." || exec == ".." {
        return Err(format!("\"exec\" must be a file name in the plugin folder, not \"{exec}\"."));
    }
    let path = folder.join(exec);
    if path.is_file() {
        return Ok(path);
    }
    let with_exe = folder.join(format!("{exec}.exe"));
    if cfg!(windows) && with_exe.is_file() {
        return Ok(with_exe);
    }
    Err(format!("The program \"{exec}\" is not in {}.", folder.display()))
}

/// All plugins in a folder, sorted by name. A folder without plugin.json is not a plugin.
pub fn scan(folder: &Path) -> Vec<PluginInfo> {
    let Ok(entries) = fs::read_dir(folder) else { return Vec::new() };
    let mut plugins: Vec<PluginInfo> = entries
        .flatten()
        .filter(|entry| entry.path().join(MANIFEST_FILE).is_file())
        .map(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            match read_manifest(&entry.path()) {
                Ok(manifest) => PluginInfo {
                    name,
                    title: manifest.title,
                    version: manifest.version,
                    capabilities: manifest.capabilities,
                    lab: manifest.lab,
                    problem: None,
                },
                Err(problem) => PluginInfo { title: name.clone(), name, version: String::new(), capabilities: Vec::new(), lab: false, problem: Some(problem) },
            }
        })
        .collect();
    plugins.sort_by(|a, b| a.name.cmp(&b.name));
    plugins
}

/// The plugin folder for a name. The name must be one folder name, so a call cannot leave the plugins folder.
fn plugin_folder(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    if name.is_empty() || name.contains(['/', '\\']) || name.starts_with('.') {
        return Err(format!("\"{name}\" is not a plugin name."));
    }
    let root = plugins_folder(app).ok_or_else(|| "No plugins folder is set.".to_string())?;
    Ok(root.join(name))
}

fn start(app: &AppHandle, name: &str) -> Result<Running, String> {
    let folder = plugin_folder(app, name)?;
    let manifest = read_manifest(&folder)?;
    let program = program_path(&folder, &manifest)?;
    let mut command = Command::new(&program);
    command.current_dir(&folder).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = command.spawn().map_err(|error| format!("{}: {error}", program.display()))?;
    let stdin: ChildStdin = child.stdin.take().ok_or("The plugin has no input.")?;
    let stdout = child.stdout.take().ok_or("The plugin has no output.")?;
    crate::debug_log::write("plugin", &format!("{name}: started."));
    // The error output of the plugin goes into the session log (at most 200 lines for each start).
    if let Some(stderr) = child.stderr.take() {
        let plugin = name.to_string();
        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok).take(200) {
                crate::debug_log::write("plugin", &format!("{plugin} (error output): {line}"));
            }
        });
    }
    let emitter = app.clone();
    let plugin = name.to_string();
    let on_notify = Box::new(move |message: Value| {
        let params = message.get("params").cloned().unwrap_or(Value::Null);
        let _ = emitter.emit("plugin-progress", json!({ "plugin": plugin, "params": params }));
    });
    let connection = Arc::new(Connection::start(BufReader::new(stdout), Box::new(stdin), on_notify));
    Ok(Running { child, connection })
}

/// The connection to a plugin. It starts the plugin if it does not run.
fn connection(app: &AppHandle, state: &PluginState, name: &str) -> Result<Arc<Connection>, String> {
    let mut running = state.running.lock().map_err(|_| "Internal lock error.".to_string())?;
    if let Some(current) = running.get(name)
        && current.connection.is_alive()
    {
        return Ok(current.connection.clone());
    }
    let started = start(app, name)?;
    let connection = started.connection.clone();
    running.insert(name.to_string(), started);
    Ok(connection)
}

#[tauri::command]
pub fn plugins_folder_path(app: AppHandle) -> Option<String> {
    plugins_folder(&app).map(|folder| folder.to_string_lossy().to_string())
}

/// Release builds only. A development build always uses data/plugins.
#[tauri::command]
pub fn set_plugins_folder(app: AppHandle, state: State<'_, PluginState>, path: String) -> Result<(), String> {
    if cfg!(debug_assertions) {
        return Err("This is a development build. It uses only the data/plugins folder of the repository.".to_string());
    }
    let folder = fs::canonicalize(&path).map_err(|error| format!("{path}: {error}"))?;
    if !folder.is_dir() {
        return Err(format!("{path} is not a folder."));
    }
    let config = app.path().app_config_dir().map_err(|error| error.to_string())?;
    let text = format!("{}\n", serde_json::to_string_pretty(&json!({ "folder": folder.to_string_lossy() })).map_err(|error| error.to_string())?);
    write_config(&config, &text)?;
    state.stop_all();
    Ok(())
}

/// Writes the config file atomically.
fn write_config(folder: &Path, text: &str) -> Result<(), String> {
    fs::create_dir_all(folder).map_err(|error| format!("{}: {error}", folder.display()))?;
    let target = folder.join(CONFIG_FILE);
    let temporary = folder.join(format!(".{CONFIG_FILE}.tmp-{}", std::process::id()));
    fs::write(&temporary, text).map_err(|error| format!("{}: {error}", temporary.display()))?;
    fs::rename(&temporary, &target).map_err(|error| format!("{}: {error}", target.display()))
}

#[tauri::command]
pub fn list_plugins(app: AppHandle, state: State<'_, PluginState>) -> Vec<PluginInfo> {
    // A new list can have new programs. Stop the old ones; they start again when called.
    state.stop_all();
    plugins_folder(&app).map(|folder| scan(&folder)).unwrap_or_default()
}

/// Calls a plugin method. The call waits on a background thread, so the app does not freeze.
#[tauri::command]
pub async fn plugin_call(app: AppHandle, name: String, method: String, params: Value) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<PluginState>();
        let start = std::time::Instant::now();
        let result = connection(&app, &state, &name).and_then(|connection| connection.call(&method, params));
        // Slow calls and errors go into the session log (no params: they can have text of notes).
        let seconds = start.elapsed().as_secs_f64();
        match &result {
            Err(error) => crate::debug_log::write("plugin", &format!("{name}.{method} failed after {seconds:.1} s: {error}")),
            Ok(_) if seconds >= 2.0 => crate::debug_log::write("plugin", &format!("{name}.{method}: {seconds:.1} s")),
            Ok(_) => {}
        }
        result
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufReader, pipe};

    /// A plugin in a thread: it echoes the params and sends one progress note per call.
    fn echo_plugin() -> (Connection, Arc<Mutex<Vec<Value>>>) {
        let (host_reader, plugin_writer) = pipe().unwrap();
        let (plugin_reader, host_writer) = pipe().unwrap();
        std::thread::spawn(move || {
            let mut out = plugin_writer;
            for line in BufReader::new(plugin_reader).lines() {
                let request: Value = serde_json::from_str(&line.unwrap()).unwrap();
                let id = request["id"].clone();
                writeln!(out, "{}", json!({ "method": "progress", "params": { "done": 1 } })).unwrap();
                let reply = if request["method"] == "fail" {
                    json!({ "id": id, "error": { "message": "no" } })
                } else {
                    json!({ "id": id, "result": request["params"] })
                };
                writeln!(out, "{reply}").unwrap();
            }
        });
        let notes = Arc::new(Mutex::new(Vec::new()));
        let sink = notes.clone();
        let connection = Connection::start(BufReader::new(host_reader), Box::new(host_writer), Box::new(move |note| sink.lock().unwrap().push(note)));
        (connection, notes)
    }

    #[test]
    fn calls_get_replies_and_notes() {
        let (connection, notes) = echo_plugin();
        assert_eq!(connection.call("echo", json!({ "a": 1 })).unwrap(), json!({ "a": 1 }));
        assert_eq!(connection.call("fail", json!(null)).unwrap_err(), "no");
        assert_eq!(notes.lock().unwrap().len(), 2);
    }

    #[test]
    fn calls_fail_when_the_plugin_stops() {
        let (host_reader, plugin_writer) = pipe().unwrap();
        let (_plugin_reader, host_writer) = pipe().unwrap();
        let connection = Connection::start(BufReader::new(host_reader), Box::new(host_writer), Box::new(|_| ()));
        drop(plugin_writer);
        std::thread::sleep(std::time::Duration::from_millis(50));
        assert!(!connection.is_alive());
        assert!(connection.call("info", json!({})).is_err());
    }

    #[test]
    fn manifest_checks() {
        let folder = tempfile::tempdir().unwrap();
        let plugin = folder.path().join("echo");
        fs::create_dir(&plugin).unwrap();
        let write = |text: &str| fs::write(plugin.join(MANIFEST_FILE), text).unwrap();

        write(r#"{"protocol":1,"title":"Echo","version":"1","exec":"../escape"}"#);
        assert!(read_manifest(&plugin).is_err());
        write(r#"{"protocol":2,"title":"Echo","version":"1","exec":"run"}"#);
        assert!(read_manifest(&plugin).unwrap_err().contains("protocol 2"));
        write(r#"{"protocol":1,"title":"Echo","version":"1","exec":"run","capabilities":["transform-text"]}"#);
        assert!(read_manifest(&plugin).is_err(), "no program yet");
        fs::write(plugin.join("run"), "").unwrap();
        assert_eq!(read_manifest(&plugin).unwrap().title, "Echo");

        fs::create_dir(folder.path().join("not-a-plugin")).unwrap();
        let found = scan(folder.path());
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].capabilities, vec!["transform-text"]);
    }
}
