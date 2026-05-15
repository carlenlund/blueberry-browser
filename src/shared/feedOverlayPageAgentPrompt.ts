/** Browser page agent for the feed overlay composer (main process LLM loop). */

import { normalizeQuickOpenInput } from "./navigateQuickOpen"

export const FEED_OVERLAY_PAGE_AGENT_MAX_ITERATIONS = 6

/**
 * Empty composer → page agent: onboarding tied to structured context / screenshot.
 * Use only when the user is not still on the app’s default Google homepage tab.
 */
export const FEED_OVERLAY_PAGE_AGENT_DEFAULT_GOAL_CONTENT_PAGE =
  'Introduce yourself briefly as the page agent. Then suggest several concrete example questions I could ask you about this page, grounded in what you see in the page context.'

/**
 * Same flow as {@link FEED_OVERLAY_PAGE_AGENT_DEFAULT_GOAL_CONTENT_PAGE}, but examples must stay
 * generic (capabilities / typical workflows), not tied to the current tab — user has not left the start page.
 */
export const FEED_OVERLAY_PAGE_AGENT_DEFAULT_GOAL_START_PAGE =
  'Introduce yourself briefly as the page agent. Then suggest several example questions I could ask you about browsing and pages in general (what you can do once I open a site or article). Do not tie examples to the specific content visible in the current tab — I am still on the browser start page.'

/** True while the active tab is effectively the initial Google homepage (new-tab default), not search/results or another site. */
export function isFeedOverlayPageAgentStartPageUrl(raw: string): boolean {
  const t = typeof raw === 'string' ? raw.trim() : ''
  if (!t || /^about:blank$/i.test(t)) return true

  try {
    const u = new URL(t)
    const proto = u.protocol.toLowerCase()
    if (proto !== 'http:' && proto !== 'https:') return false

    const host = u.hostname.toLowerCase()
    if (host !== 'google.com' && host !== 'www.google.com') return false

    let path = u.pathname || '/'
    path = path.replace(/\/+$/, '') || '/'
    return path === '/' || path === '/webhp'
  } catch {
    return false
  }
}

/** Reject unreasonably large injected scripts from the model. */
export const FEED_OVERLAY_PAGE_AGENT_MAX_SCRIPT_CHARS = 12_000

export const FEED_OVERLAY_PAGE_AGENT_PAGE_TEXT_CAP = 12_000

/**
 * Describes capabilities as “functions” the model should reason about.
 * The runtime only accepts `navigateUrl` + `pageScript` + terminal `done` from JSON.
 */
export function feedOverlayPageAgentSystemPrompt(): string {
  return [
    "You are an autonomous browser agent. The host runs in Electron and will execute your plan on the user's active tab.",
    "Each turn you receive: the user goal, structured page context (title, meta, main/article regions, and visible text sampled while scrolling — similar in spirit to our layout parser’s visibility-aware sampling), prior-action log, and usually a screenshot of the current viewport.",
    "Treat the screenshot as ground truth for what the user sees (headlines, paywalls, cookie/consent layers). Prefer runPageScript to scroll (`window.scrollTo`, `scrollBy`), dismiss overlays, or use `querySelector` / `querySelectorAll` before navigating away.",
    "",
    "You have these operations (described for your reasoning — you invoke them only via the JSON schema below):",
    "",
    "1. getPageContext — You receive URL + structured text + screenshot each turn. Use all of them before scripting.",
    "2. runPageScript — Provide `pageScript`: a single JavaScript expression evaluated in the page (no `import`).",
    "   Wrap work in an IIFE, e.g. `(function(){ /* query DOM */ return { found: true, href: el?.href }; })()`.",
    "   Return small JSON-serializable objects (strings, numbers, booleans, null, arrays, plain objects).",
    "   Prefer `document.querySelector` / `querySelectorAll`, `innerText`, `getAttribute`, `location.href`.",
    "3. navigateToUrl — Provide `navigateUrl`: absolute `https://…` or a path/query fragment resolved against the current URL (e.g. `/story/1`, `?page=2`).",
    "4. finish — Set `done: true` and `summary` when the goal is satisfied or you cannot proceed.",
    "",
    "Rules:",
    "- Usually one primary action per turn: `pageScript` OR `navigateUrl`, then another turn if needed.",
    "- **Last step:** you may set `done: true` together with **one** final `pageScript` and/or `navigateUrl`. The host runs those, then **stops** without using remaining iterations.",
    "- If you finish with **no** tab action, set `navigateUrl` and `pageScript` to null and `done: true`.",
    "- If the goal needs another page, navigate once, then inspect again on the next turn (unless you also mark `done` after that navigation).",
    "- If a script fails, the prior-action log includes the **real** exception message—fix syntax (balanced parentheses) and avoid top-level `return` outside an IIFE.",
    "- Example: **news.ycombinator.com** — story rows use class **`athing`**; headline `<a>` is under **`.titleline`**. Skip links whose `href` starts with **`vote?`** or **`from?`**.",
    "- Keep `reasoning` short (one or two sentences).",
    "",
    "Reply with exactly one JSON object and no other text, in this shape:",
    "{",
    '  "reasoning": string,',
    '  "done": boolean,',
    '  "summary": string (final user-facing answer when done),',
    '  "navigateUrl": string | null,',
    '  "pageScript": string | null',
    "}",
    "",
    "When `done` is true, `summary` must be a clear answer for the user. If there is no final script or navigation, set `navigateUrl` and `pageScript` to null.",
  ].join("\n")
}

