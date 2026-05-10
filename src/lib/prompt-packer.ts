import type { ExtractedContent } from "./reddit-extractor"
import type { RuntimeErrorInfo } from "./runtime"

export const PROMPT_VERSION = "2026-05-10.evidence-v1"
export const EVIDENCE_CHAR_LIMIT = 60_000
const BODY_LIMIT = 18_000
const COMMENT_LIMIT = 2_400
const MIN_USEFUL_CHARS = 120

export interface PackedPrompt {
  title: string
  postBody: string
  comments: string[]
  metadata: string[]
  truncationNotice?: string
  warnings: string[]
  text: string
}

export function coverageFor(content: ExtractedContent): "full" | "partial" | "limited" {
  if (content.bodyChars < MIN_USEFUL_CHARS || content.commentsIncluded === 0 && content.commentsDetected > 0) {
    return "limited"
  }
  if (content.truncated || content.warnings.length > 0 || content.commentsDetected > content.commentsIncluded) {
    return "partial"
  }
  return "full"
}

export function validateExtractedContent(content: ExtractedContent): RuntimeErrorInfo | null {
  const usefulChars = [content.title, content.body, ...(content.comments ?? [])].join(" ").trim().length
  if (usefulChars < MIN_USEFUL_CHARS) {
    return {
      type: "empty_content",
      message: "Not enough post content was available to summarize.",
      recoverable: true,
      retryable: false,
    }
  }
  return null
}

function clip(text: string, limit: number): { text: string; truncated: boolean } {
  const cleaned = text.replace(/\s{3,}/g, "\n\n").trim()
  if (cleaned.length <= limit) return { text: cleaned, truncated: false }
  return { text: cleaned.slice(0, limit).trim(), truncated: true }
}

export function packPrompt(
  content: ExtractedContent,
  userInstruction: string,
  limit = EVIDENCE_CHAR_LIMIT
): PackedPrompt {
  const body = clip(content.body || "[NO POST BODY AVAILABLE]", BODY_LIMIT)
  const metadata = [
    `Source method: ${content.source}`,
    content.subreddit ? `Subreddit: r/${content.subreddit}` : "",
    content.postId ? `Post ID: ${content.postId}` : "",
    `Comments included: ${content.commentsIncluded} of ${content.commentsDetected} detected`,
    `Coverage: ${coverageFor(content).toUpperCase()}`,
  ].filter(Boolean)

  const warnings = [...content.warnings]
  if (body.truncated) warnings.push("Post body was shortened before summarization.")
  if (content.commentsDetected > content.commentsIncluded) {
    warnings.push("Only a subset of comments was available to the summarizer.")
  }
  if (content.truncated) warnings.push("Extraction reached the local character limit.")

  let remaining = Math.max(0, limit - userInstruction.length - body.text.length - metadata.join("\n").length - 900)
  const comments: string[] = []
  for (const comment of content.comments ?? []) {
    if (remaining < 300) break
    const packed = clip(comment, Math.min(COMMENT_LIMIT, remaining))
    if (!packed.text) continue
    comments.push(packed.text)
    remaining -= packed.text.length + 64
    if (packed.truncated) break
  }

  const truncationNotice = warnings.length > 0
    ? `Do not imply full-thread coverage. Extraction notes: ${warnings.join(" ")}`
    : undefined

  const parts = [
    userInstruction,
    "",
    "Use only the evidence below. If coverage is PARTIAL or LIMITED, say so plainly when relevant.",
    "",
    "## Thread Metadata",
    metadata.map((item) => `- ${item}`).join("\n"),
    "",
    "## Title",
    content.title || "[UNTITLED REDDIT POST]",
    "",
    "## Post Body",
    body.text,
    "",
    "## Selected Comments",
    comments.length > 0
      ? comments.map((comment, index) => `### Comment ${index + 1}\n${comment}`).join("\n\n")
      : "[NO COMMENTS AVAILABLE]",
    truncationNotice ? `\n## Extraction Warnings\n${truncationNotice}` : "",
  ]

  return {
    title: content.title,
    postBody: body.text,
    comments,
    metadata,
    truncationNotice,
    warnings,
    text: parts.join("\n").slice(0, limit),
  }
}
