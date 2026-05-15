import { ArrowUp, Bot, Eye, Loader2, RotateCw } from 'lucide-react'
import { useLayoutEffect, useRef } from 'react'

import type { ParsedFeedOverlayPayload } from '../lib/feedOverlayPayload'
import { FeedOverlayLoading } from './FeedOverlayLoading'
import { FeedOverlayTurnContent } from './FeedOverlayTurnContent'

export type FeedOverlayChatSegment =
  | { id: string; kind: 'invalid' }
  | { id: string; kind: 'turn'; parsed: ParsedFeedOverlayPayload }
  | { id: string; kind: 'submittedQuery'; text: string }
  | {
      id: string
      kind: 'agentSummary'
      text: string
      iterationsUsed: number
    }
  | { id: string; kind: 'agentStatus'; text: string }

type FeedOverlayChatShellProps = {
  isDark: boolean
  entries: FeedOverlayChatSegment[]
  /** Shown below completed turns; cleared when a new result is appended. */
  inFlightLoading: boolean
  composerValue: string
  onComposerChange: (v: string) => void
  onComposerSubmit: () => void
  composerBusy: boolean
  onComposerAgentSubmit?: () => void
  composerAgentBusy?: boolean
  onQuickFeedLinkNavigate?: (url: string) => void
  /** Disables per-turn retry / eye while a retry IPC is in flight. */
  turnControlsBusy?: boolean
  onRetryQuickFeedTurn?: (url: string, segmentId: string) => void
}

const maxW = 'mx-auto w-full max-w-[min(30rem,calc(100vw-24px))]'

/** After Eye hides the overlay, reopen scrolls to this segment once. */
const FEED_OVERLAY_REOPEN_SCROLL_SEG_KEY = 'bb-feed-overlay-reopen-scroll-seg'

/** Guest tab URL for the eye control on map turns (`parsed.url`). */
function segmentTurnNavigateUrl(seg: FeedOverlayChatSegment): string | null {
  if (seg.kind !== 'turn') return null
  const u = seg.parsed.url
  return typeof u === 'string' && u.trim() ? u.trim() : null
}

/** True if the last segment is a new map turn preceded (somewhere after the prior turn) by a submitted URL bubble — e.g. `[turn, submittedQuery, turn]` from in-feed links. */
function tailTurnFollowsSubmittedNavigation(
  entries: FeedOverlayChatSegment[],
): boolean {
  const n = entries.length
  if (n < 2) return false
  const last = entries[n - 1]
  if (last.kind !== 'turn' && last.kind !== 'invalid') return false
  for (let i = n - 2; i >= 0; i--) {
    const e = entries[i]!
    if (e.kind === 'submittedQuery') return true
    if (e.kind === 'turn' || e.kind === 'invalid') return false
  }
  return false
}

function scrollSegmentToTopOfScrollRoot(
  scrollRoot: HTMLElement,
  segmentId: string,
  behavior: ScrollBehavior,
): void {
  const row = scrollRoot.querySelector<HTMLElement>(
    `[data-feed-overlay-seg="${CSS.escape(segmentId)}"]`,
  )
  if (!row) return
  const rootRect = scrollRoot.getBoundingClientRect()
  const rowRect = row.getBoundingClientRect()
  const top = rowRect.top - rootRect.top + scrollRoot.scrollTop
  scrollRoot.scrollTo({ top: Math.max(0, top), behavior })
}

function openInTabAndHideFeedOverlay(url: string, segmentId: string): void {
  const t = url.trim()
  if (!t) return
  try {
    sessionStorage.setItem(FEED_OVERLAY_REOPEN_SCROLL_SEG_KEY, segmentId)
  } catch {
    /* ignore */
  }
  const api = window.feedOverlayAPI
  if (typeof api?.navigateActiveTabToUrl === 'function') {
    void api.navigateActiveTabToUrl(t)
  }
  if (typeof api?.setFeedLayoutOverlayEnabled === 'function') {
    void api.setFeedLayoutOverlayEnabled(false)
  }
}

