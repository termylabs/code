# Termy Code

Termy Code is a desktop app for working with AI coding agents. Instead of running Claude Code, Codex and Cursor each in its own terminal tab, you open a project once and talk to any of them from the same window. Each conversation is saved as a thread you can search and return to later.

When an agent edits files, the changes show up as diffs you can review before moving on. When it runs commands, they run in a real terminal built on [Termy](https://github.com/lassejlv/termy)'s PTY, and you can see the output as it happens. A terminal panel is also there for your own commands.

Termy Code talks to the agents over the [Agent Client Protocol](https://agentclientprotocol.com) (ACP), the open protocol these CLIs use to work with editors. The agents keep their own models, tools and logins. Termy Code gives them a better interface.

## Features

- **Multiple agents.** Claude Code, Codex and Cursor connect over ACP.
- **Projects and threads.** Conversations are saved per project in a local SQLite database, and you can search them.
- **Tool calls in the timeline.** Agent tool calls are grouped into stacks. You can review file diffs in a side pane.
- **Built-in terminal.** The terminal panel uses xterm.js on top of Termy's raw PTY. Commands that agents run through ACP `terminal/*` use the same PTY layer.
- **Permission prompts.** Agent requests for permission or input appear inline.
- **Composer.** You can attach images, switch models and set reasoning effort.
- **Command palette.** Jump between projects and threads from the keyboard.

## Agents

| Agent       | Launched with                                  | Sign in                                         |
| ----------- | ---------------------------------------------- | ----------------------------------------------- |
| Claude Code | `npx -y @agentclientprotocol/claude-agent-acp` | `claude`, or set `ANTHROPIC_API_KEY`            |
| Codex       | `npx -y @agentclientprotocol/codex-acp`        | `codex login`, or set `OPENAI_API_KEY`          |
| Cursor      | `agent acp`                                    | `agent login`, or set `CURSOR_API_KEY`          |

macOS starts GUI apps with a minimal `PATH`. Termy Code reads `PATH` from your login shell so that `npx` and `agent` can be found.

## Development

### Prerequisites

- [Rust](https://rustup.rs) (stable)
- [Node.js](https://nodejs.org) and [pnpm](https://pnpm.io)
- The [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your platform

### Setup

`termy_core` comes from the `termy-code/raw-pty` branch of Termy and is linked by path. Check that branch out as a sibling of this repo:

```sh
git clone https://github.com/termylabs/code termycode
git clone -b termy-code/raw-pty https://github.com/lassejlv/termy termy-raw-pty
cd termycode
pnpm install
```

You should end up with this layout:

```
Dev/
├── termycode/      # this repo
└── termy-raw-pty/  # termy @ termy-code/raw-pty
```

### Run

```sh
pnpm tauri dev      # run the app with hot reload
pnpm tauri build    # build a release bundle
```

## Architecture

```
src-tauri/          Rust backend (Tauri v2)
├── agent.rs            spawns agents and pipes ndjson stdio to the webview
├── agent_terminal.rs   ACP terminal/* commands on Termy PTYs with sanitized output
├── terminal.rs         interactive shells for the terminal panel
├── workspace.rs        ACP fs/* requests, git branch and image attachments
├── db.rs               SQLite storage and search for projects and threads
└── shell_env.rs        resolves the login-shell PATH for spawned agents

src/                React frontend
├── services/           Effect services
│   ├── Workspace.ts        app state (SubscriptionRef) and agent session lifecycles
│   ├── AcpClient.ts        wraps the ACP SDK
│   ├── AgentHost.ts        turns Tauri events into an ACP stream
│   ├── Database.ts         fronts the db_* commands
│   └── TerminalHost.ts     fronts the term_* commands
├── domain/             pure types and reducers (timeline, tool stacks, diffs, cursor/* extensions)
├── routes/             TanStack Router file routes
└── components/         app UI, shadcn on Base UI, Notra registry components
```

## Stack

[Tauri 2](https://v2.tauri.app) · [React 19](https://react.dev) · [Effect](https://effect.website) · [TanStack Router](https://tanstack.com/router) · [Tailwind CSS 4](https://tailwindcss.com) · [Base UI](https://base-ui.com) · [xterm.js](https://xtermjs.org) · [SQLite](https://sqlite.org)
