//! Interactive shells for the terminal panel. Termy owns the PTY and shell
//! launch; the raw byte stream goes to xterm.js over an IPC channel.

use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU32, Ordering},
        Mutex,
    },
};

use serde::Serialize;
use tauri::{
    ipc::{Channel, InvokeResponseBody},
    AppHandle, Emitter, State,
};
use termy_core::pty::{Pty, PtyCommand, PtySize};

#[derive(Default)]
pub struct Terminals {
    next_id: AtomicU32,
    open: Mutex<HashMap<u32, Pty>>,
}

#[derive(Clone, Serialize)]
struct Exit {
    id: u32,
}

fn runtime_config() -> termy_core::TerminalRuntimeConfig {
    termy_core::load_config_from_default_path()
        .map(|loaded| loaded.runtime_config)
        .unwrap_or_default()
}

#[tauri::command]
pub fn term_open(
    app: AppHandle,
    terminals: State<'_, Terminals>,
    cwd: String,
    cols: u16,
    rows: u16,
    output: Channel<InvokeResponseBody>,
) -> Result<u32, String> {
    let id = terminals.next_id.fetch_add(1, Ordering::Relaxed) + 1;
    let pty = Pty::spawn(
        &runtime_config(),
        PtyCommand {
            working_directory: Some(&cwd),
            ..PtyCommand::default()
        },
        PtySize::new(cols, rows),
        move |bytes| {
            let _ = output.send(InvokeResponseBody::Raw(bytes.to_vec()));
        },
        move || {
            let _ = app.emit("term://exit", Exit { id });
        },
    )
    .map_err(|error| format!("Couldn't start a shell: {error}"))?;
    terminals
        .open
        .lock()
        .map_err(|_| "Terminal registry poisoned")?
        .insert(id, pty);
    Ok(id)
}

fn with_pty<T>(terminals: &Terminals, id: u32, f: impl FnOnce(&Pty) -> std::io::Result<T>) -> Result<T, String> {
    let open = terminals.open.lock().map_err(|_| "Terminal registry poisoned")?;
    let pty = open.get(&id).ok_or("Terminal is closed")?;
    f(pty).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn term_write(terminals: State<'_, Terminals>, id: u32, data: String) -> Result<(), String> {
    with_pty(&terminals, id, |pty| pty.write_owned(data.into_bytes()))
}

#[tauri::command]
pub fn term_resize(terminals: State<'_, Terminals>, id: u32, cols: u16, rows: u16) -> Result<(), String> {
    with_pty(&terminals, id, |pty| pty.resize(PtySize::new(cols, rows)))
}

/// Dropping the PTY hangs up the shell.
#[tauri::command]
pub fn term_close(terminals: State<'_, Terminals>, id: u32) -> Result<(), String> {
    terminals
        .open
        .lock()
        .map_err(|_| "Terminal registry poisoned")?
        .remove(&id);
    Ok(())
}