function FeedOverlayRetryButton({
  url,
  segmentId,
  isDark,
  disabled,
  onRetry,
}: {
  url: string
  segmentId: string
  isDark: boolean
  disabled: boolean
  onRetry?: (url: string, segmentId: string) => void
}) {
  const btnTint = isDark
    ? 'text-[rgb(161,161,161)] hover:bg-[rgb(50,50,50)] hover:text-[rgb(230,230,230)]'
    : 'text-[rgb(115,115,115)] hover:bg-[rgb(235,235,235)] hover:text-[rgb(25,25,25)]'
  return (
    <button
      type="button"
      disabled={disabled || !onRetry}
      className={`shrink-0 rounded-md p-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${btnTint}`}
      aria-label="Clear cached flatten script and regenerate feed for this page"
      title="Regenerate feed (forget cached script, re-run pipeline)"
      onClick={() => {
        onRetry?.(url, segmentId)
      }}
    >
      <RotateCw className="size-4" strokeWidth={1.75} aria-hidden />
    </button>
  )
}

function FeedOverlayEyeOpenButton({
  url,
  segmentId,
  isDark,
  disabled,
}: {
  url: string
  segmentId: string
  isDark: boolean
  disabled?: boolean
}) {
  const btnTint = isDark
    ? 'text-[rgb(161,161,161)] hover:bg-[rgb(50,50,50)] hover:text-[rgb(230,230,230)]'
    : 'text-[rgb(115,115,115)] hover:bg-[rgb(235,235,235)] hover:text-[rgb(25,25,25)]'
  return (
    <button
      type="button"
      disabled={disabled}
      className={`shrink-0 rounded-md p-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${btnTint}`}
      aria-label="Open page in tab and hide feed overlay"
      title="Open in tab and hide overlay"
      onClick={() => {
        openInTabAndHideFeedOverlay(url, segmentId)
      }}
    >
      <Eye className="size-4" strokeWidth={1.75} aria-hidden />
    </button>
  )
}