export function resolveFeedOverlayAgentNavigateUrl(
  raw: string,
  pageUrl: string,
): string {
  const t = typeof raw === "string" ? raw.trim() : ""
  if (!t) return ""
  if (t.startsWith("http://") || t.startsWith("https://")) return t
  try {
    const base =
      pageUrl && /^https?:\/\//i.test(pageUrl)
        ? pageUrl
        : "https://www.google.com/"
    return new URL(t, base).href
  } catch {
    return normalizeQuickOpenInput(t)
  }
}

function parseFirstJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim()
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = (fence ? fence[1] : trimmed)?.trim() ?? trimmed
  const start = candidate.indexOf("{")
  if (start === -1) {
    throw new Error("No JSON object in model output")
  }
  let depth = 0
  for (let i = start; i < candidate.length; i++) {
    const c = candidate[i]!
    if (c === "{") depth++
    else if (c === "}") {
      depth--
      if (depth === 0) {
        return JSON.parse(candidate.slice(start, i + 1)) as Record<
          string,
          unknown
        >
      }
    }
  }
  throw new Error("Unbalanced JSON in model output")
}

function parseAgentDone(v: unknown): boolean {
  if (v === true) return true
  if (v === false || v == null) return false
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase()
    return s === 'true' || s === 'yes' || s === '1'
  }
  if (typeof v === 'number') return v !== 0
  return false
}

export function parseFeedOverlayAgentModelReply(
  text: string,
): FeedOverlayAgentModelReply {
  const obj = parseFirstJsonObject(text)
  return {
    reasoning: String(obj.reasoning ?? ''),
    done: parseAgentDone(obj.done),
    summary: String(obj.summary ?? ''),
    navigateUrl:
      obj.navigateUrl == null || obj.navigateUrl === ""
        ? null
        : String(obj.navigateUrl),
    pageScript:
      obj.pageScript == null || obj.pageScript === ""
        ? null
        : String(obj.pageScript),
  }
}

export type FeedOverlayAgentModelReply = {
  reasoning: string
  done: boolean
  summary: string
  navigateUrl: string | null
  pageScript: string | null
}

export type FeedOverlayPageAgentInvokeResult =
  | {
      ok: true
      summary: string
      iterationsUsed: number
      trace: string[]
    }
  | { ok: false; error: string }

export function buildFeedOverlayAgentUserTurn(params: {
  goal: string
  /** 1-based index for display in the prompt */
  iterationIndex: number
  maxIterations: number
  pageUrl: string
  pageText: string
  actionLog: string[]
}): string {
  const log =
    params.actionLog.length > 0
      ? params.actionLog.map((l, i) => `${i + 1}. ${l}`).join("\n")
      : "(none yet)"
  return [
    `User goal: ${params.goal.trim()}`,
    "",
    `Iteration: ${params.iterationIndex} / ${params.maxIterations}`,
    `Current URL: ${params.pageUrl || "(unknown)"}`,
    "",
    "Structured page context (truncated if very long):",
    params.pageText || "(empty)",
    "",
    "Prior actions:",
    log,
  ].join("\n")
}
