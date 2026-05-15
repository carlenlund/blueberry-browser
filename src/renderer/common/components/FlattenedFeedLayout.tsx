import { ExternalLink, User } from 'lucide-react'
import type { ReactNode } from 'react'

import type { FlattenedItem, FlattenedPageMapResult } from '../flattenedMap'
import { IncrementalReadMorePanel } from './IncrementalReadMorePanel'
import { QuickFeedLink } from './QuickFeedLink'

function pickFlattenedHref(it: FlattenedItem): string | undefined {
  const u = it.url ?? it.link ?? it.href
  if (typeof u === 'string' && u.trim()) return u.trim()
  return undefined
}

function pickFlattenedCommentsHref(it: FlattenedItem): string | undefined {
  const u = it.commentsUrl ?? it.commentsHref
  if (typeof u === 'string' && u.trim()) return u.trim()
  return undefined
}

function pickFlattenedUser(it: FlattenedItem): string | undefined {
  const x = it.username ?? it.user
  if (typeof x === 'string' && x.trim()) return x.trim()
  return undefined
}

/**
 * Feed flatteners sometimes emit site-relative hrefs without a leading `/` (e.g. `user?id=…`, `item?id=…`).
 * The overlay document has a different origin, so we resolve against the scraped page URL; if that fails,
 * a leading `/` makes the ref path-root–like so resolution behaves as on the original site.
 */
