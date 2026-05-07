import React, { useEffect, useRef, useState } from "react"
import { marked } from "marked"
import type { ThreadStats } from "../lib/reddit-extractor"
import type { UsageData } from "../lib/language-model"

marked.setOptions({ breaks: true, gfm: true } as any)

type Phase = "idle" | "loading" | "streaming" | "done" | "error" | "cached"

interface Props {
  phase: Phase
  rawText: string
  reasoningText?: string
  errorMessage?: string
  fromCache?: boolean
  stats?: ThreadStats | null
  modelReady?: boolean
  providerLabel?: string
  usageData?: UsageData
  onClose: () => void
}

const PIPELINE_LABELS = [
  "Extracting thread content",
  "Loading language model",
  "Generating summary",
]

type StepState = "done" | "active" | "pending" | "error"

function getStepStates(phase: Phase, modelReady: boolean): StepState[] {
  if (phase === "loading" && !modelReady) return ["done", "active", "pending"]
  if (phase === "loading" && modelReady)  return ["done", "done",   "active"]
  if (phase === "streaming")              return ["done", "done",   "active"]
  if (phase === "done" || phase === "cached") return ["done", "done", "done"]
  if (phase === "error") {
    if (!modelReady) return ["done", "error", "pending"]
    return ["done", "done", "error"]
  }
  return ["active", "pending", "pending"]
}

function PipelineSteps({ phase, modelReady }: { phase: Phase; modelReady: boolean }) {
  const steps = getStepStates(phase, modelReady)
  return (
    <div className="rds-pipeline">
      {PIPELINE_LABELS.map((label, i) => (
        <div key={i} className={`rds-pipeline__step rds-pipeline__step--${steps[i]}`}>
          <span className="rds-pipeline__dot" />
          <span>{label}</span>
        </div>
      ))}
    </div>
  )
}

function ShimmerLines() {
  return (
    <div className="rds-shimmer-wrap">
      <div className="rds-shimmer" style={{ width: "88%" }} />
      <div className="rds-shimmer" style={{ width: "76%" }} />
      <div className="rds-shimmer" style={{ width: "82%" }} />
      <div className="rds-shimmer" style={{ width: "68%" }} />
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {}
  }
  return (
    <button
      className={`rds-icon-btn ${copied ? "rds-icon-btn--copied" : ""}`}
      onClick={copy}
      title="Copy to clipboard"
      aria-label="Copy summary">
      {copied ? "✓" : "⎘"}
    </button>
  )
}

function ReasoningBlock({ text, active }: { text: string; active: boolean }) {
  const [open, setOpen] = useState(true)
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open && bodyRef.current)
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [text, open])

  // Auto-collapse when model finishes reasoning and starts answering
  const prevActive = useRef(active)
  useEffect(() => {
    if (prevActive.current && !active) setOpen(false)
    prevActive.current = active
  }, [active])

  const wordCount = text.trim().split(/\s+/).length

  return (
    <div className="rds-reasoning">
      <button className="rds-reasoning__toggle" onClick={() => setOpen((v) => !v)}>
        <span className={`rds-reasoning__chevron ${open ? "rds-reasoning__chevron--open" : ""}`}>▶</span>
        <span className="rds-reasoning__label">{active ? "Thinking…" : "Reasoning"}</span>
        <span className="rds-reasoning__tokens">~{wordCount} tokens</span>
        {active && <span className="rds-reasoning__pulse" />}
      </button>
      {open && (
        <div className="rds-reasoning__body" ref={bodyRef}>
          <pre className="rds-reasoning__text">{text}</pre>
        </div>
      )}
    </div>
  )
}

function MarkdownBody({ text, streaming }: { text: string; streaming: boolean }) {
  const html = marked.parse(text) as string
  return (
    <div
      className={`rds-md ${streaming ? "rds-md--streaming" : ""}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

function formatUsage(u: UsageData): string {
  const parts: string[] = []
  if (u.totalTokens) parts.push(`${u.totalTokens.toLocaleString()} tok`)
  else if (u.completionTokens) parts.push(`${u.completionTokens.toLocaleString()} tok`)
  parts.push(`${(u.elapsedMs / 1000).toFixed(1)}s`)
  return parts.join(" · ")
}

export function SummaryPanel({ phase, rawText, reasoningText, errorMessage, fromCache, stats, modelReady = false, providerLabel, usageData, onClose }: Props) {
  const [open, setOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    if (phase !== "idle") requestAnimationFrame(() => setOpen(true))
    else setOpen(false)
  }, [phase])

  const showStats = !!stats && (phase === "loading" || phase === "streaming")
  const isStreaming = phase === "streaming"
  const hasReasoning = !!reasoningText
  const reasoningActive = isStreaming && !rawText
  const showShimmer = phase === "loading" && !stats && !hasReasoning
  const showText = (phase === "streaming" || phase === "done" || phase === "cached") && rawText

  return (
    <div className={`rds-panel ${open ? "rds-panel--open" : ""}`} role="region" aria-label="AI Summary">
      <div className="rds-panel__card">
        <div className="rds-panel__head" onClick={() => setCollapsed((v) => !v)} style={{ cursor: "pointer" }}>
          <div className="rds-panel__head-left">
            <span className="rds-panel__icon">✦</span>
            <span className="rds-panel__title">AI Summary</span>
            <span className="rds-panel__badge">{providerLabel ?? "Gemini Nano"}</span>
            {fromCache && <span className="rds-panel__cached">cached</span>}
            {usageData && (phase === "done" || phase === "cached") && (
              <span className="rds-panel__usage">{formatUsage(usageData)}</span>
            )}
          </div>
          <div className="rds-panel__head-right" onClick={(e) => e.stopPropagation()}>
            {(phase === "done" || phase === "cached") && rawText && (
              <CopyButton text={rawText} />
            )}
            <button className="rds-icon-btn rds-icon-btn--close" onClick={onClose} title="Close" aria-label="Close">
              ✕
            </button>
          </div>
        </div>

        {!collapsed && <div className="rds-panel__body">
          {showStats && <PipelineSteps phase={phase} modelReady={modelReady} />}
          {phase === "error" && stats && <PipelineSteps phase={phase} modelReady={modelReady} />}
          {showShimmer && <ShimmerLines />}
          {hasReasoning && <ReasoningBlock text={reasoningText!} active={reasoningActive} />}
          {showText && <MarkdownBody text={rawText} streaming={isStreaming} />}
          {phase === "error" && (
            <p className="rds-error">
              {errorMessage?.includes("403")
                ? `${errorMessage} — Ollama blocks extension requests by default. Set OLLAMA_ORIGINS=* before starting Ollama.`
                : errorMessage ?? (providerLabel === "Gemini Nano (Built-in)"
                  ? "Failed. Ensure Gemini Nano is enabled: chrome://flags/#prompt-api-for-gemini-nano"
                  : "Failed to generate summary.")}
            </p>
          )}
        </div>}
      </div>
    </div>
  )
}
