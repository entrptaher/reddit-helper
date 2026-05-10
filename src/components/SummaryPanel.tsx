import React, { useEffect, useRef, useState } from "react"
import { marked } from "marked"
import type { ThreadStats } from "../lib/reddit-extractor"
import type { UsageData } from "../lib/language-model"
import { EXA_SEARCH_TYPES, type RelatedResultsState, type ExaRelatedResult } from "../lib/exa"
import { REDDIT_SEARCH_SORTS, type RedditSearchResult, type RedditSearchSort, type RedditSearchState } from "../lib/reddit-search"

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
  relatedResults?: RelatedResultsState
  redditSearch?: RedditSearchState
  redditSearchSort?: RedditSearchSort
  onRedditSearchSortChange?: (sort: RedditSearchSort) => void
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
  const [open, setOpen] = useState(false)
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

function resultHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

function resultPath(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.pathname.replace(/\/$/, "")
  } catch {
    return ""
  }
}

function RelatedResultRow({ result }: { result: ExaRelatedResult }) {
  const image = result.image || result.favicon

  return (
    <a className="rds-related__item" href={result.url} target="_blank" rel="noreferrer">
      {image ? (
        <img className="rds-related__thumb" src={image} alt="" loading="lazy" />
      ) : (
        <span className="rds-related__thumb rds-related__thumb--fallback">r/</span>
      )}
      <span className="rds-related__content">
        <span className="rds-related__title">{result.title}</span>
        <span className="rds-related__meta">
          {resultHost(result.url)}
          {result.author ? ` · ${result.author}` : ""}
        </span>
        <span className="rds-related__path">{resultPath(result.url)}</span>
      </span>
    </a>
  )
}

function RelatedResults({ state }: { state: RelatedResultsState }) {
  const count = state.results.length
  const searchTypeLabel = EXA_SEARCH_TYPES.find((type) => type.value === state.searchType)?.label ?? "Exa"

  return (
    <div className="rds-related">
      {state.query && <div className="rds-related__query">{state.query}</div>}
      {state.phase === "loading" && (
        <div className="rds-related__status">Fetching from Exa...</div>
      )}
      {state.phase === "error" && (
        <div className="rds-related__error">{state.errorMessage ?? "Failed to fetch related results."}</div>
      )}
      {state.phase === "done" && count === 0 && (
        <div className="rds-related__status">No related results found.</div>
      )}
      {state.phase === "done" && count > 0 && (
        <div className="rds-related__list">
          {state.results.slice(0, 10).map((result) => (
            <RelatedResultRow key={result.id || result.url} result={result} />
          ))}
        </div>
      )}
      {state.phase === "done" && typeof state.searchTime === "number" && (
        <div className="rds-related__foot">{searchTypeLabel} search: {state.searchTime.toFixed(0)}ms</div>
      )}
    </div>
  )
}

