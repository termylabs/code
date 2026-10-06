import { getCurrentWebview } from "@tauri-apps/api/webview"
import { ArrowUpIcon, CheckIcon, ChevronDownIcon, PlusIcon, RotateCwIcon, SquareIcon, XIcon } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { Shimmer } from "@/components/shimmer/components/shimmer"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { agents } from "@/domain/agents"
import { activeQuery, type Mention, type Skill } from "@/domain/mentions"
import { configOption, type ImageAttachment, type Session } from "@/domain/session"
import { useRun, useWorkspace } from "@/lib/runtime"
import { cn } from "@/lib/utils"
import { emptyText, MentionPicker, type PickerRow, pickerRows } from "./mention-picker"
import { choicesOf, effortChoicesOf, ModelEffortSelector } from "./model-effort-selector"
import { formatElapsed, Led } from "./primitives"
import { RequestPrompt } from "./request-prompt"

const useNow = (active: boolean) => {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [active])
  return now
}

const StatusStrip = ({ session }: { session: Session }) => {
  const workspace = useWorkspace()
  const run = useRun()
  const now = useNow(session.status === "working")
  const agent = agents[session.agentId]

  if (session.status === "working") {
    return (
      <div className="flex h-9 items-center gap-2.5 border-b border-white/5 pr-3.5 pl-4">
        <Led />
        <Shimmer className="text-text text-xs font-medium">Working</Shimmer>
        {session.turnStartedAt && (
          <span className="text-text-3 font-mono text-[11px]">{formatElapsed(now - session.turnStartedAt)}</span>
        )}
        <span className="flex-1" />
        <span className="text-text-3 text-xs">Esc to stop</span>
      </div>
    )
  }
  if (session.status === "starting") {
    return (
      <div className="flex h-9 items-center gap-2.5 border-b border-white/5 px-4">
        <span className="border-text-3 size-2 rounded-full border border-dashed" />
        <Shimmer className="text-text-2 text-xs">Starting {agent.name}</Shimmer>
      </div>
    )
  }
  if (session.status === "failed" && session.error) {
    return (
      <div className="flex items-start gap-2.5 border-b border-white/5 py-2.5 pr-3 pl-4">
        <span className="bg-remove mt-1.5 size-1.5 shrink-0 rounded-full" />
        <p className="text-text-2 selectable min-w-0 flex-1 text-xs leading-5 whitespace-pre-wrap">{session.error}</p>
        <button
          type="button"
          onClick={() => void run(workspace.retry(session.id))}
          className="text-text-2 hover:text-text hover:bg-hover flex h-6 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs"
        >
          <RotateCwIcon className="size-3" />
          Retry
        </button>
      </div>
    )
  }
  return null
}

const ModeMenu = ({ session }: { session: Session }) => {
  const workspace = useWorkspace()
  const run = useRun()
  const modeOption = configOption(session, "mode")
  const modes = modeOption
    ? choicesOf(modeOption).map((choice) => ({ id: choice.value, name: choice.name }))
    : (session.modes?.availableModes ?? [])
  const current = modeOption?.type === "select" ? modeOption.currentValue : session.modes?.currentModeId
  if (modes.length < 2) return null
  const selected = modes.find((mode) => mode.id === current)

  const choose = (id: string) =>
    void run(modeOption ? workspace.setConfigOption(session.id, modeOption.id, id) : workspace.setMode(session.id, id))

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="text-text-2 hover:text-text aria-expanded:text-text flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs transition-colors hover:bg-white/5">
        {selected?.name ?? "Mode"}
        <ChevronDownIcon className="text-text-3 size-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-auto min-w-40 rounded-xl p-1">
        {modes.map((mode) => (
          <DropdownMenuItem key={mode.id} onClick={() => choose(mode.id)} className="h-8 gap-2.5 rounded-lg">
            <span className="text-text flex-1 truncate text-xs">{mode.name}</span>
            <span className="flex size-4 shrink-0 items-center">
              {mode.id === current && <CheckIcon className="text-amber size-3.5" />}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const NEARLY_FULL = 0.85

const tokens = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 })

const formatCost = (cost: NonNullable<Session["usage"]>["cost"]) => {
  if (!cost) return null
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency: cost.currency }).format(cost.amount)
  } catch {
    return `${cost.amount.toFixed(2)} ${cost.currency}`
  }
}

