import { DOM_MAP_TRANSFORM_PROMPT } from './domMapTransformPrompt'
import {
  DOM_MAP_JSON_SECTION_MARKER,
  stringifyDomMapForTransformLlm,
} from '@shared/domMapLlmBudget'
import { buildPageMapScannerScript } from './pageMapScanner'
import {
  forgetCachedFlattenScript,
  peekCachedDomMapScanJson,
  peekCachedFlattenScript,
  rememberDomMapScanJson,
  rememberFlattenScript,
} from './perUrlDomMapScriptCache'
import {
  extractJavascriptFromAssistantMessage,
  isFlattenedDomMapPayload,
  finalizeDomMapOverlayFromDomMapAndScript,
  stripFlattenedSummaries,
  runDomMapFlattenCallable,
} from './mapJsonUtils'
import type { SidebarPanel } from '../contexts/SidebarPanelContext'

export class QuickFeedAborted extends Error {
  readonly name = 'QuickFeedAborted'
  constructor() {
    super('Quick feed aborted')
  }
}

export function isQuickFeedAborted(err: unknown): boolean {
  return err instanceof QuickFeedAborted
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export function assistantTextFromCoreMessage(msg: unknown): string | null {
  if (msg === null || typeof msg !== 'object') return null
  const m = msg as { role?: string; content?: unknown }
  if (m.role !== 'assistant') return null
  const c = m.content
  if (typeof c === 'string') return c
  if (Array.isArray(c)) {
    const tp = (c as { type?: string; text?: unknown }[]).find(
      (p) => p?.type === 'text',
    )
    const t = tp?.text
    return typeof t === 'string' ? t : null
  }
  return null
}

async function getLastAssistantReplyText(
  maxWaitMs = 120_000,
  shouldAbort?: () => boolean,
): Promise<string> {
  const start = Date.now()
  let lastLen = -1
  let stable = 0
  let candidate = ''

  while (Date.now() - start < maxWaitMs) {
    if (shouldAbort?.()) throw new QuickFeedAborted()
    await sleep(500)
    const messages = await window.sidebarAPI.getMessages()
    let lastAssist = ''
    for (let i = messages.length - 1; i >= 0; i--) {
      const txt = assistantTextFromCoreMessage(messages[i])
      if (txt !== null && txt.length > 0) {
        lastAssist = txt
        break
      }
    }

    candidate = lastAssist

    const hasFenceComplete =
      /\n```(?:javascript|js)\b[\s\S]*?```$/i.test(lastAssist.trimEnd()) ||
      /```(?:javascript|js)\b[\s\S]*?```$/i.test(lastAssist)

    if (lastAssist.length === lastLen) stable += 1
    else stable = 0
    lastLen = lastAssist.length

    const js = extractJavascriptFromAssistantMessage(candidate)
    if (js !== null && (hasFenceComplete || stable >= 4)) {
      if (shouldAbort?.()) throw new QuickFeedAborted()
      return candidate
    }

    await sleep(350)
  }
  throw new Error('Timed out waiting for assistant reply with runnable JavaScript.')
}

function flattenDomMapWithJs(
  js: string,
  jsonForLlm: string,
  data: Record<string, unknown>,
): string {
  let scriptInput: unknown
  try {
    scriptInput = JSON.parse(jsonForLlm)
  } catch {
    throw new Error(
      'DOM map JSON sent to the assistant could not be re-parsed locally after size budget.',
    )
  }
  const out = runDomMapFlattenCallable(js, scriptInput)
  if (!isFlattenedDomMapPayload(out)) {
    throw new Error(
      'Script return value is not a blueberry-dom-map overlay payload (flattened legacy or blueberry-dom-map-overlay).',
    )
  }
  finalizeDomMapOverlayFromDomMapAndScript(data, out)
  return stripFlattenedSummaries(JSON.stringify(out))
}

export async function runQuickFeedPipeline(deps: {
  includeHiddenStructure: boolean
  sendMessage: (content: string) => Promise<void>
  clearChat: () => Promise<void>
  rememberDomMapJsonSnapshot: (json: string) => void
  requestMapJsonImport: (
    markdown: string,
    opts?: { thenDisplay?: 'json' | 'feed' | 'visual' },
  ) => void
  setPanel: (p: SidebarPanel) => void
  /** When true, pipeline steps exit with {@link QuickFeedAborted}. */
  shouldAbort?: () => boolean
}): Promise<void> {
  const {
    includeHiddenStructure,
    sendMessage,
    clearChat,
    rememberDomMapJsonSnapshot,
    requestMapJsonImport,
    setPanel,
    shouldAbort,
  } = deps

  const check = (): void => {
    if (shouldAbort?.()) throw new QuickFeedAborted()
  }

  try {
    setPanel('map')
    check()

    const tabInfo = await window.sidebarAPI.getActiveTabInfo()
    if (!tabInfo) throw new Error('No active tab')
    check()

    const idle = await window.sidebarAPI.waitActiveTabContentReady({
      settleMs: 0,
    })
    if (!idle.ok) throw new Error(idle.error ?? 'Tab not ready')
    check()

    type ScanResult = { ok: boolean; error?: string } & Record<string, unknown>
    let data: ScanResult | undefined
    const cachedScanJson = peekCachedDomMapScanJson(
      tabInfo.url,
      includeHiddenStructure,
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
          data = parsed as ScanResult
        }
      } catch {
        /* invalid cache JSON */
      }
    }
    if (data === undefined) {
      data = (await window.sidebarAPI.tabRunJs(
        tabInfo.id,
        buildPageMapScannerScript({ includeHidden: includeHiddenStructure }),
      )) as ScanResult
    }
    check()

    if (!data || typeof data !== 'object' || !('ok' in data)) {
      throw new Error('Unexpected response while parsing page')
    }

    const r = data as { ok: boolean; error?: string }
    const jsonText = JSON.stringify(r, null, 2)
    const jsonForLlm = stringifyDomMapForTransformLlm(r)
    if (!r.ok) {
      rememberDomMapJsonSnapshot(jsonText)
      requestMapJsonImport(jsonText)
      const errMsg =
        typeof r.error === 'string' ? r.error : 'Page parse failed'
      throw new Error(errMsg)
    }

    rememberDomMapScanJson(tabInfo.url, includeHiddenStructure, jsonText)

    rememberDomMapJsonSnapshot(jsonText)

    const cachedFlatten = await peekCachedFlattenScript(
      tabInfo.url,
      includeHiddenStructure,
    )
    if (cachedFlatten) {
      check()
      setPanel('chat')
      try {
        const raw = flattenDomMapWithJs(
          cachedFlatten,
          jsonForLlm,
          data as Record<string, unknown>,
        )
        check()
        requestMapJsonImport(raw, { thenDisplay: 'visual' })
        return
      } catch {
        await forgetCachedFlattenScript(tabInfo.url, includeHiddenStructure)
      }
    }

    await clearChat()
    check()
    setPanel('chat')

    const prompt = `${DOM_MAP_TRANSFORM_PROMPT}\n\n${DOM_MAP_JSON_SECTION_MARKER}\n\n${jsonForLlm}`
    await sendMessage(prompt)
    check()

    const assistantText = await getLastAssistantReplyText(120_000, shouldAbort)
    check()

    const js = extractJavascriptFromAssistantMessage(assistantText)
    if (!js) {
      throw new Error('Assistant reply had no fenced JavaScript block.')
    }

    await rememberFlattenScript(tabInfo.url, includeHiddenStructure, js)

    const raw = flattenDomMapWithJs(js, jsonForLlm, data as Record<string, unknown>)
    check()

    requestMapJsonImport(raw, { thenDisplay: 'visual' })
  } catch (e) {
    if (e instanceof QuickFeedAborted) return
    throw e
  }
}
