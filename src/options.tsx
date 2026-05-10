import React, { useEffect, useMemo, useState } from "react"
import { createCustomProvider, STATIC_PROVIDERS, type ProviderDef } from "./lib/providers"
import { loadSettings, saveSettings, type Settings } from "./lib/storage"
import { getDynamicProviders, refreshModelsCache, getModelsCacheAge } from "./lib/models-cache"
import { EXA_SEARCH_TYPES, normalizeExaSearchType } from "./lib/exa"

import "./options.css"

function testApiKey(baseURL: string, apiKey: string): Promise<{ ok: boolean; count?: number; error?: string }> {
  return new Promise((resolve) => {
    const port = chrome.runtime.connect({ name: "test-api-key" })
    port.onMessage.addListener((msg) => { port.disconnect(); resolve(msg) })
    port.onDisconnect.addListener(() => resolve({ ok: false, error: "Connection lost" }))
    port.postMessage({ baseURL, apiKey })
  })
}

function testExaSearch(apiKey: string, searchType: string): Promise<{ ok: boolean; count?: number; error?: string }> {
  return new Promise((resolve) => {
    const port = chrome.runtime.connect({ name: "test-exa-search" })
    port.onMessage.addListener((msg) => { port.disconnect(); resolve(msg) })
    port.onDisconnect.addListener(() => resolve({ ok: false, error: "Connection lost" }))
    port.postMessage({ apiKey, query: "site:reddit.com upwork", searchType })
  })
}

function testRedditSearch(): Promise<{ ok: boolean; count?: number; error?: string }> {
  return new Promise((resolve) => {
    const port = chrome.runtime.connect({ name: "test-reddit-search" })
    port.onMessage.addListener((msg) => { port.disconnect(); resolve(msg) })
    port.onDisconnect.addListener(() => resolve({ ok: false, error: "Connection lost" }))
    port.postMessage({ query: "upwork", subreddit: "Upwork" })
  })
}

type TestState = "idle" | "testing" | "ok" | "fail"

function parseModels(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((m) => m.trim())
    .filter(Boolean)
}

function hostPermissionPattern(baseURL: string): string | null {
  try {
    const url = new URL(baseURL)
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    return `${url.origin}/*`
  } catch {
    return null
  }
}

function ensureHostPermission(baseURL: string): Promise<boolean> {
  const origin = hostPermissionPattern(baseURL)
  if (!origin || !chrome.permissions) return Promise.resolve(true)

  return new Promise((resolve) => {
    chrome.permissions.contains({ origins: [origin] }, (hasPermission) => {
      if (hasPermission) {
        resolve(true)
        return
      }
      chrome.permissions.request({ origins: [origin] }, (granted) => resolve(Boolean(granted)))
    })
  })
}

