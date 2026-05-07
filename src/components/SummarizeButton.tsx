import React from "react"

type Phase = "idle" | "loading" | "streaming" | "done" | "error"

interface Props {
  phase: Phase
  onClick: () => void
}

const PHASE_CONFIG: Record<Phase, { label: string; icon: string; disabled: boolean }> = {
  idle: { label: "Summarize", icon: "✨", disabled: false },
  loading: { label: "Thinking…", icon: "", disabled: true },
  streaming: { label: "Summarizing…", icon: "", disabled: true },
  done: { label: "Re-summarize", icon: "↺", disabled: false },
  error: { label: "Try again", icon: "⚠", disabled: false }
}

export function SummarizeButton({ phase, onClick }: Props) {
  const { label, icon, disabled } = PHASE_CONFIG[phase]
  const isActive = phase === "loading" || phase === "streaming"

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rds-btn rds-btn--${phase}`}
      aria-label="Summarize this Reddit post using AI">
      {isActive && <span className="rds-spinner" aria-hidden="true" />}
      {icon && !isActive && <span className="rds-btn__icon">{icon}</span>}
      <span className="rds-btn__label">{label}</span>
    </button>
  )
}
