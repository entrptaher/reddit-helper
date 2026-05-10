export type RedditSearchPhase = "idle" | "loading" | "done" | "error"
export type RedditSearchSort = "relevance" | "hot" | "new" | "top" | "comments"

export const REDDIT_SEARCH_SORTS: Array<{ value: RedditSearchSort; label: string }> = [
  { value: "relevance", label: "Relevance" },
  { value: "hot", label: "Hot" },
  { value: "new", label: "New" },
  { value: "top", label: "Top" },
  { value: "comments", label: "Comments" },
]

export interface RedditSearchResult {
  id: string
  title: string
  url: string
  subreddit: string
  author: string
  score: number
  numComments: number
  selftext?: string
  createdUtc?: number
  thumbnail?: string
}

export interface RedditSearchResults {
  query: string
  subreddit?: string
  sort: RedditSearchSort
  results: RedditSearchResult[]
}

export interface RedditSearchState {
  phase: RedditSearchPhase
  query?: string
  subreddit?: string
  sort?: RedditSearchSort
  results: RedditSearchResult[]
  errorMessage?: string
}

export const EMPTY_REDDIT_SEARCH: RedditSearchState = {
  phase: "idle",
  results: [],
}

export function buildRedditSearchQuery(title: string): string {
  return title
    .replace(/\s*[:|]\s*r\/[^|:]+.*$/i, "")
    .replace(/\s*[:|]\s*Reddit.*$/i, "")
    .trim() || title.trim()
}

export function getSubredditFromUrl(url: string): string | undefined {
  try {
    const match = new URL(url).pathname.match(/^\/r\/([^/]+)\//i)
    return match?.[1]
  } catch {
    return undefined
  }
}

export function getPostIdFromUrl(url: string): string | undefined {
  try {
    const match = new URL(url).pathname.match(/^\/r\/[^/]+\/comments\/([^/]+)/i)
    return match?.[1]?.toLowerCase()
  } catch {
    return undefined
  }
}

export function isCurrentRedditPost(result: RedditSearchResult, currentUrl: string): boolean {
  const currentPostId = getPostIdFromUrl(currentUrl)
  if (currentPostId && result.id.toLowerCase() === currentPostId) return true

  try {
    const current = new URL(currentUrl)
    const candidate = new URL(result.url)
    return current.pathname.replace(/\/$/, "") === candidate.pathname.replace(/\/$/, "")
  } catch {
    return false
  }
}

export function searchReddit(query: string, subreddit?: string, sort: RedditSearchSort = "relevance"): Promise<RedditSearchResults> {
  return new Promise((resolve, reject) => {
    const port = chrome.runtime.connect({ name: "reddit-search" })
    let settled = false

    port.onMessage.addListener((msg) => {
      if (settled) return
      settled = true
      port.disconnect()

      if (msg?.ok) {
        resolve({
          query: msg.query,
          subreddit: msg.subreddit,
          sort: msg.sort ?? sort,
          results: Array.isArray(msg.results) ? msg.results : [],
        })
      } else {
        reject(new Error(msg?.error ?? "Failed to fetch Reddit search results"))
      }
    })

    port.onDisconnect.addListener(() => {
      if (settled) return
      settled = true
      reject(new Error("Reddit search connection lost"))
    })

    port.postMessage({ query, subreddit, sort })
  })
}
