import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { MessageSquare, Code2 } from 'lucide-react'

import { Button } from '@common/components/Button'

import { useChat } from '../contexts/ChatContext'
import { useSidebarPanel } from '../contexts/SidebarPanelContext'
import { DOM_MAP_CHAT_PROMPT } from '../lib/domMapChatPrompt'
import { DOM_MAP_TRANSFORM_PROMPT } from '../lib/domMapTransformPrompt'
import {
  extractJsonFromAssistantMessage,
  normalizeFlattenedDomMapPayload,
} from '../lib/mapJsonUtils'
import { buildPageMapScannerScript } from '../lib/pageMapScanner'
import {
  peekCachedDomMapScanJson,
  rememberDomMapScanJson,
} from '../lib/perUrlDomMapScriptCache'
import { MAIN_FEED_OVERLAY_LOADING_PAYLOAD } from '@common/feedOverlayConstants'
import { DOM_MAP_JSON_SECTION_MARKER } from '@shared/domMapLlmBudget'
import {
  discussionReplyChildren,
  normalizeOverlayLayoutKind,
  overlayPayloadHasRenderableMainContent,
  pickDiscussionNodeText,
} from '@common/lib/flattenedFeedUtils'
import {
  BLUEBERRY_DOM_MAP_OVERLAY_SCHEMA,
  type ArticleOverlayBlock,
  type DiscussionOverlayNode,
  type DomMapKind,
  type DomMapOverlayPageResult,
  type FlattenedItem,
  type FlattenedPageMapResult,
} from '@common/flattenedMap'

export type {
  DomMapKind,
  ArticleOverlayBlock,
  DiscussionOverlayNode,
  DomMapOverlayPageResult,
  FlattenedItem,
  FlattenedPageMapResult,
  FlattenedSubitem,
  OverlayLayoutKind,
} from '@common/flattenedMap'

/** DOM map node: short keys (t,i,c,a,x,z,k,w,o); v1 legacy tag,id,classes */
export interface DomMapNode {
  t?: string
  tag?: string
  z?: DomMapKind
  i?: string
  id?: string
  c?: string[]
  classes?: string[]
  a?: Record<string, string>
  attrs?: Record<string, string>
  x?: string
  text?: string
  k?: DomMapNode[]
  children?: DomMapNode[]
  w?: DomMapNode[]
  shadow?: DomMapNode[]
  o?: number
  childrenOmitted?: number
  sel?: string
}

export type PageMapMeta = {
  nodesEmitted: number
  maxDepthCap: number
  maxNodesCap: number
  truncatedByNodeBudget: boolean
  truncatedByDepth: boolean
  skippedHiddenApprox: number
  /** Present on v4 runs from blueberry scanner */
  visibilityFilter?: 'visible-only' | 'include-hidden-structure'
  /** Invisible nodes merged as stubs (prepend in root tree k; capped) */
  structuralStubsFromInvisibleApprox?: number
  fingerprintStubCap?: number
  /** Selector candidate list exceeded scan budget */
  fingerprintHuntTruncatedByStepsApprox?: boolean
  /** Unique stubs capped by quota or MAX_NODES headroom */
  fingerprintAppendTruncatedApprox?: boolean
  zMeaning?: string
}

export type TreePageMapResult = {
  ok: true
  schema:
    | 'blueberry-dom-map-v1'
    | 'blueberry-dom-map-v2'
    | 'blueberry-dom-map-v3'
    | 'blueberry-dom-map-v4'
  pageTitle: string
  url: string
  root: string
  tree: DomMapNode
  meta: PageMapMeta
  note: string
}

export type PageMapSuccess =
  | TreePageMapResult
  | FlattenedPageMapResult
  | DomMapOverlayPageResult

export type PageMapError = {
  ok: false
  error: string
}

type DisplayView = 'json' | 'visual'

function isTreeSuccess(r: PageMapSuccess): r is TreePageMapResult {
  return 'tree' in r && r.tree != null
}

function isFlattenedSuccess(r: PageMapSuccess): r is FlattenedPageMapResult {
  return r.schema === 'blueberry-dom-map-flattened' && Array.isArray(r.items)
}