const ContextRing = ({ usage }: { usage: NonNullable<Session["usage"]> }) => {
  const ratio = Math.min(usage.used / Math.max(usage.size, 1), 1)
  const percent = Math.round(ratio * 100)
  const full = ratio > NEARLY_FULL
  const circumference = 2 * Math.PI * 6
  const cost = formatCost(usage.cost)
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={150}
        aria-label={`${percent}% of context used`}
        className="hover:bg-white/5 aria-expanded:bg-white/5 flex size-7 items-center justify-center rounded-lg transition-colors"
      >
        <svg viewBox="0 0 16 16" className="size-4 -rotate-90">
          <circle cx="8" cy="8" r="6" fill="none" stroke="var(--line)" strokeWidth="2" />
          <circle
            cx="8"
            cy="8"
            r="6"
            fill="none"
            stroke={full ? "var(--amber)" : "var(--text-2)"}
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={`${circumference * ratio} ${circumference}`}
          />
        </svg>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        className="w-[220px] gap-0 rounded-[14px] bg-[#1e1e21]/97 p-1 shadow-[inset_0_1px_0_rgb(255_255_255/0.06),0_0_0_1px_rgb(255_255_255/0.07),0_16px_40px_rgb(0_0_0/0.5)] ring-0 backdrop-blur-xl"
      >
        <div className="flex flex-col gap-2 px-2.5 pt-2 pb-2.5">
          <div className="flex h-5 items-center justify-between text-xs">
            <span className="text-text-3">Context</span>
            <span className={full ? "text-amber" : "text-text"}>{percent}% used</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
            <div
              className={cn("h-full rounded-full transition-[width] duration-300", full ? "bg-amber" : "bg-text-2")}
              style={{ width: `${ratio * 100}%` }}
            />
          </div>
          <span className="text-text-3 text-xs">
            {tokens.format(usage.used)} of {tokens.format(usage.size)} tokens
          </span>
        </div>
        {cost && (
          <>
            <div className="bg-line mx-1.5 h-px" />
            <div className="flex h-8 items-center justify-between px-2.5 text-xs">
              <span className="text-text-3">Session cost</span>
              <span className="text-text">{cost}</span>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"])
const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp)$/i

/** Reads a pasted image into ACP's base64 image format. */
const readClipboardImage = (file: File) =>
  new Promise<ImageAttachment>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const url = String(reader.result)
      resolve({ name: file.name || "Pasted image", mimeType: file.type, data: url.slice(url.indexOf(",") + 1) })
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })

const Attachments = ({
  images,
  onRemove,
}: {
  images: ReadonlyArray<ImageAttachment>
  onRemove: (index: number) => void
}) => (
  <div className="flex flex-wrap gap-2 px-3.5 pt-3.5">
    {images.map((image, index) => (
      <div key={index} className="group/attachment relative">
        <img
          src={`data:${image.mimeType};base64,${image.data}`}
          alt={image.name}
          title={image.name}
          className="size-14 rounded-lg object-cover shadow-[0_0_0_1px_rgb(255_255_255/0.08)]"
        />
        <button
          type="button"
          aria-label={`Remove ${image.name}`}
          onClick={() => onRemove(index)}
          className="bg-text text-bg absolute -top-1.5 -right-1.5 hidden size-[18px] items-center justify-center rounded-full shadow-[0_1px_3px_rgb(0_0_0/0.5)] group-hover/attachment:flex"
        >
          <XIcon className="size-2.5" strokeWidth={3} />
        </button>
      </div>
    ))}
  </div>
)

interface ComposerProps {
  readonly session: Session | undefined
  readonly onSend: (text: string, images: ReadonlyArray<ImageAttachment>, mentions: ReadonlyArray<Mention>) => void
  readonly placeholder: string
  readonly autoFocus?: boolean
  readonly className?: string
}

