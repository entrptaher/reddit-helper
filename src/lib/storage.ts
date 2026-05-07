export interface ProviderConfig {
  apiKey?: string
  baseURL?: string
}

export interface Settings {
  provider: string
  model: string
  configs: Record<string, ProviderConfig>
}

const DEFAULTS: Settings = {
  provider: "gemini-nano",
  model: "gemini-nano",
  configs: {
    ollama: { baseURL: "http://localhost:11434/v1" },
  },
}

export function loadSettings(): Promise<Settings> {
  return new Promise((resolve) =>
    chrome.storage.local.get("rds_settings", (r) =>
      resolve(r.rds_settings ? { ...DEFAULTS, ...r.rds_settings } : { ...DEFAULTS })
    )
  )
}

export function saveSettings(s: Settings): Promise<void> {
  return new Promise((resolve) => chrome.storage.local.set({ rds_settings: s }, resolve))
}
