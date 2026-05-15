import {
  domMapCacheKey,
  domMapScanCacheKey,
} from '@shared/domMapCacheKeys'
import { getBundledDomMapFlattenScript } from '@shared/bundledDomMapFlattenScripts'

export {
  canonicalPageUrlForCache,
  canonicalPageUrlForScanMemory,
  domMapCacheKey,
  domMapScanCacheKey,
} from '@shared/domMapCacheKeys'

/** In-memory LRU for DOM scan JSON only (session). Disk cache stores flatten JS only. */
const MAX_SCAN_ENTRIES = 64

function mapSetLru(m: Map<string, string>, k: string, v: string): void {
  if (m.has(k)) m.delete(k)
  m.set(k, v)
  while (m.size > MAX_SCAN_ENTRIES) {
    const first = m.keys().next().value
    if (first === undefined) break
    m.delete(first)
  }
}

function mapGetLru(m: Map<string, string>, k: string): string | undefined {
  const v = m.get(k)
  if (v === undefined) return undefined
  m.delete(k)
  m.set(k, v)
  return v
}

const scanJsonByKey = new Map<string, string>()

function api() {
  return window.sidebarAPI
}

export function peekCachedDomMapScanJson(
  rawUrl: string,
  includeHiddenStructure: boolean,
): string | null {
  const key = domMapScanCacheKey(rawUrl, includeHiddenStructure)
  if (!key) return null
  const json = mapGetLru(scanJsonByKey, key)
  return json ?? null
}

export function rememberDomMapScanJson(
  rawUrl: string,
  includeHiddenStructure: boolean,
  scanJson: string,
): void {
  const key = domMapScanCacheKey(rawUrl, includeHiddenStructure)
  if (!key) return
  mapSetLru(scanJsonByKey, key, scanJson)
}

export async function peekCachedFlattenScript(
  rawUrl: string,
  includeHiddenStructure: boolean,
): Promise<string | null> {
  const key = domMapCacheKey(rawUrl, includeHiddenStructure)
  if (!key) return null
  const bundled = getBundledDomMapFlattenScript(key)
  if (bundled) return bundled
  const a = api()
  if (typeof a?.domMapCachePeekFlatten !== 'function') return null
  const v = await a.domMapCachePeekFlatten(rawUrl, includeHiddenStructure)
  return typeof v === 'string' ? v : null
}

export async function rememberFlattenScript(
  rawUrl: string,
  includeHiddenStructure: boolean,
  flattenScript: string,
): Promise<void> {
  const a = api()
  if (typeof a?.domMapCacheRememberFlatten !== 'function') return
  if (!domMapCacheKey(rawUrl, includeHiddenStructure)) return
  await a.domMapCacheRememberFlatten(
    rawUrl,
    includeHiddenStructure,
    flattenScript,
  )
}

export async function forgetCachedFlattenScript(
  rawUrl: string,
  includeHiddenStructure: boolean,
): Promise<void> {
  const a = api()
  if (typeof a?.domMapCacheForgetFlatten !== 'function') return
  if (!domMapCacheKey(rawUrl, includeHiddenStructure)) return
  await a.domMapCacheForgetFlatten(rawUrl, includeHiddenStructure)
}
