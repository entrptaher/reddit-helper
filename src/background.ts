import OpenAI from "openai"
import { loadSettings, saveSettings, toPublicSettings } from "./lib/storage"
import { normalizeBaseURL, providerEndpoint, STATIC_PROVIDERS } from "./lib/providers"
import { normalizeExaSearchType } from "./lib/exa"
import { getDynamicModels, getDynamicProviders } from "./lib/models-cache"
import { STYLE_KEYS, type StyleKey } from "./lib/styles"
import { getCached, setCached } from "./lib/cache"
import { packPrompt, validateExtractedContent } from "./lib/prompt-packer"
import { checkedFetch, normalizeRuntimeError, RuntimeError, withTimeoutAndRetry } from "./lib/runtime"
import type { ExtractedContent } from "./lib/reddit-extractor"

try {
  const result = chrome.storage.local.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" })
  ;(result as Promise<void> | undefined)?.catch?.(() => {})
} catch {}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes.rds_settings?.newValue) return
  chrome.tabs.query({ url: ["https://*.reddit.com/*"] }, (tabs) => {
    const settings = toPublicSettings(changes.rds_settings.newValue)
    tabs.forEach((tab) => {
      if (typeof tab.id === "number") {
        chrome.tabs.sendMessage(tab.id, { type: "public-settings-changed", settings }).catch?.(() => {})
      }
    })
  })
})

async function resolveProvider(providerId: string) {
  const settings = await loadSettings()
  const dynamicProviders = await getDynamicProviders().catch(() => [])
  const providers = [...STATIC_PROVIDERS, ...dynamicProviders, ...settings.customProviders]
  const def = providers.find((item) => item.id === providerId)
  if (!def) throw new RuntimeError({
    type: "provider",
    message: `Provider ${providerId} is not configured.`,
    recoverable: true,
    retryable: false,
    providerId,
  })

  const cfg = settings.configs[providerId] ?? {}
  const baseURL = cfg.baseURL ?? def.baseURL
  const apiKey = cfg.apiKey ?? ""

  if (!baseURL) throw new RuntimeError({
    type: "provider",
    message: `Provider ${def.label} is missing a base URL.`,
    recoverable: true,
    retryable: false,
    providerId,
  })
  if (def.requiresApiKey && !apiKey.trim()) throw new RuntimeError({
    type: "auth",
    message: `Provider ${def.label} is missing an API key.`,
    recoverable: true,
    retryable: false,
    providerId,
  })

  return { def, baseURL, apiKey }
}

function compact(text: string): string {
  return String(text ?? "").replace(/\u00a0/g, " ").replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim()
}

function collectJsonComments(node: any, out: string[] = []): string[] {
  const data = node?.data ?? node
  if (data?.body && data.body !== "[deleted]" && data.body !== "[removed]") out.push(compact(data.body))
  const children = data?.replies?.data?.children
  if (Array.isArray(children)) children.forEach((child) => collectJsonComments(child, out))
  return out
}

async function fetchRedditJsonContent(subreddit: string, postId: string): Promise<ExtractedContent> {
  const safeSubreddit = /^[A-Za-z0-9_]+$/.test(subreddit) ? subreddit : ""
  const safePostId = /^[A-Za-z0-9_]+$/.test(postId) ? postId : ""
  if (!safeSubreddit || !safePostId) throw new RuntimeError({
    type: "empty_content",
    message: "Reddit JSON fallback needs a valid subreddit and post id.",
    recoverable: true,
    retryable: false,
  })

  const url = `https://www.reddit.com/r/${safeSubreddit}/comments/${safePostId}.json?limit=100&raw_json=1`
  const res = await checkedFetch(url, { headers: { accept: "application/json" } }, { timeoutMs: 15_000, retries: 1 })
  const data = await res.json()
  const post = data?.[0]?.data?.children?.[0]?.data ?? {}
  const commentsRoot = data?.[1]?.data?.children ?? []
  const comments = commentsRoot
    .flatMap((child: any) => collectJsonComments(child))
    .map(compact)
    .filter((text: string, index: number, arr: string[]) => text.length > 12 && arr.indexOf(text) === index)
    .slice(0, 100)
  const body = compact(post.selftext || post.url_overridden_by_dest || post.url || "")
  const title = compact(post.title || "")
  const combined = [body, ...comments].join("\n\n")
  const words = combined.split(/\s+/).filter(Boolean).length
  const commentsDetected = Number(post.num_comments ?? comments.length)

  return {
    source: "reddit-json",
    postId: safePostId,
    subreddit: safeSubreddit,
    title,
    body,
    bodyChars: body.length,
    comments,
    commentsDetected,
    commentsIncluded: comments.length,
    truncated: commentsDetected > comments.length,
    warnings: commentsDetected > comments.length ? ["Reddit JSON returned only a subset of comments."] : [],
    stats: {
      words,
      comments: commentsDetected,
      upvotes: typeof post.score === "number" ? post.score : null,
      readMinutes: Math.max(1, Math.round(words / 200)),
      savedMinutes: Math.max(1, Math.round(words / 200) - 1),
    },
  }
}

