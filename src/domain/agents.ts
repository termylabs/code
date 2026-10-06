import { Schema } from "effect"

export const AgentId = Schema.Literals(["claude", "codex", "cursor"])
export type AgentId = typeof AgentId.Type

export interface AgentSpec {
  readonly id: AgentId
  readonly name: string
  readonly command: string
  readonly args: ReadonlyArray<string>
  /** Shown when the agent reports that it needs a login. */
  readonly loginHint: string
}

export const agents: Record<AgentId, AgentSpec> = {
  claude: {
    id: "claude",
    name: "Claude Code",
    command: "npx",
    args: ["-y", "@agentclientprotocol/claude-agent-acp"],
    loginHint: "Run `claude` in a terminal and sign in, or set ANTHROPIC_API_KEY.",
  },
  codex: {
    id: "codex",
    name: "Codex",
    command: "npx",
    args: ["-y", "@agentclientprotocol/codex-acp"],
    loginHint: "Run `codex login` in a terminal, or set OPENAI_API_KEY.",
  },
  cursor: {
    id: "cursor",
    name: "Cursor",
    command: "agent",
    args: ["acp"],
    loginHint: "Run `agent login` in a terminal, or set CURSOR_API_KEY.",
  },
}

export const agentList = Object.values(agents)
