import { Link, useNavigate, useParams } from "@tanstack/react-router"
import { FolderPlusIcon, MoreHorizontalIcon, PlusIcon, SearchIcon, SquarePenIcon, Trash2Icon } from "lucide-react"
import { useEffect, useMemo } from "react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { AgentId } from "@/domain/agents"
import type { SessionStatus } from "@/domain/session"
import { useRun, useWorkspace, useWorkspaceState } from "@/lib/runtime"
import { cn } from "@/lib/utils"
import type { Project, ThreadSummary } from "@/services/Database"
import { AgentIcon } from "./agent-icon"
import { Kbd, Led, relativeTime } from "./primitives"
import { ResizeHandle, usePanelWidth } from "./resize-handle"

/** The thread's agent, with a badge in the corner while it's starting, working or failed. */
export const AgentSlot = ({ agent, status, dim }: { agent: AgentId; status: SessionStatus | undefined; dim: boolean }) => (
  <span className="relative flex size-3.5 shrink-0 items-center justify-center">
    <AgentIcon
      agent={agent}
      className={cn("text-text-2 size-3.5 transition-opacity", dim && "opacity-55 group-hover/thread:opacity-100")}
    />
    {status === "working" && <Led className="absolute -right-1 -bottom-1 size-[7px]" />}
    {status === "starting" && (
      <span className="border-text-2 bg-panel absolute -right-1 -bottom-1 size-[7px] rounded-full border border-dashed" />
    )}
    {status === "failed" && <span className="bg-remove absolute -right-1 -bottom-1 size-[7px] rounded-full" />}
  </span>
)

const ThreadRow = ({ thread, active, status }: { thread: ThreadSummary; active: boolean; status?: SessionStatus }) => {
  const workspace = useWorkspace()
  const run = useRun()
  const navigate = useNavigate()

  const remove = async () => {
    await run(workspace.deleteThread(thread.id))
    if (active) await navigate({ to: "/", search: { project: thread.projectId } })
  }

  return (
    <Link
      to="/thread/$threadId"
      params={{ threadId: thread.id }}
      className={cn(
        "group/thread flex h-8 items-center gap-2.5 rounded-lg px-2.5 transition-colors",
        active ? "bg-hover" : "hover:bg-hover/60",
      )}
    >
      <AgentSlot agent={thread.agentId} status={status} dim={!active && status !== "working"} />
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-[13px]",
          active ? "text-text font-medium" : status === "working" ? "text-text" : "text-text-2",
        )}
      >
        {thread.title}
      </span>
      <span
        className={cn(
          "w-8 shrink-0 text-right font-mono text-[11px] group-hover/thread:hidden",
          status === "working" ? "text-amber" : "text-text-3",
        )}
      >
        {relativeTime(thread.updatedAt)}
      </span>
      <button
        type="button"
        aria-label="Delete thread"
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void remove()
        }}
        className="text-text-3 hover:text-text hidden w-8 shrink-0 justify-end group-hover/thread:flex"
      >
        <Trash2Icon className="size-3.5" />
      </button>
    </Link>
  )
}

const ProjectGroup = ({
  project,
  threads,
  activeId,
  statuses,
}: {
  project: Project
  threads: ReadonlyArray<ThreadSummary>
  activeId: string | undefined
  statuses: Readonly<Record<string, SessionStatus>>
}) => {
  const workspace = useWorkspace()
  const run = useRun()
  const navigate = useNavigate()

  return (
    <div className="flex flex-col gap-px pb-4">
      <div className="group/project flex h-7 items-center gap-2 px-2.5">
        <span className="text-text-3 flex-1 truncate text-xs font-medium" title={project.path}>
          {project.name}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`${project.name} options`}
            className="text-text-3 hover:text-text opacity-0 transition-opacity group-hover/project:opacity-100 data-popup-open:opacity-100"
          >
            <MoreHorizontalIcon className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onClick={() => void navigate({ to: "/", search: { project: project.id } })}>
              <SquarePenIcon />
              New thread
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => void run(workspace.removeProject(project.id))}>
              <Trash2Icon />
              Remove project
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Link
          to="/"
          search={{ project: project.id }}
          aria-label={`New thread in ${project.name}`}
          className="text-text-3 hover:text-text"
        >
          <PlusIcon className="size-3.5" />
        </Link>
      </div>
      {threads.length === 0 ? (
        <span className="text-text-3 px-2.5 py-1.5 text-xs">No threads yet</span>
      ) : (
        threads.map((thread) => (
          <ThreadRow
            key={thread.id}
            thread={thread}
            active={thread.id === activeId}
            status={statuses[thread.id]}
          />
        ))
      )}
    </div>
  )
}

export const Sidebar = ({ onSearch }: { onSearch: () => void }) => {
  const workspace = useWorkspace()
  const run = useRun()
  const navigate = useNavigate()
  const projects = useWorkspaceState((state) => state.projects)
  const threads = useWorkspaceState((state) => state.threads)
  const sessions = useWorkspaceState((state) => state.sessions)
  const { threadId } = useParams({ strict: false })
  const { width, resize, reset } = usePanelWidth("sidebar.width", { initial: 264, min: 200, max: 420 })

  const statuses = useMemo(
    () => Object.fromEntries(Object.values(sessions).map((session) => [session.id, session.status])),
    [sessions],
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey && event.key.toLowerCase() === "n") {
        event.preventDefault()
        void navigate({ to: "/" })
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [navigate])

  const addProject = async () => {
    const project = await run(workspace.addProject())
    if (project) await navigate({ to: "/", search: { project: project.id } })
  }

  return (
    <aside style={{ width }} className="bg-panel relative flex h-full shrink-0 flex-col px-2.5 pb-3">
      <ResizeHandle edge="right" width={width} onResize={resize} onReset={reset} />
      <div data-tauri-drag-region className="h-[52px] shrink-0" />

      <nav className="flex flex-col gap-1.5 pt-1 pb-5">
        <Link
          to="/"
          className="bg-raised flex h-[34px] items-center gap-2.5 rounded-lg px-2.5 shadow-[inset_0_1px_0_rgb(255_255_255/0.05),0_0_0_1px_rgb(255_255_255/0.04)] transition-colors hover:bg-[#202024]"
        >
          <SquarePenIcon className="text-text size-4" strokeWidth={1.6} />
          <span className="text-text flex-1 text-[13px] font-medium tracking-[-0.005em]">New thread</span>
          <Kbd>⌘N</Kbd>
        </Link>
        <button
          type="button"
          onClick={onSearch}
          className="hover:bg-hover/60 flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-left transition-colors"
        >
          <SearchIcon className="text-text-2 size-4" strokeWidth={1.6} />
          <span className="text-text-2 flex-1 text-[13px]">Search</span>
          <Kbd>⌘K</Kbd>
        </button>
        <button
          type="button"
          onClick={() => void addProject()}
          className="hover:bg-hover/60 flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-left transition-colors"
        >
          <FolderPlusIcon className="text-text-2 size-4" strokeWidth={1.6} />
          <span className="text-text-2 flex-1 text-[13px]">Add project</span>
        </button>
      </nav>

      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
        {projects.map((project) => (
          <ProjectGroup
            key={project.id}
            project={project}
            threads={threads.filter((thread) => thread.projectId === project.id)}
            activeId={threadId}
            statuses={statuses}
          />
        ))}
        {projects.length === 0 && (
          <p className="text-text-3 px-2.5 text-xs leading-5">Add a project folder to start a thread in it.</p>
        )}
      </div>
    </aside>
  )
}
