import {
  BLUEBERRY_DOM_MAP_OVERLAY_SCHEMA,
  type OverlayLayoutKind,
} from '@common/flattenedMap'
import { normalizeOverlayLayoutKind } from '@common/lib/flattenedFeedUtils'
import { DOM_MAP_SCRIPT_HELPERS } from './domMapScriptHelpers'
import { overlayDiscussionFromHackernewsItemDomMap } from './hnItemDiscussionFromDomMap'
import { overlayDiscussionFromRedditThreadDomMap } from './redditThreadDiscussionFromDomMap'
export function overlayPayloadLayoutKind(
  value: Record<string, unknown>,
): OverlayLayoutKind | null {
  const sch = value.schema
  if (sch === 'blueberry-dom-map-flattened') return 'feed'
  if (sch === BLUEBERRY_DOM_MAP_OVERLAY_SCHEMA) {
    return normalizeOverlayLayoutKind(value.layoutKind)
  }
  return null
}

/**
 * Extract JSON from assistant markdown (last ```json fence, else whole message if valid JSON).
 */
export function extractJsonFromAssistantMessage(text: string): string | null {
  const fences = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)]
  if (fences.length > 0) {
    const last = fences[fences.length - 1]?.[1]
    if (last != null && last.trim().length > 0) {
      return last.trim()
    }
  }
  const t = text.trim()
  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      JSON.parse(t)
      return t
    } catch {
      return null
    }
  }
  return null
}

/**
 * Extract last ```javascript or ```js fence from assistant markdown.
 */
export function extractJavascriptFromAssistantMessage(text: string): string | null {
  const fences = [...text.matchAll(/```(?:javascript|js)\s*([\s\S]*?)```/gi)]
  if (fences.length === 0) return null
  const body = fences[fences.length - 1]?.[1]?.trim()
  return body != null && body.length > 0 ? body : null
}

/** Remove optional \`summary\` from each flattened item before Map import (model often adds it anyway). */
export function stripFlattenedSummaries(rawJsonText: string): string {
  try {
    const o = JSON.parse(rawJsonText) as {
      items?: unknown[]
    }
    if (o != null && typeof o === 'object' && Array.isArray(o.items)) {
      for (const row of o.items) {
        if (row != null && typeof row === 'object' && 'summary' in row) {
          delete (row as { summary?: string }).summary
        }
      }
    }
    return JSON.stringify(o, null, 2)
  } catch {
    return rawJsonText
  }
}

export function isFlattenedDomMapPayload(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (v.ok !== true || !Array.isArray(v.items)) return false
  return overlayPayloadLayoutKind(v) !== null
}

/** DOM-map walker subtree shape occasionally lands in flattened `items` by mistake — detect and coerce. */
type LooseWalker = Record<string, unknown>

function walkerChildren(n: LooseWalker): LooseWalker[] {
  const out: LooseWalker[] = []
  const k = n.k
  const w = n.w
  if (Array.isArray(k)) {
    for (const c of k) {
      if (c && typeof c === 'object') out.push(c as LooseWalker)
    }
  }
  if (Array.isArray(w)) {
    for (const c of w) {
      if (c && typeof c === 'object') out.push(c as LooseWalker)
    }
  }
  return out
}

function walkPreorderWalker(
  root: LooseWalker | null | undefined,
  visit: (n: LooseWalker) => void,
): void {
  if (root == null || typeof root !== 'object') return
  visit(root)
  for (const c of walkerChildren(root)) walkPreorderWalker(c, visit)
}

function walkerHasFlattenedSemantics(o: LooseWalker): boolean {
  const t = o.title
  if (typeof t === 'string' && t.trim() !== '') return true
  const hrefish = o.url ?? o.link ?? o.href
  if (typeof hrefish === 'string' && hrefish.trim() !== '') return true
  return false
}

function isMalformedWalkerFlattenRow(row: unknown): row is LooseWalker {
  if (row == null || typeof row !== 'object') return false
  const o = row as LooseWalker
  if (typeof o.t !== 'string') return false
  if (!Array.isArray(o.k) && !Array.isArray(o.w)) return false
  if (walkerHasFlattenedSemantics(o)) return false
  return true
}

