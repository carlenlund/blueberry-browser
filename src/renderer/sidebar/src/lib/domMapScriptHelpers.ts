/**
 * Page-agnostic utilities passed into assistant-generated flatten scripts (`(input, H) => …`).
 * No site-specific selectors — only blueberry-dom-map-v4 keys.
 */
export type DomMapWalkerNode = {
  t?: string
  z?: string
  x?: string
  i?: string
  c?: string[]
  a?: Record<string, string>
  k?: DomMapWalkerNode[]
  w?: DomMapWalkerNode[]
  o?: number
}

function kids(n: DomMapWalkerNode | null | undefined): DomMapWalkerNode[] {
  if (n == null) return []
  const out: DomMapWalkerNode[] = []
  if (Array.isArray(n.k)) out.push(...n.k)
  if (Array.isArray(n.w)) out.push(...n.w)
  return out
}

function walkPre(
  n: DomMapWalkerNode | null | undefined,
  visit: (node: DomMapWalkerNode) => void,
): void {
  if (n == null) return
  visit(n)
  for (const c of kids(n)) walkPre(c, visit)
}

function findPreorder(
  n: DomMapWalkerNode | null | undefined,
  predicate: (node: DomMapWalkerNode) => boolean,
): DomMapWalkerNode | undefined {
  if (n == null) return undefined
  if (predicate(n)) return n
  for (const c of kids(n)) {
    const hit = findPreorder(c, predicate)
    if (hit) return hit
  }
  return undefined
}

function walkPost(
  n: DomMapWalkerNode | null | undefined,
  visit: (node: DomMapWalkerNode) => void,
): void {
  if (n == null) return
  for (const c of kids(n)) walkPost(c, visit)
  visit(n)
}

function nodeDirectText(n: DomMapWalkerNode | null | undefined): string | undefined {
  const x = n?.x
  return typeof x === 'string' && x.trim() !== '' ? x : undefined
}

function nodeAttrs(
  n: DomMapWalkerNode | null | undefined,
): Record<string, string> | undefined {
  const a = n?.a
  return a != null && typeof a === 'object' ? a : undefined
}

export type DomMapScriptHelpers = {
  children: typeof kids
  walkPreorder: typeof walkPre
  walkPostorder: typeof walkPost
  /**
   * Preorder traversal from `root` (including **`root`** in the predicate). Use with a **scoped root**
   * from \`findPreorder\`—e.g. a feature block's \`section\`—so you do not match rail headings elsewhere on the page.
   */
  collect: (
    root: DomMapWalkerNode | null | undefined,
    predicate: (node: DomMapWalkerNode) => boolean,
  ) => DomMapWalkerNode[]
  /** First node in the subtree (preorder, root included) that satisfies the predicate. */
  findPreorder: typeof findPreorder
  tag: (n: DomMapWalkerNode | null | undefined) => string
  /**
   * One argument: list of class names.
   * Two arguments: \`cls(n,'foo')\` === \`hasClass(n,'foo')\` (helps when models mix up the API).
   * **If you write \`if (H.cls(n))\` with one arg the condition is almost always true** (\`[]\` is truthy in JS — use \`hasClass\` or \`cls(n,'class')\`).
   */
  cls: (
    n: DomMapWalkerNode | null | undefined,
    mustInclude?: string,
  ) => string[] | boolean
  hasClass: (
    n: DomMapWalkerNode | null | undefined,
    name: string,
  ) => boolean
  text: typeof nodeDirectText
  /** Empty string when \`text\` has no meaningful direct text content. */
  textOrEmpty: (
    n: DomMapWalkerNode | null | undefined,
  ) => string
  /** Safe \`includes\` even when the node has no direct readable text. */
  textIncludes: (
    n: DomMapWalkerNode | null | undefined,
    substring: string,
  ) => boolean
  /**
   * Concatenate every direct \`x\` string in the subtree (preorder). Use for containers whose text
   * lives on descendants (e.g. Reddit \`.usertext-body\` → child \`p\` nodes).
   */
  textSubtree: (
    n: DomMapWalkerNode | null | undefined,
    joiner?: string,
  ) => string
  attrs: typeof nodeAttrs
  attr: (
    n: DomMapWalkerNode | null | undefined,
    key: string,
  ) => string | undefined
  interaction: (n: DomMapWalkerNode | null | undefined) => string | undefined
}

export const DOM_MAP_SCRIPT_HELPERS = Object.freeze({
  children: kids,
  walkPreorder: walkPre,
  walkPostorder: walkPost,
  collect(
    root: DomMapWalkerNode | null | undefined,
    predicate: (node: DomMapWalkerNode) => boolean,
  ): DomMapWalkerNode[] {
    const out: DomMapWalkerNode[] = []
    walkPre(root, (node) => {
      if (predicate(node)) out.push(node)
    })
    return out
  },
  findPreorder,
  tag(n) {
    return (n?.t ?? '?').toLowerCase()
  },
  cls(n: DomMapWalkerNode | null | undefined, mustInclude?: string) {
    const arr = Array.isArray(n?.c) ? n.c : []
    if (mustInclude !== undefined && typeof mustInclude === 'string') {
      return arr.includes(mustInclude)
    }
    return arr
  },
  hasClass(n, name) {
    return Array.isArray(n?.c) && n.c.includes(name)
  },
  text: nodeDirectText,
  textOrEmpty(n) {
    return nodeDirectText(n) ?? ''
  },
  textIncludes(n, substring) {
    return (nodeDirectText(n) ?? '').includes(substring)
  },
  textSubtree(n, joiner = '\n\n') {
    const parts: string[] = []
    walkPre(n, (node) => {
      const t = nodeDirectText(node)
      if (t) parts.push(t)
    })
    return parts.join(joiner)
  },
  attrs: nodeAttrs,
  attr(n, key) {
    const v = nodeAttrs(n)?.[key]
    return typeof v === 'string' ? v : undefined
  },
  interaction(n) {
    return typeof n?.z === 'string' ? n.z : undefined
  },
}) satisfies DomMapScriptHelpers
