import type { ProviderDef } from "./providers"
import { normalizeExaSearchType, type ExaSearchType } from "./exa"
import { STYLE_KEYS, type StyleKey } from "./styles"

export interface ProviderConfig {
  apiKey?: string
  baseURL?: string
}

export interface Settings {
  provider: string
  model: string
  configs: Record<string, ProviderConfig>
  customProviders: ProviderDef[]
  enabled: boolean
  exaEnabled: boolean
  exaApiKey?: string
  exaSearchType: ExaSearchType
  redditSearchEnabled: boolean
  summaryStyle: StyleKey
  allowJsonPages: boolean
  configuredProviderIds?: string[]
}

const DEFAULTS: Settings = {
  provider: "gemini-nano",
  model: "gemini-nano",
  configs: {
    ollama: { baseURL: "http://localhost:11434/v1" },
  },
  customProviders: [],
  enabled: true,
  exaEnabled: false,
  exaSearchType: "fast",
  redditSearchEnabled: true,
  summaryStyle: "summary",
  allowJsonPages: false,
}

function normalizeStyleKey(value?: string): StyleKey {
  return STYLE_KEYS.includes(value as StyleKey) ? value as StyleKey : DEFAULTS.summaryStyle
}

function normalizeSettings(raw?: Partial<Settings>): Settings {
  const configs = { ...DEFAULTS.configs, ...(raw?.configs ?? {}) }
  const customProviders = Array.isArray(raw?.customProviders) ? [...raw.customProviders] : []
  const legacyCustom = configs.custom

  if (customProviders.length === 0 && (legacyCustom?.baseURL || raw?.provider === "custom")) {
    customProviders.push({
      id: "custom-legacy",
      label: "Custom",
      baseURL: legacyCustom?.baseURL ?? "",
      requiresApiKey: false,
      apiKeyPlaceholder: "optional",
      baseURLEditable: true,
      defaultModels: [],
      custom: true,
    })
    configs["custom-legacy"] = legacyCustom ?? {}
  }

  const exaApiKey = raw?.exaApiKey ?? DEFAULTS.exaApiKey

  return {
    ...DEFAULTS,
    ...(raw ?? {}),
    configs,
    customProviders,
    exaApiKey,
    exaEnabled: raw?.exaEnabled ?? Boolean(exaApiKey),
    exaSearchType: normalizeExaSearchType(raw?.exaSearchType),
    redditSearchEnabled: raw?.redditSearchEnabled ?? DEFAULTS.redditSearchEnabled,
    summaryStyle: normalizeStyleKey(raw?.summaryStyle),
    allowJsonPages: raw?.allowJsonPages ?? DEFAULTS.allowJsonPages,
    provider: raw?.provider === "custom" ? "custom-legacy" : raw?.provider ?? DEFAULTS.provider,
  }
}

export function loadSettings(): Promise<Settings> {
  return new Promise((resolve) =>
    chrome.storage.local.get("rds_settings", (r) =>
      resolve(normalizeSettings(r.rds_settings))
    )
  )
}

export function saveSettings(s: Settings): Promise<void> {
  return new Promise((resolve) => chrome.storage.local.set({ rds_settings: s }, resolve))
}

export function toPublicSettings(settings: Settings): Settings {
  const configs = Object.fromEntries(
    Object.entries(settings.configs).map(([id, cfg]) => [
      id,
      { ...cfg, apiKey: cfg.apiKey ? "" : undefined },
    ])
  )
  const configuredProviderIds = Object.entries(settings.configs)
    .filter(([, cfg]) => Boolean(cfg.apiKey?.trim() || cfg.baseURL?.trim()))
    .map(([id]) => id)

  return {
    ...settings,
    configs,
    exaApiKey: settings.exaApiKey ? "" : undefined,
    configuredProviderIds,
  }
}

export function loadContentSettings(): Promise<Settings> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: "get-public-settings" }, (response) => {
      const err = chrome.runtime.lastError
      if (err) {
        reject(new Error(err.message))
        return
      }
      resolve(normalizeSettings(response?.settings))
    })
  })
}

export function saveProviderSelection(provider: string, model: string): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: "save-provider-selection", provider, model }, (response) => {
      const err = chrome.runtime.lastError
      if (err || !response?.ok) {
        reject(new Error(err?.message ?? response?.error ?? "Failed to save provider selection"))
        return
      }
      resolve()
    })
  })
}

export function saveSummaryStyle(summaryStyle: StyleKey): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: "save-summary-style", summaryStyle }, (response) => {
      const err = chrome.runtime.lastError
      if (err || !response?.ok) {
        reject(new Error(err?.message ?? response?.error ?? "Failed to save summary style"))
        return
      }
      resolve()
    })
  })
}
