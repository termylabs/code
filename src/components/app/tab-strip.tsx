import { useNavigate, useParams } from "@tanstack/react-router"
import { PlusIcon, XIcon } from "lucide-react"
import { useEffect } from "react"
import { useRun, useWorkspace, useWorkspaceState } from "@/lib/runtime"
import { cn } from "@/lib/utils"
import { AgentSlot } from "./sidebar"

/** Open threads as tabs above the main area. ⌘1–9 jumps to a tab, ⌃Tab cycles. */
export const TabStrip = () => {
  const workspace = useWorkspace()
  const run = useRun()
  const navigate = useNavigate()
  const tabs = useWorkspaceState((state) => state.tabs)
  const threads = useWorkspaceState((state) => state.threads)
  const sessions = useWorkspaceState((state) => state.sessions)
  const { threadId } = useParams({ strict: false })

  const go = (id: string | undefined) =>
    void (id ? navigate({ to: "/thread/$threadId", params: { threadId: id } }) : navigate({ to: "/" }))

  const close = async (id: string) => {
    if (id === threadId) {
      const index = tabs.indexOf(id)
      await (tabs[index + 1] ?? tabs[index - 1]
        ? navigate({ to: "/thread/$threadId", params: { threadId: (tabs[index + 1] ?? tabs[index - 1])! } })
        : navigate({ to: "/" }))
    }
    await run(workspace.closeTab(id))
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey && !event.shiftKey && !event.altKey && /^[1-9]$/.test(event.key)) {
        const id = event.key === "9" ? tabs.at(-1) : tabs[Number(event.key) - 1]
        if (!id) return
        event.preventDefault()
        go(id)
      } else if (event.ctrlKey && event.key === "Tab" && tabs.length > 1) {
        event.preventDefault()
        const index = threadId ? tabs.indexOf(threadId) : -1
        const step = event.shiftKey ? -1 : 1
        go(tabs[(index + step + tabs.length) % tabs.length])
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  if (tabs.length === 0) return null

  return (
    <div data-tauri-drag-region className="flex h-10 shrink-0 items-center gap-1 pb-2">
      {tabs.map((id) => {
        const session = sessions[id]
        const thread = threads.find((candidate) => candidate.id === id)
        const agentId = session?.agentId ?? thread?.agentId
        if (!agentId) return null
        const active = id === threadId
        return (
          <div
            key={id}
            className={cn(
              "group/thread flex h-[30px] max-w-[200px] min-w-[96px] flex-1 basis-0 items-center rounded-lg transition-colors",
              active
                ? "bg-raised shadow-[inset_0_1px_0_rgb(255_255_255/0.05),0_0_0_1px_rgb(255_255_255/0.04)]"
                : "hover:bg-hover/60",
            )}
          >
            <button
              type="button"
              onClick={() => go(id)}
              onAuxClick={(event) => event.button === 1 && void close(id)}
              className="flex h-full min-w-0 flex-1 items-center gap-2 pl-2.5"
            >
              <AgentSlot agent={agentId} status={session?.status} dim={!active && session?.status !== "working"} />
              <span className={cn("min-w-0 truncate text-xs", active ? "text-text font-medium" : "text-text-2")}>
                {session?.title ?? thread?.title}
              </span>
            </button>
            <button
              type="button"
              aria-label="Close tab"
              onClick={() => void close(id)}
              className={cn(
                "text-text-3 hover:text-text hover:bg-hover mr-1 flex size-5 shrink-0 items-center justify-center rounded-md",
                !active && "opacity-0 group-hover/thread:opacity-100",
              )}
            >
              <XIcon className="size-3" />
            </button>
          </div>
        )
      })}
      <button
        type="button"
        aria-label="New thread"
        onClick={() => go(undefined)}
        className="text-text-3 hover:text-text hover:bg-hover/60 flex size-[30px] shrink-0 items-center justify-center rounded-lg"
      >
        <PlusIcon className="size-3.5" />
      </button>
    </div>
  )
}
