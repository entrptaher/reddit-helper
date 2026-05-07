import type { ExtractedContent } from "./reddit-extractor"

export interface UsageData {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  elapsedMs: number
}

export function isLanguageModelAvailable(): boolean {
  return typeof window.LanguageModel !== "undefined"
}

export function summarize(
  content: ExtractedContent,
  systemPrompt: string,
  userInstruction: string,
  onChunk: (text: string) => void,
  onDone: (usage?: UsageData) => void,
  onError: (e: Error) => void,
  onModelLoaded?: () => void
): () => void {
  let cancelled = false
  let session: LanguageModelSession | null = null

  const run = async () => {
    const startMs = Date.now()
    try {
      session = await window.LanguageModel!.create({ systemPrompt })

      if (cancelled) { session.destroy(); return }

      onModelLoaded?.()

      // Repeat the instruction in the user turn — small models follow user turn more reliably than system prompt
      const prompt = `${userInstruction}\n\nTitle: ${content.title}\n\n${content.body.slice(0, 60_000)}`
      const stream = session.promptStreaming(prompt)

      let accumulated = ""
      for await (const chunk of stream) {
        if (cancelled) break
        // Handle both cumulative and delta streaming
        accumulated = chunk.startsWith(accumulated) ? chunk : accumulated + chunk
        onChunk(accumulated)
      }

      if (!cancelled) onDone({ elapsedMs: Date.now() - startMs })
    } catch (e) {
      if (!cancelled) onError(e instanceof Error ? e : new Error(String(e)))
    } finally {
      session?.destroy()
    }
  }

  run()
  return () => { cancelled = true; session?.destroy() }
}

export function summarizeWithAPI(
  content: ExtractedContent,
  systemPrompt: string,
  userInstruction: string,
  model: string,
  baseURL: string,
  apiKey: string,
  onChunk: (text: string) => void,
  onDone: (usage?: UsageData) => void,
  onError: (e: Error) => void,
  onModelLoaded?: () => void,
  onReasoning?: (text: string) => void
): () => void {
  let cancelled = false
  let port: chrome.runtime.Port | null = null

  try {
    port = chrome.runtime.connect({ name: "summarize-api" })

    // Ping every 20s to keep MV3 service worker alive during long reasoning phases
    const keepAlive = setInterval(() => {
      try { port?.postMessage({ type: "keepalive" }) } catch {}
    }, 20_000)

    port.onMessage.addListener((msg) => {
      if (cancelled) return
      if (msg.type === "chunk") {
        onChunk(msg.text)
      } else if (msg.type === "reasoning") {
        onReasoning?.(msg.text)
      } else if (msg.type === "done") {
        clearInterval(keepAlive)
        onDone(msg.usage)
      } else if (msg.type === "error") {
        clearInterval(keepAlive)
        console.error("[rds] summarizeWithAPI error", msg.message)
        onError(new Error(msg.message))
      }
    })

    port.onDisconnect.addListener(() => {
      clearInterval(keepAlive)
      if (!cancelled) onError(new Error("Background connection lost"))
    })

    onModelLoaded?.()
    port.postMessage({ content, systemPrompt, userInstruction, model, baseURL, apiKey })
  } catch (e) {
    onError(e instanceof Error ? e : new Error(String(e)))
  }

  return () => {
    cancelled = true
    port?.disconnect()
  }
}