function resolveFlattenedHref(href: string, pageBase: string | undefined): string {
  const t = href.trim()
  if (!t) return t
  const base = pageBase?.trim()
  if (base) {
    try {
      return new URL(t, base).href
    } catch {
      /* use fallbacks below */
    }
  }
  if (!/^(?:[a-zA-Z][a-zA-Z+.-]*:|\/\/|\/|#|\?)/.test(t)) {
    return `/${t}`
  }
  return t
}

function FeedRowAnchor({
  behavior,
  href,
  className,
  children,
  onQuickFeedNavigate,
}: {
  behavior: 'external' | 'quickFeed'
  href: string
  className: string
  children: ReactNode
  onQuickFeedNavigate?: (url: string) => void
}) {
  if (behavior === 'quickFeed') {
    return (
      <QuickFeedLink
        href={href}
        className={className}
        onWillNavigate={onQuickFeedNavigate}
      >
        {children}
      </QuickFeedLink>
    )
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
    >
      {children}
    </a>
  )
}

/** Rich list for blueberry-dom-map-flattened feeds (title · url · score · user …). */
export function FlattenedFeedLayout({
  result,
  linkBehavior = 'external',
  variant = 'full',
  onQuickFeedLinkNavigate,
}: {
  result: FlattenedPageMapResult
  /** `quickFeed` uses in-app pipeline for primary + comment links (main feed overlay). */
  linkBehavior?: 'external' | 'quickFeed'
  /** `embedded` skips the page header (e.g. feed overlay chat turns). */
  variant?: 'full' | 'embedded'
  onQuickFeedLinkNavigate?: (url: string) => void
}) {
  const sourceUrl =
    typeof result.url === 'string' && result.url.trim().length > 0
      ? result.url.trim()
      : undefined

  const listPadding = variant === 'embedded' ? 'p-2' : 'p-3'

  return (
    <div
      className={`flex min-h-0 flex-1 flex-col ${variant === 'embedded' ? 'bg-transparent' : 'bg-background'}`}
    >
      {variant === 'full' ? (
        <div className="from-primary/[0.07] sticky top-0 z-10 shrink-0 border-b border-border bg-background/95 px-4 py-3 backdrop-blur-md bg-gradient-to-b to-transparent">
          <div className="flex flex-col gap-1">
            <span className="text-foreground text-sm font-semibold tracking-tight">
              {result.pageTitle ?? 'Feed'}
            </span>
            {sourceUrl ? (
              <FeedRowAnchor
                behavior={linkBehavior}
                href={sourceUrl}
                className="text-primary inline-flex max-w-full min-w-0 items-center gap-1 self-start truncate text-[11px] hover:underline"
                onQuickFeedNavigate={onQuickFeedLinkNavigate}
              >
                <ExternalLink className="size-3 shrink-0 opacity-70" aria-hidden />
                <span className="truncate">{sourceUrl}</span>
              </FeedRowAnchor>
            ) : null}
          </div>
          <p className="text-muted-foreground/80 m-0 mt-1.5 font-mono text-[9px]">
            blueberry-dom-map-flattened · {result.items.length} items
          </p>
        </div>
      ) : null}
      <IncrementalReadMorePanel
        expandMode="scaled"
        scaledStepScale={2}
        className={`flex min-h-0 flex-1 flex-col ${listPadding}`}
      >
        <div className="space-y-2">
        {result.items.map((it, idx) => {
          const rawHref = pickFlattenedHref(it)
          const rawCommentsHref = pickFlattenedCommentsHref(it)
          const href = rawHref
            ? resolveFlattenedHref(rawHref, sourceUrl)
            : undefined
          const commentsHref = rawCommentsHref
            ? resolveFlattenedHref(rawCommentsHref, sourceUrl)
            : undefined
          const title = typeof it.title === 'string' ? it.title : ''
          const user = pickFlattenedUser(it)
          const hasSub = Array.isArray(it.subitems) && it.subitems.length > 0

          const scoreUserRow = (
            <div className="text-foreground/68 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px]">
              {it.score ? (
                <span className="bg-background/90 text-foreground/95 border-border inline-flex rounded-md border px-2 py-0.5 font-mono text-[10px] font-medium tracking-tight">
                  {it.score}
                </span>
              ) : null}
              {user ? (
                <span className="inline-flex items-center gap-1">
                  <User className="size-3 opacity-60" aria-hidden />
                  <span className="truncate">{user}</span>
                </span>
              ) : null}
            </div>
          )

          const subitemsBlock = hasSub ? (
            <ul className="border-border/60 bg-background/40 divide-border/40 mt-1.5 divide-y rounded-md border px-3 py-0 text-[10px]">
              {it.subitems!.map((s, j) => (
                <li
                  key={s.id ?? `sub-${idx}-${j}`}
                  className="text-foreground/78 py-2 first:pt-1 last:pb-1"
                >
                  <span className="text-foreground/68 font-mono text-[9px]">
                    {s.t ?? '•'}
                  </span>
                  {s.label ? (
                    <span className="font-medium">{` ${s.label}`}</span>
                  ) : null}
                  {s.text ? (
                    <div className="text-foreground/78 mt-0.5 whitespace-pre-wrap">
                      {s.text}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null

          const indexBadge = (
            <span
              className="bg-primary/12 text-primary flex h-7 min-w-[1.75rem] shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums"
              aria-hidden
            >
              {idx + 1}
            </span>
          )

          const primaryBody = (
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="text-foreground group-hover/card-primary:underline line-clamp-2 text-[13px] font-semibold leading-snug tracking-tight">
                {title || href || 'No title'}
              </div>
              {href && title.trim() ? (
                <div className="text-primary/90 flex max-w-full items-center gap-1 truncate text-[10px] font-mono opacity-90">
                  <ExternalLink className="size-3 shrink-0" aria-hidden />
                  <span className="truncate">{href}</span>
                </div>
              ) : null}
              {scoreUserRow}
              {subitemsBlock}
            </div>
          )

          return (
            <article
              key={it.id ?? `feed-${idx}`}
              className="border-border/80 bg-muted/25 overflow-hidden rounded-lg border shadow-sm transition-colors hover:border-primary/25 has-[[data-feed-comments]:hover]:border-border/80"
            >
              {href ? (
                <>
                  <FeedRowAnchor
                    behavior={linkBehavior}
                    href={href}
                    className="group/card-primary text-foreground/82 hover:bg-muted/40 block cursor-pointer px-3 py-2.5 no-underline outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                    onQuickFeedNavigate={onQuickFeedLinkNavigate}
                  >
                    <div className="flex gap-3">
                      {indexBadge}
                      {primaryBody}
                    </div>
                  </FeedRowAnchor>
                  {commentsHref && commentsHref !== href ? (
                    <div
                      data-feed-comments
                      className="border-border/60 bg-muted/15 border-t px-3 py-2"
                    >
                      <FeedRowAnchor
                        behavior={linkBehavior}
                        href={commentsHref}
                        className="text-primary inline-flex max-w-full items-center gap-1 truncate text-[10px] no-underline underline-offset-2 hover:underline"
                        onQuickFeedNavigate={onQuickFeedLinkNavigate}
                      >
                        <ExternalLink
                          className="size-3 shrink-0 opacity-80"
                          aria-hidden
                        />
                        <span className="truncate">
                          {typeof it.comments === 'string' && it.comments.trim()
                            ? it.comments.trim()
                            : 'Comments'}
                        </span>
                      </FeedRowAnchor>
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="text-foreground/82 px-3 py-2.5">
                  <div className="flex gap-3">
                    {indexBadge}
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <span className="text-foreground line-clamp-2 text-[13px] font-semibold leading-snug">
                        {title || 'No title'}
                      </span>
                      {scoreUserRow}
                      {commentsHref ? (
                        <div data-feed-comments>
                          <FeedRowAnchor
                            behavior={linkBehavior}
                            href={commentsHref}
                            className="text-primary inline-flex max-w-full items-center gap-1 truncate text-[10px] no-underline underline-offset-2 hover:underline"
                            onQuickFeedNavigate={onQuickFeedLinkNavigate}
                          >
                            <ExternalLink
                              className="size-3 shrink-0 opacity-80"
                              aria-hidden
                            />
                            <span className="truncate">
                              {typeof it.comments === 'string' && it.comments.trim()
                                ? it.comments.trim()
                                : 'Comments'}
                            </span>
                          </FeedRowAnchor>
                        </div>
                      ) : null}
                      {subitemsBlock}
                    </div>
                  </div>
                </div>
              )}
            </article>
          )
        })}
        </div>
      </IncrementalReadMorePanel>
    </div>
  )
}
