import {
  BLUEBERRY_DOM_MAP_OVERLAY_SCHEMA,
  type DomMapOverlayPageResult,
  type FlattenedItem,
  type FlattenedPageMapResult,
} from '../flattenedMap'

function hrefish(it: FlattenedItem): boolean {
  for (const k of ['url', 'link', 'href', 'commentsUrl'] as const) {
    const v = it[k]
    if (typeof v === 'string' && v.trim().length > 0) return true
  }
  return false
}

function subitemsMeaningful(it: FlattenedItem): boolean {
  const subs = it.subitems
  if (!Array.isArray(subs) || subs.length === 0) return false
  return subs.some(
    (s) =>
      (typeof s.label === 'string' && s.label.trim().length > 0) ||
      (typeof s.text === 'string' && s.text.trim().length > 0),
  )
}

export function normalizeOverlayLayoutKind(
  raw: unknown,
): 'feed' | 'article' | 'discussion' | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim().toLowerCase()
  if (s === 'feed' || s === 'article' || s === 'discussion') return s
  return null
}

function overlayPayloadLayoutKind(
  value: FlattenedPageMapResult | DomMapOverlayPageResult,
): 'feed' | 'article' | 'discussion' | null {
  const v = value as Record<string, unknown>
  const sch = v.schema
  if (sch === 'blueberry-dom-map-flattened') return 'feed'
  if (sch === BLUEBERRY_DOM_MAP_OVERLAY_SCHEMA) {
    return normalizeOverlayLayoutKind(v.layoutKind)
  }
  return null
}

const DISCUSSION_TEXT_KEYS = [
  'text',
  'body',
  'content',
  'message',
  'markdown',
] as const

/** First non-empty string among common LLM keys for thread nodes — used by overlay gating + UI. */
export function pickDiscussionNodeText(n: unknown): string {
  if (n === null || typeof n !== 'object') return ''
  const o = n as Record<string, unknown>
  for (const k of DISCUSSION_TEXT_KEYS) {
    const v = o[k]
    if (typeof v === 'string' && v.trim().length > 0) return v.trim()
  }
  return ''
}

/** Nested replies: models use `children` or `replies`. */
export function discussionReplyChildren(n: unknown): unknown[] {
  if (n === null || typeof n !== 'object') return []
  const o = n as Record<string, unknown>
  if (Array.isArray(o.children)) return o.children
  if (Array.isArray(o.replies)) return o.replies
  return []
}

/** True when the flattened payload has something worth rendering as a feed card. */
function flattenedFeedHasRenderableItems(r: FlattenedPageMapResult): boolean {
  const items = r.items
  if (!Array.isArray(items) || items.length === 0) return false
  return items.some(
    (it) =>
      (typeof it.title === 'string' && it.title.trim().length > 0) ||
      hrefish(it) ||
      (typeof it.summary === 'string' && it.summary.trim().length > 0) ||
      subitemsMeaningful(it),
  )
}

function articleBlockRenderable(b: unknown): boolean {
  if (b === null || typeof b !== 'object') return false
  const o = b as {
    text?: unknown
    src?: unknown
    image?: unknown
    img?: unknown
    href?: unknown
    url?: unknown
    link?: unknown
  }
  const t = o.text
  if (typeof t === 'string' && t.trim().length > 0) return true
  for (const k of ['src', 'image', 'img'] as const) {
    const v = o[k]
    if (typeof v === 'string' && v.trim().length > 0) return true
  }
  for (const k of ['href', 'url', 'link'] as const) {
    const v = o[k]
    if (typeof v === 'string' && v.trim().length > 0) return true
  }
  return false
}

function discussionTreeHasText(n: unknown): boolean {
  if (pickDiscussionNodeText(n)) return true
  return discussionReplyChildren(n).some(discussionTreeHasText)
}

/**
 * Models sometimes emit flattened HN/Reddit rows under layoutKind "discussion" with
 * no `text` / `children`. Treat those rows as overlay-worthy if they have feed-like
 * metadata (user, score, comments, non-vote links, etc.).
 */
function discussionMisparsedFeedLikeRow(n: unknown): boolean {
  if (n === null || typeof n !== 'object') return false
  const o = n as Record<string, unknown>
  if (typeof o.username === 'string' && o.username.trim().length > 0) return true
  if (typeof o.user === 'string' && o.user.trim().length > 0) return true
  if (typeof o.title === 'string' && o.title.trim().length > 0) return true
  if (typeof o.comments === 'string' && o.comments.trim().length > 0) return true
  if (typeof o.score === 'string' && o.score.trim().length > 0) return true
  if (typeof o.commentsUrl === 'string' && o.commentsUrl.trim().length > 0) return true
  for (const k of ['url', 'link', 'href'] as const) {
    const v = o[k]
    if (typeof v === 'string' && v.trim().length > 0) {
      if (!/\/vote\?/i.test(v)) return true
    }
  }
  return false
}

/**
 * True when an overlay / legacy-flattened map has content the main-area overlay should show
 * (versus staying on the loading mosaic).
 */
export function overlayPayloadHasRenderableMainContent(
  r: FlattenedPageMapResult | DomMapOverlayPageResult,
): boolean {
  const items = r.items
  if (!Array.isArray(items) || items.length === 0) return false
  const lk = overlayPayloadLayoutKind(r)
  if (lk === 'feed') {
    return flattenedFeedHasRenderableItems({
      ...(r as FlattenedPageMapResult),
      schema: 'blueberry-dom-map-flattened',
      items: items as FlattenedItem[],
    })
  }
  if (lk === 'article') return items.some(articleBlockRenderable)
  if (lk === 'discussion') {
    return items.some(
      (n) =>
        discussionTreeHasText(n) || discussionMisparsedFeedLikeRow(n),
    )
  }
  return false
}
