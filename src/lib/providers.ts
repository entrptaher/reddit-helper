export interface ProviderDef {
  id: string
  label: string
  baseURL: string
  requiresApiKey: boolean
  apiKeyPlaceholder: string
  baseURLEditable: boolean
  defaultModels: string[]
  custom?: boolean
}

// Static providers not covered by models.dev (local / special)
export const STATIC_PROVIDERS: ProviderDef[] = [
  {
    id: "gemini-nano",
    label: "Gemini Nano (Built-in)",
    baseURL: "",
    requiresApiKey: false,
    apiKeyPlaceholder: "",
    baseURLEditable: false,
    defaultModels: ["gemini-nano"],
  },
  {
    id: "ollama",
    label: "Ollama (Local)",
    baseURL: "http://localhost:11434/v1",
    requiresApiKey: false,
    apiKeyPlaceholder: "",
    baseURLEditable: true,
    defaultModels: ["llama3.2", "llama3.1", "gemma2", "mistral", "qwen2.5"],
  },
]

export const STATIC_PROVIDER_MAP: Record<string, ProviderDef> = Object.fromEntries(
  STATIC_PROVIDERS.map((p) => [p.id, p])
)

export function createCustomProvider(label = "Custom Server"): ProviderDef {
  const id = `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  return {
    id,
    label,
    baseURL: "",
    requiresApiKey: false,
    apiKeyPlaceholder: "optional",
    baseURLEditable: true,
    defaultModels: [],
    custom: true,
  }
}

export function isProviderConfigured(def: ProviderDef, config?: { apiKey?: string; baseURL?: string }): boolean {
  if (def.id === "gemini-nano") return true
  const baseURL = (config?.baseURL ?? def.baseURL).trim()
  if (!baseURL) return false
  if (def.requiresApiKey && !config?.apiKey?.trim()) return false
  return true
}

export function normalizeBaseURL(baseURL: string): string {
  return baseURL.trim().replace(/\/+$/, "")
}

export function providerEndpoint(baseURL: string, path: string): string {
  return `${normalizeBaseURL(baseURL)}/${path.replace(/^\/+/, "")}`
}

const modelCache = new Map<string, string[]>()

export async function fetchModels(baseURL: string, apiKey: string): Promise<string[]> {
  const normalizedBaseURL = normalizeBaseURL(baseURL)
  const cacheKey = `${normalizedBaseURL}::${apiKey}`
  if (modelCache.has(cacheKey)) return modelCache.get(cacheKey)!

  try {
    const headers: Record<string, string> = {}
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`
    const res = await fetch(providerEndpoint(normalizedBaseURL, "models"), { headers })
    if (!res.ok) return []
    const data = await res.json()
    const list: any[] = data.data ?? data.models ?? []
    const models = list
      .map((m: any) => m.id ?? m.name ?? m)
      .filter((m: any) => typeof m === "string" && m.length > 0)
      .sort()
    if (models.length > 0) modelCache.set(cacheKey, models)
    return models
  } catch {
    return []
  }
}
