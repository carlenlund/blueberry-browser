import { domMapCacheKey } from './domMapCacheKeys'

/**
 * Shipped flatten for Google web search. Cache key has **no** query string; this reads
 * `input.url` (full page URL from the DOM map, including `?q=`) to branch behavior.
 */
const FLATTEN_GOOGLE_WEB_SEARCH = `(input, H) => {
  let q = "";
  try {
    q = (new URL(input.url || "https://www.google.com/")).searchParams.get("q") || "";
  } catch (e) {
    q = "";
  }
  const ql = q.toLowerCase();
  const base = input.url || "https://www.google.com/";

  const allTr = H.collect(input.tree, (x) => H.tag(x) === "tr");
  const items = [];
  for (let i = 0; i < allTr.length; i++) {
    const row = allTr[i];
    const titleLink = H.findPreorder(
      row,
      (n) => H.tag(n) === "a" && H.text(n).trim(),
    );
    if (!titleLink) continue;
    const title = H.text(titleLink).trim();
    const href = H.attr(titleLink, "href");
    const url = href ? new URL(href, base).href : undefined;
    items.push({ title, url });
  }
  const note = "Google search results";
  return {
    ok: true,
    schema: "blueberry-dom-map-overlay",
    layoutKind: "feed",
    pageTitle: input.pageTitle || "",
    url: input.url || "",
    note,
    items,
  };
}`

const GOOGLE_SEARCH_CANONICAL_URLS = [
  'https://www.google.com/search',
  'https://google.com/search',
  'https://www.google.co.uk/search',
]

let bundledByCacheKey: Record<string, string> | null = null

function ensureBundledMap(): Record<string, string> {
  if (bundledByCacheKey) return bundledByCacheKey
  const m: Record<string, string> = {}
  for (const u of GOOGLE_SEARCH_CANONICAL_URLS) {
    const k = domMapCacheKey(u, false)
    if (k) m[k] = FLATTEN_GOOGLE_WEB_SEARCH
  }
  bundledByCacheKey = m
  return m
}

/** @returns script source or \`null\` if this app build has no bundle for the key. */
export function getBundledDomMapFlattenScript(cacheKey: string): string | null {
  return ensureBundledMap()[cacheKey] ?? null
}
