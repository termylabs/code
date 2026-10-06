import { createFileRoute } from "@tanstack/react-router"
import { PanelRightIcon } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { Composer } from "@/components/app/composer"
import { ForkMenu } from "@/components/app/fork-menu"
import { FileTree } from "@/components/app/file-tree"
import { Diffstat } from "@/components/app/primitives"
import { ReviewPane } from "@/components/app/review-pane"
import { TerminalView } from "@/components/app/terminal-view"
import { ThreadHeader } from "@/components/app/thread-header"
import { Timeline } from "@/components/app/timeline"
import { collectChanges, totals } from "@/domain/changes"
import type { Mention } from "@/domain/mentions"
import type { ImageAttachment } from "@/domain/session"
import { useRun, useWorkspace, useWorkspaceState } from "@/lib/runtime"
import { cn } from "@/lib/utils"

type Panel = "changes" | "files" | "terminal"

const panelNames: Record<Panel, string> = { changes: "Review", files: "Files", terminal: "Terminal" }

const PanelTabs = ({ value, onChange }: { value: Panel; onChange: (tab: Panel) => void }) => (
  <div className="bg-panel flex items-center gap-0.5 rounded-[9px] p-0.5 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.04)]">
    {(["changes", "files", "terminal"] as const).map((tab) => (
      <button
        key={tab}
        type="button"
        onClick={() => onChange(tab)}
        aria-pressed={value === tab}
        className={cn(
          "h-[26px] rounded-[7px] px-3 text-xs capitalize transition-colors",
          value === tab
            ? "bg-hover text-text font-medium shadow-[inset_0_1px_0_rgb(255_255_255/0.06),0_1px_2px_rgb(0_0_0/0.4)]"
            : "text-text-2 hover:text-text",
        )}
      >
        {panelNames[tab]}
      </button>
    ))}
  </div>
)

const ThreadView = () => {
  const { threadId } = Route.useParams()
  const workspace = useWorkspace()
  const run = useRun()
  const session = useWorkspaceState((state) => state.sessions[threadId])
  const [reviewOpen, setReviewOpen] = useState(true)
  const [tab, setTab] = useState<Panel>("changes")
  // The shell survives tab switches; it starts the first time the tab opens.
  const [terminalStarted, setTerminalStarted] = useState(false)

  useEffect(() => {
    setTerminalStarted(false)
    setTab("changes")
  }, [threadId])

  useEffect(() => {
    void run(workspace.open(threadId))
  }, [threadId, run, workspace])

  const changes = useMemo(() => (session ? collectChanges(session.items) : []), [session?.items])
  const sum = totals(changes)

  if (!session) return <div className="surface flex-1 rounded-xl" />

  const send = (text: string, images: ReadonlyArray<ImageAttachment> = [], mentions: ReadonlyArray<Mention> = []) =>
    void run(workspace.send(session.id, text, images, mentions))

  return (
    <>
      <section className="surface relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl">
        <ThreadHeader title={session.title} cwd={session.cwd} agentId={session.agentId}>
          <ForkMenu
            threadId={session.id}
            agentId={session.agentId}
            disabled={session.status === "working" || !session.items.some((item) => item._tag === "User")}
          />
          <button
            type="button"
            onClick={() => setReviewOpen(!reviewOpen)}
            aria-pressed={reviewOpen}
            className={cn(
              "flex h-[26px] items-center gap-2 rounded-[7px] px-2.5 transition-colors",
              reviewOpen ? "bg-raised text-text" : "text-text-2 hover:bg-raised/60",
            )}
          >
            <PanelRightIcon className="size-3.5" />
            {sum.files > 0 ? <Diffstat additions={sum.additions} deletions={sum.deletions} /> : <span className="text-xs">Changes</span>}
          </button>
        </ThreadHeader>
        <Timeline key={session.id} session={session} onRetry={send} />
        <div className="flex shrink-0 justify-center px-10 pb-5">
          <Composer
            session={session}
            onSend={send}
            placeholder={session.status === "working" ? "The agent is working" : "Ask for a follow-up"}
            autoFocus
            className="max-w-[672px]"
          />
        </div>
      </section>
      {reviewOpen && (
        <ReviewPane
          changes={changes}
          cwd={session.cwd}
          onClose={() => setReviewOpen(false)}
          tabs={
            <PanelTabs
              value={tab}
              onChange={(next) => {
                setTab(next)
                if (next === "terminal") setTerminalStarted(true)
              }}
            />
          }
        >
          {terminalStarted && (
            <div className={cn("min-h-0 flex-1 flex-col", tab === "terminal" ? "flex" : "hidden")}>
              <TerminalView key={session.id} cwd={session.cwd} active={tab === "terminal"} />
            </div>
          )}
          {tab === "changes" && <ReviewPane.Changes changes={changes} cwd={session.cwd} />}
          {/* Reloads when a turn starts and ends, since that's when the agent changes files. */}
          {tab === "files" && (
            <FileTree cwd={session.cwd} changes={changes} refreshKey={session.status === "working"} />
          )}
        </ReviewPane>
      )}
    </>
  )
}

export const Route = createFileRoute("/thread/$threadId")({ component: ThreadView })
