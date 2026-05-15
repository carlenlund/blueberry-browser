import { ArrowUp, ExternalLink } from 'lucide-react'
import type { RefObject } from 'react'
import { useCallback, useEffect, useState } from 'react'

import type { FlattenedPageMapResult } from '../flattenedMap'
import type { ParsedFeedOverlayPayload } from '../lib/feedOverlayPayload'
import { FlattenedFeedLayout } from './FlattenedFeedLayout'
import { FeedOverlayArticleBody } from './FeedOverlayArticle'
import { FeedOverlayDiscussionBody } from './FeedOverlayDiscussion'
import { QuickFeedLink } from './QuickFeedLink'

const SCROLL_UP_SHOW_PX = 32

/** One appended “turn” in the overlay chat: title row + feed / article / discussion body. */
export function FeedOverlayTurnContent({
  parsed,
  isDark,
  segmentId,
  scrollPortRef,
  onQuickFeedLinkNavigate,
}: {
  parsed: ParsedFeedOverlayPayload
  isDark: boolean
  /** When set with `scrollPortRef`, shows an up control after scrolling down in this card. */
  segmentId?: string
  scrollPortRef?: RefObject<HTMLDivElement | null>
  onQuickFeedLinkNavigate?: (url: string) => void
}) {
  const pageBase =
    typeof parsed.url === 'string' && parsed.url.trim()
      ? parsed.url.trim()
      : ''

  const fallbackTitle =
    parsed.layoutKind === 'article'
      ? 'Article'
      : parsed.layoutKind === 'discussion'
        ? 'Discussion'
        : 'Feed'

  const muted = isDark ? 'text-[rgb(161,161,161)]' : 'text-[rgb(115,115,115)]'
  const accent = isDark ? 'text-[rgb(200,200,200)]' : 'text-[rgb(30,30,30)]'

  const headerSticky =
    'sticky top-0 z-10 -mx-3 shrink-0 overflow-visible border-b border-border/40 px-3 py-2 backdrop-blur-md'

  const headerBg = isDark
    ? 'bg-[rgba(20,20,20,0.92)]'
    : 'bg-[rgba(255,255,255,0.94)]'

  const canScrollTrack =
    typeof segmentId === 'string' &&
    segmentId.length > 0 &&
    scrollPortRef !== undefined

  const [showScrollToTop, setShowScrollToTop] = useState(false)

  const updateScrollToTopAffordance = useCallback(() => {
    if (!canScrollTrack || !scrollPortRef?.current || !segmentId) {
      setShowScrollToTop(false)
      return
    }
    const root = scrollPortRef.current
    const seg = root.querySelector<HTMLElement>(
      `[data-feed-overlay-seg="${CSS.escape(segmentId)}"]`,
    )
    if (!seg) {
      setShowScrollToTop(false)
      return
    }
    const rootRect = root.getBoundingClientRect()
    const segRect = seg.getBoundingClientRect()
    const deltaTop = segRect.top - rootRect.top
    setShowScrollToTop(deltaTop < -SCROLL_UP_SHOW_PX)
  }, [canScrollTrack, scrollPortRef, segmentId])

  const scrollCardToTop = useCallback(() => {
    if (!scrollPortRef?.current || !segmentId) return
    const root = scrollPortRef.current
    const seg = root.querySelector<HTMLElement>(
      `[data-feed-overlay-seg="${CSS.escape(segmentId)}"]`,
    )
    if (!seg) return
    const dy = seg.getBoundingClientRect().top - root.getBoundingClientRect().top
    root.scrollBy({ top: dy, behavior: 'smooth' })
  }, [scrollPortRef, segmentId])

  useEffect(() => {
    if (!canScrollTrack) return
    updateScrollToTopAffordance()
    const root = scrollPortRef?.current
    if (!root || !segmentId) return
    const seg = root.querySelector<HTMLElement>(
      `[data-feed-overlay-seg="${CSS.escape(segmentId)}"]`,
    )
    const ro = new ResizeObserver(() => updateScrollToTopAffordance())
    if (seg) ro.observe(seg)
    ro.observe(root)
    root.addEventListener('scroll', updateScrollToTopAffordance, { passive: true })
    window.addEventListener('resize', updateScrollToTopAffordance)
    return () => {
      ro.disconnect()
      root.removeEventListener('scroll', updateScrollToTopAffordance)
      window.removeEventListener('resize', updateScrollToTopAffordance)
    }
  }, [canScrollTrack, scrollPortRef, segmentId, updateScrollToTopAffordance])

  const upBtnTint = isDark
    ? 'text-[rgb(161,161,161)] hover:bg-[rgb(50,50,50)] hover:text-[rgb(230,230,230)]'
    : 'text-[rgb(115,115,115)] hover:bg-[rgb(235,235,235)] hover:text-[rgb(25,25,25)]'

  return (
    <>
      <header className={`${headerSticky} ${headerBg}`}>
        <div className="relative min-w-0 flex flex-col gap-1">
          {showScrollToTop ? (
            <button
              type="button"
              className={`absolute z-20 -translate-x-full rounded-md p-1 -left-2 transition-colors ${upBtnTint}`}
              aria-label="Scroll to top of this card"
              title="Top of card"
              onClick={() => scrollCardToTop()}
            >
              <ArrowUp className="size-3 drop-shadow-sm" strokeWidth={2.25} aria-hidden />
            </button>
          ) : null}
          <span className="text-[13px] font-semibold">
            {parsed.pageTitle?.trim() || fallbackTitle}
          </span>
          {pageBase ? (
            <QuickFeedLink
              href={pageBase}
              className={`inline-flex max-w-full min-w-0 items-center gap-1 self-start truncate text-[10px] no-underline hover:underline ${accent}`}
              onWillNavigate={onQuickFeedLinkNavigate}
            >
              <ExternalLink className="size-3 shrink-0 opacity-70" aria-hidden />
              <span className="truncate">{pageBase}</span>
            </QuickFeedLink>
          ) : null}
        </div>
      </header>

      {parsed.layoutKind === 'feed' ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <FlattenedFeedLayout
            variant="embedded"
            linkBehavior="quickFeed"
            onQuickFeedLinkNavigate={onQuickFeedLinkNavigate}
            result={
              {
                ok: true,
                schema: 'blueberry-dom-map-flattened',
                pageTitle: parsed.pageTitle,
                url: parsed.url,
                note: parsed.note,
                items: parsed.items,
              } satisfies FlattenedPageMapResult
            }
          />
        </div>
      ) : parsed.layoutKind === 'article' ? (
        parsed.items.length === 0 ? (
          <p className={`p-6 text-center text-sm ${muted}`}>No items.</p>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <FeedOverlayArticleBody
              items={parsed.items}
              pageBase={pageBase}
              onQuickFeedLinkNavigate={onQuickFeedLinkNavigate}
            />
          </div>
        )
      ) : parsed.items.length === 0 ? (
        <p className={`p-6 text-center text-sm ${muted}`}>No items.</p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <FeedOverlayDiscussionBody items={parsed.items} />
        </div>
      )}
    </>
  )
}
