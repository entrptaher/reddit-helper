interface LanguageModelSession {
  promptStreaming(prompt: string): AsyncIterable<string>
  destroy(): void
}

interface LanguageModelAPI {
  create(options?: { systemPrompt?: string }): Promise<LanguageModelSession>
  capabilities?(): Promise<{ available: "readily" | "after-download" | "no" }>
}

interface Window {
  LanguageModel?: LanguageModelAPI
}
