const CHAR_LIMIT = 60_000

export interface ThreadStats {
  words: number
  comments: number
  upvotes: number | null
  readMinutes: number
  savedMinutes: number
}

export interface ExtractedContent {
  title: string
  body: string
  truncated: boolean
  stats: ThreadStats
}

const STRIP_SELECTORS = [
  '[slot="ad-format-content"]',
  '[data-adtype]',
  '[data-ad-slot]',
  'shreddit-ad-post',
  '.promotedlink',
  '[data-before-content]',
  'aside',
  'style',
  'script'
]

function cleanedText(el: HTMLElement): string {
  const clone = el.cloneNode(true) as HTMLElement
  for (const sel of STRIP_SELECTORS) {
    clone.querySelectorAll(sel).forEach((n) => n.remove())
  }
  return clone.innerText.trim()
}

function getPostId(): string | null {
  const m = window.location.pathname.match(/\/r\/[^/]+\/comments\/([^/]+)/i)
  return m ? m[1].toLowerCase() : null
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
    `[data-testid="post-container"]`
  ]

  for (const sel of selectors) {
    try {
      const el = document.querySelector(sel) as HTMLElement | null
      if (el && cleanedText(el).length > 50) return el
    } catch {}
  }
  return null
}

function findCommentsElement(): HTMLElement | null {
  const selectors = [
    "shreddit-comment-tree",
    "[data-testid='comments-page-content']",
    ".commentarea"
  ]
  for (const sel of selectors) {
    try {
      const el = document.querySelector(sel) as HTMLElement | null
      if (el && cleanedText(el).length > 20) return el
    } catch {}
  }
  return null
}

function extractStats(postEl: HTMLElement | null, commentsEl: HTMLElement | null, bodyText: string): ThreadStats {
  // Upvotes from shreddit-post[score] attribute
  let upvotes: number | null = null
  if (postEl) {
    const scoreAttr = postEl.getAttribute("score")
    if (scoreAttr !== null) {
      const n = parseInt(scoreAttr, 10)
      if (!isNaN(n)) upvotes = n
    }
  }

  // Comment count from shreddit-comment elements or totalcomments attribute
  let comments = 0
  if (commentsEl) {
    const totalAttr = commentsEl.getAttribute("totalcomments") ?? commentsEl.getAttribute("total-comments")
    if (totalAttr !== null) {
      const n = parseInt(totalAttr, 10)
      if (!isNaN(n)) comments = n
    } else {
      comments = commentsEl.querySelectorAll("shreddit-comment, .comment").length
    }
  }

  const words = bodyText.split(/\s+/).filter(Boolean).length
  const readMinutes = Math.max(1, Math.round(words / 200))
  const savedMinutes = Math.max(1, readMinutes - 1)

  return { words, comments, upvotes, readMinutes, savedMinutes }
}

export function extractPageContent(): ExtractedContent {
  const title = document.title.replace(/\s*[:|]\s*Reddit.*$/i, "").trim()

  const postEl = findPostElement()
  const commentsEl = findCommentsElement()

  let body = ""

  if (postEl) {
    body += cleanedText(postEl)
  }

  if (commentsEl) {
    const commentText = cleanedText(commentsEl)
    const remaining = CHAR_LIMIT - body.length - 100
    if (remaining > 200) {
      body += "\n\n--- Comments ---\n\n" + commentText.slice(0, remaining)
    }
  }

  // Absolute fallback: only if nothing found
  if (!body) {
    const main = document.querySelector("main") as HTMLElement | null
    if (main) body = cleanedText(main).slice(0, CHAR_LIMIT)
  }

  body = body.replace(/\s{3,}/g, "\n\n").trim()
  const finalBody = body.slice(0, CHAR_LIMIT)

  return {
    title,
    body: finalBody,
    truncated: body.length >= CHAR_LIMIT,
    stats: extractStats(postEl, commentsEl, finalBody)
  }
}
