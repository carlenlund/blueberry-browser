import {
  BLUEBERRY_DOM_MAP_OVERLAY_SCHEMA,
  type ArticleOverlayBlock,
  type DiscussionOverlayNode,
  type DomMapOverlayPageResult,
  type FlattenedItem,
  type FlattenedPageMapResult,
  type OverlayLayoutKind,
} from '../flattenedMap'

export type ParsedFeedOverlayPayload =
  | (FlattenedPageMapResult & { layoutKind: 'feed' })
  | (DomMapOverlayPageResult & {
      layoutKind: 'article'
      items: ArticleOverlayBlock[]
    })
  | (DomMapOverlayPageResult & {
      layoutKind: 'discussion'
      items: DiscussionOverlayNode[]
    })

export function parseFeedOverlayPayload(
  payloadJson: string,
): ParsedFeedOverlayPayload | null {
  try {
    const o = JSON.parse(payloadJson) as Record<string, unknown>
    if (o == null || typeof o !== 'object' || o.ok !== true) return null
    if (!Array.isArray(o.items)) return null

    let layoutKind: OverlayLayoutKind | null = null
    if (o.schema === 'blueberry-dom-map-flattened') layoutKind = 'feed'
    else if (o.schema === BLUEBERRY_DOM_MAP_OVERLAY_SCHEMA) {
      const x = o.layoutKind
      if (typeof x === 'string') {
        const xl = x.trim().toLowerCase()
        if (xl === 'feed' || xl === 'article' || xl === 'discussion')
          layoutKind = xl as OverlayLayoutKind
      }
    }
    if (!layoutKind) return null

    if (layoutKind === 'feed') {
      return {
        ok: true,
        schema: 'blueberry-dom-map-flattened',
        pageTitle: typeof o.pageTitle === 'string' ? o.pageTitle : undefined,
        url: typeof o.url === 'string' ? o.url : undefined,
        note: typeof o.note === 'string' ? o.note : undefined,
        items: o.items as FlattenedItem[],
        layoutKind: 'feed',
      }
    }

    const base: DomMapOverlayPageResult = {
      ok: true,
      schema: BLUEBERRY_DOM_MAP_OVERLAY_SCHEMA,
      layoutKind,
      pageTitle: typeof o.pageTitle === 'string' ? o.pageTitle : undefined,
      url: typeof o.url === 'string' ? o.url : undefined,
      note: typeof o.note === 'string' ? o.note : undefined,
      items: o.items as unknown[],
    }

    if (layoutKind === 'article') {
      return {
        ...base,
        layoutKind: 'article',
        items: o.items as ArticleOverlayBlock[],
      }
    }

    return {
      ...base,
      layoutKind: 'discussion',
      items: o.items as DiscussionOverlayNode[],
    }
  } catch {
    return null
  }
}
