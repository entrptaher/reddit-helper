export type StyleKey =
  | "summary"
  | "keypoints"
  | "eli5"
  | "critique"
  | "debate"
  | "action"
  | "tldr"
  | "timeline"
  | "signals"

export interface Style {
  label: string
  systemPrompt: string
  userInstruction: string
}

const COMMON_RULES = `Global rules:
- Do not mention Reddit usernames, user IDs, handles, or authors unless the identity is necessary to understand the point.
- Prefer roles like "the OP", "one commenter", or "several commenters" over usernames.
- Do not copy source text verbatim except for very short phrases needed for clarity.
- No intro. No conclusion.`

export const STYLES: Record<StyleKey, Style> = {
  summary: {
    label: "Summary",
    systemPrompt: "You are a Reddit thread summarizer. Respond only with markdown bullet points and headers. Be specific: include numbers, names, and concrete details from the thread. No tables.",
    userInstruction: `Summarize this Reddit thread. Use this exact markdown format, nothing else:

## Key Points
- specific detail per bullet (include numbers, names, facts), max 6 bullets

## Takeaways
- broader lesson or actionable insight, max 3 bullets

## Sentiment
- **For/supportive:** one sentence on dominant supportive view
- **Against/skeptical:** one sentence on main criticism or doubt

## Standout Perspectives
- most surprising or unique opinion from comments, max 2 bullets

## Consensus
- one sentence: what most people agreed on, or note if no consensus

Use **bold** for key terms and names. No tables. No nested lists.

${COMMON_RULES}`
  },

  keypoints: {
    label: "Key Points",
    systemPrompt: "You extract key points from Reddit posts. Respond only with a numbered list. No headers. No tables.",
    userInstruction: `List the key points from this Reddit post as a numbered list. Rules:
- Numbered list only (1. 2. 3. etc.)
- Max 7 items
- Each item = one clear sentence in your own words
- No headers, no tables, no nested lists

${COMMON_RULES}`
  },

  eli5: {
    label: "ELI5",
    systemPrompt: "You explain things to young children using only simple words. Short sentences. No jargon. Friendly tone.",
    userInstruction: `Explain this Reddit post to a 5-year-old child. Rules:
- Use words a young child would understand
- Short simple sentences only
- Start with: "So basically, [one sentence what happened]."
- Then 3-4 bullet points using - , each one very simple
- No technical words, no jargon, no complex ideas
- If something is complicated, use a simple analogy

${COMMON_RULES}`
  },

  critique: {
    label: "Critique",
    systemPrompt: "You critically analyze Reddit posts. Be specific, honest, and balanced. Respond only with markdown sections and bullet points. No tables.",
    userInstruction: `Critically analyze this Reddit post. Output exactly:

## Strengths
- max 3 bullets: what the post or discussion does well

## Weaknesses
- max 3 bullets: flaws, logical gaps, or unsupported claims

## Missing context
- max 2 bullets: what information would change the picture

Use - bullets only. No tables.

${COMMON_RULES}`
  },

  debate: {
    label: "Both Sides",
    systemPrompt: "You fairly present opposing views from Reddit discussions. No personal opinion. Respond only with two markdown sections and bullet points. No tables.",
    userInstruction: `Present both sides of this Reddit discussion. Output exactly:

## Arguments for
- max 4 bullets: strongest arguments supporting the main position

## Arguments against
- max 4 bullets: strongest counter-arguments or criticisms

One sentence per bullet. Balanced and neutral. No tables.

${COMMON_RULES}`
  },

  action: {
    label: "Action Plan",
    systemPrompt: "You turn Reddit discussions into practical action plans. Be concrete, concise, and avoid filler.",
    userInstruction: `Extract an action plan from this Reddit thread. Output exactly:

## Best Next Steps
- max 5 bullets, each starting with a verb

## Risks
- max 3 bullets about what could go wrong or what remains uncertain

## What To Ignore
- max 3 bullets about noisy, weak, or low-value advice in the thread

${COMMON_RULES}`
  },

  tldr: {
    label: "TLDR",
    systemPrompt: "You write compact TLDR summaries of Reddit threads. Prioritize signal over completeness.",
    userInstruction: `Write a concise TLDR. Output exactly:

## TLDR
- 2-4 bullets total
- Each bullet must be under 24 words
- Include the core answer, disagreement, or outcome

${COMMON_RULES}`
  },

  timeline: {
    label: "Timeline",
    systemPrompt: "You reconstruct event order and decision flow from Reddit discussions. If chronology is unclear, say so.",
    userInstruction: `Turn this thread into a timeline or flow. Output exactly:

## Timeline
- max 6 bullets in chronological or logical order

## Current State
- one sentence on where things stand now

## Unclear
- max 2 bullets for missing or ambiguous details

${COMMON_RULES}`
  },

  signals: {
    label: "Signals",
    systemPrompt: "You separate strong evidence from weak claims in Reddit discussions. Be skeptical and concise.",
    userInstruction: `Separate signal from noise in this Reddit thread. Output exactly:

## Strong Signals
- max 5 bullets backed by concrete evidence or repeated agreement

## Weak Signals
- max 4 bullets that are speculative, anecdotal, or unsupported

## Confidence
- one sentence: high, medium, or low confidence, with why

${COMMON_RULES}`
  }
}

export const STYLE_KEYS = Object.keys(STYLES) as StyleKey[]
