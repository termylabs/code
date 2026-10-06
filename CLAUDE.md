# Termy Code

Desktop client for ACP coding agents (Claude Code, Codex, Cursor).

- `src-tauri/`: Rust. Spawns agents and pipes their ndjson stdio to the webview (`agent.rs`), runs shells on Termy's PTY for the terminal panel (`terminal.rs`), runs ACP `terminal/*` commands for agents on Termy PTYs with sanitized text output (`agent_terminal.rs`), stores and searches projects and threads in SQLite (`db.rs`), and serves ACP `fs/*` requests and image attachments (`workspace.rs`).
- `src/services/`: Effect services. `Workspace` owns all app state (a `SubscriptionRef`) and agent session lifecycles; `AcpClient` wraps the ACP SDK; `AgentHost` turns Tauri events into an ACP stream; `Database` and `TerminalHost` front the Rust commands.
- `src/domain/`: pure types and reducers (session timeline, tool stacks, diffs, Cursor's `cursor/*` ACP extensions).
- `src/routes/`: TanStack Router file routes. UI primitives come from shadcn on Base UI (`src/components/ui`); the Notra registry provides shimmer and the step slider.
- `termy_core` comes from the `termy-code/raw-pty` branch of termy, checked out as a worktree at `../termy-raw-pty`, which adds `termy_core::pty` (raw PTY bytes for xterm.js, exit status, kill, per-command environment).

# Learning more about Effect

This repository uses the Effect Typescript library.

Before writing any Effect code, first read `node_modules/effect/AGENTS.md`
**completely**, and follow the links in the file when required.

If you need to learn more about particular Effect apis and concepts that the
guide doesn't cover, search through the source code in `node_modules/effect/src`.
