import { BLUEBERRY_DOM_MAP_OVERLAY_SCHEMA } from '@common/flattenedMap'
import {
  DOM_MAP_SCRIPT_HELPERS as H,
  type DomMapWalkerNode,
} from './domMapScriptHelpers'

function isRedditThreadUrl(raw: string): boolean {
  try {
    const u = new URL(raw.trim())
    const h = u.hostname.replace(/^www\./i, '').toLowerCase()
    if (
      h !== 'reddit.com' &&
      h !== 'old.reddit.com' &&
      h !== 'new.reddit.com' &&
      h !== 'sh.reddit.com'
    ) {
      return false
    }
    return /\/r\/[^/]+\/comments\/[^/]+/i.test(u.pathname)
  } catch {
    return false
  }
}

function isOldRedditCommentThing(n: DomMapWalkerNode): boolean {
  if (H.tag(n) !== 'div') return false
  if (!H.hasClass(n, 'thing') || !H.hasClass(n, 'comment')) return false
  return H.attr(n, 'data-type') === 'comment'
}

function redditCommentBody(thing: DomMapWalkerNode): string {
  const bodyRoot = H.findPreorder(thing, (n) => H.hasClass(n, 'usertext-body'))
  if (!bodyRoot) return ''

  const blocks = H.collect(bodyRoot, (n) => {
    const t = H.tag(n)
    return (
      t === 'p' ||
      t === 'li' ||
      t === 'pre' ||
      t === 'h1' ||
      t === 'h2' ||
      t === 'h3' ||
      t === 'h4' ||
      t === 'h5' ||
      t === 'h6'
    )
  })
  const fromBlocks = blocks.map((b) => H.textOrEmpty(b).trim()).filter(Boolean)
  if (fromBlocks.length > 0) return fromBlocks.join('\n\n')

  const bits: string[] = []
  H.walkPreorder(bodyRoot, (node) => {
    const x = H.text(node)
    if (x && x.trim()) bits.push(x.trim())
  })
  return bits.join('\n\n')
}

function redditCommentUsername(thing: DomMapWalkerNode): string {
  const fromAttr = H.attr(thing, 'data-author')?.trim()
  if (fromAttr) return fromAttr
  const a = H.findPreorder(
    thing,
    (n) => H.tag(n) === 'a' && H.hasClass(n, 'author'),
  )
  return a ? H.textOrEmpty(a).trim() : ''
}

function redditReplyCommentThings(thing: DomMapWalkerNode): DomMapWalkerNode[] {
  for (const child of H.children(thing)) {
    if (H.tag(child) !== 'div' || !H.hasClass(child, 'child')) continue
    const listing = H.findPreorder(child, (n) => {
      if (H.tag(n) !== 'div' || !H.hasClass(n, 'sitetable')) return false
      return H.hasClass(n, 'listing') || H.hasClass(n, 'nestedlisting')
    })
    if (listing?.k?.length) {
      return listing.k.filter((n): n is DomMapWalkerNode =>
        isOldRedditCommentThing(n as DomMapWalkerNode),
      )
    }
  }
  return []
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

function parseRedditComment(thing: DomMapWalkerNode): MutableDiscussion | null {
  if (!isOldRedditCommentThing(thing)) return null
  const username = redditCommentUsername(thing)
  const text = redditCommentBody(thing)
  const children: MutableDiscussion[] = []
  for (const r of redditReplyCommentThings(thing)) {
    const ch = parseRedditComment(r)
    if (ch != null && (ch.username.trim() || ch.text.trim())) children.push(ch)
  }
  if (!username.trim() && !text.trim() && children.length === 0) return null
  return { username, text, children }
}

function findClassicNestedListingRoot(
  tree: DomMapWalkerNode,
): DomMapWalkerNode | undefined {
  const scope =
    H.findPreorder(tree, (n) => H.hasClass(n, 'commentarea')) ?? tree
  const byPostTable = H.findPreorder(
    scope,
    (n) =>
      typeof n.i === 'string' &&
      /^siteTable_t3_/.test(n.i) &&
      H.hasClass(n, 'sitetable') &&
      H.hasClass(n, 'nestedlisting'),
  )
  if (byPostTable) return byPostTable
  return H.findPreorder(
    scope,
    (n) =>
      H.tag(n) === 'div' &&
      H.hasClass(n, 'sitetable') &&
      H.hasClass(n, 'nestedlisting'),
  )
}

/**
 * old.reddit / classic reddit DOM: `.thing.comment` rows under `.sitetable.nestedlisting`,
 * bodies under `.usertext-body`, replies under `.child` > `.sitetable`.
 */
export function overlayDiscussionFromRedditThreadDomMap(
  input: unknown,
): Record<string, unknown> | null {
  if (input == null || typeof input !== 'object') return null
  const o = input as Record<string, unknown>
  const url = typeof o.url === 'string' ? o.url.trim() : ''
  if (!isRedditThreadUrl(url)) return null

  const tree = o.tree
  if (tree == null || typeof tree !== 'object') return null

  const listing = findClassicNestedListingRoot(tree as DomMapWalkerNode)
  if (listing?.k == null || !Array.isArray(listing.k)) return null

  const roots: MutableDiscussion[] = []
  for (const node of listing.k) {
    const thing = node as DomMapWalkerNode
    if (!isOldRedditCommentThing(thing)) continue
    const parsed = parseRedditComment(thing)
    if (parsed != null && (parsed.username.trim() || parsed.text.trim())) {
      roots.push(parsed)
    }
  }

  if (roots.length === 0) return null

  const items = finalizeDiscussionTrees(roots)
  const pageTitle = typeof o.pageTitle === 'string' ? o.pageTitle : ''

  return {
    ok: true,
    schema: BLUEBERRY_DOM_MAP_OVERLAY_SCHEMA,
    layoutKind: 'discussion',
    pageTitle,
    url,
    note: 'Reddit',
    items,
  }
}
