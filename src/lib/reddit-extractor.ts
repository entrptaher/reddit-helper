export const EXTRACTOR_VERSION = "2026-05-10.structured-v1"
const CHAR_LIMIT = 60_000
const COMMENT_LIMIT = 80

export type ExtractedContentSource = "dom" | "reddit-json" | "fallback-main"

export interface ThreadStats {
  words: number
  comments: number
  upvotes: number | null
  readMinutes: number
  savedMinutes: number
}

export interface ExtractedContent {
  source: ExtractedContentSource
  postId?: string
  subreddit?: string
  title: string
  body: string
  bodyChars: number
  comments: string[]
  commentsDetected: number
  commentsIncluded: number
  truncated: boolean
  warnings: string[]
  stats: ThreadStats
}

const STRIP_SELECTORS = [
  '[slot="ad-format-content"]',
  '[data-adtype]',
  '[data-ad-slot]',
  "shreddit-ad-post",
  ".promotedlink",
  "[data-before-content]",
  "aside",
  "style",
  "script",
  "template",
  "iframe",
  "nav",
]

function compactText(text: string): string {
  return text
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function cleanedText(el: HTMLElement): string {
  const clone = el.cloneNode(true) as HTMLElement
  for (const sel of STRIP_SELECTORS) {
    clone.querySelectorAll(sel).forEach((n) => n.remove())
  }
  return compactText(clone.innerText || clone.textContent || "")
}

function uniqueTexts(items: string[], limit = COMMENT_LIMIT): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of items) {
    const normalized = compactText(item)
    const fingerprint = normalized.toLowerCase().slice(0, 220)
    if (normalized.length < 12 || seen.has(fingerprint)) continue
    seen.add(fingerprint)
    out.push(normalized)
    if (out.length >= limit) break
  }
  return out
}

export function parseRedditUrl(url: string): { postId?: string; subreddit?: string } {
  try {
    const match = new URL(url).pathname.match(/^\/r\/([^/]+)\/comments\/([^/]+)/i)
    return { subreddit: match?.[1], postId: match?.[2]?.toLowerCase() }
  } catch {
    return {}
  }
}

function getPostId(): string | undefined {
  return parseRedditUrl(window.location.href).postId
}

function getSubreddit(): string | undefined {
  return parseRedditUrl(window.location.href).subreddit
}

function findPostElement(): HTMLElement | null {
  const postId = getPostId()
  if (!postId) return null

  const r = `t3_${postId}`
  const selectors = [
    `shreddit-post#${CSS.escape(r)}`,
    `shreddit-post[thingid="${r}"]`,
    `shreddit-post[permalink*="/comments/${CSS.escape(postId)}/"]`,
    `shreddit-post[view-context="CommentsPage"]`,
    `[data-test-id="post-content"]`,
    `[data-testid="post-container"]`,
  ]

  for (const sel of selectors) {
    try {
      const el = document.querySelector(sel) as HTMLElement | null
      if (el && cleanedText(el).length > 40) return el
    } catch {}
  }
  return null
}

function findCommentsElement(): HTMLElement | null {
  const selectors = [
    "shreddit-comment-tree",
    "[data-testid='comments-page-content']",
    ".commentarea",
  ]
  for (const sel of selectors) {
    try {
      const el = document.querySelector(sel) as HTMLElement | null
      if (el && cleanedText(el).length > 20) return el
    } catch {}
  }
  return null
}

function extractCommentTexts(commentsEl: HTMLElement | null): string[] {
  if (!commentsEl) return []
  const nodes = Array.from(commentsEl.querySelectorAll<HTMLElement>(
    "shreddit-comment, [data-testid='comment'], .comment"
  ))
  if (nodes.length === 0) return uniqueTexts([cleanedText(commentsEl)])

  return uniqueTexts(nodes.map((node) => {
    const body =
      node.querySelector<HTMLElement>("[slot='comment'], [data-testid='comment'], .md, .usertext-body") ?? node
    return cleanedText(body)
  }))
}

function extractTitle(postEl: HTMLElement | null): string {
  const candidates = [
    postEl?.getAttribute("post-title"),
    postEl?.querySelector<HTMLElement>("h1, h2, [slot='title']")?.innerText,
    document.querySelector<HTMLElement>("h1")?.innerText,
    document.title.replace(/\s*[:|]\s*Reddit.*$/i, ""),
  ]
  return compactText(candidates.find((item) => item && compactText(item).length > 0) ?? "")
}