function formatRelativeDate(createdUtc?: number): string {
  if (!createdUtc) return ""
  const diffMs = Date.now() - createdUtc * 1000
  const days = Math.floor(diffMs / 86_400_000)
  if (days < 1) return "today"
  if (days < 30) return `${days}d ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

function trimSnippet(text?: string): string {
  if (!text) return ""
  const cleaned = text.replace(/\s+/g, " ").trim()
  return cleaned.length > 180 ? `${cleaned.slice(0, 177)}...` : cleaned
}

function RedditSearchRow({ result }: { result: RedditSearchResult }) {
  const snippet = trimSnippet(result.selftext)
  const date = formatRelativeDate(result.createdUtc)

  return (
    <a className="rds-related__item" href={result.url} target="_blank" rel="noreferrer">
      {result.thumbnail ? (
        <img className="rds-related__thumb" src={result.thumbnail} alt="" loading="lazy" />
      ) : (
        <span className="rds-related__thumb rds-related__thumb--fallback">r/</span>
      )}
      <span className="rds-related__content">
        <span className="rds-related__title">{result.title}</span>
        <span className="rds-related__meta">
          {[result.subreddit, result.author ? `u/${result.author}` : "", date].filter(Boolean).join(" · ")}
        </span>
        {snippet && <span className="rds-related__snippet">{snippet}</span>}
        <span className="rds-related__path">
          {result.score.toLocaleString()} points · {result.numComments.toLocaleString()} comments
        </span>
      </span>
    </a>
  )
}

function RedditSearchResults({
  state,
  sort,
  onSortChange,
}: {
  state: RedditSearchState
  sort: RedditSearchSort
  onSortChange?: (sort: RedditSearchSort) => void
}) {
  const count = state.results.length
  const queryLabel = [state.subreddit ? `r/${state.subreddit}` : "", state.query].filter(Boolean).join(" · ")

  return (
    <div className="rds-related rds-related--reddit">
      <div className="rds-related__tools">
        {queryLabel && <div className="rds-related__query">{queryLabel}</div>}
        <label className="rds-related__sort">
          <span>Sort</span>
          <select
            value={sort}
            onChange={(e) => onSortChange?.(e.target.value as RedditSearchSort)}
            disabled={state.phase === "loading"}>
            {REDDIT_SEARCH_SORTS.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
        </label>
      </div>
      {state.phase === "loading" && (
        <div className="rds-related__status">Fetching from Reddit search...</div>
      )}
      {state.phase === "error" && (
        <div className="rds-related__error">{state.errorMessage ?? "Failed to fetch Reddit search results."}</div>
      )}
      {state.phase === "done" && count === 0 && (
        <div className="rds-related__status">No Reddit search results found.</div>
      )}
      {state.phase === "done" && count > 0 && (
        <div className="rds-related__list">
          {state.results.slice(0, 10).map((result) => (
            <RedditSearchRow key={result.id || result.url} result={result} />
          ))}
        </div>
      )}
    </div>
  )
}

type TabKey = "summary" | "exa" | "reddit"

function resultCountLabel(count: number): string {
  return `${count} result${count === 1 ? "" : "s"}`
}

function formatUsage(u: UsageData): string {
  const parts: string[] = []
  if (u.totalTokens) parts.push(`${u.totalTokens.toLocaleString()} tok`)
  else if (u.completionTokens) parts.push(`${u.completionTokens.toLocaleString()} tok`)
  parts.push(`${(u.elapsedMs / 1000).toFixed(1)}s`)
  return parts.join(" · ")
}

export function SummaryPanel({ phase, rawText, reasoningText, errorMessage, fromCache, stats, modelReady = false, providerLabel, usageData, relatedResults, redditSearch, redditSearchSort = "relevance", onRedditSearchSortChange, onClose }: Props) {
  const [open, setOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [activeTab, setActiveTab] = useState<TabKey>("summary")
  const hasRelated = !!relatedResults && relatedResults.phase !== "idle"
  const hasRedditSearch = !!redditSearch && redditSearch.phase !== "idle"
  const hasSummary = phase !== "idle"
  const hasPanelContent = hasSummary || hasRelated || hasRedditSearch
  const tabs: Array<{ key: TabKey; label: string; meta?: string }> = []

  if (hasSummary) tabs.push({ key: "summary", label: "Summary" })
  if (hasRelated) {
    const meta = relatedResults.phase === "loading"
      ? "Searching"
      : relatedResults.phase === "error"
        ? "Unavailable"
        : resultCountLabel(relatedResults.results.length)
    tabs.push({ key: "exa", label: "Exa search", meta })
  }
  if (hasRedditSearch) {
    const meta = redditSearch.phase === "loading"
      ? "Searching"
      : redditSearch.phase === "error"
        ? "Unavailable"
        : resultCountLabel(redditSearch.results.length)
    tabs.push({ key: "reddit", label: "Reddit search", meta })
  }

  useEffect(() => {
    if (hasPanelContent) requestAnimationFrame(() => setOpen(true))
    else setOpen(false)
  }, [hasPanelContent])

  useEffect(() => {
    if (!tabs.some((tab) => tab.key === activeTab)) {
      setActiveTab(tabs[0]?.key ?? "summary")
    }
  }, [activeTab, tabs])

  const prevHasRelated = useRef(hasRelated)
  const prevHasRedditSearch = useRef(hasRedditSearch)
  useEffect(() => {
    if (!hasSummary && hasRelated && !prevHasRelated.current) setActiveTab("exa")
    else if (!hasSummary && hasRedditSearch && !prevHasRedditSearch.current) setActiveTab("reddit")
    prevHasRelated.current = hasRelated
    prevHasRedditSearch.current = hasRedditSearch
  }, [hasRelated, hasRedditSearch, hasSummary])

  const showStats = !!stats && (phase === "loading" || phase === "streaming")
  const isStreaming = phase === "streaming"
  const hasReasoning = !!reasoningText
  const reasoningActive = isStreaming && !rawText
  const showShimmer = phase === "loading" && !stats && !hasReasoning
  const showText = (phase === "streaming" || phase === "done" || phase === "cached") && rawText

  return (
    <div className={`rds-panel ${open ? "rds-panel--open" : ""}`} role="region" aria-label="Post tools">
      <div className="rds-panel__card">
        <div className="rds-panel__head" onClick={() => setCollapsed((v) => !v)} style={{ cursor: "pointer" }}>
          <div className="rds-panel__head-left">
            <span className="rds-panel__icon">✦</span>
            <span className="rds-panel__title">Post tools</span>
            {phase !== "idle" && <span className="rds-panel__badge">{providerLabel ?? "Gemini Nano"}</span>}
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
          {tabs.length > 1 && (
            <div className="rds-tabs" role="tablist" aria-label="Post tool result tabs">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  className={`rds-tab ${activeTab === tab.key ? "rds-tab--active" : ""}`}
                  onClick={() => setActiveTab(tab.key)}
                  role="tab"
                  aria-selected={activeTab === tab.key}>
                  <span>{tab.label}</span>
                  {tab.meta && <span className="rds-tab__meta">{tab.meta}</span>}
                </button>
              ))}
            </div>
          )}

          <div className="rds-tab-panel" role="tabpanel">
            {activeTab === "summary" && hasSummary && (
              <>
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
              </>
            )}
            {activeTab === "exa" && hasRelated && <RelatedResults state={relatedResults} />}
            {activeTab === "reddit" && hasRedditSearch && (
              <RedditSearchResults
                state={redditSearch}
                sort={redditSearch.sort ?? redditSearchSort}
                onSortChange={onRedditSearchSortChange}
              />
            )}
          </div>
        </div>}
      </div>
    </div>
  )
}