export const Composer = ({ session, onSend, placeholder, autoFocus, className }: ComposerProps) => {
  const workspace = useWorkspace()
  const run = useRun()
  const [text, setText] = useState("")
  const [images, setImages] = useState<ReadonlyArray<ImageAttachment>>([])
  const [dragging, setDragging] = useState(false)
  const [mentions, setMentions] = useState<ReadonlyArray<Mention>>([])
  const [caret, setCaret] = useState(0)
  const [pickerIndex, setPickerIndex] = useState(0)
  /** Where the dismissed mention starts, so Escape keeps it closed until a new one is typed. */
  const [dismissedAt, setDismissedAt] = useState<number | null>(null)
  const [files, setFiles] = useState<ReadonlyArray<string> | null>(null)
  const [skills, setSkills] = useState<ReadonlyArray<Skill> | null>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const working = session?.status === "working"
  const acceptsImages = session?.supportsImages ?? false
  const canSend =
    (text.trim().length > 0 || images.length > 0) && !working && session !== undefined && session.status !== "failed"

  const addImages = (added: ReadonlyArray<ImageAttachment> | undefined) => {
    if (added && added.length > 0) setImages((current) => [...current, ...added])
  }

  // Files dropped anywhere on the window land in the composer.
  useEffect(() => {
    if (!acceptsImages) return
    let unlisten: (() => void) | undefined
    let disposed = false
    void getCurrentWebview()
      .onDragDropEvent(({ payload }) => {
        if (payload.type === "enter") setDragging(payload.paths.some((path) => IMAGE_EXTENSIONS.test(path)))
        else if (payload.type === "leave") setDragging(false)
        else if (payload.type === "drop") {
          setDragging(false)
          const paths = payload.paths.filter((path) => IMAGE_EXTENSIONS.test(path))
          if (paths.length > 0) void run(workspace.loadImages(paths)).then(addImages)
        }
      })
      .then((stop) => {
        if (disposed) stop()
        else unlisten = stop
      })
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [acceptsImages, run, workspace])

  useEffect(() => {
    if (!working || !session) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") void run(workspace.cancel(session.id))
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [working, session, run, workspace])

  useEffect(() => {
    if (autoFocus) input.current?.focus()
  }, [autoFocus, session?.id])

  const typed = session ? activeQuery(text, caret) : null
  const query = typed && typed.start !== dismissedAt ? typed : null
  const queryKind = query?.kind ?? null
  const cwd = session?.cwd
  const agentId = session?.agentId

  // Load fresh files or skills each time the picker opens; typing filters locally.
  useEffect(() => {
    if (!queryKind || queryKind === "command" || !cwd || !agentId) return
    let cancelled = false
    if (queryKind === "file") {
      void run(workspace.listFiles(cwd)).then((list) => !cancelled && list && setFiles(list))
    } else {
      void run(workspace.listSkills(agentId, cwd)).then((list) => !cancelled && list && setSkills(list))
    }
    return () => {
      cancelled = true
    }
  }, [queryKind, cwd, agentId, run, workspace])

  const rows = useMemo(
    () => (query && cwd ? pickerRows(query.kind, query.query, cwd, files ?? [], skills ?? [], session?.commands ?? []) : []),
    [query?.kind, query?.query, cwd, files, skills, session?.commands],
  )

  useEffect(() => setPickerIndex(0), [query?.kind, query?.query])

  const typing = typed !== null
  useEffect(() => {
    if (!typing) setDismissedAt(null)
  }, [typing])

  const choose = (row: PickerRow) => {
    if (!query) return
    const before = text.slice(0, query.start) + row.insert + " "
    const next = before + text.slice(caret)
    setText(next)
    const added = row.mention
    if (added) setMentions((current) => [...current.filter((mention) => mention.token !== added.token), added])
    setCaret(before.length)
    requestAnimationFrame(() => input.current?.setSelectionRange(before.length, before.length))
  }

  const submit = () => {
    if (!canSend) return
    onSend(
      text,
      images,
      mentions.filter((mention) => text.includes(mention.token)),
    )
    setText("")
    setImages([])
    setMentions([])
    setDismissedAt(null)
  }

  const model = session ? configOption(session, "model") : undefined
  const effort = session ? configOption(session, "thought_level") : undefined

  return (
    <div
      className={cn(
        "bg-raised relative flex w-full flex-col rounded-2xl shadow-[inset_0_1px_0_rgb(255_255_255/0.06),0_0_0_1px_rgb(255_255_255/0.06),0_20px_50px_rgb(0_0_0/0.5)]",
        dragging &&
          "shadow-[inset_0_1px_0_rgb(255_255_255/0.06),0_0_0_1.5px_rgb(255_178_36/0.6),0_20px_50px_rgb(0_0_0/0.5)]",
        className,
      )}
    >
      {query && (
        <MentionPicker
          rows={rows}
          active={pickerIndex}
          empty={emptyText(
            query.kind,
            agentId,
            query.kind === "file" ? files === null : query.kind === "skill" ? skills === null : !session?.connected,
          )}
          onActiveChange={setPickerIndex}
          onSelect={choose}
        />
      )}
      {session && <RequestPrompt session={session} />}
      {session && !session.request && <StatusStrip session={session} />}
      {images.length > 0 && (
        <Attachments
          images={images}
          onRemove={(index) => setImages((current) => current.filter((_, i) => i !== index))}
        />
      )}

      <textarea
        ref={input}
        value={text}
        rows={1}
        onChange={(event) => {
          setText(event.target.value)
          setCaret(event.target.selectionStart)
        }}
        onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
        onPaste={(event) => {
          const files = [...event.clipboardData.files].filter((file) => IMAGE_TYPES.has(file.type))
          if (files.length === 0 || !acceptsImages) return
          event.preventDefault()
          void Promise.all(files.map(readClipboardImage)).then(addImages)
        }}
        onKeyDown={(event) => {
          if (query && !event.nativeEvent.isComposing) {
            const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0
            if (step !== 0 && rows.length > 0) {
              event.preventDefault()
              setPickerIndex((index) => (index + step + rows.length) % rows.length)
              return
            }
            const row = rows[pickerIndex]
            if ((event.key === "Enter" || event.key === "Tab") && row) {
              event.preventDefault()
              choose(row)
              return
            }
            if (event.key === "Escape") {
              event.preventDefault()
              // Don't let the window's Escape handler stop the running turn.
              event.nativeEvent.stopPropagation()
              setDismissedAt(query.start)
              return
            }
          }
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            submit()
          }
        }}
        placeholder={placeholder}
        className="text-text placeholder:text-text-3 max-h-60 min-h-[52px] resize-none bg-transparent px-4 pt-4 pb-1.5 text-sm leading-[22px] outline-none [field-sizing:content]"
      />

      <div className="flex h-12 items-center gap-1 px-2.5">
        {acceptsImages && (
          <button
            type="button"
            aria-label="Attach images"
            title="Attach images"
            onClick={() => void run(workspace.loadImages()).then(addImages)}
            className="text-text-2 hover:text-text flex size-7 items-center justify-center rounded-lg transition-colors hover:bg-white/5"
          >
            <PlusIcon className="size-4" />
          </button>
        )}
        {session && (
          <ModelEffortSelector
            models={choicesOf(model)}
            model={model?.type === "select" ? model.currentValue : undefined}
            onModelChange={(value) => model && void run(workspace.setConfigOption(session.id, model.id, value))}
            efforts={effortChoicesOf(effort)}
            effort={effort?.type === "select" ? effort.currentValue : undefined}
            onEffortChange={(value) => effort && void run(workspace.setConfigOption(session.id, effort.id, value))}
            disabled={!session.connected}
          />
        )}
        {session && <ModeMenu session={session} />}
        <span className="flex-1" />
        {session?.usage && <ContextRing usage={session.usage} />}
        {working ? (
          <button
            type="button"
            aria-label="Stop"
            onClick={() => session && void run(workspace.cancel(session.id))}
            className="bg-text flex size-[30px] items-center justify-center rounded-full shadow-[0_1px_2px_rgb(0_0_0/0.4)] transition-transform active:scale-95"
          >
            <SquareIcon className="fill-bg text-bg size-2.5" />
          </button>
        ) : (
          <button
            type="button"
            aria-label="Send"
            disabled={!canSend}
            onClick={submit}
            className={cn(
              "flex size-[30px] items-center justify-center rounded-full transition-[transform,background-color,box-shadow] active:scale-95",
              canSend
                ? "bg-amber text-amber-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.4),0_1px_2px_rgb(0_0_0/0.5),0_0_18px_rgb(255_178_36/0.22)]"
                : "text-text-3 bg-white/6",
            )}
          >
            <ArrowUpIcon className="size-3.5" strokeWidth={2.4} />
          </button>
        )}
      </div>
    </div>
  )
}
