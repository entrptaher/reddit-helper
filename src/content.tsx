import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import "@fontsource/space-grotesk/400.css"
import "@fontsource/space-grotesk/500.css"
import "@fontsource/space-grotesk/700.css"
import "@fontsource/space-mono/400.css"
import "@fontsource/space-mono/700.css"
import "@fontsource/doto/600.css"

import type { PlasmoCSConfig, PlasmoMountShadowHost } from "plasmo"

import { Toolbar } from "./components/Toolbar"
import { SummaryPanel } from "./components/SummaryPanel"
import { EXTRACTOR_VERSION, extractPageContent, shouldUseRedditJsonFallback, type ExtractedContent } from "./lib/reddit-extractor"
import { isLanguageModelAvailable, summarize, summarizeWithAPI, type UsageData } from "./lib/language-model"
import { getCached, setCached } from "./lib/cache"
import { PROMPT_VERSION, coverageFor } from "./lib/prompt-packer"
import { STYLES, type StyleKey } from "./lib/styles"
import { loadContentSettings, saveProviderSelection, saveSummaryStyle, type Settings } from "./lib/storage"
import { STATIC_PROVIDERS, fetchModels, isProviderConfigured, type ProviderDef } from "./lib/providers"
import { EMPTY_RELATED_RESULTS, buildRelatedResultsQuery, normalizeExaSearchType, searchRelatedResults, type ExaSearchType, type RelatedResultsState } from "./lib/exa"
import { EMPTY_REDDIT_SEARCH, buildRedditSearchQuery, getSubredditFromUrl, isCurrentRedditPost, searchReddit, type RedditSearchSort, type RedditSearchState } from "./lib/reddit-search"
import type { RuntimeErrorInfo } from "./lib/runtime"

import cssText from "data-text:./content.css"

export const config: PlasmoCSConfig = {
  matches: [
    "https://*.reddit.com/r/*/comments/*",
    "https://*.reddit.com/r/*/comments/*/*"
  ],
  run_at: "document_idle"
}

export const getInlineAnchor = async () =>
  document.querySelector("main") ?? document.body

export const mountShadowHost: PlasmoMountShadowHost = async ({ shadowHost }) => {
  const host = shadowHost as HTMLElement
  host.style.cssText = "display:block;width:100%;"
  const main = document.querySelector("main")
  if (main) main.prepend(host)
  else document.body.prepend(host)
}

export const getStyle = () => {
  const style = document.createElement("style")
  style.textContent = cssText
  return style
}

type Phase = "idle" | "loading" | "streaming" | "done" | "error" | "cached"

const POST_URL_RE = /\/r\/[^/]+\/comments\//

function isRedditJsonPage(url: string): boolean {
  try {
    return new URL(url).pathname.toLowerCase().endsWith(".json")
  } catch {
    return /\.json(?:[?#]|$)/i.test(url)
  }
}

function fetchRedditJsonFallback(content: ExtractedContent): Promise<ExtractedContent | null> {
  if (!content.postId || !content.subreddit) return Promise.resolve(null)
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: "fetch-reddit-json", postId: content.postId, subreddit: content.subreddit },
      (response) => {
        if (chrome.runtime.lastError || !response?.ok) {
          resolve({
            ...content,
            warnings: [
              ...content.warnings,
              response?.error ?? chrome.runtime.lastError?.message ?? "Reddit JSON fallback failed.",
            ],
          })
          return
        }
        resolve(response.content)
      }
    )
  })
}

function getContentDynamicProviders(): Promise<ProviderDef[]> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "get-dynamic-providers" }, (response) => {
      resolve(Array.isArray(response?.providers) ? response.providers : [])
    })
  })
}

function getContentDynamicModels(providerId: string): Promise<string[] | null> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "get-dynamic-models", providerId }, (response) => {
      resolve(Array.isArray(response?.models) ? response.models : null)
    })
  })
}

