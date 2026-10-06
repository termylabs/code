import type * as acp from "@agentclientprotocol/sdk"
import { CheckIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import { useState } from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { EffortMeter } from "./primitives"

export interface Choice {
  readonly value: string
  readonly name: string
}

const effortNames: Record<string, string> = { xhigh: "Extra high" }

/** Effort stops for the slider: "default" isn't a level, so it sits out. */
export const effortChoicesOf = (option: acp.SessionConfigOption | undefined): ReadonlyArray<Choice> =>
  choicesOf(option)
    .filter((choice) => choice.value !== "default")
    .map((choice) => ({ ...choice, name: effortNames[choice.value] ?? choice.name }))

/** ACP select options can be flat or grouped; the picker only needs the flat list. */
export const choicesOf = (option: acp.SessionConfigOption | undefined): ReadonlyArray<Choice> => {
  if (!option || option.type !== "select") return []
  return option.options.flatMap((entry) => ("group" in entry ? entry.options : [entry]))
}

interface Props {
  readonly models: ReadonlyArray<Choice>
  readonly model: string | undefined
  readonly onModelChange: (value: string) => void
  readonly efforts: ReadonlyArray<Choice>
  readonly effort: string | undefined
  readonly onEffortChange: (value: string) => void
  readonly disabled?: boolean
}

export const ModelEffortSelector = ({
  models,
  model,
  onModelChange,
  efforts,
  effort,
  onEffortChange,
  disabled,
}: Props) => {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<"effort" | "models">("effort")
  const [hovered, setHovered] = useState<number | null>(null)
  const hasEfforts = efforts.length > 1

  const selectedModel = models.find((choice) => choice.value === model)
  const effortIndex = Math.max(
    efforts.findIndex((choice) => choice.value === effort),
    0,
  )
  const selectedEffort = efforts.find((choice) => choice.value === effort) ?? { value: "default", name: "Default" }

  if (models.length === 0 && !hasEfforts) return null

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    setHovered(null)
    if (next) setView(hasEfforts ? "effort" : "models")
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        disabled={disabled}
        className={cn(
          "group/selector flex h-7 items-center gap-[7px] rounded-full pr-2.5 pl-2.5 transition-[background-color,scale] duration-150 active:scale-[0.97]",
          "bg-white/5 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.05)] hover:bg-white/8 aria-expanded:bg-white/9",
          "disabled:pointer-events-none disabled:opacity-50",
        )}
      >
        {hasEfforts && <EffortMeter level={effortIndex} of={efforts.length} />}
        {selectedModel && <span className="text-text text-xs font-medium">{selectedModel.name}</span>}
        {hasEfforts && selectedEffort && <span className="text-text-2 text-xs">{selectedEffort.name}</span>}
        <ChevronDownIcon className="text-text-3 size-3 transition-transform duration-150 group-aria-expanded/selector:rotate-180" />
      </PopoverTrigger>

      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        className="w-[232px] gap-0 rounded-[14px] bg-[#1e1e21]/97 p-1 shadow-[inset_0_1px_0_rgb(255_255_255/0.06),0_0_0_1px_rgb(255_255_255/0.07),0_16px_40px_rgb(0_0_0/0.5)] ring-0 backdrop-blur-xl"
      >
        {view === "effort" && hasEfforts ? (
          <div key="effort" className="animate-in fade-in-0 flex flex-col duration-150">
            <div className="flex flex-col gap-2 px-2.5 pt-2 pb-2.5">
              <div className="flex h-5 items-center justify-between text-xs">
                <span className="text-text-3">Effort</span>
                <span className="text-text">{efforts[hovered ?? effortIndex]?.name}</span>
              </div>
              <div
                role="radiogroup"
                aria-label="Reasoning effort"
                onMouseLeave={() => setHovered(null)}
                onKeyDown={(event) => {
                  const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0
                  const next = efforts[effortIndex + step]
                  if (step === 0 || !next) return
                  event.preventDefault()
                  onEffortChange(next.value)
                }}
                className="flex gap-1"
              >
                {efforts.map((choice, index) => (
                  <button
                    key={choice.value}
                    type="button"
                    role="radio"
                    aria-checked={index === effortIndex}
                    aria-label={choice.name}
                    tabIndex={index === effortIndex ? 0 : -1}
                    onClick={() => onEffortChange(choice.value)}
                    onMouseEnter={() => setHovered(index)}
                    className="flex h-5 flex-1 items-center"
                  >
                    <span
                      className={cn(
                        "h-1.5 w-full rounded-full transition-colors duration-150",
                        index <= effortIndex
                          ? "bg-amber"
                          : hovered !== null && index <= hovered
                            ? "bg-amber/35"
                            : "bg-white/10",
                      )}
                    />
                  </button>
                ))}
              </div>
            </div>
            {models.length > 0 && (
              <>
                <div className="bg-line mx-1.5 h-px" />
                <button
                  type="button"
                  onClick={() => setView("models")}
                  className="hover:bg-hover mt-1 flex h-8 items-center gap-2 rounded-[10px] px-2.5 text-xs transition-colors"
                >
                  <span className="text-text-3">Model</span>
                  <span className="text-text ml-auto truncate">{selectedModel?.name ?? "Choose"}</span>
                  <ChevronRightIcon className="text-text-3 size-3 shrink-0" />
                </button>
              </>
            )}
          </div>
        ) : (
          <div key="models" className="animate-in fade-in-0 flex flex-col duration-150">
            {hasEfforts && (
              <button
                type="button"
                onClick={() => setView("effort")}
                className="text-text-3 hover:text-text-2 flex h-7 items-center gap-1 px-1.5 text-xs transition-colors"
              >
                <ChevronLeftIcon className="size-3.5" />
                Effort
              </button>
            )}
            <div className="flex max-h-72 flex-col overflow-y-auto">
              {models.map((choice) => (
                <button
                  key={choice.value}
                  type="button"
                  onClick={() => {
                    onModelChange(choice.value)
                    if (hasEfforts) setView("effort")
                    else setOpen(false)
                  }}
                  className="hover:bg-hover flex h-8 shrink-0 items-center justify-between gap-3 rounded-[10px] px-2.5 text-left transition-colors"
                >
                  <span className="text-text truncate text-xs">{choice.name}</span>
                  {choice.value === model && <CheckIcon className="text-amber size-3.5 shrink-0" />}
                </button>
              ))}
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
