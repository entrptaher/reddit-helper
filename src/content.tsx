import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"

import type { PlasmoCSConfig, PlasmoMountShadowHost } from "plasmo"

import { Toolbar } from "./components/Toolbar"
import { SummaryPanel } from "./components/SummaryPanel"
import { extractPageContent } from "./lib/reddit-extractor"
import { isLanguageModelAvailable, summarize, summarizeWithAPI, type UsageData } from "./lib/language-model"
import { getCached, setCached } from "./lib/cache"
import { STYLES, type StyleKey } from "./lib/styles"
import { loadSettings, saveSettings, type Settings } from "./lib/storage"
import { STATIC_PROVIDERS, STATIC_PROVIDER_MAP, fetchModels, type ProviderDef } from "./lib/providers"
import { getDynamicProviders, getDynamicModels } from "./lib/models-cache"

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

function RedditSummarizer() {
  const [phase, setPhase] = useState<Phase>("idle")
  const [rawText, setRawText] = useState("")
  const [reasoningText, setReasoningText] = useState("")
  const [errorMessage, setErrorMessage] = useState<string>()
  const [styleKey, setStyleKey] = useState<StyleKey>("summary")
  const [fromCache, setFromCache] = useState(false)
  const [modelReady, setModelReady] = useState(false)
  const [usageData, setUsageData] = useState<UsageData | undefined>()
  const [currentUrl, setCurrentUrl] = useState(window.location.href)

  const [settings, setSettings] = useState<Settings | null>(null)
  const [provider, setProvider] = useState("gemini-nano")
  const [model, setModel] = useState("gemini-nano")
  const [availableModels, setAvailableModels] = useState<string[]>(["gemini-nano"])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [dynamicProviders, setDynamicProviders] = useState<ProviderDef[]>([])

  const cancelRef = useRef<(() => void) | null>(null)
  const currentUrlRef = useRef(window.location.href)
  const settingsLoaded = useRef(false)
  const nanoAvailable = isLanguageModelAvailable()

  const onPostPage = POST_URL_RE.test(currentUrl)

  // Full provider list: built-in nano + dynamic API providers + local/custom
  const allProviders = useMemo<ProviderDef[]>(() => {
    const [nano, ollama, custom] = [
      STATIC_PROVIDERS[0],
      STATIC_PROVIDERS[1],
      STATIC_PROVIDERS[2],
    ]
    return [nano, ...dynamicProviders, ollama, custom]
  }, [dynamicProviders])

  const providerMap = useMemo<Record<string, ProviderDef>>(
    () => Object.fromEntries(allProviders.map((p) => [p.id, p])),
    [allProviders]
  )

  // Load settings + dynamic providers on mount
  useEffect(() => {
    loadSettings().then((s) => {
      setSettings(s)
      setProvider(s.provider)
      setModel(s.model)
      const def = STATIC_PROVIDER_MAP[s.provider]
      setAvailableModels(def?.defaultModels ?? [s.model])
      settingsLoaded.current = true
    })
    getDynamicProviders().then(setDynamicProviders)
  }, [])

  // Persist provider + model whenever either changes (covers manual selection AND auto-selection)
  useEffect(() => {
    if (!settingsLoaded.current) return
    loadSettings().then((s) => saveSettings({ ...s, provider, model }))
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

    getDynamicModels(provider).then((cached) => {
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
          setAvailableModels(live)
          setModel((prev) => live.includes(prev) ? prev : live[0])
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
    setPhase("idle")
    setRawText("")
    setReasoningText("")
    setErrorMessage(undefined)
    setFromCache(false)
    setModelReady(false)
    setUsageData(undefined)
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

  const analyze = (style: StyleKey, currentProvider: string, currentModel: string, skipCache = false) => {
    cancelRef.current?.()
    setRawText("")
    setReasoningText("")
    setErrorMessage(undefined)
    setFromCache(false)
    setModelReady(false)
    setUsageData(undefined)

    if (!skipCache) {
      const cacheKey = `${currentProvider}:${currentModel}`
      const cached = getCached(window.location.href, style, cacheKey)
      if (cached) {
        setRawText(cached)
        setPhase("cached")
        setFromCache(true)
        return
      }
    }

    setPhase("loading")
    const content = extractPageContent()
    const hasContent = { current: false }

    const onChunk = (chunk: string) => {
      hasContent.current = true
      setRawText(chunk)
      setPhase((p) => (p === "loading" ? "streaming" : p))
    }
    const onDone = (usage?: UsageData) => {
      if (usage) setUsageData(usage)
      setPhase("done")
      const cacheKey = `${currentProvider}:${currentModel}`
      setRawText((text) => {
        if (text) setCached(window.location.href, style, text, cacheKey)
        return text
      })
    }
    const onError = (e: Error) => {
      // Connection dropped but we already have output — finalize instead of showing error
      if (hasContent.current) { onDone(); return }
      setErrorMessage(e.message)
      setPhase("error")
    }
    const onModelLoaded = () => setModelReady(true)
    const onReasoning = (text: string) => setReasoningText(text)

    if (currentProvider === "gemini-nano") {
      cancelRef.current = summarize(
        content,
        STYLES[style].systemPrompt,
        STYLES[style].userInstruction,
        onChunk, onDone, onError, onModelLoaded
      )
    } else {
      const def = providerMap[currentProvider]
      const cfg = settings?.configs?.[currentProvider] ?? {}
      const baseURL = cfg.baseURL ?? def?.baseURL ?? ""
      const apiKey = cfg.apiKey ?? ""
      cancelRef.current = summarizeWithAPI(
        content,
        STYLES[style].systemPrompt,
        STYLES[style].userInstruction,
        currentModel, baseURL, apiKey,
        onChunk, onDone, onError, onModelLoaded, onReasoning
      )
    }
  }

  const handleAnalyze = () => {
    const reanalyze = phase === "done" || phase === "cached"
    analyze(styleKey, provider, model, reanalyze)
  }

  const handleStop = () => {
    cancelRef.current?.()
    cancelRef.current = null
    setPhase((p) => (p === "loading" ? "idle" : "done"))
  }

  const handleStyleChange = (s: StyleKey) => {
    setStyleKey(s)
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
    setPhase("idle")
  }

  if (!onPostPage) return null

  const showNanoWarning = provider === "gemini-nano" && !nanoAvailable
  const currentDef = providerMap[provider]
  const currentApiKey = settings?.configs?.[provider]?.apiKey ?? ""
  const apiKeyMissing = !!(currentDef?.requiresApiKey && !currentApiKey)

  return (
    <div className="rds-root">
      {showNanoWarning ? (
        <p className="rds-unavailable">
          ⚠ Gemini Nano unavailable — enable{" "}
          <code>chrome://flags/#prompt-api-for-gemini-nano</code>{" "}
          or select a different provider.
        </p>
      ) : null}
      <Toolbar
        phase={phase}
        style={styleKey}
        provider={provider}
        model={model}
        providers={allProviders}
        availableModels={availableModels}
        modelsLoading={modelsLoading}
        apiKeyMissing={apiKeyMissing}
        onStyleChange={handleStyleChange}
        onProviderChange={handleProviderChange}
        onModelChange={handleModelChange}
        onAnalyze={handleAnalyze}
        onStop={handleStop}
      />
      {phase !== "idle" && (
        <SummaryPanel
          phase={phase}
          rawText={rawText}
          reasoningText={reasoningText}
          errorMessage={errorMessage}
          fromCache={fromCache}
          modelReady={modelReady}
          providerLabel={currentDef?.label}
          usageData={usageData}
          onClose={handleClose}
        />
      )}
    </div>
  )
}

export default RedditSummarizer
