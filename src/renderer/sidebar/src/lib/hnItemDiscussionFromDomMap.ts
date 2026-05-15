import { BLUEBERRY_DOM_MAP_OVERLAY_SCHEMA } from '@common/flattenedMap'
import {
  DOM_MAP_SCRIPT_HELPERS as H,
  type DomMapWalkerNode,
} from './domMapScriptHelpers'

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

function hnStoryNumericId(pageUrl: string): string | null {
  try {
    const id = new URL(pageUrl.trim()).searchParams.get('id')
    return id != null && /^\d+$/.test(id) ? id : null
  } catch {
    return null
  }
}

function commentWalkerId(tr: DomMapWalkerNode): string | undefined {
  const i = typeof tr.i === 'string' ? tr.i.trim() : ''
  return /^\d+$/.test(i) ? i : undefined
}

function hnParentShortcutTargetId(tr: DomMapWalkerNode): string | undefined {
  const hit = H.findPreorder(tr, (n) =>
    H.tag(n) === 'a' &&
    H.textOrEmpty(n).trim() === 'parent' &&
    /^#\d+$/.test((H.attr(n, 'href') ?? '').trim()),
  )
  if (!hit) return undefined
  const frag = /^#(\d+)$/.exec((H.attr(hit, 'href') ?? '').trim())
  return frag?.[1]
}

function hnFirstReplyHref(tr: DomMapWalkerNode): string | undefined {
  const hit = H.findPreorder(tr, (n) =>
    H.tag(n) === 'a' &&
    /^reply\?id=\d+/i.test((H.attr(n, 'href') ?? '').trim()),
  )
  const h = hit ? H.attr(hit, 'href')?.trim() : undefined
  return h
}

function hnReplyHrefParentNumericId(replyHref: string): string | undefined {
  const m = /\bid=(\d+)/i.exec(replyHref.trim())
  return m?.[1]
}

/**
 * @returns `null` when this comment is a **thread root** (direct reply to story / lacks a nearer parent comment we can resolve).
 */
function inferHNCommentParentId(
  tr: DomMapWalkerNode,
  commentId: string,
  storyId: string,
): string | null {
  /** `parent` shortcut is always authoritative when present (`href="#482…"`). */
  const shortcut = hnParentShortcutTargetId(tr)
  if (shortcut != null && /^\d+$/.test(shortcut)) {
    if (shortcut === storyId) return null
    if (shortcut !== commentId) return shortcut
  }

  const replyHref = hnFirstReplyHref(tr)
  const replyPid = replyHref ? hnReplyHrefParentNumericId(replyHref) : undefined

  if (replyPid != null && /^\d+$/.test(replyPid)) {
    if (replyPid === storyId) return null
    if (replyPid !== commentId) return replyPid
  }

  return null
}

type MutableDiscussion = {
  username: string
  text: string
  children: MutableDiscussion[]
}

function finalizeDiscussionTrees(
  nodes: MutableDiscussion[],
): Record<string, unknown>[] {
  return nodes.map((n) => {
    const row: Record<string, unknown> = {}
    if (n.username.trim()) row.username = n.username
    if (n.text.trim()) row.text = n.text
    if (n.children.length > 0) {
      const ch = finalizeDiscussionTrees(n.children)
      if (ch.length > 0) row.children = ch
    }
    return row
  })
}

function commtextBody(commRoot: DomMapWalkerNode): string {
  const ps = H.collect(commRoot, (n) => H.tag(n) === 'p')
  const fromP = ps
    .map((p) => H.textOrEmpty(p).trim())
    .filter(Boolean)
    .join('\n\n')
  if (fromP) return fromP

  const bits: string[] = []
  const walk = (n: DomMapWalkerNode): void => {
    if (H.hasClass(n, 'reply')) return
    const x = typeof n.x === 'string' ? n.x.trim() : ''
    if (x) bits.push(x)
    for (const c of H.children(n)) walk(c as DomMapWalkerNode)
  }
  walk(commRoot)
  return bits.join('\n\n')
}

type RowDraft = {
  cid: string
  parentHint: string | null
  username: string
  text: string
}

/**
 * Walks the v4 DOM map for HN `/item?id=` pages: each `tr.athing.comtr` row is one comment
 * (`a.hnuser`, `div/span.commtext`). Threads use `reply?id=<parent>` + optional `parent` nav link —
 * reconstructed as nested `children` for `layoutKind:"discussion"` overlays.
 */
export function overlayDiscussionFromHackernewsItemDomMap(
  input: unknown,
): Record<string, unknown> | null {
  if (input == null || typeof input !== 'object') return null
  const o = input as Record<string, unknown>
  const url = typeof o.url === 'string' ? o.url.trim() : ''
  if (!isHackernewsItemDiscussionUrl(url)) return null
  const storyId = hnStoryNumericId(url)
  if (storyId == null) return null

  const tree = o.tree
  if (tree == null || typeof tree !== 'object') return null

  const commentRows = H.collect(tree as DomMapWalkerNode, (x) => {
    if (H.tag(x) !== 'tr') return false
    return H.hasClass(x, 'athing') && H.hasClass(x, 'comtr')
  })
  if (commentRows.length === 0) return null

  const drafts: RowDraft[] = []
  for (const tr of commentRows) {
    const cid = commentWalkerId(tr)
    if (!cid) continue

    const userEl = H.findPreorder(
      tr,
      (n) => H.tag(n) === 'a' && H.hasClass(n, 'hnuser'),
    )
    const username = userEl ? H.textOrEmpty(userEl).trim() : ''
    const commEl = H.findPreorder(tr, (n) => H.hasClass(n, 'commtext'))
    const text = commEl ? commtextBody(commEl).trim() : ''

    const parentHint = inferHNCommentParentId(tr, cid, storyId)

    drafts.push({ cid, parentHint, username, text })
  }

  /** Keep only rows we've seen with body or author (preserve DOM order inside `drafts`). */
  const visible = drafts.filter((d) => d.username.trim() || d.text.trim())
  if (visible.length === 0) return null

  const byId = new Map<string, MutableDiscussion>()
  for (const d of visible) {
    byId.set(d.cid, {
      username: d.username,
      text: d.text,
      children: [],
    })
  }

  const roots: MutableDiscussion[] = []

  for (const d of visible) {
    const node = byId.get(d.cid)!
    const pk = d.parentHint

    let parentNode: MutableDiscussion | undefined
    if (pk != null) parentNode = byId.get(pk)

    if (parentNode) parentNode.children.push(node)
    else roots.push(node)
  }

  const items = finalizeDiscussionTrees(roots)

  if (items.length === 0) return null

  const pageTitle = typeof o.pageTitle === 'string' ? o.pageTitle : ''
  return {
    ok: true,
    schema: BLUEBERRY_DOM_MAP_OVERLAY_SCHEMA,
    layoutKind: 'discussion',
    pageTitle,
    url,
    note: 'HN',
    items,
  }
}