function ProviderRow({
  def,
  apiKey,
  baseURL,
  onChange,
  onProviderChange,
  onRemove,
}: {
  def: ProviderDef
  apiKey: string
  baseURL: string
  onChange: (field: "apiKey" | "baseURL", value: string) => void
  onProviderChange?: (patch: Partial<ProviderDef>) => void
  onRemove?: () => void
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
    const allowed = await ensureHostPermission(effectiveBaseURL)
    if (!allowed) {
      setTestState("fail")
      setTestMsg("Host permission denied")
      return
    }
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
        <div className="opt-provider__actions">
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
          {def.custom && onRemove && (
            <button className="opt-remove-btn" onClick={onRemove} title="Remove custom server">
              Remove
            </button>
          )}
        </div>
      </div>

      {def.custom && onProviderChange && (
        <label className="opt-field">
          <span className="opt-field__label">Server Name</span>
          <input
            className="opt-input"
            type="text"
            value={def.label}
            placeholder="Custom Server"
            onChange={(e) => onProviderChange({ label: e.target.value })}
            spellCheck={false}
          />
        </label>
      )}

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
      {def.custom && onProviderChange && (
        <label className="opt-field">
          <span className="opt-field__label">Models</span>
          <textarea
            className="opt-input opt-textarea"
            value={def.defaultModels.join("\n")}
            placeholder={"gpt-4.1\nclaude-sonnet-4-5\nllama3.2"}
            onChange={(e) => onProviderChange({ defaultModels: parseModels(e.target.value) })}
            spellCheck={false}
            rows={4}
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
  const [activeTab, setActiveTab] = useState<"providers" | "finder">("providers")
  const [saved, setSaved] = useState(false)
  const [cacheAge, setCacheAge] = useState<number | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [dynamicProviders, setDynamicProviders] = useState<ProviderDef[]>([])
  const [search, setSearch] = useState("")
  const [exaTestState, setExaTestState] = useState<TestState>("idle")
  const [exaTestMsg, setExaTestMsg] = useState("")
  const [redditTestState, setRedditTestState] = useState<TestState>("idle")
  const [redditTestMsg, setRedditTestMsg] = useState("")

  useEffect(() => {
    loadSettings().then(setSettings)
    getModelsCacheAge().then(setCacheAge)
    getDynamicProviders().then(setDynamicProviders)
  }, [])

  const allProviders = useMemo<ProviderDef[]>(() => {
    const [nano, ollama] = [STATIC_PROVIDERS[0], STATIC_PROVIDERS[1]]
    return [nano, ...dynamicProviders, ollama, ...(settings?.customProviders ?? [])]
  }, [dynamicProviders, settings?.customProviders])

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

  const updateCustomProvider = (id: string, patch: Partial<ProviderDef>) => {
    setSettings((s) => s ? ({
      ...s,
      customProviders: s.customProviders.map((p) =>
        p.id === id ? { ...p, ...patch, custom: true } : p
      ),
    }) : s)
  }

  const addCustomProvider = () => {
    const provider = createCustomProvider()
    setSettings((s) => s ? ({
      ...s,
      customProviders: [...s.customProviders, provider],
      configs: { ...s.configs, [provider.id]: { baseURL: "" } },
    }) : s)
    setSearch("")
  }

  const removeCustomProvider = (id: string) => {
    setSettings((s) => {
      if (!s) return s
      const { [id]: _removed, ...configs } = s.configs
      return {
        ...s,
        provider: s.provider === id ? "gemini-nano" : s.provider,
        model: s.provider === id ? "gemini-nano" : s.model,
        configs,
        customProviders: s.customProviders.filter((p) => p.id !== id),
      }
    })
  }

  const updateExaApiKey = (value: string) => {
    setSettings((s) => s ? ({ ...s, exaApiKey: value }) : s)
    setExaTestState("idle")
    setExaTestMsg("")
  }

  const updateExaSearchType = (value: string) => {
    setSettings((s) => s ? ({ ...s, exaSearchType: normalizeExaSearchType(value) }) : s)
    setExaTestState("idle")
    setExaTestMsg("")
  }

  const handleTestExa = async () => {
    setExaTestState("testing")
    setExaTestMsg("")
    const result = await testExaSearch(settings.exaApiKey ?? "", settings.exaSearchType)
    if (result.ok) {
      setExaTestState("ok")
      setExaTestMsg(result.count != null ? `${result.count} results` : "connected")
    } else {
      setExaTestState("fail")
      setExaTestMsg(result.error ?? "failed")
    }
  }

  const handleTestReddit = async () => {
    setRedditTestState("testing")
    setRedditTestMsg("")
    const result = await testRedditSearch()
    if (result.ok) {
      setRedditTestState("ok")
      setRedditTestMsg(result.count != null ? `${result.count} results` : "connected")
    } else {
      setRedditTestState("fail")
      setRedditTestMsg(result.error ?? "failed")
    }
  }

  const ensureConfiguredHostPermissions = async () => {
    for (const def of allProviders) {
      if (def.id === "gemini-nano") continue
      const baseURL = getConfig(def.id).baseURL ?? def.baseURL
      if (!baseURL) continue
      const allowed = await ensureHostPermission(baseURL)
      if (!allowed) return false
    }
    return true
  }

  const handleSave = async () => {
    const allowed = await ensureConfiguredHostPermissions()
    if (!allowed) return
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
          <button
            className={`opt-toggle ${settings.enabled ? "on" : "off"}`}
            onClick={() => setSettings((s) => s ? { ...s, enabled: !s.enabled } : s)}
            aria-label={settings.enabled ? "Disable summarizer" : "Enable summarizer"}
            style={{ marginLeft: "auto" }}
          >
            <span className="opt-toggle-thumb" />
          </button>
        </header>
        <div className="opt-tabs" role="tablist" aria-label="Settings sections">
          <button
            className={`opt-tab ${activeTab === "providers" ? "opt-tab--active" : ""}`}
            onClick={() => setActiveTab("providers")}
            role="tab"
            aria-selected={activeTab === "providers"}>
            AI providers
          </button>
          <button
            className={`opt-tab ${activeTab === "finder" ? "opt-tab--active" : ""}`}
            onClick={() => setActiveTab("finder")}
            role="tab"
            aria-selected={activeTab === "finder"}>
            Post finder
          </button>
        </div>
        {activeTab === "providers" && (
          <div className="opt-search-wrap">
            <input
              className="opt-search"
              type="search"
              placeholder={`Search ${allProviders.length} providers…`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button className="opt-add-btn" onClick={addCustomProvider}>
              Add Custom Server
            </button>
          </div>
        )}
      </div>

      <div className="opt-scroll">
        {activeTab === "finder" ? (
          <div className="opt-card opt-related-card">
            <div className="opt-provider">
              <div className="opt-provider__header">
                <div>
                  <div className="opt-provider__name">Post Finder</div>
                  <p className="opt-provider__note">Choose which related-post sources run when you click Find posts.</p>
                </div>
              </div>
              <div className="opt-finder-source">
                <div className="opt-finder-source__head">
                  <div>
                    <div className="opt-finder-source__name">Exa search</div>
                    <p className="opt-provider__note">External web search scoped to the current subreddit.</p>
                  </div>
                  <div className="opt-provider__actions">
                    <button
                      className={`opt-test-btn opt-test-btn--${exaTestState}`}
                      onClick={handleTestExa}
                      disabled={exaTestState === "testing"}>
                      {exaTestState === "testing" ? "Testing…"
                        : exaTestState === "ok" ? `✓ ${exaTestMsg}`
                        : exaTestState === "fail" ? "✗ Failed"
                        : "Test"}
                    </button>
                    <button
                      className={`opt-toggle opt-toggle--small ${settings.exaEnabled ? "on" : "off"}`}
                      onClick={() => setSettings((s) => s ? { ...s, exaEnabled: !s.exaEnabled } : s)}
                      aria-label={settings.exaEnabled ? "Disable Exa search" : "Enable Exa search"}>
                      <span className="opt-toggle-thumb" />
                    </button>
                  </div>
                </div>
                {exaTestState === "fail" && exaTestMsg && (
                  <span className="opt-test-error">{exaTestMsg}</span>
                )}
                <label className="opt-field">
                  <span className="opt-field__label">Exa API Key</span>
                  <input
                    className="opt-input opt-input--key"
                    type="password"
                    value={settings.exaApiKey ?? ""}
                    placeholder="optional"
                    onChange={(e) => updateExaApiKey(e.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>
                <label className="opt-field">
                  <span className="opt-field__label">Search Type</span>
                  <select
                    className="opt-input opt-select"
                    value={settings.exaSearchType}
                    onChange={(e) => updateExaSearchType(e.target.value)}>
                    {EXA_SEARCH_TYPES.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="opt-select-note">
                  {EXA_SEARCH_TYPES.find((type) => type.value === settings.exaSearchType)?.note}
                </p>
              </div>

              <div className="opt-finder-source">
                <div className="opt-finder-source__head">
                  <div>
                    <div className="opt-finder-source__name">Reddit search</div>
                    <p className="opt-provider__note">Subreddit-scoped search using reddit.com search.json.</p>
                  </div>
                  <div className="opt-provider__actions">
                    <button
                      className={`opt-test-btn opt-test-btn--${redditTestState}`}
                      onClick={handleTestReddit}
                      disabled={redditTestState === "testing"}>
                      {redditTestState === "testing" ? "Testing…"
                        : redditTestState === "ok" ? `✓ ${redditTestMsg}`
                        : redditTestState === "fail" ? "✗ Failed"
                        : "Test"}
                    </button>
                    <button
                      className={`opt-toggle opt-toggle--small ${settings.redditSearchEnabled ? "on" : "off"}`}
                      onClick={() => setSettings((s) => s ? { ...s, redditSearchEnabled: !s.redditSearchEnabled } : s)}
                      aria-label={settings.redditSearchEnabled ? "Disable Reddit search" : "Enable Reddit search"}>
                      <span className="opt-toggle-thumb" />
                    </button>
                  </div>
                </div>
                {redditTestState === "fail" && redditTestMsg && (
                  <span className="opt-test-error">{redditTestMsg}</span>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="opt-card">
            {visibleProviders.length === 0 ? (
              <p className="opt-empty-state">No providers match "{search}"</p>
            ) : (
              visibleProviders.map((def) => (
                <ProviderRow
                  key={def.id}
                  def={def}
                  apiKey={getConfig(def.id).apiKey ?? ""}
                  baseURL={getConfig(def.id).baseURL ?? def.baseURL}
                  onChange={(field, value) => updateConfig(def.id, field, value)}
                  onProviderChange={def.custom ? (patch) => updateCustomProvider(def.id, patch) : undefined}
                  onRemove={def.custom ? () => removeCustomProvider(def.id) : undefined}
                />
              ))
            )}
          </div>
        )}
      </div>

      <div className="opt-footer">
        <p className="opt-footer__note">
          API keys stay local. They are only sent to the configured provider endpoint.
          {cacheAge !== null && activeTab === "providers" ? ` Provider list updated ${formatAge(cacheAge)}.` : ""}
        </p>
        <div className="opt-footer__actions">
          {activeTab === "providers" && (
            <button
              className="opt-refresh-btn"
              onClick={handleRefreshModels}
              disabled={refreshing}
              title="Refresh provider and model list from models.dev">
              {refreshing ? "Refreshing…" : "Refresh providers"}
            </button>
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
