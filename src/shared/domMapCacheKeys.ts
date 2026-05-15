/**
 * **Flatten scripts (disk + bundled):** strip **query** and **hash** so one snippet
 * applies to every `…/search?q=…` on the same path (see bundled Google flatten, which
 * reads `input.url` for the live query).
 *
 * **In-memory DOM scans:** use {@link domMapScanCacheKey} instead — SERP HTML differs
 * per query; reusing a scan keyed without `q` shows the wrong results.
 */
export function canonicalPageUrlForCache(raw: string): string | null {
  const t = typeof raw === 'string' ? raw.trim() : ''
  if (!t) return null
  try {
    const u = new URL(t)
    u.search = ''
    u.hash = ''
    return u.href
  } catch {
    return null
  }
}

export function domMapCacheKey(
  rawUrl: string,
  includeHiddenStructure: boolean,
): string | null {
  const c = canonicalPageUrlForCache(rawUrl)
  if (!c) return null
  return `${c}\u0000${includeHiddenStructure ? '1' : '0'}`
}

/** Session LRU for DOM map scans — keeps search params, strips hash only. */
export function canonicalPageUrlForScanMemory(raw: string): string | null {
  const t = typeof raw === 'string' ? raw.trim() : ''
  if (!t) return null
  try {
    const u = new URL(t)
    u.hash = ''
    return u.href
  } catch {
    return null
  }
}

export function domMapScanCacheKey(
  rawUrl: string,
  includeHiddenStructure: boolean,
): string | null {
  const c = canonicalPageUrlForScanMemory(rawUrl)
  if (!c) return null
  return `${c}\u0000${includeHiddenStructure ? '1' : '0'}`
}
