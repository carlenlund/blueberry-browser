/** Active / passive hint from DOM map scanner (z). */
export type DomMapKind = 'a' | 'p'

export type FlattenedSubitem = {
  id?: string
  label?: string
  text?: string
  t?: string
  z?: DomMapKind
  a?: Record<string, string>
}

export type FlattenedItem = {
  id?: string
  title?: string
  summary?: string
  z?: DomMapKind
  subitems?: FlattenedSubitem[]
  url?: string
  link?: string
  href?: string
  /** Permalink to the comment thread when it differs from the primary story URL. */
  commentsUrl?: string
  commentsHref?: string
  score?: string
  username?: string
  user?: string
  comments?: string
  age?: string
  site?: string
}

export type FlattenedPageMapResult = {
  ok: true
  schema: 'blueberry-dom-map-flattened'
  pageTitle?: string
  url?: string
  note?: string
  items: FlattenedItem[]
}

export const BLUEBERRY_DOM_MAP_OVERLAY_SCHEMA = 'blueberry-dom-map-overlay' as const

/** Main-area overlay layouts (LLM picks one per page). */
export type OverlayLayoutKind = 'feed' | 'article' | 'discussion'

export type ArticleOverlayBlock = {
  type?: string
  text?: string
  src?: string
  image?: string
  img?: string
  alt?: string
  caption?: string
  href?: string
  url?: string
  link?: string
}

export type DiscussionOverlayNode = {
  username?: string
  user?: string
  text?: string
  body?: string
  content?: string
  message?: string
  markdown?: string
  title?: string
  score?: string
  comments?: string
  url?: string
  link?: string
  href?: string
  commentsUrl?: string
  children?: DiscussionOverlayNode[]
  replies?: DiscussionOverlayNode[]
}

/** Unified envelope for quick-feed overlays (preferred). Legacy `FlattenedPageMapResult` still supported. */
export type DomMapOverlayPageResult = {
  ok: true
  schema: typeof BLUEBERRY_DOM_MAP_OVERLAY_SCHEMA
  layoutKind: OverlayLayoutKind
  pageTitle?: string
  url?: string
  note?: string
  /** Interpretation depends on `layoutKind`; client validates at runtime. */
  items: unknown[]
}
