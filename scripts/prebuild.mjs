#!/usr/bin/env node
// Downloads models.dev/api.json once at build time.
// Writes bundled data to src/lib/models-dev-data.json.
// Patches manifest host permissions in package.json.

import { readFileSync, writeFileSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

const __dir = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dir, "..")

const MODELS_DEV_URL = "https://models.dev/api.json"
const DATA_OUT = resolve(root, "src/lib/models-dev-data.json")
const PKG_PATH = resolve(root, "package.json")

// Providers that use dedicated SDKs in models.dev but are OpenAI-compatible over HTTP
const KNOWN_COMPAT_URLS = [
  "https://api.groq.com/openai/v1",
  "https://api.mistral.ai/v1",
  "https://api.x.ai/v1",
  "https://api.perplexity.ai",
  "https://api.cerebras.ai/v1",
  "https://api.deepinfra.com/v1/openai",
  "https://openrouter.ai/api/v1",
  "https://api.cohere.ai/compatibility/v1",
]

function toOrigin(url) {
  try {
    const { protocol, hostname } = new URL(url)
    return `${protocol}//${hostname}/*`
  } catch {
    return null
  }
}

console.log(`Fetching ${MODELS_DEV_URL}...`)
const res = await fetch(MODELS_DEV_URL)
if (!res.ok) throw new Error(`HTTP ${res.status}`)
const data = await res.json()

// Save raw data for runtime use
writeFileSync(DATA_OUT, JSON.stringify(data, null, 2))
console.log(`Saved ${DATA_OUT}`)

// Extract all https origins from openai-compatible providers
const origins = new Set()
origins.add("https://models.dev/*")

for (const p of Object.values(data)) {
  if (p.npm !== "@ai-sdk/openai-compatible") continue
  const api = p.api ?? ""
  if (!api || api.includes("${")) continue
  if (!api.startsWith("https://")) continue
  const origin = toOrigin(api)
  if (origin) origins.add(origin)
}

for (const url of KNOWN_COMPAT_URLS) {
  const origin = toOrigin(url)
  if (origin) origins.add(origin)
}

const sorted = [...origins].sort()
console.log(`Found ${sorted.length} origins`)

// Patch package.json
const pkg = JSON.parse(readFileSync(PKG_PATH, "utf8"))
pkg.manifest = pkg.manifest ?? {}
const fixed = ["https://*.reddit.com/*", "https://api.exa.ai/*", "http://localhost/*", "http://127.0.0.1/*"]
pkg.manifest.host_permissions = [...fixed, ...sorted]
pkg.manifest.optional_host_permissions = ["http://*/*", "https://*/*"]
writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + "\n")
console.log(`Patched package.json host_permissions (${pkg.manifest.host_permissions.length} total)`)