function coerceWalkerHostRow(
  row: LooseWalker,
  pageUrl: string,
): Record<string, unknown> {
  const attrsObj = row.a
  const attrs: Record<string, string> = {}
  if (attrsObj && typeof attrsObj === 'object' && !Array.isArray(attrsObj)) {
    for (const [key, val] of Object.entries(attrsObj)) {
      if (typeof val === 'string') attrs[key] = val
    }
  }

  const base =
    typeof pageUrl === 'string' && pageUrl.trim().length > 0
      ? pageUrl.trim()
      : 'https://www.reddit.com/'

  function resolveHref(h?: string): string | undefined {
    if (typeof h !== 'string' || !h.trim()) return undefined
    try {
      return new URL(h.trim(), base).href
    } catch {
      return undefined
    }
  }

  let title = ''
  let pickedSynthHeadline = false
  walkPreorderWalker(row, (n) => {
    if (pickedSynthHeadline) return
    const tag = typeof n.t === 'string' ? n.t.toLowerCase() : ''
    if (tag !== 'a') return
    const xi = typeof n.x === 'string' ? n.x.trim() : ''
    if (!xi) return
    const idStr = typeof n.i === 'string' ? n.i : ''
    if (idStr.startsWith('__bb_nav__')) {
      title = xi
      pickedSynthHeadline = true
      return
    }
    if (!title) title = xi
  })

  const ch = attrs['content-href']
  const permalink = attrs['permalink']
  let url: string | undefined
  if (typeof ch === 'string' && ch.trim()) {
    url = resolveHref(ch)
  }
  if (!url && typeof permalink === 'string' && permalink.trim()) {
    url = resolveHref(permalink)
  }
  if (!url) {
    walkPreorderWalker(row, (n) => {
      if (url) return
      const tag = typeof n.t === 'string' ? n.t.toLowerCase() : ''
      if (tag !== 'a') return
      const aobj = n.a
      const href =
        aobj &&
        typeof aobj === 'object' &&
        !Array.isArray(aobj) &&
        typeof (aobj as Record<string, unknown>).href === 'string'
          ? String((aobj as Record<string, string>).href)
          : undefined
      if (!href?.trim()) return
      const h = href.trim()
      if (/^vote\?/i.test(h) || /how=up/i.test(h) || /\bhide\b/i.test(h)) return
      const abs = resolveHref(h)
      if (abs && /^https?:\/\//i.test(abs)) url = abs
    })
  }

  const out: Record<string, unknown> = {}
  if (title.trim()) out.title = title.trim()
  if (url) out.url = url
  const id = typeof row.i === 'string' ? row.i : undefined
  if (id) out.id = id
  return out
}

function pickFlattenedHrefish(row: Record<string, unknown>): unknown {
  return row.url ?? row.link ?? row.href
}

/** Collapse rows sharing the same display title × resolved URL (ordering preserved). */
function flattenedItemDedupeKey(row: unknown, pageUrl: string): string {
  if (row === null || typeof row !== 'object') {
    return `__primitive__:${String(row)}`
  }
  const r = row as Record<string, unknown>
  const title =
    typeof r.title === 'string' ? r.title.trim().replace(/\s+/g, ' ') : ''
  const raw = pickFlattenedHrefish(r)
  let urlNorm = ''
  const base =
    typeof pageUrl === 'string' && pageUrl.trim().length > 0
      ? pageUrl.trim()
      : 'about:blank'
  if (typeof raw === 'string' && raw.trim()) {
    try {
      urlNorm = new URL(raw.trim(), base).href
    } catch {
      urlNorm = raw.trim()
    }
  }
  return `${title}\0${urlNorm}`
}

function isHackernewsItemDiscussionUrl(raw: string): boolean {
  try {
    const u = new URL(raw.trim())
    if (u.hostname.replace(/^www\./i, '') !== 'news.ycombinator.com')
      return false
    if (u.pathname.replace(/\/$/, '') !== '/item') return false
    const id = u.searchParams.get('id')
    return id != null && /^\d+$/.test(id)
  } catch {
    return false
  }
}

function feedLikeRowPrimaryHref(row: unknown): string | undefined {
  if (row == null || typeof row !== 'object') return undefined
  const o = row as Record<string, unknown>
  for (const k of ['url', 'link', 'href'] as const) {
    const v = o[k]
    if (typeof v === 'string' && v.trim() !== '') return v.trim()
  }
  return undefined
}

/** Rel paths from DOM map scripts use plain `vote?…`; emitted JSON may already be absolute. */
function hrefLooksLikeHackernewsVoteLink(href: string): boolean {
  const h = href.trim()
  return (
    /^vote\?/i.test(h) ||
    /news\.ycombinator\.com\/vote\?/i.test(h) ||
    /\bycombinator\.com\/vote\?/i.test(h)
  )
}

/**
 * Homepage-style feed rows mistakenly applied to `/item?id=` threads: dozens of `{ url: vote?…, username }` with empty titles.
 */
function hnMisclassifiedListingFeed(items: unknown[]): boolean {
  if (!Array.isArray(items) || items.length < 2) return false
  let voteish = 0
  let nonEmptyTitles = 0
  const n = items.length
  for (const row of items) {
    const h = feedLikeRowPrimaryHref(row)
    if (h != null && hrefLooksLikeHackernewsVoteLink(h)) voteish++
    if (
      row != null &&
      typeof row === 'object' &&
      typeof (row as { title?: string }).title === 'string' &&
      (row as { title?: string }).title!.trim() !== ''
    ) {
      nonEmptyTitles++
    }
  }
  return voteish / n >= 0.35 && nonEmptyTitles / n < 0.15
}

/**
 * Narrow safety net besides the prompt: HN discussion pages coerced into feed-shaped vote-arrow rows → discussion + stripped links.
 */
function coerceHNItemThreadMisclassifiedFeed(
  payload: Record<string, unknown>,
): void {
  const pageUrl = typeof payload.url === 'string' ? payload.url.trim() : ''
  if (
    pageUrl === '' ||
    !isHackernewsItemDiscussionUrl(pageUrl) ||
    overlayPayloadLayoutKind(payload) !== 'feed'
  ) {
    return
  }
  const items = payload.items
  if (!Array.isArray(items) || !hnMisclassifiedListingFeed(items)) return

  payload.schema = BLUEBERRY_DOM_MAP_OVERLAY_SCHEMA
  payload.layoutKind = 'discussion'

  const next: unknown[] = []
  for (const row of items) {
    if (row == null || typeof row !== 'object') continue
    const o = row as Record<string, unknown>
    const userRaw = o.username ?? o.user
    const user =
      typeof userRaw === 'string' ? userRaw.trim() : ''

    const textParts: string[] = []
    for (const k of ['score', 'comments', 'title'] as const) {
      const v = o[k]
      if (typeof v === 'string' && v.trim() !== '')
        textParts.push(v.trim())
    }
    const text = textParts.join(' · ')

    const node: Record<string, unknown> = {}
    if (user) node.username = user
    if (text) node.text = text
    next.push(node)
  }
  payload.items = dedupeFlattenedDomMapItemsPreserveOrder(next, pageUrl)
}

/** First occurrence wins (original object kept). Exported for callers that mutate items arrays directly. */
export function dedupeFlattenedDomMapItemsPreserveOrder(
  items: unknown[],
  pageUrl: string,
): unknown[] {
  const seen = new Set<string>()
  const out: unknown[] = []
  for (const row of items) {
    const k = flattenedItemDedupeKey(row, pageUrl)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(row)
  }
  return out
}

/**
 * When a flatten script mistakenly `push`es blueberry walker nodes (`t` + `k` / `w`) instead of `{ title, url }`,
 * feed UI stays empty (“No title”). Coerce rows in place — **narrow** heuristic (needs tree shape + absent flat fields).
 */
export function normalizeFlattenedDomMapPayload(value: unknown): void {
  if (!isFlattenedDomMapPayload(value)) return
  const payload = value as Record<string, unknown>
  const layout = overlayPayloadLayoutKind(payload)
  if (layout === 'feed') {
    const pageUrl = typeof payload.url === 'string' ? payload.url : ''
    const items = payload.items
    if (Array.isArray(items)) {
      const coerced = items.map((row) =>
        isMalformedWalkerFlattenRow(row) ? coerceWalkerHostRow(row, pageUrl) : row,
      )
      payload.items = dedupeFlattenedDomMapItemsPreserveOrder(coerced, pageUrl)
    }
  }
  coerceHNItemThreadMisclassifiedFeed(payload)
}

function applyDeterministicHackernewsItemThreadOverlay(
  domMapInput: unknown,
  payload: Record<string, unknown>,
): void {
  const built = overlayDiscussionFromHackernewsItemDomMap(domMapInput)
  if (built == null) return
  Object.assign(payload, built)
}

function applyDeterministicRedditThreadOverlay(
  domMapInput: unknown,
  payload: Record<string, unknown>,
): void {
  const built = overlayDiscussionFromRedditThreadDomMap(domMapInput)
  if (built == null) return
  Object.assign(payload, built)
}

function discussionNodePrimaryHref(n: unknown): string | undefined {
  if (n == null || typeof n !== 'object') return undefined
  const o = n as Record<string, unknown>
  for (const k of ['url', 'link', 'href'] as const) {
    const v = o[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  const cu = o.commentsUrl
  if (typeof cu === 'string' && cu.trim()) return cu.trim()
  return undefined
}

function walkDiscussionTreeFirstHref(
  nodes: unknown,
  depth: number,
): string | undefined {
  if (depth > 48 || !Array.isArray(nodes)) return undefined
  for (const n of nodes) {
    const h = discussionNodePrimaryHref(n)
    if (h && !hrefLooksLikeHackernewsVoteLink(h)) return h
    if (n != null && typeof n === 'object') {
      const o = n as { children?: unknown; replies?: unknown }
      const kids = Array.isArray(o.children)
        ? o.children
        : Array.isArray(o.replies)
          ? o.replies
          : undefined
      const sub = walkDiscussionTreeFirstHref(kids, depth + 1)
      if (sub) return sub
    }
  }
  return undefined
}

/** Top-level `url` for overlay header / Eye when the model omitted it but DOM map or nodes carry a link. */
function ensureDiscussionOverlayPageUrl(
  domMapInput: unknown,
  payload: Record<string, unknown>,
): void {
  if (overlayPayloadLayoutKind(payload) !== 'discussion') return
  const cur = typeof payload.url === 'string' ? payload.url.trim() : ''
  if (cur) return

  if (domMapInput != null && typeof domMapInput === 'object') {
    const mp = (domMapInput as { url?: unknown }).url
    if (typeof mp === 'string' && mp.trim()) {
      payload.url = mp.trim()
      return
    }
  }

  const fromItems = walkDiscussionTreeFirstHref(payload.items, 0)
  if (fromItems) payload.url = fromItems
}

/**
 * When the full v4 DOM map matches known thread layouts, replace the script result with a
 * canonical overlay: HN `/item?id=` (`tr.comtr`) or Reddit `/r/…/comments/…` (classic `thing.comment`).
 * @param domMapScannerFull `blueberry-dom-map-v4` object straight from the page scanner. Must not be
 * `stringifyDomMapForTransformLlm` output (that prunes siblings/depth and often drops comment rows).
 */
export function finalizeDomMapOverlayFromDomMapAndScript(
  domMapScannerFull: unknown,
  scriptReturn: unknown,
): void {
  if (!isFlattenedDomMapPayload(scriptReturn)) return
  const payload = scriptReturn as Record<string, unknown>
  applyDeterministicHackernewsItemThreadOverlay(domMapScannerFull, payload)
  applyDeterministicRedditThreadOverlay(domMapScannerFull, payload)
  normalizeFlattenedDomMapPayload(payload)
  ensureDiscussionOverlayPageUrl(domMapScannerFull, payload)
}

/**
 * Run assistant-supplied callable on parsed v4 DOM map. **Trusted local use only** (LLM‑generated code).
 * Passes `(input, H)` when the function arity ≥ 2; otherwise legacy `(input)` only.
 */
export function runDomMapFlattenCallable(
  source: string,
  input: unknown
): unknown {
  const trimmed = source.trim().replace(/^export\s+default\s+/m, '')
  const runner = new Function(
    'input',
    'H',
    `
    var __fn = (${trimmed});
    if (typeof __fn !== 'function')
      throw new TypeError('Expected a function expression in the fenced block.');
    return __fn.length >= 2 ? __fn(input, H) : __fn(input);
    `,
  ) as (inp: unknown, h: typeof DOM_MAP_SCRIPT_HELPERS) => unknown
  return runner(input, DOM_MAP_SCRIPT_HELPERS)
}

export { DOM_MAP_SCRIPT_HELPERS } from './domMapScriptHelpers'
