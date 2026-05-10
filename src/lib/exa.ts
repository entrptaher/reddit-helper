export type RelatedResultsPhase = "idle" | "loading" | "done" | "error"

export const EXA_SEARCH_TYPES = [
  { value: "instant", label: "Instant", note: "~250 ms. Real-time apps, chat, voice, autocomplete." },
  { value: "fast", label: "Fast", note: "~450 ms. Optimized search models with good relevance." },
  { value: "auto", label: "Auto", note: "~1s. Balanced relevance and speed." },
  { value: "deep-lite", label: "Deep lite", note: "~4s. Lightweight synthesis; cheaper than full deep." },
  { value: "deep", label: "Deep", note: "4-15s. Multi-step planning with structured outputs." },
  { value: "deep-reasoning", label: "Deep reasoning", note: "12-40s. Maximum reasoning capability per step." },
] as const

export type ExaSearchType = typeof EXA_SEARCH_TYPES[number]["value"]

export function normalizeExaSearchType(value?: string): ExaSearchType {
  return EXA_SEARCH_TYPES.some((type) => type.value === value)
    ? value as ExaSearchType
    : "fast"
}

export interface ExaRelatedResult {
  id: string
  title: string
  url: string
  displayUrl?: string
  author?: string
  image?: string
  favicon?: string
}

export interface ExaRelatedResults {
  query: string
  searchType?: ExaSearchType
  results: ExaRelatedResult[]
  searchTime?: number
  costDollars?: {
    total?: number
  }
}

export interface RelatedResultsState {
  phase: RelatedResultsPhase
  query?: string
  searchType?: ExaSearchType
  results: ExaRelatedResult[]
  searchTime?: number
  errorMessage?: string
}

export const EMPTY_RELATED_RESULTS: RelatedResultsState = {
  phase: "idle",
  results: [],
}

export function buildRelatedResultsQuery(title: string, subreddit?: string): string {
  const cleaned = title
    .replace(/\s*[:|]\s*r\/[^|:]+.*$/i, "")
    .replace(/\s*[:|]\s*Reddit.*$/i, "")
    .trim()
  const scopedSubreddit = subreddit && /^[A-Za-z0-9_]+$/.test(subreddit) ? subreddit : undefined
  const site = scopedSubreddit ? `site:reddit.com/r/${scopedSubreddit}` : "site:reddit.com"

  return `${site} ${cleaned || title.trim()}`
}

export function searchRelatedResults(query: string, searchType?: ExaSearchType): Promise<ExaRelatedResults> {
  return new Promise((resolve, reject) => {
    const port = chrome.runtime.connect({ name: "exa-search" })
    let settled = false

    port.onMessage.addListener((msg) => {
      if (settled) return
      settled = true
      port.disconnect()

      if (msg?.ok) {
        resolve({
          query: msg.query,
          searchType: normalizeExaSearchType(msg.searchType),
          results: Array.isArray(msg.results) ? msg.results : [],
          searchTime: msg.searchTime,
          costDollars: msg.costDollars,
        })
      } else {
        reject(new Error(msg?.error ?? "Failed to fetch related results"))
      }
    })

    port.onDisconnect.addListener(() => {
      if (settled) return
      settled = true
      reject(new Error("Related results connection lost"))
    })

    port.postMessage({ query, searchType })
  })
}
