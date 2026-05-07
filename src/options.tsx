import React, { useEffect, useMemo, useState } from "react"
import { STATIC_PROVIDERS, type ProviderDef } from "./lib/providers"
import { loadSettings, saveSettings, type Settings } from "./lib/storage"
import { getDynamicProviders, refreshModelsCache, getModelsCacheAge } from "./lib/models-cache"

import "./options.css"

function testApiKey(baseURL: string, apiKey: string): Promise<{ ok: boolean; count?: number; error?: string }> {
  return new Promise((resolve) => {
    const port = chrome.runtime.connect({ name: "test-api-key" })
    port.onMessage.addListener((msg) => { port.disconnect(); resolve(msg) })
    port.onDisconnect.addListener(() => resolve({ ok: false, error: "Connection lost" }))
    port.postMessage({ baseURL, apiKey })
  })
}

type TestState = "idle" | "testing" | "ok" | "fail"

function ProviderRow({
  def,
  apiKey,
  baseURL,
  onChange,
}: {
  def: ProviderDef
  apiKey: string
  baseURL: string
  onChange: (field: "apiKey" | "baseURL", value: string) => void
}) {
  const [testState, setTestState] = useState<TestState>("idle")
  const [testMsg, setTestMsg] = useState("")

  if (def.id === "gemini-nano") {
    return (
      <div className="opt-provider">
        <div className="opt-provider__name">{def.label}</div>
        <p className="opt-provider__note">Built-in — no configuration required.</p>
      </div>
    )
  }

  const effectiveBaseURL = baseURL || def.baseURL
  const canTest = !!(effectiveBaseURL && (apiKey || !def.requiresApiKey))

  const handleTest = async () => {
    setTestState("testing")
    setTestMsg("")
    const result = await testApiKey(effectiveBaseURL, apiKey)
    if (result?.ok) {
      setTestState("ok")
      setTestMsg(result.count != null ? `${result.count} models` : "connected")
    } else {
      setTestState("fail")
      setTestMsg(result?.error ?? "failed")
    }
  }

  return (
    <div className="opt-provider">
      <div className="opt-provider__header">
        <div className="opt-provider__name">{def.label}</div>
        {canTest && (
          <div className="opt-provider__test-wrap">
            <button
              className={`opt-test-btn opt-test-btn--${testState}`}
              onClick={handleTest}
              disabled={testState === "testing"}>
              {testState === "testing" ? "Testing…"
                : testState === "ok" ? `✓ ${testMsg}`
                : testState === "fail" ? "✗ Failed"
                : "Test"}
            </button>
            {testState === "fail" && testMsg && (
              <span className="opt-test-error">{testMsg}</span>
            )}
          </div>
        )}
      </div>

      {def.baseURLEditable && (
        <label className="opt-field">
          <span className="opt-field__label">Base URL</span>
          <input
            className="opt-input"
            type="url"
            value={baseURL}
            placeholder={def.baseURL || "https://..."}
            onChange={(e) => { onChange("baseURL", e.target.value); setTestState("idle") }}
            spellCheck={false}
          />
        </label>
      )}
      {(def.requiresApiKey || def.apiKeyPlaceholder) && (
        <label className="opt-field">
          <span className="opt-field__label">API Key</span>
          <input
            className="opt-input opt-input--key"
            type="password"
            value={apiKey}
            placeholder={def.apiKeyPlaceholder || "optional"}
            onChange={(e) => { onChange("apiKey", e.target.value); setTestState("idle") }}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
      )}
    </div>
  )
}

export default function Options() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [saved, setSaved] = useState(false)
  const [cacheAge, setCacheAge] = useState<number | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [dynamicProviders, setDynamicProviders] = useState<ProviderDef[]>([])
  const [search, setSearch] = useState("")

  useEffect(() => {
    loadSettings().then(setSettings)
    getModelsCacheAge().then(setCacheAge)
    getDynamicProviders().then(setDynamicProviders)
  }, [])

  const allProviders = useMemo<ProviderDef[]>(() => {
    const [nano, ollama, custom] = [STATIC_PROVIDERS[0], STATIC_PROVIDERS[1], STATIC_PROVIDERS[2]]
    return [nano, ...dynamicProviders, ollama, custom]
  }, [dynamicProviders])

  const visibleProviders = useMemo(() => {
    const q = search.toLowerCase()
    if (!q) return allProviders
    return allProviders.filter((p) => p.label.toLowerCase().includes(q) || p.id.includes(q))
  }, [allProviders, search])

  const handleRefreshModels = async () => {
    setRefreshing(true)
    try {
      const ts = await refreshModelsCache()
      setCacheAge(ts)
      getDynamicProviders().then(setDynamicProviders)
    } catch {}
    setRefreshing(false)
  }

  function formatAge(ts: number): string {
    const mins = Math.floor((Date.now() - ts) / 60000)
    if (mins < 1) return "just now"
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    return `${Math.floor(hrs / 24)}d ago`
  }

  if (!settings) return <div className="opt-loading">Loading…</div>

  const getConfig = (id: string) => settings.configs[id] ?? {}

  const updateConfig = (id: string, field: "apiKey" | "baseURL", value: string) => {
    setSettings((s) => s ? ({
      ...s,
      configs: { ...s.configs, [id]: { ...s.configs[id], [field]: value } }
    }) : s)
  }

  const handleSave = async () => {
    await saveSettings(settings)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="opt-root">
      <div className="opt-top">
        <header className="opt-header">
          <span className="opt-header__icon">✦</span>
          <div>
            <h1 className="opt-header__title">Reddit Summarizer</h1>
            <p className="opt-header__sub">Configure AI provider API keys</p>
          </div>
        </header>
        <div className="opt-search-wrap">
          <input
            className="opt-search"
            type="search"
            placeholder={`Search ${allProviders.length} providers…`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="opt-scroll">
        <div className="opt-card">
          {visibleProviders.length === 0 ? (
            <p className="opt-provider__note" style={{ padding: "12px 16px" }}>No providers match "{search}"</p>
          ) : (
            visibleProviders.map((def) => (
              <ProviderRow
                key={def.id}
                def={def}
                apiKey={getConfig(def.id).apiKey ?? ""}
                baseURL={getConfig(def.id).baseURL ?? def.baseURL}
                onChange={(field, value) => updateConfig(def.id, field, value)}
              />
            ))
          )}
        </div>
      </div>

      <div className="opt-footer">
        <p className="opt-footer__note">API keys stored locally, never sent anywhere except the configured provider endpoint.</p>
        <div className="opt-footer__actions">
          <button
            className="opt-refresh-btn"
            onClick={handleRefreshModels}
            disabled={refreshing}
            title="Refresh provider + model list from models.dev">
            {refreshing ? "Refreshing…" : "↺ Refresh providers"}
          </button>
          {cacheAge !== null && (
            <span className="opt-cache-age">Updated {formatAge(cacheAge)}</span>
          )}
          <button
            className={`opt-save-btn ${saved ? "opt-save-btn--saved" : ""}`}
            onClick={handleSave}>
            {saved ? "✓ Saved" : "Save"}
          </button>
        </div>
      </div>
    </div>
  )
}