function extractPostBody(postEl: HTMLElement | null, title: string): string {
  if (!postEl) return ""

  const bodyNode =
    postEl.querySelector<HTMLElement>("[slot='text-body'], [data-post-click-location='text-body'], .usertext-body, [data-testid='post-content']") ??
    postEl
  let body = cleanedText(bodyNode)

  if (title && body.startsWith(title)) {
    body = compactText(body.slice(title.length))
  }
  return body
}

function extractStats(
  postEl: HTMLElement | null,
  commentsEl: HTMLElement | null,
  bodyText: string,
  commentsDetected: number
): ThreadStats {
  let upvotes: number | null = null
  if (postEl) {
    const scoreAttr = postEl.getAttribute("score")
    if (scoreAttr !== null) {
      const n = parseInt(scoreAttr, 10)
      if (!Number.isNaN(n)) upvotes = n
    }
  }

  let comments = commentsDetected
  if (commentsEl) {
    const totalAttr = commentsEl.getAttribute("totalcomments") ?? commentsEl.getAttribute("total-comments")
    if (totalAttr !== null) {
      const n = parseInt(totalAttr, 10)
      if (!Number.isNaN(n)) comments = n
    }
  }

  const words = bodyText.split(/\s+/).filter(Boolean).length
  const readMinutes = Math.max(1, Math.round(words / 200))
  const savedMinutes = Math.max(1, readMinutes - 1)

  return { words, comments, upvotes, readMinutes, savedMinutes }
}

function chromeTextDominates(text: string): boolean {
  const lower = text.toLowerCase()
  const hits = [
    "advertise on reddit",
    "open settings menu",
    "log in",
    "sign up",
    "popular posts",
    "back to top",
  ].filter((needle) => lower.includes(needle)).length
  return hits >= 3 && text.length < 2_000
}

export function shouldUseRedditJsonFallback(content: ExtractedContent): boolean {
  return Boolean(
    content.postId &&
    content.subreddit &&
    (content.source === "fallback-main" ||
      content.bodyChars < 240 ||
      chromeTextDominates(content.body) ||
      content.commentsDetected === 0 ||
      content.commentsIncluded === 0 && content.stats.comments > 0 ||
      content.warnings.includes("DOM extraction was weak."))
  )
}

export function extractPageContent(): ExtractedContent {
  const postId = getPostId()
  const subreddit = getSubreddit()
  const postEl = findPostElement()
  const commentsEl = findCommentsElement()
  const title = extractTitle(postEl)
  const warnings: string[] = []
  let source: ExtractedContentSource = "dom"
  let body = extractPostBody(postEl, title)
  const comments = extractCommentTexts(commentsEl)
  let commentsDetected = comments.length

  if (!postId) warnings.push("Could not identify the Reddit post id.")
  if (!title) warnings.push("Could not identify a post title.")
  if (!postEl) warnings.push("Could not locate Reddit post content in the page DOM.")
  if (!commentsEl) warnings.push("Could not locate visible comments in the page DOM.")

  if (!body) {
    const main = document.querySelector("main") as HTMLElement | null
    if (main) {
      source = "fallback-main"
      body = cleanedText(main)
      warnings.push("Used a broad page fallback; Reddit chrome may be included.")
    }
  }

  body = compactText(body)
  if (chromeTextDominates(body)) warnings.push("DOM extraction was weak.")
  if (body.length < 160) warnings.push("Post body text is short or unavailable.")

  const combinedLength = body.length + comments.reduce((sum, item) => sum + item.length, 0)
  let truncated = combinedLength > CHAR_LIMIT
  if (body.length > CHAR_LIMIT) body = body.slice(0, CHAR_LIMIT)

  if (commentsEl) {
    const totalAttr = commentsEl.getAttribute("totalcomments") ?? commentsEl.getAttribute("total-comments")
    const total = totalAttr ? parseInt(totalAttr, 10) : NaN
    if (!Number.isNaN(total) && total > commentsDetected) commentsDetected = total
  }

  const stats = extractStats(postEl, commentsEl, body, commentsDetected)

  return {
    source,
    postId,
    subreddit,
    title,
    body,
    bodyChars: body.length,
    comments,
    commentsDetected,
    commentsIncluded: comments.length,
    truncated,
    warnings,
    stats,
  }
}
