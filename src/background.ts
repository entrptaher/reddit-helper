import OpenAI from "openai"

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "openOptions") chrome.runtime.openOptionsPage()
})

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "test-api-key") {
    port.onMessage.addListener(async ({ baseURL, apiKey }) => {
      const headers: Record<string, string> = {}
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`
      try {
        const r = await fetch(`${baseURL}/models`, { headers })
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
        baseURL,
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
