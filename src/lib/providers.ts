export interface ProviderDef {
  id: string
  label: string
  baseURL: string
  requiresApiKey: boolean
  apiKeyPlaceholder: string
  baseURLEditable: boolean
  defaultModels: string[]
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
  {
    id: "custom",
    label: "Custom",
    baseURL: "",
    requiresApiKey: false,
    apiKeyPlaceholder: "optional",
    baseURLEditable: true,
    defaultModels: [],
  },
]

export const STATIC_PROVIDER_MAP: Record<string, ProviderDef> = Object.fromEntries(
  STATIC_PROVIDERS.map((p) => [p.id, p])
)

const modelCache = new Map<string, string[]>()

export async function fetchModels(baseURL: string, apiKey: string): Promise<string[]> {
  const cacheKey = `${baseURL}::${apiKey}`
  if (modelCache.has(cacheKey)) return modelCache.get(cacheKey)!

  try {
    const headers: Record<string, string> = {}
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`
    const res = await fetch(`${baseURL}/models`, { headers })
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
