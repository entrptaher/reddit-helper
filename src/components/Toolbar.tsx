import React from "react"
import { STYLES, STYLE_KEYS, type StyleKey } from "../lib/styles"
import type { ProviderDef } from "../lib/providers"

type Phase = "idle" | "loading" | "streaming" | "done" | "error" | "cached"

interface Props {
  phase: Phase
  style: StyleKey
  provider: string
  model: string
  providers: ProviderDef[]
  availableModels: string[]
  modelsLoading: boolean
  apiKeyMissing: boolean
  onStyleChange: (s: StyleKey) => void
  onProviderChange: (p: string) => void
  onModelChange: (m: string) => void
  onAnalyze: () => void
  onStop: () => void
}

function modelLabel(m: string): string {
  const slash = m.lastIndexOf("/")
  return slash >= 0 ? m.slice(slash + 1) : m
}

export function Toolbar({
  phase, style, provider, model, providers, availableModels, modelsLoading, apiKeyMissing,
  onStyleChange, onProviderChange, onModelChange, onAnalyze, onStop
}: Props) {
  const busy = phase === "loading" || phase === "streaming"

  return (
    <div className="rds-toolbar">
      <span className="rds-toolbar__brand">✦</span>

      <select
        className="rds-style-select"
        value={provider}
        onChange={(e) => onProviderChange(e.target.value)}
        disabled={busy}
        aria-label="AI provider">
        {providers.map((p) => (
          <option key={p.id} value={p.id}>{p.label}</option>
        ))}
      </select>

      {provider !== "gemini-nano" && (
        <select
          className="rds-style-select rds-model-select"
          value={model}
          onChange={(e) => onModelChange(e.target.value)}
          disabled={busy || modelsLoading || apiKeyMissing}
          title={apiKeyMissing ? "Add an API key in Settings" : undefined}
          aria-label="Model">
          {modelsLoading ? (
            <option>Loading…</option>
          ) : apiKeyMissing ? (
            <option>— API key required —</option>
          ) : (
            availableModels.map((m) => (
              <option key={m} value={m}>{modelLabel(m)}</option>
            ))
          )}
        </select>
      )}

      <select
        className="rds-style-select"
        value={style}
        onChange={(e) => onStyleChange(e.target.value as StyleKey)}
        disabled={busy}
        aria-label="Summary style">
        {STYLE_KEYS.map((k) => (
          <option key={k} value={k}>
            {STYLES[k].emoji} {STYLES[k].label}
          </option>
        ))}
      </select>

      <button
        className="rds-settings-btn"
        onClick={() => chrome.runtime.sendMessage({ type: "openOptions" })}
        title="Settings"
        aria-label="Open settings">
        ⚙
      </button>

      {busy ? (
        <button className="rds-stop-btn" onClick={onStop} aria-label="Stop generation">
          <span className="rds-stop-icon" aria-hidden="true" />
          Stop
        </button>
      ) : (
        <button
          className={`rds-analyze-btn rds-analyze-btn--${phase}`}
          onClick={onAnalyze}>
          {(phase === "idle" || phase === "error") && "✨ Analyze"}
          {(phase === "done" || phase === "cached") && "↺ Re-analyze"}
        </button>
      )}
    </div>
  )
}