function isOverlayEnvelopeSuccess(r: PageMapSuccess): r is DomMapOverlayPageResult {
  if (!('schema' in r) || !r.ok || r.schema !== BLUEBERRY_DOM_MAP_OVERLAY_SCHEMA)
    return false
  return (
    normalizeOverlayLayoutKind(r.layoutKind) != null &&
    Array.isArray(r.items)
  )
}

function isOverlayLayoutPayloadSuccess(
  r: PageMapSuccess,
): r is FlattenedPageMapResult | DomMapOverlayPageResult {
  return isFlattenedSuccess(r) || isOverlayEnvelopeSuccess(r)
}

function isSuccess(
  r: PageMapSuccess | PageMapError,
): r is PageMapSuccess {
  return r.ok === true
}

function pickNodeFields(n: DomMapNode) {
  const tag = n.t ?? n.tag ?? '?'
  const id = n.i ?? n.id
  const cls = n.c ?? n.classes
  const attrs = n.a ?? n.attrs
  const text = n.x ?? n.text
  const kids = n.k ?? n.children
  const sh = n.w ?? n.shadow
  const omitted = n.o ?? n.childrenOmitted
  const z = n.z
  return { tag, id, cls, attrs, text, kids, sh, omitted, z }
}

function DomTreeNodeView({
  node,
  depth,
}: {
  node: DomMapNode
  depth: number
}) {
  const { tag, id, cls, attrs, text, kids, sh, omitted, z } =
    pickNodeFields(node)
  const indent = Math.min(depth, 32) * 9
  const attrsStr =
    attrs && Object.keys(attrs).length > 0 ? JSON.stringify(attrs) : null
  return (
    <div className="border-border/50 border-l border-dashed" style={{ paddingLeft: indent }}>
      <div className="text-foreground flex flex-wrap items-baseline gap-x-1.5 font-mono text-[10px] leading-tight">
        <span className="text-primary">
          &lt;{tag === '_' ? 'frag' : tag}&gt;
        </span>
        {z != null ? (
          <span
            title={z === 'a' ? 'active' : 'passive'}
            className={
              z === 'a'
                ? 'font-semibold text-orange-500'
                : 'text-muted-foreground'
            }
          >
            z:{z}
          </span>
        ) : null}
        {id ? (
          <span className="text-muted-foreground">#{id}</span>
        ) : null}
        {node.sel ? (
          <span className="text-muted-foreground/90 text-[9px]" title={node.sel}>
            {node.sel}
          </span>
        ) : null}
        {cls && cls.length > 0 ? (
          <span className="text-muted-foreground/85 max-w-[min(100%,180px)] truncate text-[9px]">
            .{cls.join('.')}
          </span>
        ) : null}
      </div>
      {attrsStr != null ? (
        <pre className="text-muted-foreground/90 m-0 max-h-24 overflow-auto py-0.5 text-[9px] leading-snug whitespace-pre-wrap break-all">
          {attrsStr}
        </pre>
      ) : null}
      {text ? (
        <div className="text-foreground/90 mt-0.5 line-clamp-4 text-[10px] leading-snug">
          {text}
        </div>
      ) : null}
      {omitted != null && omitted > 0 ? (
        <p className="text-destructive/90 m-0 py-1 text-[9px]">
          +{omitted} siblings omitted (cap)
        </p>
      ) : null}
      {sh && sh.length > 0 ? (
        <div className="border-amber-500/45 bg-amber-500/5 mt-1 rounded border border-dashed px-1 py-1">
          <div className="text-amber-600/90 mb-1 font-mono text-[9px] font-semibold">
            shadow-root
          </div>
          {sh.map((sn, i) => (
            <DomTreeNodeView key={`s${i}`} node={sn} depth={depth + 1} />
          ))}
        </div>
      ) : null}
      {kids?.map((ch, i) => (
        <DomTreeNodeView key={`c${i}`} node={ch} depth={depth + 1} />
      ))}
    </div>
  )
}

