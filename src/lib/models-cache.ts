import type { ProviderDef } from "./providers"
import bundledData from "./models-dev-data.json"

const CACHE_KEY = "rds_models_v1"
const STALE_MS = 24 * 60 * 60 * 1000
const MODELS_DEV_URL = "https://models.dev/api.json"

// Providers that use dedicated SDKs in models.dev (api: null) but are OpenAI-compatible over HTTP
const KNOWN_COMPAT: Record<string, { label: string; baseURL: string; placeholder: string }> = {
  groq:       { label: "Groq",        baseURL: "https://api.groq.com/openai/v1",         placeholder: "gsk_..." },
  mistral:    { label: "Mistral",     baseURL: "https://api.mistral.ai/v1",               placeholder: "..." },
  xai:        { label: "xAI",         baseURL: "https://api.x.ai/v1",                     placeholder: "xai-..." },
  perplexity: { label: "Perplexity",  baseURL: "https://api.perplexity.ai",               placeholder: "pplx-..." },
  cerebras:   { label: "Cerebras",    baseURL: "https://api.cerebras.ai/v1",              placeholder: "..." },
  deepinfra:  { label: "Deep Infra",  baseURL: "https://api.deepinfra.com/v1/openai",     placeholder: "..." },
  openrouter: { label: "OpenRouter",  baseURL: "https://openrouter.ai/api/v1",            placeholder: "sk-or-..." },
  cohere:     { label: "Cohere",      baseURL: "https://api.cohere.ai/compatibility/v1",  placeholder: "..." },
}

interface CacheEntry {
  fetchedAt: number
  providers: ProviderDef[]
  models: Record<string, string[]>
}

function readCache(): Promise<CacheEntry | null> {
  return new Promise((resolve) =>
    chrome.storage.local.get(CACHE_KEY, (r) => resolve(r[CACHE_KEY] ?? null))
  )
}

function writeCache(entry: CacheEntry): Promise<void> {
  return new Promise((resolve) =>
    chrome.storage.local.set({ [CACHE_KEY]: entry }, resolve)
  )
}

function buildFromData(data: Record<string, any>): { providers: ProviderDef[]; models: Record<string, string[]> } {
  const providers: ProviderDef[] = []
  const models: Record<string, string[]> = {}
  const seen = new Set<string>()

  for (const [id, p] of Object.entries(data)) {
    if (p.npm !== "@ai-sdk/openai-compatible") continue
    const api: string = p.api ?? ""
    if (!api || api.includes("${")) continue

    seen.add(id)
    const modelIds: string[] = p.models ? Object.keys(p.models).sort() : []
    models[id] = modelIds
    providers.push({
      id,
      label: p.name || id,
      baseURL: api,
      requiresApiKey: (p.env?.length ?? 0) > 0,
      apiKeyPlaceholder: p.env?.[0] ?? "...",
      baseURLEditable: false,
      defaultModels: modelIds.slice(0, 5),
    })
  }

  for (const [id, info] of Object.entries(KNOWN_COMPAT)) {
    if (seen.has(id)) continue
    seen.add(id)
    const p = (data as any)[id]
    const modelIds: string[] = p?.models ? Object.keys(p.models).sort() : []
    models[id] = modelIds
    providers.push({
      id,
      label: info.label,
      baseURL: info.baseURL,
      requiresApiKey: true,
      apiKeyPlaceholder: info.placeholder,
      baseURLEditable: false,
      defaultModels: modelIds.slice(0, 5),
    })
  }

  providers.sort((a, b) => a.label.localeCompare(b.label))
  return { providers, models }
}

async function fetchAndBuild(): Promise<{ providers: ProviderDef[]; models: Record<string, string[]> }> {
  const res = await fetch(MODELS_DEV_URL)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  return buildFromData(data)
}

// Build from bundled build-time snapshot — instant, no network
const bundled = buildFromData(bundledData as Record<string, any>)

export async function getDynamicProviders(): Promise<ProviderDef[]> {
  const cache = await readCache()
  const now = Date.now()

  if (cache?.providers.length) {
    if (now - cache.fetchedAt > STALE_MS) {
      fetchAndBuild().then(({ providers, models }) => {
        if (providers.length > 0) writeCache({ fetchedAt: now, providers, models })
      }).catch(() => {})
    }
    return cache.providers
  }

  // No cache yet — use bundled data immediately, refresh in background
  fetchAndBuild().then(({ providers, models }) => {
    if (providers.length > 0) writeCache({ fetchedAt: now, providers, models })
  }).catch(() => {})

  return bundled.providers
}

export async function getDynamicModels(providerId: string): Promise<string[] | null> {
  const cache = await readCache()
  const list = cache?.models[providerId] ?? bundled.models[providerId]
  return list?.length ? list : null
}

export async function refreshModelsCache(): Promise<number> {
  const { providers, models } = await fetchAndBuild()
  if (providers.length === 0) throw new Error("Fetch returned no data")
  const fetchedAt = Date.now()
  await writeCache({ fetchedAt, providers, models })
  return fetchedAt
}

export async function getModelsCacheAge(): Promise<number | null> {
  const cache = await readCache()
  return cache?.fetchedAt ?? null
}
