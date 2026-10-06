import { CheckIcon, ChevronRightIcon } from "lucide-react"
import { useLayoutEffect, useMemo, useRef, useState } from "react"
import { Shimmer } from "@/components/shimmer/components/shimmer"
import type { ImageAttachment, Session } from "@/domain/session"
import { type Block, toBlocks } from "@/domain/timeline"
import { cn } from "@/lib/utils"
import { Markdown } from "./markdown"
import { MessageActions } from "./message-actions"
import { Led } from "./primitives"
import { ToolStack } from "./tool-stack"

const STICK_THRESHOLD_PX = 64

const Thought = ({ text, live }: { text: string; live: boolean }) => {
  const [open, setOpen] = useState(false)
  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="group/thought flex h-[30px] items-center gap-1.5 self-start text-[13px]"
      >
        {live ? <Shimmer className="text-text-2">Thinking</Shimmer> : <span className="text-text-3">Thought</span>}
        <ChevronRightIcon
          className={cn(
            "text-text-3 group-hover/thought:text-text-2 size-3.5 transition-transform duration-200",
            open && "rotate-90",
          )}
        />
      </button>
      {open && (
        <p className="selectable text-text-3 animate-in fade-in-0 border-line border-l pl-3 text-[13px] leading-[21px] whitespace-pre-wrap duration-200">
          {text}
        </p>
      )}
    </div>
  )
}

const Plan = ({ entries }: { entries: Extract<Block, { _tag: "Plan" }>["entries"] }) => (
  <div className="flex flex-col gap-1.5 rounded-xl bg-white/[0.02] px-3.5 py-3 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.04)]">
    {entries.map((entry, index) => (
      <div key={index} className="flex items-start gap-2.5">
        <span className="mt-[5px] flex size-3 shrink-0 items-center justify-center">
          {entry.status === "completed" ? (
            <CheckIcon className="text-text-3 size-3" />
          ) : entry.status === "in_progress" ? (
            <Led />
          ) : (
            <span className="border-text-3 size-2 rounded-full border" />
          )}
        </span>
        <span
          className={cn(
            "text-[13px] leading-[21px]",
            entry.status === "completed" ? "text-text-3" : entry.status === "in_progress" ? "text-text" : "text-text-2",
          )}
        >
          {entry.content}
        </span>
      </div>
    ))}
  </div>
)

interface TimelineProps {
  readonly session: Session
  readonly onRetry: (text: string, images: ReadonlyArray<ImageAttachment>) => void
}

export const Timeline = ({ session, onRetry }: TimelineProps) => {
  const blocks = useMemo(() => toBlocks(session.items), [session.items])
  const scroller = useRef<HTMLDivElement>(null)
  const stuck = useRef(true)
  const working = session.status === "working"

  useLayoutEffect(() => {
    const element = scroller.current
    if (element && stuck.current) element.scrollTop = element.scrollHeight
  }, [blocks, session.request, working])

  /** The last user message before each block, so an answer can be retried. */
  const promptBefore = (index: number) => {
    for (let i = index; i >= 0; i--) {
      const block = blocks[i]
      if (block?._tag === "User") return block
    }
    return null
  }

  const isTurnEnd = (index: number) => {
    const next = blocks.slice(index + 1).find((block) => block._tag !== "Notice")
    return next === undefined ? !working : next._tag === "User"
  }

  return (
    <div
      ref={scroller}
      onScroll={(event) => {
        const element = event.currentTarget
        stuck.current = element.scrollHeight - element.scrollTop - element.clientHeight < STICK_THRESHOLD_PX
      }}
      className="min-h-0 flex-1 overflow-y-auto px-10 pt-5 pb-10"
    >
      <div className="mx-auto flex w-full max-w-[640px] flex-col gap-6">
        {blocks.map((block, index) => {
          const last = index === blocks.length - 1
          switch (block._tag) {
            case "User":
              return (
                <div key={block.id} className="flex justify-end pl-16">
                  <div className="flex flex-col items-end gap-2">
                    {block.images && block.images.length > 0 && (
                      <div className="flex flex-wrap justify-end gap-2">
                        {block.images.map((image, imageIndex) => (
                          <img
                            key={imageIndex}
                            src={`data:${image.mimeType};base64,${image.data}`}
                            alt={image.name}
                            title={image.name}
                            className="max-h-48 max-w-60 rounded-xl object-cover shadow-[0_0_0_1px_rgb(255_255_255/0.08)]"
                          />
                        ))}
                      </div>
                    )}
                    {block.text && (
                      <div className="bg-raised selectable text-text rounded-[16px_16px_6px_16px] px-4 py-3 text-sm leading-[22px] whitespace-pre-wrap shadow-[inset_0_1px_0_rgb(255_255_255/0.04)]">
                        {block.text}
                      </div>
                    )}
                  </div>
                </div>
              )
            case "Agent": {
              const prompt = promptBefore(index)
              return (
                <div key={block.id} className="group/answer flex flex-col gap-2">
                  <Markdown text={block.text} />
                  {isTurnEnd(index) && (
                    <MessageActions
                      text={block.text}
                      onRetry={prompt && !working ? () => onRetry(prompt.text, prompt.images ?? []) : undefined}
                      className={cn(!last && "opacity-0 transition-opacity group-hover/answer:opacity-100")}
                    />
                  )}
                </div>
              )
            }
            case "Thought":
              return <Thought key={block.id} text={block.text} live={working && last} />
            case "Stack":
              return <ToolStack key={block.id} tools={block.tools} live={working && last} cwd={session.cwd} />
            case "Plan":
              return <Plan key={block.id} entries={block.entries} />
            case "Notice":
              return (
                <div key={block.id} className="flex items-start gap-2.5">
                  <span
                    className={cn(
                      "mt-[7px] size-1.5 shrink-0 rounded-full",
                      block.tone === "error" ? "bg-remove" : "bg-text-3",
                    )}
                  />
                  <p className="selectable text-text-2 text-[13px] leading-[21px]">{block.text}</p>
                </div>
              )
          }
        })}
        {working && blocks.at(-1)?._tag === "User" && (
          <Shimmer className="text-text-2 self-start text-[13px]">Thinking</Shimmer>
        )}
      </div>
    </div>
  )
}