export function FeedOverlayChatShell({
  isDark,
  entries,
  inFlightLoading,
  composerValue,
  onComposerChange,
  onComposerSubmit,
  composerBusy,
  onComposerAgentSubmit,
  composerAgentBusy = false,
  onQuickFeedLinkNavigate,
  turnControlsBusy = false,
  onRetryQuickFeedTurn,
}: FeedOverlayChatShellProps) {
  const scrollPortRef = useRef<HTMLDivElement>(null)
  /** Bumped each `entries` commit so deferred smooth-scroll rAFs do not run after a newer commit (e.g. tail turn scroll). */
  const scrollTargetGenRef = useRef(0)
  const lastScrolledSubmittedIdRef = useRef<string | null>(null)
  /** After a submitted-URL bubble, scroll once to the new tail turn (handles in-feed links: `…, turn, submittedQuery, turn`). */
  const lastScrolledTurnAfterQueryIdRef = useRef<string | null>(null)

  const anyComposerBusy = composerBusy || composerAgentBusy

  const idleWelcome =
    entries.length === 0 && !inFlightLoading && !anyComposerBusy
  /** Big loading card: only before first turn when main pipeline runs; with turns, include composer busy. */
  const showBigInFlightCard =
    entries.length === 0 ? inFlightLoading : inFlightLoading || anyComposerBusy

  useLayoutEffect(() => {
    if (entries.length === 0) return
    let segmentId: string | null = null
    try {
      segmentId = sessionStorage.getItem(FEED_OVERLAY_REOPEN_SCROLL_SEG_KEY)
    } catch {
      return
    }
    if (!segmentId || !entries.some((e) => e.id === segmentId)) {
      if (segmentId) {
        try {
          sessionStorage.removeItem(FEED_OVERLAY_REOPEN_SCROLL_SEG_KEY)
        } catch {
          /* ignore */
        }
      }
      return
    }
    const root = scrollPortRef.current
    if (!root) return
    scrollSegmentToTopOfScrollRoot(root, segmentId, 'auto')
    try {
      sessionStorage.removeItem(FEED_OVERLAY_REOPEN_SCROLL_SEG_KEY)
    } catch {
      /* ignore */
    }
  }, [entries])

  useLayoutEffect(() => {
    if (entries.length === 0) return
    scrollTargetGenRef.current += 1
    const gen = scrollTargetGenRef.current
    const root = scrollPortRef.current
    if (!root) return

    const last = entries[entries.length - 1]

    const scrollSeg = (segmentId: string, behavior: ScrollBehavior): void => {
      const run = (): void => {
        if (scrollTargetGenRef.current !== gen) return
        scrollSegmentToTopOfScrollRoot(root, segmentId, behavior)
      }
      if (behavior === 'smooth') {
        requestAnimationFrame(() => requestAnimationFrame(run))
      } else {
        run()
      }
    }

    if (
      (last.kind === 'turn' || last.kind === 'invalid') &&
      tailTurnFollowsSubmittedNavigation(entries)
    ) {
      if (lastScrolledTurnAfterQueryIdRef.current === last.id) return
      lastScrolledTurnAfterQueryIdRef.current = last.id
      scrollSeg(last.id, 'auto')
      return
    }

    if (last.kind === 'submittedQuery' || last.kind === 'agentSummary' || last.kind === 'agentStatus') {
      if (lastScrolledSubmittedIdRef.current === last.id) return
      lastScrolledSubmittedIdRef.current = last.id
      scrollSeg(last.id, 'smooth')
    }
  }, [entries])

  const shell =
    'flex h-10 min-w-0 flex-1 items-center gap-2 rounded-full border border-border bg-background px-3 dark:bg-secondary/40'

  const muted = isDark ? 'text-[rgb(161,161,161)]' : 'text-[rgb(115,115,115)]'

  const composerForm = (
    <form
      className={`flex w-full min-w-0 gap-1.5 ${maxW}`}
      onSubmit={(e) => {
        e.preventDefault()
        onComposerSubmit()
      }}
    >
      <div className={shell}>
        <input
          type="text"
          value={composerValue}
          onChange={(e) => onComposerChange(e.target.value)}
          className="text-foreground placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent py-0.5 text-sm outline-none"
          placeholder="Search on Google or enter a web address"
          disabled={anyComposerBusy}
          spellCheck={false}
          aria-label="Quick feed URL"
          autoFocus
        />
        {anyComposerBusy ? (
          <Loader2
            className="text-muted-foreground size-4 shrink-0 animate-spin"
            aria-hidden
          />
        ) : null}
      </div>
      <button
        type="submit"
        disabled={anyComposerBusy || !composerValue.trim()}
        className="flex items-center justify-center text-foreground bg-primary/30 hover:bg-primary/35 shrink-0 rounded-full w-10 h-10 disabled:opacity-40"
        aria-label="Open quick feed for this URL or search"
      >
        <ArrowUp className="size-5" />
      </button>
      <button
        type="button"
        disabled={anyComposerBusy || !onComposerAgentSubmit}
        className="flex items-center justify-center text-foreground border border-border bg-primary/18 hover:bg-primary/24 shrink-0 rounded-full w-10 h-10 disabled:opacity-40"
        aria-label="Page agent: use LLM to query this page"
        title="Page agent (LLM): run scripts and navigate on the active tab, up to 6 steps"
        onClick={() => onComposerAgentSubmit?.()}
      >
        <Bot className="size-5" strokeWidth={1.85} />
      </button>
    </form>
  )

  const rootTint = isDark
    ? 'bg-[rgba(20,20,20,0.92)] text-[rgb(250,250,250)]'
    : 'bg-[rgba(255,255,255,0.94)] text-[rgb(20,20,20)]'

  const scrollScheme = isDark ? '[color-scheme:dark]' : '[color-scheme:light]'

  if (entries.length === 0) {
    return (
      <div
        className={`fixed inset-0 z-[2147483646] box-border flex min-h-0 flex-col font-sans ${rootTint} backdrop-blur-md`}
      >
        <div
          className={`flex min-h-0 flex-1 flex-col justify-center px-3 py-8 ${scrollScheme}`}
        >
          <div className={`${maxW} flex min-w-0 flex-col gap-8`}>
            {idleWelcome ? (
              <p
                className={`m-0 text-center text-base font-medium tracking-tight ${muted}`}
              >
                I am ready.
              </p>
            ) : null}
            {inFlightLoading ? (
              <div className="flex justify-center py-2" aria-busy="true" aria-live="polite">
                <FeedOverlayLoading isDark={isDark} />
              </div>
            ) : null}
            {composerForm}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className={`fixed inset-0 z-[2147483646] box-border flex flex-col font-sans ${rootTint} backdrop-blur-md`}
    >
      {/* Full-width scrollport so the scrollbar sits at the overlay right edge, not beside the narrow column */}
      <div
        ref={scrollPortRef}
        className={`min-h-0 w-full flex-1 overflow-y-auto ${scrollScheme}`}
      >
        <div className={`${maxW} min-w-0 px-3 py-3`}>
          {entries.map((seg) => {
            if (seg.kind === 'submittedQuery') {
              return (
                <div
                  key={seg.id}
                  data-feed-overlay-seg={seg.id}
                  className={`mt-9 mb-3 ml-[40%] max-w-full rounded-full py-3 pl-3 ${
                    isDark
                      ? 'bg-neutral-700'
                      : 'bg-gray-200'
                  }`}
                >
                  <p
                    className={`m-0 truncate text-sm leading-snug ${
                      isDark ? 'text-[rgb(200,200,200)]' : 'text-[rgb(55,55,55)]'
                    }`}
                    title={seg.text}
                  >
                    {seg.text}
                  </p>
                </div>
              )
            }
            if (seg.kind === 'agentStatus') {
              return (
                <div
                  key={seg.id}
                  data-feed-overlay-seg={seg.id}
                  className={`mb-2 max-w-full rounded-lg px-3 py-2 ${
                    isDark ? 'bg-neutral-800/50' : 'bg-gray-100'
                  }`}
                >
                  <p
                    className={`m-0 text-xs leading-relaxed ${
                      isDark
                        ? 'text-[rgb(180,180,180)]'
                        : 'text-[rgb(80,80,80)]'
                    }`}
                  >
                    {seg.text}
                  </p>
                </div>
              )
            }
            if (seg.kind === 'agentSummary') {
              return (
                <div
                  key={seg.id}
                  data-feed-overlay-seg={seg.id}
                  className={`mb-3 max-w-full rounded-2xl border px-3 py-3 ${
                    isDark
                      ? 'border-neutral-600 bg-neutral-800/80'
                      : 'border-gray-200 bg-gray-50'
                  }`}
                >
                  <p
                    className={`m-0 whitespace-pre-wrap text-sm leading-snug ${
                      isDark
                        ? 'text-[rgb(230,230,230)]'
                        : 'text-[rgb(35,35,35)]'
                    }`}
                  >
                    {seg.text}
                  </p>
                </div>
              )
            }
            const navigateUrl = segmentTurnNavigateUrl(seg)
            return (
              <div
                key={seg.id}
                data-feed-overlay-seg={seg.id}
                className="mb-4 flex w-full max-w-full items-start gap-1.5"
              >
                {/* No overflow-hidden here — it breaks sticky headers inside turns (sticky needs visible overflow chain to the scrollport). */}
                <div className="min-w-0 flex-1">
                  <article className="m-0 border-0 bg-transparent p-0 shadow-none">
                    {seg.kind === 'invalid' ? (
                      <p className={`py-2 text-center text-sm ${muted}`}>
                        Invalid or unsupported overlay payload.
                      </p>
                    ) : (
                      <FeedOverlayTurnContent
                        parsed={seg.parsed}
                        isDark={isDark}
                        segmentId={seg.id}
                        scrollPortRef={scrollPortRef}
                        onQuickFeedLinkNavigate={onQuickFeedLinkNavigate}
                      />
                    )}
                  </article>
                </div>
                {navigateUrl ? (
                  <div className="flex shrink-0 items-start gap-0.5">
                    <FeedOverlayRetryButton
                      url={navigateUrl}
                      segmentId={seg.id}
                      isDark={isDark}
                      disabled={turnControlsBusy}
                      onRetry={onRetryQuickFeedTurn}
                    />
                    <FeedOverlayEyeOpenButton
                      url={navigateUrl}
                      segmentId={seg.id}
                      isDark={isDark}
                      disabled={turnControlsBusy}
                    />
                  </div>
                ) : null}
              </div>
            )
          })}
          {showBigInFlightCard ? (
            <div
              className={`flex justify-center py-8 ${
                entries.length > 0 ? 'mb-[25vh]' : 'mb-4'
              }`}
              aria-busy="true"
              aria-live="polite"
            >
              <FeedOverlayLoading isDark={isDark} />
            </div>
          ) : null}
        </div>
      </div>

      <div
        className={`shrink-0 px-3 py-3 pb-7 bg-background/90 backdrop-blur-sm`}
      >
        {composerForm}
      </div>
    </div>
  )
}
