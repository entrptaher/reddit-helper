interface LanguageModelSession {
  promptStreaming(prompt: string, options?: { signal?: AbortSignal }): AsyncIterable<string>
  destroy(): void
}

interface LanguageModelAPI {
  create(options?: { systemPrompt?: string; signal?: AbortSignal }): Promise<LanguageModelSession>
  availability?(): Promise<"readily" | "after-download" | "downloading" | "no">
  capabilities?(): Promise<{ available: "readily" | "after-download" | "no" }>
}

interface Window {
  LanguageModel?: LanguageModelAPI
}
