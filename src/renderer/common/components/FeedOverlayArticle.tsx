import type { ArticleOverlayBlock } from '../flattenedMap'
import { IncrementalReadMorePanel } from './IncrementalReadMorePanel'
import { QuickFeedLink } from './QuickFeedLink'

function resolveUrlMaybe(u: string, base: string): string {
  const t = u.trim()
  if (!t) return ''
  if (!base) return t
  try {
    return new URL(t, base).href
  } catch {
    return t
  }
}

function pickArticleHref(b: ArticleOverlayBlock): string {
  const h = b.href ?? b.url ?? b.link
  return typeof h === 'string' ? h.trim() : ''
}

function pickImgSrc(b: ArticleOverlayBlock): string {
  const s = b.src ?? b.image ?? b.img
  return typeof s === 'string' ? s.trim() : ''
}

export function FeedOverlayArticleBody({
  items,
  pageBase,
  onQuickFeedLinkNavigate,
}: {
  items: ArticleOverlayBlock[]
  pageBase: string
  onQuickFeedLinkNavigate?: (url: string) => void
}) {
  return (
    <IncrementalReadMorePanel
      expandMode="scaled"
      scaledStepScale={4}
      scaledStepCurve="exponential"
      className="flex min-h-0 flex-1 flex-col py-2"
    >
      <div className="flex flex-col gap-2">
      {items.map((blk, idx) => {
        if (blk == null || typeof blk !== 'object') return null
        const imgSrc = pickImgSrc(blk)
        if (imgSrc) {
          const absImg = resolveUrlMaybe(imgSrc, pageBase) || imgSrc
          const altStr =
            typeof blk.alt === 'string'
              ? blk.alt.trim()
              : typeof blk.text === 'string'
                ? blk.text.trim()
                : ''
          const capFrom =
            typeof blk.caption === 'string'
              ? blk.caption.trim()
              : typeof blk.text === 'string' &&
                  blk.text.trim() &&
                  blk.text.trim() !== altStr
                ? blk.text.trim()
                : ''
          return (
            <figure key={idx} className="mt-3 first:mt-0">
              <img
                src={absImg}
                alt={altStr}
                draggable={false}
                decoding="async"
                loading="lazy"
                referrerPolicy="no-referrer"
                className="mx-0 block w-auto max-w-full rounded-lg"
              />
              {capFrom ? (
                <figcaption className="text-foreground/76 mt-1.5 text-[11px] leading-snug">
                  {capFrom}
                </figcaption>
              ) : null}
            </figure>
          )
        }

        const tySrc = blk.type
        const ty0 =
          typeof tySrc === 'string' ? tySrc.replace(/^\s+|\s+$/g, '').toLowerCase() : ''
        const ty = ty0 || 'p'
        const text =
          typeof blk.text === 'string' ? blk.text.replace(/^\s+|\s+$/g, '') : ''
        const hrefRaw = pickArticleHref(blk)
        const href = hrefRaw ? resolveUrlMaybe(hrefRaw, pageBase) : ''
        if (!text && !href) return null

        if (href && (ty === 'a' || ty === 'button')) {
          return (
            <QuickFeedLink
              key={idx}
              href={href || hrefRaw}
              className="text-primary mt-2.5 inline-block text-[13px] underline first:mt-0"
              onWillNavigate={onQuickFeedLinkNavigate}
            >
              {text || hrefRaw || href}
            </QuickFeedLink>
          )
        }

        if (ty === 'li') {
          return (
            <div
              key={idx}
              className="text-foreground/82 mt-1.5 flex gap-2 text-[13px] leading-snug first:mt-0"
            >
              <span className="shrink-0 opacity-55" aria-hidden>
                •
              </span>
              <div className="min-w-0 flex-1 whitespace-pre-wrap">
                {href && text ? (
                  <QuickFeedLink
                    href={href || hrefRaw}
                    className="text-primary underline"
                    onWillNavigate={onQuickFeedLinkNavigate}
                  >
                    {text}
                  </QuickFeedLink>
                ) : (
                  text
                )}
              </div>
            </div>
          )
        }

        const Tag =
          ty === 'h1'
            ? 'h1'
            : ty === 'h2'
              ? 'h2'
              : ty === 'h3'
                ? 'h3'
                : ty === 'blockquote'
                  ? 'blockquote'
                  : 'p'
        const fz =
          ty === 'h1' ? 'text-[22px]' : ty === 'h2' ? 'text-lg' : ty === 'h3' ? 'text-[15px]' : 'text-[13px]'
        const fw =
          ty === 'h1' || ty === 'h2' || ty === 'h3' ? 'font-bold' : 'font-normal'
        const proseTone =
          ty === 'h1' || ty === 'h2' || ty === 'h3'
            ? 'text-foreground'
            : 'text-foreground/80'
        const quote =
          ty === 'blockquote'
            ? 'border-l-[3px] border-primary bg-muted/30 rounded-r-lg py-2.5 pl-3 pr-3'
            : ''

        return (
          <Tag
            key={idx}
            className={`${proseTone} mt-2.5 leading-snug first:mt-0 ${fz} ${fw} ${quote}`}
          >
            {href ? (
              <QuickFeedLink
                href={href || hrefRaw}
                className="text-inherit underline decoration-inherit"
                onWillNavigate={onQuickFeedLinkNavigate}
              >
                {text || hrefRaw || href}
              </QuickFeedLink>
            ) : (
              text
            )}
          </Tag>
        )
      })}
      </div>
    </IncrementalReadMorePanel>
  )
}
