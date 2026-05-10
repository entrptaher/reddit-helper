import OpenAI from "openai"
import { loadSettings } from "./lib/storage"
import { normalizeBaseURL, providerEndpoint } from "./lib/providers"
import { normalizeExaSearchType } from "./lib/exa"

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "openOptions") chrome.runtime.openOptionsPage()
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

        const r = await fetch("https://api.exa.ai/search", {
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

        if (!r.ok) {
          port.postMessage({ ok: false, error: `HTTP ${r.status}` })
          return
        }

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

        const r = await fetch(url.toString(), {
          headers: { accept: "application/json" },
        })

        if (!r.ok) {
          port.postMessage({ ok: false, error: `HTTP ${r.status}` })
          return
        }

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

        const r = await fetch(url.toString(), {
          headers: { accept: "application/json" },
        })

        if (!r.ok) {
          port.postMessage({ ok: false, error: `Reddit HTTP ${r.status}` })
          return
        }

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
    port.onMessage.addListener(async ({ query }) => {
      try {
        const settings = await loadSettings()
        const apiKey = settings.exaApiKey?.trim()
        const searchType = normalizeExaSearchType(settings.exaSearchType)

        if (!apiKey) {
          port.postMessage({ ok: false, error: "Add an Exa API key in options to show related results." })
          return
        }

        const r = await fetch("https://api.exa.ai/search", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": apiKey,
          },
          body: JSON.stringify({ query, type: searchType }),
        })

        if (!r.ok) {
          port.postMessage({ ok: false, error: `Exa HTTP ${r.status}` })
          return
        }

        const data = await r.json()
        const results = Array.isArray(data.results)
          ? data.results.map((item: any) => ({
              id: String(item.id ?? item.url ?? ""),
              title: String(item.title ?? item.url ?? "Untitled result"),
              url: String(item.url ?? item.id ?? ""),
              author: item.author ? String(item.author) : undefined,
              image: item.image ? String(item.image) : undefined,
              favicon: item.favicon ? String(item.favicon) : undefined,
            })).filter((item: any) => item.url)
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
        const r = await fetch(providerEndpoint(baseURL, "models"), { headers })
        if (!r.ok) { port.postMessage({ ok: false, error: `HTTP ${r.status}` }); return }
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

    const { content, systemPrompt, userInstruction, model, baseURL, apiKey } = msg

    try {
      const client = new OpenAI({
        apiKey: apiKey || "none",
        baseURL: normalizeBaseURL(baseURL),
        dangerouslyAllowBrowser: true,
      })

      const prompt = `${userInstruction}\n\nTitle: ${content.title}\n\n${content.body.slice(0, 60_000)}`
      const startMs = Date.now()
      const stream = await client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
        ],
        stream: true,
        stream_options: { include_usage: true },
      })

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
      let msg = "Unknown error"
      if (e instanceof Error) {
        const status = (e as any).status
        const code = (e as any).code
        const detail = (e as any).error?.message ?? (e as any).error?.error ?? ""
        msg = [
          status ? `HTTP ${status}` : null,
          code ? `(${code})` : null,
          detail || e.message,
        ].filter(Boolean).join(" — ")
      } else {
        msg = String(e)
      }
      port.postMessage({ type: "error", message: msg })
    }
  })
})
