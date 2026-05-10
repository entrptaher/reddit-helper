import { EXTRACTOR_VERSION, type ExtractedContentSource } from "./reddit-extractor"
import { PROMPT_VERSION } from "./prompt-packer"

const CACHE_ROOT = "rds_summary_cache_v2"
const TTL_MS = 30 * 60 * 1000
const MAX_ENTRIES = 40
const MAX_BYTES = 2_000_000

export interface SummaryCacheEntry {
  text: string
  createdAt: number
  providerId: string
  model: string
  style: string
  postId?: string
  source: ExtractedContentSource
  coverage: "full" | "partial" | "limited"
  warnings: string[]
  promptVersion: string
  extractorVersion: string
}

export interface SummaryCacheInput {
  url: string
  style: string
  providerId: string
  model: string
  postId?: string
}

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.hash = ""
    parsed.search = ""
    return parsed.toString().replace(/\/$/, "")
  } catch {
    return url.split("?")[0].replace(/\/$/, "")
  }
}

export function summaryCacheKey(input: SummaryCacheInput): string {
  const stableId = input.postId || normalizeUrl(input.url)
  return [
    stableId,
    input.style,
    input.providerId,
    input.model,
    PROMPT_VERSION,
    EXTRACTOR_VERSION,
  ].join("::")
}

function estimateBytes(cache: Record<string, SummaryCacheEntry>): number {
  try {
    return JSON.stringify(cache).length
  } catch {
    return Number.MAX_SAFE_INTEGER
  }
}

function isHttpContentContext(): boolean {
  return typeof window !== "undefined" && /^https?:$/.test(window.location.protocol)
}

function loadCache(): Promise<Record<string, SummaryCacheEntry>> {
  return new Promise((resolve) => {
    chrome.storage.local.get(CACHE_ROOT, (result) => {
      resolve(result[CACHE_ROOT] && typeof result[CACHE_ROOT] === "object" ? result[CACHE_ROOT] : {})
    })
  })
}

function saveCache(cache: Record<string, SummaryCacheEntry>): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [CACHE_ROOT]: cache }, () => {
      const err = chrome.runtime.lastError
      if (err) reject(new Error(err.message))
      else resolve()
    })
  })
}

function evict(cache: Record<string, SummaryCacheEntry>): Record<string, SummaryCacheEntry> {
  const now = Date.now()
  const entries = Object.entries(cache)
    .filter(([, entry]) => now - entry.createdAt <= TTL_MS)
    .sort((a, b) => b[1].createdAt - a[1].createdAt)
    .slice(0, MAX_ENTRIES)

  let next = Object.fromEntries(entries)
  while (estimateBytes(next) > MAX_BYTES && Object.keys(next).length > 1) {
    const oldest = Object.entries(next).sort((a, b) => a[1].createdAt - b[1].createdAt)[0]?.[0]
    if (!oldest) break
    delete next[oldest]
  }
  return next
}

async function getCachedDirect(input: SummaryCacheInput): Promise<SummaryCacheEntry | null> {
  try {
    const cache = await loadCache()
    const key = summaryCacheKey(input)
    const entry = cache[key]
    if (!entry) return null
    if (Date.now() - entry.createdAt > TTL_MS) {
      delete cache[key]
      await saveCache(cache).catch(() => undefined)
      return null
    }
    return entry
  } catch {
    return null
  }
}

async function setCachedDirect(input: SummaryCacheInput, entry: SummaryCacheEntry): Promise<void> {
  try {
    const cache = evict({ ...(await loadCache()), [summaryCacheKey(input)]: entry })
    await saveCache(cache)
  } catch {
    // Cache should never block the summary result.
  }
}

export async function getCached(input: SummaryCacheInput): Promise<SummaryCacheEntry | null> {
  if (!isHttpContentContext()) return getCachedDirect(input)
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "summary-cache-get", input }, (response) => {
      if (chrome.runtime.lastError || !response?.ok) resolve(null)
      else resolve(response.entry ?? null)
    })
  })
}

export async function setCached(input: SummaryCacheInput, entry: SummaryCacheEntry): Promise<void> {
  if (!isHttpContentContext()) return setCachedDirect(input, entry)
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "summary-cache-set", input, entry }, () => resolve())
  })
}
