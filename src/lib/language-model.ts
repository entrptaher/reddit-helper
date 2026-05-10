import type { ExtractedContent } from "./reddit-extractor"
import { packPrompt, validateExtractedContent } from "./prompt-packer"
import { normalizeRuntimeError, RuntimeError, type RuntimeErrorInfo } from "./runtime"

export interface UsageData {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  elapsedMs: number
}

export function isLanguageModelAvailable(): boolean {
  return typeof window.LanguageModel !== "undefined"
}

export async function getLanguageModelAvailability(): Promise<"readily" | "after-download" | "downloading" | "no" | "unknown"> {
  const api = window.LanguageModel as any
  if (!api) return "no"
  try {
    if (typeof api.availability === "function") return await api.availability()
    if (typeof api.capabilities === "function") {
      const capabilities = await api.capabilities()
      return capabilities?.available ?? "unknown"
    }
    return "unknown"
  } catch {
    return "unknown"
  }
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
  const controller = new AbortController()

  const run = async () => {
    const startMs = Date.now()
    try {
      const validation = validateExtractedContent(content)
      if (validation) throw new RuntimeError(validation)

      const availability = await getLanguageModelAvailability()
      if (availability === "no") {
        throw new RuntimeError({
          type: "provider",
          message: "Gemini Nano is unavailable in this Chrome profile.",
          recoverable: true,
          retryable: false,
        })
      }
      if (availability === "after-download" || availability === "downloading") {
        throw new RuntimeError({
          type: "provider",
          message: "Gemini Nano is not ready yet. Chrome reports the model must download before use.",
          recoverable: true,
          retryable: false,
        })
      }

      session = await (window.LanguageModel as any)!.create({ systemPrompt, signal: controller.signal })

      if (cancelled) { session.destroy(); return }

      onModelLoaded?.()

      // Repeat the instruction in the user turn — small models follow user turn more reliably than system prompt
      const prompt = packPrompt(content, userInstruction).text
      const stream = (session as any).promptStreaming(prompt, { signal: controller.signal })

      let accumulated = ""
      for await (const chunk of stream) {
        if (cancelled) break
        // Handle both cumulative and delta streaming
        accumulated = chunk.startsWith(accumulated) ? chunk : accumulated + chunk
        onChunk(accumulated)
      }

      if (!cancelled) onDone({ elapsedMs: Date.now() - startMs })
    } catch (e) {
      if (!cancelled) {
        const info = normalizeRuntimeError(e)
        const err = new Error(info.message) as Error & { runtime?: RuntimeErrorInfo }
        err.runtime = info
        onError(err)
      }
    } finally {
      session?.destroy()
    }
  }

  run()
  return () => { cancelled = true; controller.abort(); session?.destroy() }
}

export function summarizeWithAPI(
  content: ExtractedContent,
  systemPrompt: string,
  userInstruction: string,
  providerId: string,
  model: string,
  onChunk: (text: string) => void,
  onDone: (usage?: UsageData) => void,
  onError: (e: Error) => void,
  onModelLoaded?: () => void,
  onReasoning?: (text: string) => void
): () => void {
  let cancelled = false
  let settled = false
  let port: chrome.runtime.Port | null = null

  const settle = (fn: () => void) => {
    if (settled || cancelled) return
    settled = true
    fn()
  }

  try {
    port = chrome.runtime.connect({ name: "summarize-api" })

    // Ping every 20s to keep MV3 service worker alive during long reasoning phases
    const keepAlive = setInterval(() => {
      try { port?.postMessage({ type: "keepalive" }) } catch {}
    }, 20_000)

    port.onMessage.addListener((msg) => {
      if (cancelled || settled) return
      if (msg.type === "chunk") {
        onChunk(msg.text)
      } else if (msg.type === "reasoning") {
        onReasoning?.(msg.text)
      } else if (msg.type === "done") {
        clearInterval(keepAlive)
        settle(() => onDone(msg.usage))
      } else if (msg.type === "error") {
        clearInterval(keepAlive)
        console.error("[rds] summarizeWithAPI error", msg.message)
        settle(() => {
          const err = new Error(msg.message) as Error & { runtime?: RuntimeErrorInfo }
          err.runtime = msg.error ?? normalizeRuntimeError(err, providerId)
          onError(err)
        })
      }
    })

    port.onDisconnect.addListener(() => {
      clearInterval(keepAlive)
      settle(() => onError(new Error("Background connection lost")))
    })

    onModelLoaded?.()
    port.postMessage({ content, systemPrompt, userInstruction, providerId, model })
  } catch (e) {
    onError(e instanceof Error ? e : new Error(String(e)))
  }

  return () => {
    cancelled = true
    port?.disconnect()
  }
}
