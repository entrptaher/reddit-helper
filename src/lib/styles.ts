export type StyleKey = "summary" | "keypoints" | "eli5" | "critique" | "debate"

export interface Style {
  label: string
  emoji: string
  systemPrompt: string
  userInstruction: string
}

export const STYLES: Record<StyleKey, Style> = {
  summary: {
    label: "Summary",
    emoji: "📝",
    systemPrompt: "You are a Reddit thread summarizer. Respond only with markdown bullet points and headers. Be specific: include numbers, names, and concrete details from the thread. No tables. No copying the source text verbatim.",
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

Use **bold** for key terms and names. No intro. No conclusion. No tables. No nested lists.`
  },

  keypoints: {
    label: "Key Points",
    emoji: "🎯",
    systemPrompt: "You extract key points from Reddit posts. Respond only with a numbered list. No headers. No tables. No copying the source text.",
    userInstruction: `List the key points from this Reddit post as a numbered list. Rules:
- Numbered list only (1. 2. 3. etc.)
- No headers, no intro, no conclusion
- Max 7 items
- Each item = one clear sentence in your own words
- No tables, no nested lists`
  },

  eli5: {
    label: "ELI5",
    emoji: "🧒",
    systemPrompt: "You explain things to young children using only simple words. Short sentences. No jargon. Friendly tone.",
    userInstruction: `Explain this Reddit post to a 5-year-old child. Rules:
- Use words a young child would understand
- Short simple sentences only
- Start with: "So basically, [one sentence what happened]."
- Then 3-4 bullet points using - , each one very simple
- No technical words, no jargon, no complex ideas
- If something is complicated, use a simple analogy`
  },

  critique: {
    label: "Critique",
    emoji: "🔍",
    systemPrompt: "You critically analyze Reddit posts. Be specific, honest, and balanced. Respond only with markdown sections and bullet points. No tables.",
    userInstruction: `Critically analyze this Reddit post. Output exactly:

## Strengths
- max 3 bullets: what the post or discussion does well

## Weaknesses
- max 3 bullets: flaws, logical gaps, or unsupported claims

## Missing context
- max 2 bullets: what information would change the picture

No intro. No conclusion. No tables. Use - bullets only.`
  },

  debate: {
    label: "Both Sides",
    emoji: "⚖️",
    systemPrompt: "You fairly present opposing views from Reddit discussions. No personal opinion. Respond only with two markdown sections and bullet points. No tables.",
    userInstruction: `Present both sides of this Reddit discussion. Output exactly:

## Arguments for
- max 4 bullets: strongest arguments supporting the main position

## Arguments against
- max 4 bullets: strongest counter-arguments or criticisms

One sentence per bullet. Balanced and neutral. No intro. No conclusion. No tables.`
  }
}

export const STYLE_KEYS = Object.keys(STYLES) as StyleKey[]
