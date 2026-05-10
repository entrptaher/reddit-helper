import type { ProviderDef } from "./providers"
import { normalizeExaSearchType, type ExaSearchType } from "./exa"

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