function normalizeRedditJsonResultUrl(rawUrl: string): { url: string; displayUrl?: string } {
  try {
    const parsed = new URL(rawUrl)
    if (!/(^|\.)reddit\.com$/i.test(parsed.hostname)) return { url: rawUrl }
    if (!parsed.pathname.toLowerCase().endsWith(".json")) return { url: rawUrl }

    const cleanPath = parsed.pathname.replace(/\.json$/i, "")
    parsed.pathname = cleanPath
    parsed.search = ""
    parsed.hash = ""
    return {
      url: parsed.toString(),
      displayUrl: `${parsed.origin}${cleanPath}`,
    }
  } catch {
    return { url: rawUrl.replace(/\.json(?=$|[?#])/i, "") }
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "openOptions") {
    chrome.runtime.openOptionsPage()
    sendResponse?.({ ok: true })
    return false
  }
  if (msg?.type === "get-public-settings") {
    loadSettings()
      .then((settings) => sendResponse({ ok: true, settings: toPublicSettings(settings) }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }))
    return true
  }
  if (msg?.type === "save-provider-selection") {
    loadSettings()
      .then((settings) => saveSettings({ ...settings, provider: String(msg.provider), model: String(msg.model) }))
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }))
    return true
  }
  if (msg?.type === "save-exa-search-type") {
    loadSettings()
      .then((settings) => saveSettings({ ...settings, exaSearchType: normalizeExaSearchType(msg.searchType) }))
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }))
    return true
  }
  if (msg?.type === "save-summary-style") {
    const summaryStyle = STYLE_KEYS.includes(msg.summaryStyle as StyleKey) ? msg.summaryStyle as StyleKey : "summary"
    loadSettings()
      .then((settings) => saveSettings({ ...settings, summaryStyle }))
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }))
    return true
  }
  if (msg?.type === "fetch-reddit-json") {
    fetchRedditJsonContent(String(msg.subreddit ?? ""), String(msg.postId ?? ""))
      .then((content) => sendResponse({ ok: true, content }))
      .catch((error) => {
        const normalized = normalizeRuntimeError(error)
        sendResponse({ ok: false, error: normalized.message, runtimeError: normalized })
      })
    return true
  }
  if (msg?.type === "summary-cache-get") {
    getCached(msg.input)
      .then((entry) => sendResponse({ ok: true, entry }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }))
    return true
  }
  if (msg?.type === "summary-cache-set") {
    setCached(msg.input, msg.entry)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }))
    return true
  }
  if (msg?.type === "get-dynamic-providers") {
    getDynamicProviders()
      .then((providers) => sendResponse({ ok: true, providers }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error), providers: [] }))
    return true
  }
  if (msg?.type === "get-dynamic-models") {
    getDynamicModels(String(msg.providerId ?? ""))
      .then((models) => sendResponse({ ok: true, models }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error), models: null }))
    return true
  }
  return false
})

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "test-exa-search") {
    port.onMessage.addListener(async ({ apiKey, query, searchType }) => {
      try {
        const key = typeof apiKey === "string" ? apiKey.trim() : ""
        if (!key) {
          port.postMessage({ ok: false, error: "API key required" })
          return
        }

        const r = await checkedFetch("https://api.exa.ai/search", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": key,
          },
          body: JSON.stringify({
            query: query || "site:reddit.com upwork",
            type: normalizeExaSearchType(searchType),
          }),
        })

        const data = await r.json()
        port.postMessage({ ok: true, count: Array.isArray(data.results) ? data.results.length : 0 })
      } catch (e) {
        port.postMessage({ ok: false, error: e instanceof Error ? e.message : String(e) })
      }
    })
    return
  }

  if (port.name === "test-reddit-search") {
    port.onMessage.addListener(async ({ query, subreddit }) => {
      try {
        const scopedSubreddit = typeof subreddit === "string" && /^[A-Za-z0-9_]+$/.test(subreddit)
          ? subreddit
          : undefined
        const url = new URL(scopedSubreddit
          ? `https://www.reddit.com/r/${scopedSubreddit}/search.json`
          : "https://www.reddit.com/search.json")
        url.searchParams.set("q", query || "upwork")
        url.searchParams.set("limit", "3")
        if (scopedSubreddit) url.searchParams.set("restrict_sr", "1")

        const r = await checkedFetch(url.toString(), {
          headers: { accept: "application/json" },
        }, { timeoutMs: 12_000, retries: 1 })

        const data = await r.json()
        port.postMessage({ ok: true, count: Array.isArray(data?.data?.children) ? data.data.children.length : 0 })
      } catch (e) {
        port.postMessage({ ok: false, error: e instanceof Error ? e.message : String(e) })
      }
    })
    return
  }

  if (port.name === "reddit-search") {
    port.onMessage.addListener(async ({ query, subreddit, sort }) => {
      try {
        const scopedSubreddit = typeof subreddit === "string" && /^[A-Za-z0-9_]+$/.test(subreddit)
          ? subreddit
          : undefined
        const searchSort = ["relevance", "hot", "new", "top", "comments"].includes(sort) ? sort : "relevance"
        const url = new URL(scopedSubreddit
          ? `https://www.reddit.com/r/${scopedSubreddit}/search.json`
          : "https://www.reddit.com/search.json")
        url.searchParams.set("q", query)
        url.searchParams.set("limit", "10")
        url.searchParams.set("sort", searchSort)
        if (scopedSubreddit) url.searchParams.set("restrict_sr", "1")

        const r = await checkedFetch(url.toString(), {
          headers: { accept: "application/json" },
        }, { timeoutMs: 12_000, retries: 1 })

        const data = await r.json()
        const results = Array.isArray(data?.data?.children)
          ? data.data.children.map((child: any) => {
              const item = child?.data ?? {}
              const permalink = item.permalink ? `https://www.reddit.com${item.permalink}` : item.url
              const thumbnail = typeof item.thumbnail === "string" && item.thumbnail.startsWith("http")
                ? item.thumbnail
                : undefined

              return {
                id: String(item.id ?? item.name ?? permalink ?? ""),
                title: String(item.title ?? permalink ?? "Untitled Reddit result"),
                url: String(permalink ?? ""),
                subreddit: String(item.subreddit_name_prefixed ?? (item.subreddit ? `r/${item.subreddit}` : "")),
                author: String(item.author ?? ""),
                score: Number(item.score ?? item.ups ?? 0),
                numComments: Number(item.num_comments ?? 0),
                selftext: item.selftext ? String(item.selftext) : undefined,
                createdUtc: typeof item.created_utc === "number" ? item.created_utc : undefined,
                thumbnail,
              }
            }).filter((item: any) => item.url)
          : []

        port.postMessage({ ok: true, query, subreddit: scopedSubreddit, sort: searchSort, results })
      } catch (e) {
        port.postMessage({ ok: false, error: e instanceof Error ? e.message : String(e) })
      }
    })
    return
  }

  if (port.name === "exa-search") {
    port.onMessage.addListener(async ({ query, searchType: requestedSearchType }) => {
      try {
        const settings = await loadSettings()
        const apiKey = settings.exaApiKey?.trim()
        const searchType = normalizeExaSearchType(requestedSearchType ?? settings.exaSearchType)

        if (!apiKey) {
          port.postMessage({ ok: false, error: "Add an Exa API key in options to show related results." })
          return
        }

        const r = await checkedFetch("https://api.exa.ai/search", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": apiKey,
          },
          body: JSON.stringify({ query, type: searchType }),
        }, { timeoutMs: 18_000, retries: 1 })

        const data = await r.json()
        const results = Array.isArray(data.results)
          ? data.results.map((item: any) => {
              const normalized = normalizeRedditJsonResultUrl(String(item.url ?? item.id ?? ""))
              return {
                id: String(item.id ?? item.url ?? ""),
                title: String(item.title ?? item.url ?? "Untitled result"),
                url: normalized.url,
                displayUrl: normalized.displayUrl,
                author: item.author ? String(item.author) : undefined,
                image: item.image ? String(item.image) : undefined,
                favicon: item.favicon ? String(item.favicon) : undefined,
              }
            }).filter((item: any) => item.url)
          : []

        port.postMessage({
          ok: true,
          query,
          searchType,
          results,
          searchTime: data.searchTime,
          costDollars: data.costDollars,
        })
      } catch (e) {
        port.postMessage({ ok: false, error: e instanceof Error ? e.message : String(e) })
      }
    })
    return
  }

  if (port.name === "test-api-key") {
    port.onMessage.addListener(async ({ baseURL, apiKey }) => {
      const headers: Record<string, string> = {}
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`
      try {
        const r = await checkedFetch(providerEndpoint(baseURL, "models"), { headers }, { timeoutMs: 15_000, retries: 1 })
        const data = await r.json()
        const list: any[] = data.data ?? data.models ?? []
        port.postMessage({ ok: true, count: list.length })
      } catch (e) {
        port.postMessage({ ok: false, error: e instanceof Error ? e.message : String(e) })
      }
    })
    return
  }

  if (port.name !== "summarize-api") return

  port.onMessage.addListener(async (msg) => {
    if (msg?.type === "keepalive") return

    let cancelled = false
    port.onDisconnect.addListener(() => { cancelled = true })

    const { content, systemPrompt, userInstruction, providerId, model } = msg

    try {
      const validation = validateExtractedContent(content)
      if (validation) throw new RuntimeError({ ...validation, providerId })
      const resolved = await resolveProvider(providerId)
      const client = new OpenAI({
        apiKey: resolved.apiKey || "none",
        baseURL: normalizeBaseURL(resolved.baseURL),
        dangerouslyAllowBrowser: true,
      })

      const prompt = packPrompt(content, userInstruction).text
      const startMs = Date.now()
      const stream = await withTimeoutAndRetry((signal) =>
        client.chat.completions.create({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: prompt },
          ],
          stream: true,
          stream_options: { include_usage: true },
        }, { signal }),
        { timeoutMs: 45_000, retries: 1 }
      )

      let accumulated = ""
      let accumulatedReasoning = ""
      let lastUsage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null = null
      for await (const chunk of stream) {
        if (cancelled) break
        if (chunk.usage) lastUsage = chunk.usage
        const d = chunk.choices[0]?.delta as any
        const reasoningDelta: string = d?.reasoning_content ?? d?.thinking ?? ""
        const textDelta: string = d?.content ?? ""
        if (reasoningDelta) {
          accumulatedReasoning += reasoningDelta
          port.postMessage({ type: "reasoning", text: accumulatedReasoning })
        }
        if (textDelta) {
          accumulated += textDelta
          port.postMessage({ type: "chunk", text: accumulated })
        }
      }

      if (!cancelled) {
        const usage = lastUsage ? {
          promptTokens: lastUsage.prompt_tokens,
          completionTokens: lastUsage.completion_tokens,
          totalTokens: lastUsage.total_tokens,
          elapsedMs: Date.now() - startMs,
        } : { elapsedMs: Date.now() - startMs }
        port.postMessage({ type: "done", usage })
      }
    } catch (e) {
      if (cancelled) return
      const error = normalizeRuntimeError(e, providerId)
      port.postMessage({ type: "error", message: error.message, error })
    }
  })
})
