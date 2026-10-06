import type * as acp from "@agentclientprotocol/sdk"
import { CheckIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import { useState } from "react"
import { StepSlider } from "@/components/step-slider/components/step-slider"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { EffortMeter } from "./primitives"

export interface Choice {
  readonly value: string
  readonly name: string
  readonly description?: string | null
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
        sideOffset={10}
        className="w-[316px] gap-0 rounded-[18px] bg-[#1e1e21]/97 p-0 shadow-[inset_0_1px_0_rgb(255_255_255/0.08),0_0_0_1px_rgb(255_255_255/0.07),0_24px_60px_rgb(0_0_0/0.6),0_4px_12px_rgb(0_0_0/0.35)] ring-0 backdrop-blur-xl"
      >
        {view === "effort" && hasEfforts ? (
          <div key="effort" className="animate-in fade-in-0 slide-in-from-bottom-1 flex flex-col gap-3 p-4 pt-3.5 duration-200">
            <div className="flex items-start">
              <span className="flex size-6 items-center justify-center">
                <EffortMeter level={effortIndex} of={efforts.length} size="md" />
              </span>
              <div className="flex flex-1 flex-col items-center gap-0.5">
                <span className="text-amber text-[17px] leading-6 font-semibold tracking-[-0.015em]">
                  {selectedEffort?.name}
                </span>
                {models.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setView("models")}
                    className="text-text-2 hover:text-text flex items-center gap-1 rounded-full px-2 text-[13px] transition-colors"
                  >
                    {selectedModel?.name ?? "Choose model"}
                    <ChevronRightIcon className="size-3" />
                  </button>
                )}
              </div>
              <span className="size-6" />
            </div>
            <StepSlider
              aria-label="Reasoning effort"
              steps={efforts.map((_, index) => index)}
              value={effortIndex}
              onValueChange={(index) => {
                const next = efforts[index]
                if (next) onEffortChange(next.value)
              }}
              formatLabel={(index) => efforts[index]?.name ?? ""}
              getValueText={(index) => efforts[index]?.name ?? ""}
            />
          </div>
        ) : (
          <div key="models" className="animate-in fade-in-0 slide-in-from-bottom-1 flex flex-col p-1.5 duration-200">
            {hasEfforts && (
              <button
                type="button"
                onClick={() => setView("effort")}
                className="text-text-3 hover:text-text-2 flex h-8 items-center gap-1 px-2.5 text-xs"
              >
                <ChevronLeftIcon className="size-3.5" />
                Reasoning effort
              </button>
            )}
            <div className="flex max-h-80 flex-col overflow-y-auto">
              {models.map((choice) => (
                <button
                  key={choice.value}
                  type="button"
                  onClick={() => {
                    onModelChange(choice.value)
                    if (hasEfforts) setView("effort")
                    else setOpen(false)
                  }}
                  className="hover:bg-hover flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition-colors"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="text-text truncate text-[13px]">{choice.name}</span>
                    {choice.description && (
                      <span className="text-text-3 truncate text-xs">{choice.description}</span>
                    )}
                  </span>
                  {choice.value === model && <CheckIcon className="text-amber size-4 shrink-0" />}
                </button>
              ))}
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