function RedditSummarizer() {
  const [phase, setPhase] = useState<Phase>("idle")
  const [rawText, setRawText] = useState("")
  const [reasoningText, setReasoningText] = useState("")
  const [errorMessage, setErrorMessage] = useState<string>()
  const [styleKey, setStyleKey] = useState<StyleKey>("summary")
  const [fromCache, setFromCache] = useState(false)
  const [modelReady, setModelReady] = useState(false)
  const [usageData, setUsageData] = useState<UsageData | undefined>()
  const [extractedContent, setExtractedContent] = useState<ExtractedContent | null>(null)
  const [runtimeError, setRuntimeError] = useState<RuntimeErrorInfo | undefined>()
  const [relatedResults, setRelatedResults] = useState<RelatedResultsState>(EMPTY_RELATED_RESULTS)
  const [redditSearch, setRedditSearch] = useState<RedditSearchState>(EMPTY_REDDIT_SEARCH)
  const [redditSearchSort, setRedditSearchSort] = useState<RedditSearchSort>("relevance")
  const [currentUrl, setCurrentUrl] = useState(window.location.href)

  const [enabled, setEnabled] = useState(true)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [provider, setProvider] = useState("gemini-nano")
  const [model, setModel] = useState("gemini-nano")
  const [availableModels, setAvailableModels] = useState<string[]>(["gemini-nano"])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [dynamicProviders, setDynamicProviders] = useState<ProviderDef[]>([])
  const [providersLoaded, setProvidersLoaded] = useState(false)

  const cancelRef = useRef<(() => void) | null>(null)
  const summaryRequestRef = useRef(0)
  const relatedRequestRef = useRef(0)
  const redditRequestRef = useRef(0)
  const currentUrlRef = useRef(window.location.href)
  const settingsLoaded = useRef(false)
  const nanoAvailable = isLanguageModelAvailable()

  const onPostPage = POST_URL_RE.test(currentUrl)
  const onJsonPage = isRedditJsonPage(currentUrl)

  // Full provider list: built-in nano + dynamic API providers + local/custom
  const allProviders = useMemo<ProviderDef[]>(() => {
    const [nano, ollama] = [
      STATIC_PROVIDERS[0],
      STATIC_PROVIDERS[1],
    ]
    return [nano, ...dynamicProviders, ollama, ...(settings?.customProviders ?? [])]
  }, [dynamicProviders, settings?.customProviders])

  const selectableProviders = useMemo<ProviderDef[]>(() => {
    return allProviders.filter((p) => {
      if (!settings) return p.id === "gemini-nano"
      if (p.requiresApiKey && settings.configuredProviderIds?.includes(p.id)) {
        const cfg = settings.configs[p.id]
        return Boolean((cfg?.baseURL ?? p.baseURL).trim())
      }
      return isProviderConfigured(p, settings.configs?.[p.id])
    })
  }, [allProviders, settings])

  const providerMap = useMemo<Record<string, ProviderDef>>(
    () => Object.fromEntries(allProviders.map((p) => [p.id, p])),
    [allProviders]
  )

  // Load settings + dynamic providers on mount
  useEffect(() => {
    loadContentSettings().then((s) => {
      setEnabled(s.enabled)
      setSettings(s)
      setProvider(s.provider)
      setModel(s.model)
      setStyleKey(s.summaryStyle)
      const def = [...STATIC_PROVIDERS, ...s.customProviders].find((p) => p.id === s.provider)
      setAvailableModels(def?.defaultModels ?? [s.model])
      settingsLoaded.current = true
    })
    getContentDynamicProviders().then((providers) => {
      setDynamicProviders(providers)
      setProvidersLoaded(true)
    })

    const onRuntimeMessage = (msg: any) => {
      if (msg?.type !== "public-settings-changed" || !msg.settings) return
      const next = msg.settings as Settings
      setSettings(next)
      setEnabled(next.enabled)
      setProvider(next.provider)
      setModel(next.model)
      setStyleKey(next.summaryStyle)
    }
    chrome.runtime.onMessage.addListener(onRuntimeMessage)
    return () => chrome.runtime.onMessage.removeListener(onRuntimeMessage)
  }, [])

  useEffect(() => {
    if (!settingsLoaded.current || !providersLoaded || selectableProviders.length === 0) return
    if (selectableProviders.some((p) => p.id === provider)) return

    const next = selectableProviders[0]
    setProvider(next.id)
    setModel(next.defaultModels[0] ?? next.id)
  }, [provider, providersLoaded, selectableProviders])

  // Persist provider + model whenever either changes (covers manual selection AND auto-selection)
  useEffect(() => {
    if (!settingsLoaded.current) return
    saveProviderSelection(provider, model).catch(() => {})
  }, [provider, model])

  // Fetch models when provider changes
  useEffect(() => {
    if (!settings) return

    if (provider === "gemini-nano") {
      setAvailableModels(["gemini-nano"])
      setModel("gemini-nano")
      return
    }

    const def = providerMap[provider]
    const cfg = settings.configs[provider] ?? {}
    const baseURL = cfg.baseURL ?? def?.baseURL ?? ""
    const apiKey = cfg.apiKey ?? ""

    setModelsLoading(true)

    getContentDynamicModels(provider).then((cached) => {
      if (cached && cached.length > 0) {
        setModelsLoading(false)
        setAvailableModels(cached)
        setModel((prev) => cached.includes(prev) ? prev : cached[0])
        return
      }
      // Fall back to live /models endpoint (ollama, lmstudio, custom, etc.)
      if (!baseURL) {
        setModelsLoading(false)
        setAvailableModels(def?.defaultModels ?? [])
        return
      }
      fetchModels(baseURL, apiKey).then((live) => {
        setModelsLoading(false)
        const fallback = def?.defaultModels ?? []
        if (live.length > 0) {
          const models = def?.custom ? Array.from(new Set([...fallback, ...live])).sort() : live
          setAvailableModels(models)
          setModel((prev) => models.includes(prev) ? prev : models[0])
        } else {
          setAvailableModels(fallback)
          setModel((prev) => fallback.includes(prev) ? prev : fallback[0] ?? prev)
        }
      })
    })
  }, [provider, settings, providerMap])

  const reset = useCallback(() => {
    cancelRef.current?.()
    cancelRef.current = null
    summaryRequestRef.current += 1
    setPhase("idle")
    setRawText("")
    setReasoningText("")
    setErrorMessage(undefined)
    setFromCache(false)
    setModelReady(false)
    setUsageData(undefined)
    setExtractedContent(null)
    setRuntimeError(undefined)
    relatedRequestRef.current += 1
    redditRequestRef.current += 1
    setRelatedResults(EMPTY_RELATED_RESULTS)
    setRedditSearch(EMPTY_REDDIT_SEARCH)
  }, [])

  // SPA navigation reset
  useEffect(() => {
    const handle = () => {
      const url = window.location.href
      if (url !== currentUrlRef.current) {
        currentUrlRef.current = url
        setCurrentUrl(url)
        reset()
      }
    }
    const orig = history.pushState.bind(history)
    history.pushState = (...args: Parameters<typeof history.pushState>) => { orig(...args); handle() }
    window.addEventListener("popstate", handle)
    const poll = setInterval(handle, 600)
    return () => {
      window.removeEventListener("popstate", handle)
      history.pushState = orig
      clearInterval(poll)
    }
  }, [reset])

  const analyze = async (style: StyleKey, currentProvider: string, currentModel: string, skipCache = false) => {
    cancelRef.current?.()
    setRawText("")
    setReasoningText("")
    setErrorMessage(undefined)
    setFromCache(false)
    setModelReady(false)
    setUsageData(undefined)
    setRuntimeError(undefined)
    summaryRequestRef.current += 1
    const requestId = summaryRequestRef.current
    const isCurrentRequest = () => summaryRequestRef.current === requestId

    let content = extractPageContent()
    setPhase("loading")
    setExtractedContent(content)

    if (shouldUseRedditJsonFallback(content)) {
      const fallback = await fetchRedditJsonFallback(content)
      if (!isCurrentRequest()) return
      if (fallback) {
        content = fallback
        setExtractedContent(fallback)
      }
    }

    if (!skipCache) {
      const cached = await getCached({
        url: window.location.href,
        style,
        providerId: currentProvider,
        model: currentModel,
        postId: content.postId,
      })
      if (!isCurrentRequest()) return
      if (cached) {
        setRawText(cached.text)
        setPhase("cached")
        setFromCache(true)
        return
      }
    }

    const hasContent = { current: false }

    const onChunk = (chunk: string) => {
      if (!isCurrentRequest()) return
      hasContent.current = true
      setRawText(chunk)
      setPhase((p) => (p === "loading" ? "streaming" : p))
    }
    const onDone = (usage?: UsageData) => {
      if (!isCurrentRequest()) return
      if (usage) setUsageData(usage)
      setPhase("done")
      setRawText((text) => {
        if (text) {
          setCached({
            url: window.location.href,
            style,
            providerId: currentProvider,
            model: currentModel,
            postId: content.postId,
          }, {
            text,
            createdAt: Date.now(),
            providerId: currentProvider,
            model: currentModel,
            style,
            postId: content.postId,
            source: content.source,
            coverage: coverageFor(content),
            warnings: content.warnings,
            promptVersion: PROMPT_VERSION,
            extractorVersion: EXTRACTOR_VERSION,
          })
        }
        return text
      })
    }
    const onError = (e: Error) => {
      if (!isCurrentRequest()) return
      // Connection dropped but we already have output — finalize instead of showing error
      if (hasContent.current) { onDone(); return }
      setRuntimeError((e as Error & { runtime?: RuntimeErrorInfo }).runtime)
      setErrorMessage(e.message)
      setPhase("error")
    }
    const onModelLoaded = () => {
      if (isCurrentRequest()) setModelReady(true)
    }
    const onReasoning = (text: string) => {
      if (isCurrentRequest()) setReasoningText(text)
    }

    if (!isCurrentRequest()) return

    if (currentProvider === "gemini-nano") {
      cancelRef.current = summarize(
        content,
        STYLES[style].systemPrompt,
        STYLES[style].userInstruction,
        onChunk, onDone, onError, onModelLoaded
      )
    } else {
      cancelRef.current = summarizeWithAPI(
        content,
        STYLES[style].systemPrompt,
        STYLES[style].userInstruction,
        currentProvider,
        currentModel,
        onChunk, onDone, onError, onModelLoaded, onReasoning
      )
    }
  }

  const handleAnalyze = () => {
    const reanalyze = phase === "done" || phase === "cached"
    analyze(styleKey, provider, model, reanalyze)
  }

  const handleRetry = () => {
    analyze(styleKey, provider, model, true)
  }

  const handleOpenSettings = () => {
    chrome.runtime.sendMessage({ type: "openOptions" })
  }

  const runRedditSearch = (
    query: string,
    subreddit: string | undefined,
    currentPostUrl: string,
    sort: RedditSearchSort
  ) => {
    redditRequestRef.current += 1
    const requestId = redditRequestRef.current

    setRedditSearch({
      phase: "loading",
      query,
      subreddit,
      sort,
      results: [],
    })

    searchReddit(query, subreddit, sort)
      .then((data) => {
        if (redditRequestRef.current !== requestId) return
        setRedditSearch({
          phase: "done",
          query: data.query,
          subreddit: data.subreddit,
          sort: data.sort,
          results: data.results.filter((result) => !isCurrentRedditPost(result, currentPostUrl)),
        })
      })
      .catch((e) => {
        if (redditRequestRef.current !== requestId) return
        setRedditSearch({
          phase: "error",
          query,
          subreddit,
          sort,
          results: [],
          errorMessage: e instanceof Error ? e.message : String(e),
        })
      })
  }

  const handleFindRelated = () => {
    relatedRequestRef.current += 1

    const content = extractPageContent()
    const redditSearchSubreddit = getSubredditFromUrl(window.location.href)
    const relatedQuery = buildRelatedResultsQuery(content.title, redditSearchSubreddit)
    const redditSearchQuery = buildRedditSearchQuery(content.title)
    const currentPostUrl = window.location.href
    const requestId = relatedRequestRef.current
    const exaEnabled = Boolean(settings?.exaEnabled)
    const redditEnabled = settings?.redditSearchEnabled !== false

    setRelatedResults(EMPTY_RELATED_RESULTS)
    setRedditSearch(EMPTY_REDDIT_SEARCH)

    if (!exaEnabled && !redditEnabled) return

    if (exaEnabled) {
      setRelatedResults({ phase: "loading", query: relatedQuery, searchType: settings?.exaSearchType, results: [] })
      searchRelatedResults(relatedQuery, settings?.exaSearchType)
        .then((data) => {
          if (relatedRequestRef.current !== requestId) return
          setRelatedResults({
            phase: "done",
            query: data.query,
            searchType: data.searchType,
            results: data.results,
            searchTime: data.searchTime,
          })
        })
        .catch((e) => {
          if (relatedRequestRef.current !== requestId) return
          setRelatedResults({
            phase: "error",
            query: relatedQuery,
            searchType: settings?.exaSearchType,
            results: [],
            errorMessage: e instanceof Error ? e.message : String(e),
          })
        })
    }

    if (redditEnabled) {
      runRedditSearch(redditSearchQuery, redditSearchSubreddit, currentPostUrl, redditSearchSort)
    }
  }

  const handleRedditSearchSortChange = (sort: RedditSearchSort) => {
    setRedditSearchSort(sort)
    const query = redditSearch.query ?? buildRedditSearchQuery(extractPageContent().title)
    const subreddit = redditSearch.subreddit ?? getSubredditFromUrl(window.location.href)
    runRedditSearch(query, subreddit, window.location.href, sort)
  }

  const handleExaSearchTypeChange = (searchType: ExaSearchType) => {
    const nextSearchType = normalizeExaSearchType(searchType)
    setSettings((s) => s ? ({ ...s, exaSearchType: nextSearchType }) : s)
    chrome.runtime.sendMessage({ type: "save-exa-search-type", searchType: nextSearchType })

    const query = relatedResults.query ?? buildRelatedResultsQuery(extractPageContent().title, getSubredditFromUrl(window.location.href))
    if (!query) return
    relatedRequestRef.current += 1
    const requestId = relatedRequestRef.current
    setRelatedResults({ phase: "loading", query, searchType: nextSearchType, results: [] })
    searchRelatedResults(query, nextSearchType)
      .then((data) => {
        if (relatedRequestRef.current !== requestId) return
        setRelatedResults({
          phase: "done",
          query: data.query,
          searchType: data.searchType,
          results: data.results,
          searchTime: data.searchTime,
        })
      })
      .catch((e) => {
        if (relatedRequestRef.current !== requestId) return
        setRelatedResults({
          phase: "error",
          query,
          searchType: nextSearchType,
          results: [],
          errorMessage: e instanceof Error ? e.message : String(e),
        })
      })
  }

  const handleStop = () => {
    cancelRef.current?.()
    cancelRef.current = null
    setPhase((p) => (p === "loading" ? "idle" : "done"))
  }

  const handleStyleChange = (s: StyleKey) => {
    setStyleKey(s)
    setSettings((current) => current ? { ...current, summaryStyle: s } : current)
    if (settingsLoaded.current) {
      saveSummaryStyle(s).catch(() => {})
    }
  }

  const handleProviderChange = (p: string) => {
    setProvider(p)
  }

  const handleModelChange = (m: string) => {
    setModel(m)
  }

  const handleClose = () => {
    cancelRef.current?.()
    cancelRef.current = null
    summaryRequestRef.current += 1
    relatedRequestRef.current += 1
    redditRequestRef.current += 1
    setRelatedResults(EMPTY_RELATED_RESULTS)
    setRedditSearch(EMPTY_REDDIT_SEARCH)
    setPhase("idle")
  }

  if (!onPostPage || !enabled || (onJsonPage && !settings?.allowJsonPages)) return null

  const showNanoWarning = provider === "gemini-nano" && !nanoAvailable
  const currentDef = providerMap[provider]
  const currentApiKey = settings?.configs?.[provider]?.apiKey ?? ""
  const apiKeyMissing = !!(
    currentDef?.requiresApiKey &&
    !currentApiKey &&
    !settings?.configuredProviderIds?.includes(provider)
  )
  const showPanel = phase !== "idle" || relatedResults.phase !== "idle" || redditSearch.phase !== "idle"

  return (
    <div className="rds-root">
      {showNanoWarning ? (
        <p className="rds-unavailable">
          [MODEL UNAVAILABLE] Gemini Nano unavailable - enable{" "}
          <code>chrome://flags/#prompt-api-for-gemini-nano</code>{" "}
          or select a different provider.
        </p>
      ) : null}
      <Toolbar
        phase={phase}
        style={styleKey}
        provider={provider}
        model={model}
        providers={selectableProviders}
        availableModels={availableModels}
        modelsLoading={modelsLoading}
        apiKeyMissing={apiKeyMissing}
        onStyleChange={handleStyleChange}
        onProviderChange={handleProviderChange}
        onModelChange={handleModelChange}
        onAnalyze={handleAnalyze}
        onFindRelated={handleFindRelated}
        onStop={handleStop}
      />
      {showPanel && (
        <SummaryPanel
          phase={phase}
          rawText={rawText}
          reasoningText={reasoningText}
          errorMessage={errorMessage}
          fromCache={fromCache}
          modelReady={modelReady}
          providerLabel={currentDef?.label}
          usageData={usageData}
          extractedContent={extractedContent}
          runtimeError={runtimeError}
          relatedResults={relatedResults}
          redditSearch={redditSearch}
          redditSearchSort={redditSearchSort}
          onExaSearchTypeChange={handleExaSearchTypeChange}
          onRedditSearchSortChange={handleRedditSearchSortChange}
          onRetry={handleRetry}
          onOpenSettings={handleOpenSettings}
          sourceUrl={window.location.href}
          onClose={handleClose}
        />
      )}
    </div>
  )
}

export default RedditSummarizer
