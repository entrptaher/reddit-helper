const PREFIX = "rds:"
const TTL_MS = 30 * 60 * 1000 // 30 minutes

interface CacheEntry {
  text: string
  ts: number
}

function cacheKey(url: string, style: string, providerModel = ""): string {
  const base = url.split("?")[0]
  return providerModel
    ? `${PREFIX}${providerModel}:${style}:${base}`
    : `${PREFIX}${style}:${base}`
}

export function getCached(url: string, style: string, providerModel = ""): string | null {
  try {
    const raw = localStorage.getItem(cacheKey(url, style, providerModel))
    if (!raw) return null
    const entry: CacheEntry = JSON.parse(raw)
    if (Date.now() - entry.ts > TTL_MS) {
      localStorage.removeItem(cacheKey(url, style, providerModel))
      return null
    }
    return entry.text
  } catch {
    return null
  }
}

export function setCached(url: string, style: string, text: string, providerModel = ""): void {
  try {
    localStorage.setItem(cacheKey(url, style, providerModel), JSON.stringify({ text, ts: Date.now() }))
  } catch {}
}
