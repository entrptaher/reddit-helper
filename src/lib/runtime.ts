export type RuntimeErrorType =
  | "timeout"
  | "auth"
  | "permission"
  | "rate_limit"
  | "bad_model"
  | "network"
  | "empty_content"
  | "provider"
  | "storage"
  | "unknown"

export interface RuntimeErrorInfo {
  type: RuntimeErrorType
  message: string
  recoverable: boolean
  retryable: boolean
  status?: number
  providerId?: string
}

export class RuntimeError extends Error implements RuntimeErrorInfo {
  type: RuntimeErrorType
  recoverable: boolean
  retryable: boolean
  status?: number
  providerId?: string

  constructor(info: RuntimeErrorInfo) {
    super(info.message)
    this.name = "RuntimeError"
    this.type = info.type
    this.recoverable = info.recoverable
    this.retryable = info.retryable
    this.status = info.status
    this.providerId = info.providerId
  }
}

export function normalizeRuntimeError(error: unknown, providerId?: string): RuntimeErrorInfo {
  if (error instanceof RuntimeError) {
    return {
      type: error.type,
      message: error.message,
      recoverable: error.recoverable,
      retryable: error.retryable,
      status: error.status,
      providerId: error.providerId ?? providerId,
    }
  }

  const anyError = error as any
  const status = Number(anyError?.status ?? anyError?.response?.status)
  const code = String(anyError?.code ?? "")
  const rawMessage = error instanceof Error ? error.message : String(error ?? "Unknown error")
  const detail = String(anyError?.error?.message ?? anyError?.error?.error ?? "")
  const message = [status ? `HTTP ${status}` : "", code ? `(${code})` : "", detail || rawMessage]
    .filter(Boolean)
    .join(" - ")

  if (rawMessage.toLowerCase().includes("abort") || code === "ETIMEDOUT") {
    return { type: "timeout", message: "Request timed out.", recoverable: true, retryable: true, providerId }
  }
  if (status === 401) return { type: "auth", message, recoverable: true, retryable: false, status, providerId }
  if (status === 403) return { type: "permission", message, recoverable: true, retryable: false, status, providerId }
  if (status === 404 || /model/i.test(message) && /not found|invalid|does not exist/i.test(message)) {
    return { type: "bad_model", message, recoverable: true, retryable: false, status, providerId }
  }
  if (status === 429) return { type: "rate_limit", message, recoverable: true, retryable: true, status, providerId }
  if (status >= 500) return { type: "provider", message, recoverable: true, retryable: true, status, providerId }
  if (/failed to fetch|network|connection lost|disconnected/i.test(message)) {
    return { type: "network", message, recoverable: true, retryable: true, providerId }
  }

  return { type: "unknown", message, recoverable: true, retryable: false, status: status || undefined, providerId }
}

export function isRetryableError(error: unknown): boolean {
  const info = normalizeRuntimeError(error)
  return info.retryable
}

export async function withTimeoutAndRetry<T>(
  task: (signal: AbortSignal) => Promise<T>,
  options: { timeoutMs?: number; retries?: number } = {}
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 30_000
  const retries = options.retries ?? 1
  let lastError: unknown

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      return await task(controller.signal)
    } catch (error) {
      lastError = error
      if (attempt >= retries || !isRetryableError(error)) throw error
    } finally {
      clearTimeout(timeout)
    }
  }

  throw lastError
}

export async function checkedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: { timeoutMs?: number; retries?: number } = {}
): Promise<Response> {
  return withTimeoutAndRetry(async (signal) => {
    const res = await fetch(input, { ...init, signal })
    if (!res.ok) {
      throw new RuntimeError({
        ...normalizeRuntimeError({ status: res.status, message: `HTTP ${res.status}` }),
        status: res.status,
      })
    }
    return res
  }, options)
}
