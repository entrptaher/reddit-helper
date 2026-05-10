# Reddit Post Summarizer

A browser extension that adds an AI-powered summarizer directly into Reddit post pages. Summarize threads, discover related posts, and switch between 100+ AI providers — from Chrome's built-in Gemini Nano to OpenAI, Ollama, and anything in between.

Built with [Plasmo](https://www.plasmo.com/), React, and TypeScript.

---

## Features

### AI Summarization
- **5 summary styles** — Summary, Key Points, ELI5, Critique, Both Sides
- **Streaming output** — See the summary appear in real-time
- **Local & remote providers** — Use Gemini Nano on-device, Ollama locally, or any OpenAI-compatible API
- **100+ built-in providers** — Auto-populated from [models.dev](https://models.dev); just add your API key
- **Custom providers** — Add your own OpenAI-compatible endpoint
- **Caching** — Revisit a post and the summary loads instantly from cache
- **Token usage** — See prompt/completion token counts when using API providers

### Related Post Finder
- **Exa search** — Web search scoped to the current subreddit (requires Exa API key)
- **Reddit search** — Subreddit-scoped search via Reddit's public JSON API
- **Sort options** — Relevance, Hot, New, Top, Comments

### UI
- **In-page toolbar** — Appears at the top of Reddit post pages; no popup needed
- **Collapsible panel** — Clean markdown rendering with close/hide controls
- **SPA-aware** — Automatically resets when navigating between posts on new Reddit

---

## Installation

### Prerequisites
- [Node.js](https://nodejs.org/) 18+
- [pnpm](https://pnpm.io/)

### Development

```bash
pnpm install
pnpm dev
```

This starts the Plasmo dev server. Load the extension in Chrome:
1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `build/chrome-mv3-dev` folder

### Production Build

```bash
pnpm build
```

The production bundle is output to `build/chrome-mv3-prod`.

### Package for Distribution

```bash
pnpm package
```

Creates a zip file ready for the Chrome Web Store.

---

## Configuration

Open the extension's **Options** page (click the popup icon → "Open Options", or right-click the extension → "Options").

### AI Providers

| Provider | Type | Setup |
|----------|------|-------|
| Gemini Nano | Local (browser) | Enable `chrome://flags/#prompt-api-for-gemini-nano` |
| Ollama | Local (machine) | Enter your Ollama base URL (default: `http://localhost:11434`) |
| OpenAI, Anthropic, Groq, etc. | API | Select provider → paste API key → Test → Save |
| Custom | OpenAI-compatible | Click "Add Custom Server" → name, base URL, models, key |

API keys are stored locally in Chrome storage and are only sent to the configured provider endpoint.

### Post Finder

In the **Post finder** tab:
- Toggle **Exa search** and/or **Reddit search**
- Add your Exa API key if using Exa
- Choose Exa search type (Auto, Neural, Keyword)

---

## Project Structure

```
├── src/
│   ├── content.tsx          # Content script injected on Reddit post pages
│   ├── background.ts        # Service worker for API calls and search
│   ├── popup.tsx            # Extension popup (enable/disable toggle)
│   ├── options.tsx          # Options page for provider configuration
│   ├── components/
│   │   ├── Toolbar.tsx      # Style/provider selector + action buttons
│   │   ├── SummaryPanel.tsx # Streaming output, related results, search
│   │   └── SummarizeButton.tsx
│   └── lib/
│       ├── styles.ts        # Summary style definitions & prompts
│       ├── providers.ts     # Built-in provider definitions
│       ├── models-cache.ts  # Dynamic provider list from models.dev
│       ├── language-model.ts# Gemini Nano & API summarization logic
│       ├── reddit-extractor.ts # DOM scraping for post title + body
│       ├── reddit-search.ts # Reddit JSON API search
│       ├── exa.ts           # Exa API integration
│       ├── cache.ts         # Per-URL summary caching
│       └── storage.ts       # Chrome storage wrapper
├── scripts/
│   └── prebuild.mjs         # Pre-build script
├── assets/
│   └── icon.png
└── package.json
```

---

## Architecture Notes

- **Content script** (`content.tsx`) mounts a React app into the Reddit page shadow DOM. It extracts post content, coordinates with the toolbar/panel UI, and streams summaries.
- **Background script** (`background.ts`) handles all outbound API calls via long-lived ports. This avoids CORS issues in the content script and keeps API keys isolated.
- **Provider discovery** — On build, `scripts/prebuild.mjs` fetches provider metadata from [models.dev](https://models.dev). The options page can refresh this list at runtime.
- **Model fetching** — For API providers, the extension queries the `/models` endpoint to populate the model dropdown dynamically.

---

## Permissions

- **`storage`** — Persist settings, API keys, and cache
- **`host_permissions`** — Reddit pages (content script), provider API endpoints (background), and Exa API

The extension uses optional host permissions for custom provider URLs, requested at runtime when you add/configure a provider.

---

## License

MIT