function PageMapTreeVisual({ result }: { result: TreePageMapResult }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-0">
      <div className="text-muted-foreground border-b border-border px-3 py-1.5 text-[10px]">
        {result.pageTitle}
        <span className="text-muted-foreground/80 ml-2">
          {result.schema} · root:{result.root} · nodes:{result.meta.nodesEmitted}
          {result.meta.truncatedByNodeBudget ? ' · truncated' : ''}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        <DomTreeNodeView node={result.tree} depth={0} />
      </div>
    </div>
  )
}

function PageMapDiscussNode({ node }: { node: DiscussionOverlayNode }) {
  const nm = typeof node.username === 'string'
    ? node.username.trim()
    : typeof node.user === 'string'
      ? node.user.trim()
      : ''
  const txt = pickDiscussionNodeText(node)
  const childList = discussionReplyChildren(node)
  if (!txt && childList.length === 0) return null
  return (
    <div className="border-border mb-2 border-l border-dashed py-1 pl-2">
      {nm.length > 0 ? (
        <div className="text-primary text-[10px] font-semibold">{nm}</div>
      ) : null}
      {txt.length > 0 ? (
        <div className="text-foreground/95 mt-0.5 whitespace-pre-wrap text-[10px] leading-snug">
          {txt}
        </div>
      ) : null}
      {childList.length > 0 ? (
        <div className="border-border mt-2 space-y-1 border-l pl-3">
          {childList.map((ch, ci) => (
            <PageMapDiscussNode
              key={ci}
              node={ch as DiscussionOverlayNode}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function PageMapOverlayLayoutVisual({
  result,
}: {
  result: FlattenedPageMapResult | DomMapOverlayPageResult
}) {
  const layout =
    result.schema === BLUEBERRY_DOM_MAP_OVERLAY_SCHEMA
      ? normalizeOverlayLayoutKind(result.layoutKind) ?? 'feed'
      : 'feed'

  const headerSchema =
    result.schema === BLUEBERRY_DOM_MAP_OVERLAY_SCHEMA ? result.schema : 'blueberry-dom-map-flattened'

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-0 font-sans">
      <div className="text-muted-foreground border-b border-border px-3 py-1.5 text-[10px]">
        {result.pageTitle ?? '—'}
        <span className="text-muted-foreground/80 ml-2">
          {headerSchema} · {layout} · {(result.items as unknown[]).length} sections
        </span>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-2">
        {layout === 'feed' ? (
          (result.items as FlattenedItem[]).map((it, idx) => (
            <div
              key={it.id ?? `it-${idx}`}
              className="border-border bg-background/80 rounded-md border p-2"
            >
              <div className="text-foreground flex flex-wrap items-baseline gap-2 text-[11px] font-semibold">
                <span>{it.title ?? 'Section'}</span>
                {it.z != null ? (
                  <span
                    className={
                      it.z === 'a'
                        ? 'font-normal text-orange-500'
                        : 'text-muted-foreground font-normal'
                    }
                  >
                    z:{it.z}
                  </span>
                ) : null}
              </div>
              {(() => {
                const u = it.url ?? it.link ?? it.href
                const s = typeof u === 'string' ? u.trim() : ''
                if (!s) return null
                return (
                  <p className="m-0 mt-1 truncate font-mono text-[9px] leading-tight">
                    <a
                      href={s}
                      className="text-primary hover:underline"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {s}
                    </a>
                  </p>
                )
              })()}
              {typeof it.commentsUrl === 'string' &&
              it.commentsUrl.trim() &&
              it.commentsUrl.trim() !==
                (typeof (it.url ?? it.link ?? it.href) === 'string'
                  ? String(it.url ?? it.link ?? it.href).trim()
                  : '') ? (
                <p className="m-0 mt-1 truncate text-[9px] leading-tight">
                  <a
                    href={it.commentsUrl.trim()}
                    className="text-primary underline underline-offset-2"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {typeof it.comments === 'string' && it.comments.trim()
                      ? it.comments.trim()
                      : 'Comments'}
                  </a>
                </p>
              ) : null}
              {it.summary ? (
                <p className="text-muted-foreground m-0 mt-1 text-[10px] leading-snug">
                  {it.summary}
                </p>
              ) : null}
              {it.subitems && it.subitems.length > 0 ? (
                <ul className="text-foreground/95 mt-2 list-disc space-y-1.5 pl-4 text-[10px]">
                  {it.subitems.map((s, j) => (
                    <li key={s.id ?? `si-${idx}-${j}`}>
                      <span className="font-mono text-[9px] text-primary">
                        {s.t ?? 'item'}
                      </span>
                      {s.z != null ? (
                        <span
                          className={
                            s.z === 'a'
                              ? 'text-orange-500'
                              : 'text-muted-foreground'
                          }
                        >
                          {' '}
                          z:{s.z}
                        </span>
                      ) : null}
                      {s.label ? (
                        <span className="font-medium">{`: ${s.label}`}</span>
                      ) : null}
                      {s.text ? (
                        <div className="text-muted-foreground whitespace-pre-wrap">
                          {s.text}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground m-0 mt-2 text-[9px]">
                  No subitems
                </p>
              )}
            </div>
          ))
        ) : layout === 'article' ? (
          (result.items as ArticleOverlayBlock[]).map((blk, bi) => {
            const ttRaw =
              typeof blk.type === 'string' ? blk.type.toLowerCase().trim() : ''
            const tt = ttRaw || 'p'
            const imgSrc =
              (typeof blk.src === 'string' && blk.src.trim()) ||
              (typeof (blk as { image?: string }).image === 'string' &&
                (blk as { image: string }).image.trim()) ||
              (typeof (blk as { img?: string }).img === 'string' &&
                (blk as { img: string }).img.trim()) ||
              ''
            if (imgSrc) {
              const alt =
                (typeof blk.alt === 'string' && blk.alt.trim()) ||
                (typeof blk.text === 'string' && blk.text.trim()) ||
                ''
              const cap =
                typeof blk.caption === 'string'
                  ? blk.caption.trim()
                  : typeof blk.text === 'string' &&
                      blk.text.trim() &&
                      blk.text.trim() !== alt
                    ? blk.text.trim()
                    : ''
              return (
                <figure key={`ab-${bi}`} className="mt-3">
                  <img
                    src={imgSrc}
                    alt={alt}
                    className="border-border max-h-[40vh] max-w-full rounded-md border object-contain"
                    loading="lazy"
                    decoding="async"
                  />
                  {cap ? (
                    <figcaption className="text-muted-foreground mt-1 text-[10px] leading-snug">
                      {cap}
                    </figcaption>
                  ) : null}
                </figure>
              )
            }
            const hrefPick =
              (typeof blk.href === 'string' && blk.href.trim()) ||
              (typeof blk.url === 'string' && blk.url.trim()) ||
              (typeof blk.link === 'string' && blk.link.trim()) ||
              ''
            const body =
              typeof blk.text === 'string' ? blk.text.trim() : ''
            if (!body && !hrefPick) return null
            if (hrefPick && (tt === 'a' || tt === 'button')) {
              return (
                <a
                  key={`ab-${bi}`}
                  href={hrefPick}
                  className="text-primary mt-2 block text-[11px] underline"
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {body || hrefPick}
                </a>
              )
            }
            const CN =
              tt === 'h1'
                ? 'text-[15px] font-bold mt-3'
                : tt === 'h2'
                  ? 'text-[13px] font-semibold mt-2'
                  : tt === 'h3'
                    ? 'text-[12px] font-semibold mt-2'
                    : tt === 'blockquote'
                      ? 'text-muted-foreground border-border border-l-2 pl-2 text-[10px]'
                      : 'text-foreground/95 text-[11px]'
            const inner =
              hrefPick && body ? (
                <a
                  href={hrefPick}
                  className="text-primary underline"
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {body}
                </a>
              ) : hrefPick && !body ? (
                <a
                  href={hrefPick}
                  className="text-primary underline"
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {hrefPick}
                </a>
              ) : (
                <span className="whitespace-pre-wrap">{body}</span>
              )
            return (
              <div key={`ab-${bi}`} className={CN}>
                {tt === 'li' ? (
                  <span className="text-muted-foreground mr-1.5 inline-block align-top opacity-65">
                    •
                  </span>
                ) : null}
                {inner}
              </div>
            )
          })
        ) : (
          <div className="text-foreground/95 space-y-1">
            {(result.items as DiscussionOverlayNode[]).map((n, ri) =>
              n !== null ? <PageMapDiscussNode key={ri} node={n} /> : null,
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export const PageMapPanel = () => {
  const { clearChat } = useChat()
  const {
    prefillChatComposer,
    pendingMapImport,
    clearPendingMapImport,
    rememberDomMapJsonSnapshot,
    setMainWebFeedOverlay,
    mapGuestDocumentNavigationEpoch,
  } = useSidebarPanel()
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<PageMapSuccess | PageMapError | null>(
    null,
  )
  const [jsonText, setJsonText] = useState('')
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [displayView, setDisplayView] = useState<DisplayView>('json')
  const [jsonCopied, setJsonCopied] = useState(false)
  /** Match markup closer to body.outerHTML when SPAs keep list items display:none until hydrated. */
  const [includeHiddenDomStructure, setIncludeHiddenDomStructure] =
    useState(false)
  const copyResetRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  )

  useLayoutEffect(() => {
    setResult(null)
    setJsonText('')
    setJsonError(null)
    setDisplayView('json')
    setLoading(false)
  }, [mapGuestDocumentNavigationEpoch])

  const tryParseDocument = useCallback(
    (raw: string): PageMapSuccess | PageMapError | null => {
      const trimmed = raw.trim()
      let candidate = trimmed
      const fromFence = extractJsonFromAssistantMessage(trimmed)
      if (fromFence) candidate = fromFence
      try {
        const parsed: unknown = JSON.parse(candidate)
        if (typeof parsed === 'object' && parsed !== null && 'ok' in parsed) {
          normalizeFlattenedDomMapPayload(parsed)
          return parsed as PageMapSuccess | PageMapError
        }
        setJsonError('JSON must be an object with an "ok" field.')
        return null
      } catch (e) {
        setJsonError(
          e instanceof Error ? e.message : 'Invalid JSON',
        )
        return null
      }
    },
    [],
  )

  const applyJsonFromEditor = useCallback(():
    | PageMapSuccess
    | PageMapError
    | null => {
    setJsonError(null)
    const r = tryParseDocument(jsonText)
    if (r) setResult(r)
    return r
  }, [jsonText, tryParseDocument])

  useEffect(() => {
    if (pendingMapImport == null) return
    const { markdown, thenDisplay } = pendingMapImport
    setJsonText(markdown)
    const r = tryParseDocument(markdown)
    if (r) {
      setResult(r)
      setJsonError(null)
      if (r.ok) {
        const pref = thenDisplay ?? 'json'
        if (
          pref === 'feed' &&
          (isFlattenedSuccess(r) ||
            (isOverlayEnvelopeSuccess(r) &&
              normalizeOverlayLayoutKind(r.layoutKind) === 'feed'))
        )
          setDisplayView('visual')
        else if (
          pref === 'visual' &&
          (isTreeSuccess(r) || isOverlayLayoutPayloadSuccess(r))
        )
          setDisplayView('visual')
        else setDisplayView('json')
      } else {
        setDisplayView('json')
      }
    }
    clearPendingMapImport()
  }, [pendingMapImport, clearPendingMapImport, tryParseDocument])

  const parsePage = useCallback(async () => {
    setLoading(true)
    setJsonCopied(false)
    setJsonError(null)
    try {
      const tabInfo = await window.sidebarAPI.getActiveTabInfo()
      if (!tabInfo) {
        const err: PageMapError = { ok: false, error: 'No active tab' }
        setResult(err)
        setJsonText(JSON.stringify(err, null, 2))
        setDisplayView('json')
        return
      }
      await window.sidebarAPI.waitActiveTabContentReady({ settleMs: 0 })

      type ScanData = PageMapSuccess | PageMapError
      let data: ScanData | undefined
      const cachedScanJson = peekCachedDomMapScanJson(
        tabInfo.url,
        includeHiddenDomStructure,
      )
      if (cachedScanJson) {
        try {
          const parsed = JSON.parse(cachedScanJson) as unknown
          if (
            parsed &&
            typeof parsed === 'object' &&
            'ok' in parsed &&
            (parsed as { ok: unknown }).ok === true
          ) {
            data = parsed as ScanData
          }
        } catch {
          /* ignore */
        }
      }
      if (data === undefined) {
        data = (await window.sidebarAPI.tabRunJs(
          tabInfo.id,
          buildPageMapScannerScript({
            includeHidden: includeHiddenDomStructure,
          }),
        )) as ScanData
      }

      if (data && typeof data === 'object' && 'ok' in data) {
        const r = data as PageMapSuccess | PageMapError
        setResult(r)
        setJsonText(JSON.stringify(r, null, 2))
        if (r.ok) {
          rememberDomMapScanJson(
            tabInfo.url,
            includeHiddenDomStructure,
            JSON.stringify(r, null, 2),
          )
        }
        if (!r.ok) setDisplayView('json')
      } else {
        const err: PageMapError = {
          ok: false,
          error: 'Unexpected response from page',
        }
        setResult(err)
        setJsonText(JSON.stringify(err, null, 2))
        setDisplayView('json')
      }
    } catch (e) {
      const err: PageMapError = {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      }
      setResult(err)
      setJsonText(JSON.stringify(err, null, 2))
      setDisplayView('json')
    } finally {
      setLoading(false)
    }
  }, [includeHiddenDomStructure])

  const sendToChat = useCallback(async () => {
    if (!jsonText.trim()) return
    rememberDomMapJsonSnapshot(jsonText)
    await clearChat()
    prefillChatComposer(`${DOM_MAP_CHAT_PROMPT}\n\n${DOM_MAP_JSON_SECTION_MARKER}\n\n${jsonText}`)
  }, [jsonText, prefillChatComposer, rememberDomMapJsonSnapshot, clearChat])

  const sendTransformToChat = useCallback(async () => {
    if (!jsonText.trim()) return
    rememberDomMapJsonSnapshot(jsonText)
    await clearChat()
    prefillChatComposer(
      `${DOM_MAP_TRANSFORM_PROMPT}\n\n${DOM_MAP_JSON_SECTION_MARKER}\n\n${jsonText}`,
    )
  }, [jsonText, prefillChatComposer, rememberDomMapJsonSnapshot, clearChat])

  const showJson = displayView === 'json'
  const showVisual =
    result !== null &&
    isSuccess(result) &&
    displayView === 'visual' &&
    (isTreeSuccess(result) || isOverlayLayoutPayloadSuccess(result))

  const copyJsonView = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(jsonText)
      if (copyResetRef.current) clearTimeout(copyResetRef.current)
      setJsonCopied(true)
      copyResetRef.current = setTimeout(() => {
        setJsonCopied(false)
        copyResetRef.current = undefined
      }, 2000)
    } catch {
      /* ignore */
    }
  }, [jsonText])

  const goToVisual = useCallback(() => {
    const r = applyJsonFromEditor()
    if (!r) return
    if (!isSuccess(r)) {
      setJsonError('Layout requires ok: true.')
      return
    }
    if (isTreeSuccess(r)) {
      setJsonError(null)
      setDisplayView('visual')
      return
    }
    if (isOverlayLayoutPayloadSuccess(r)) {
      if (!Array.isArray(r.items)) {
        setJsonError('Overlay map is missing an items array.')
        return
      }
      setJsonError(null)
      setDisplayView('visual')
      return
    }
    setJsonError('Unknown successful map type.')
  }, [applyJsonFromEditor])

  const goToJson = useCallback(() => {
    setJsonError(null)
    if (result) {
      setJsonText(JSON.stringify(result, null, 2))
    }
    setDisplayView('json')
  }, [result])

  /** Main-area overlay payload: loading mosaic until usable overlay rows exist. */
  useEffect(() => {
    const overlayReady =
      result !== null &&
      isSuccess(result) &&
      isOverlayLayoutPayloadSuccess(result) &&
      overlayPayloadHasRenderableMainContent(result)

    setMainWebFeedOverlay(
      overlayReady ? JSON.stringify(result) : MAIN_FEED_OVERLAY_LOADING_PAYLOAD,
    )
  }, [result, setMainWebFeedOverlay])

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3">
      <div className="shrink-0 space-y-2">
        <p className="text-muted-foreground text-xs leading-snug">
          v4: structure and text per node, <code className="text-[10px]">z=a|p</code>{' '}
          (active/passive). The default parser keeps only subtrees that pass{' '}
          <span className="font-medium">layout visibility</span>
          {' '}
          (not the same as raw{' '}
          <code className="text-[10px]">body.outerHTML</code>
          ); enable &quot;Include hidden structure&quot; for SPA feeds (e.g. Reddit). Noise
          tags are still dropped.
        </p>
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              id="page-map-include-hidden-structure"
              type="checkbox"
              className="border-border accent-primary size-3.5 rounded"
              checked={includeHiddenDomStructure}
              onChange={(ev) =>
                setIncludeHiddenDomStructure(ev.target.checked)
              }
              disabled={loading}
            />
            <span>Include hidden structure (closer to outerHTML; larger JSON)</span>
          </label>
        </div>
        <p className="text-muted-foreground m-0 text-xs leading-snug">
          Toggle the <span className="font-medium text-foreground">feed icon</span> in the{' '}
          <span className="font-medium">top bar</span> to mirror a flattened blueberry map over the webpage.
          {' '}Use{' '}
          <span className="font-medium">Parse current page</span>;{' '}
          <span className="font-medium">Send JS transform</span> for LLM‑written flatten scripts.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            className="min-w-0 flex-1"
            disabled={loading}
            onClick={() => void parsePage()}
          >
            {loading ? 'Parsing…' : 'Parse current page'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="gap-1.5"
            disabled={!jsonText.trim() || loading}
            onClick={() => void sendToChat()}
            title="Opens Chat with prompt + current JSON (send manually)"
          >
            <MessageSquare className="size-3.5 shrink-0" />
            Send to Chat
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="gap-1.5"
            disabled={!jsonText.trim() || loading}
            onClick={() => void sendTransformToChat()}
            title="LLM writes JavaScript; runs locally via Run JS → Map. Often much faster than a huge JSON reply."
          >
            <Code2 className="size-3.5 shrink-0" />
            Send JS transform
          </Button>
          <div
            className="bg-muted flex shrink-0 gap-0 rounded-md border border-border p-0.5"
            role="group"
            aria-label="Map view: JSON or layout"
          >
            <button
              type="button"
              aria-pressed={displayView === 'json'}
              className={`rounded px-2.5 py-1.5 text-xs font-medium transition-colors ${
                displayView === 'json'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={goToJson}
            >
              JSON
            </button>
            <button
              type="button"
              aria-pressed={displayView === 'visual'}
              className={`rounded px-2.5 py-1.5 text-xs font-medium transition-colors ${
                displayView === 'visual'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={goToVisual}
            >
              Layout
            </button>
          </div>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border bg-muted/30">
        {showJson ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-2 py-1.5">
              <span className="text-muted-foreground text-[10px]">
                Edit JSON · <span className="font-medium">Layout</span> for tree walk or flattened cards.
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void copyJsonView()}
              >
                {jsonCopied ? 'Copied' : 'Copy'}
              </Button>
            </div>
            {jsonError != null && (
              <p className="text-destructive border-b border-border px-3 py-2 text-[11px] leading-snug">
                {jsonError}
              </p>
            )}
            <textarea
              className="text-foreground placeholder:text-muted-foreground m-0 min-h-0 w-full flex-1 resize-none overflow-auto bg-transparent p-3 font-mono text-[11px] leading-relaxed whitespace-pre focus-visible:outline-none"
              spellCheck={false}
              aria-label="Page map JSON"
              placeholder='Parse or paste: ok + schema (v4 / flattened / overlay) …'
              value={jsonText}
              onChange={(e) => {
                setJsonText(e.target.value)
                setJsonError(null)
              }}
            />
          </div>
        ) : showVisual && result && isSuccess(result) ? (
          isTreeSuccess(result) ? (
            <PageMapTreeVisual result={result} />
          ) : (
            <PageMapOverlayLayoutVisual
              result={
                result as FlattenedPageMapResult | DomMapOverlayPageResult
              }
            />
          )
        ) : (
          <p className="text-muted-foreground p-3 text-xs">
            Parse or paste JSON, then{' '}
            <span className="font-medium text-foreground">Layout</span> to preview structure.
          </p>
        )}
      </div>
    </div>
  )
}
