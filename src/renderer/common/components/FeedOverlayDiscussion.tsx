import type { ReactNode } from 'react'

import type { DiscussionOverlayNode } from '../flattenedMap'
import { IncrementalReadMorePanel } from './IncrementalReadMorePanel'

function pickUser(n: DiscussionOverlayNode): string {
  const x = n.username ?? n.user
  return typeof x === 'string' ? x.trim() : ''
}

function pickHref(n: DiscussionOverlayNode): string {
  const u = n.url ?? n.link ?? n.href
  return typeof u === 'string' ? u.trim() : ''
}

function pickDiscussionNodeText(n: DiscussionOverlayNode): string {
  for (const k of ['text', 'body', 'content', 'message', 'markdown'] as const) {
    const v = n[k]
    if (typeof v === 'string' && v.replace(/^\s+|\s+$/g, '').length)
      return v.replace(/^\s+|\s+$/g, '')
  }
  return ''
}

function discussionReplyChildren(n: DiscussionOverlayNode): DiscussionOverlayNode[] {
  if (Array.isArray(n.children)) return n.children
  if (Array.isArray(n.replies)) return n.replies as DiscussionOverlayNode[]
  return []
}

function discussionFallbackLine(n: DiscussionOverlayNode): string {
  const parts: string[] = []
  if (typeof n.title === 'string' && n.title.replace(/^\s+|\s+$/g, '').length)
    parts.push(n.title.replace(/^\s+|\s+$/g, ''))
  if (typeof n.score === 'string' && n.score.replace(/^\s+|\s+$/g, '').length)
    parts.push(n.score.replace(/^\s+|\s+$/g, ''))
  if (typeof n.comments === 'string' && n.comments.replace(/^\s+|\s+$/g, '').length)
    parts.push(n.comments.replace(/^\s+|\s+$/g, ''))
  const h = pickHref(n)
  if (h) {
    const hs = String(h)
    if (!hs.includes('/vote?') && !hs.includes('how=up')) parts.push(hs)
  }
  const cu = n.commentsUrl
  if (typeof cu === 'string' && cu.trim()) {
    const ct = cu.trim()
    if (!h || ct !== String(h).trim()) parts.push(ct)
  }
  return parts.join(' · ')
}

function DiscussionWalk({
  nodes,
  marginLeft,
  depth,
}: {
  nodes: DiscussionOverlayNode[]
  marginLeft: number
  depth: number
}): ReactNode {
  if (!Array.isArray(nodes) || depth > 42) return null
  return (
    <>
      {nodes.map((node, i) => {
        if (node == null || typeof node !== 'object') return null
        const raw = pickDiscussionNodeText(node)
        const fb = discussionFallbackLine(node)
        const display = raw || fb
        const usr = pickUser(node)
        const kids = discussionReplyChildren(node)
        const showLine = display || usr
        const line = display || (usr ? '\u2014' : '')
        if (!showLine && kids.length === 0) return null
        const nextMargin = marginLeft + (showLine ? 14 : 0)
        return (
          <div key={i}>
            {showLine ? (
              <div
                className="bg-muted/65 border-border mb-2 rounded-lg border px-2.5 py-2"
                style={{ marginLeft }}
              >
                {usr ? (
                  <div className="text-primary mb-1 text-[11px] font-bold">{usr}</div>
                ) : null}
                {display ? (
                  <div className="text-foreground whitespace-pre-wrap text-[13px] leading-snug">
                    {line}
                  </div>
                ) : null}
              </div>
            ) : null}
            <DiscussionWalk nodes={kids} marginLeft={nextMargin} depth={depth + 1} />
          </div>
        )
      })}
    </>
  )
}

export function FeedOverlayDiscussionBody({
  items,
}: {
  items: DiscussionOverlayNode[]
}) {
  return (
    <IncrementalReadMorePanel
      expandMode="scaled"
      scaledStepScale={4}
      scaledStepCurve="exponential"
      className="flex min-h-0 flex-1 flex-col py-2"
    >
      <DiscussionWalk nodes={items} marginLeft={0} depth={0} />
    </IncrementalReadMorePanel>
  )
}
