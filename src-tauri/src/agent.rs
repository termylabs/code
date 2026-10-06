//! Spawns ACP agents as child processes and bridges their stdio to the webview.
//! ACP is newline-delimited JSON, so stdout is forwarded line by line.

use std::{
    collections::HashMap,
    process::Stdio,
    sync::atomic::{AtomicU32, Ordering},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{ChildStdin, Command},
    sync::{oneshot, Mutex},
};

use crate::shell_env;

#[derive(Default)]
pub struct Agents {
    next_id: AtomicU32,
    running: Mutex<HashMap<u32, Running>>,
}

struct Running {
    stdin: ChildStdin,
    kill: Option<oneshot::Sender<()>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnRequest {
    command: String,
    args: Vec<String>,
    cwd: String,
    #[serde(default)]
    env: HashMap<String, String>,
}

#[derive(Clone, Serialize)]
struct Line<'a> {
    id: u32,
    line: &'a str,
}

#[derive(Clone, Serialize)]
struct Exit {
    id: u32,
    code: Option<i32>,
}

#[tauri::command]
pub async fn agent_spawn(
    app: AppHandle,
    agents: State<'_, Agents>,
    request: SpawnRequest,
) -> Result<u32, String> {
    let mut child = Command::new(&request.command)
        .args(&request.args)
        .current_dir(&request.cwd)
        .env("PATH", shell_env::login_path())
        .envs(&request.env)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| format!("Couldn't start `{}`: {error}", request.command))?;

    let id = agents.next_id.fetch_add(1, Ordering::Relaxed) + 1;
    let stdin = child.stdin.take().ok_or("Agent has no stdin")?;
    let stdout = child.stdout.take().ok_or("Agent has no stdout")?;
    let stderr = child.stderr.take().ok_or("Agent has no stderr")?;
    let (kill_tx, kill_rx) = oneshot::channel();

    agents.running.lock().await.insert(
        id,
        Running {
            stdin,
            kill: Some(kill_tx),
        },
    );

    forward_lines(app.clone(), id, stdout, "agent://stdout");
    forward_lines(app.clone(), id, stderr, "agent://stderr");

    tauri::async_runtime::spawn(async move {
        let status = tokio::select! {
            status = child.wait() => status.ok(),
            _ = kill_rx => {
                let _ = child.kill().await;
                child.wait().await.ok()
            }
        };
        let _ = app.emit(
            "agent://exit",
            Exit {
                id,
                code: status.and_then(|status| status.code()),
            },
        );
    });

    Ok(id)
}

fn forward_lines<R>(app: AppHandle, id: u32, reader: R, event: &'static str)
where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(reader).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if !line.is_empty() {
                let _ = app.emit(event, Line { id, line: &line });
            }
        }
    });
}

#[tauri::command]
pub async fn agent_write(agents: State<'_, Agents>, id: u32, line: String) -> Result<(), String> {
    let mut running = agents.running.lock().await;
    let agent = running.get_mut(&id).ok_or("Agent is not running")?;
    agent
        .stdin
        .write_all(format!("{line}\n").as_bytes())
        .await
        .map_err(|error| error.to_string())?;
    agent.stdin.flush().await.map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn agent_kill(agents: State<'_, Agents>, id: u32) -> Result<(), String> {
    if let Some(mut agent) = agents.running.lock().await.remove(&id) {
        if let Some(kill) = agent.kill.take() {
            let _ = kill.send(());
        }
    }
    Ok(())
}
