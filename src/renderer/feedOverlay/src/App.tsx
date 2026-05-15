import { useCallback, useEffect, useRef, useState } from 'react'

import {
  FeedOverlayChatShell,
  type FeedOverlayChatSegment,
} from '@common/components/FeedOverlayChatShell'
import { parseFeedOverlayPayload } from '@common/lib/feedOverlayPayload'
import { normalizeNavigateInput } from '@common/navigateNormalize'
import type {
  FeedOverlaySetStatePayload,
  FeedOverlayPageAgentStatusPayload,
} from '@shared/feedOverlayIpc'
import {
  FEED_OVERLAY_PAGE_AGENT_DEFAULT_GOAL_CONTENT_PAGE,
  FEED_OVERLAY_PAGE_AGENT_DEFAULT_GOAL_START_PAGE,
  isFeedOverlayPageAgentStartPageUrl,
} from '@shared/feedOverlayPageAgentPrompt'
import { FEED_OVERLAY_LOADING_PAYLOAD } from '@shared/feedOverlaySentinel'

export function FeedOverlayApp() {
  const [chromeOpen, setChromeOpen] = useState(false)
  const [entries, setEntries] = useState<FeedOverlayChatSegment[]>([])
  const [inFlightLoading, setInFlightLoading] = useState(false)
  const [isDark, setIsDark] = useState(true)
  const [composer, setComposer] = useState('')
  const [composerBusy, setComposerBusy] = useState(false)
  const [composerAgentBusy, setComposerAgentBusy] = useState(false)
  const [turnControlsBusy, setTurnControlsBusy] = useState(false)

  const segIdRef = useRef(0)
  /** Dedupes identical payload JSON re-sent without a new user search (e.g. theme toggle). */
  const lastAppliedContentJsonRef = useRef<string | null>(null)
  const nextSegId = useCallback(() => {
    segIdRef.current += 1
    return `feed-overlay-seg-${segIdRef.current}`
  }, [])

  const appendSubmittedQuery = useCallback((displayText: string) => {
    const trimmed = typeof displayText === 'string' ? displayText.trim() : ''
    if (!trimmed) return
    /** New user navigation: accept next payload even if JSON matches last (cached pipeline). */
    lastAppliedContentJsonRef.current = null
    setEntries((prev) => [
      ...prev,
      { id: nextSegId(), kind: 'submittedQuery', text: trimmed },
    ])
  }, [nextSegId])

  useEffect(() => {
    const api = window.feedOverlayAPI
    if (typeof api?.onSetState !== 'function') return undefined

    const handler = (msg: FeedOverlaySetStatePayload): void => {
      if (msg.kind === 'hidden') {
        setChromeOpen(false)
        setInFlightLoading(false)
        if (!msg.preserveChatHistory) {
          setEntries([])
          lastAppliedContentJsonRef.current = null
        }
        return
      }
      setChromeOpen(true)
      setIsDark(!!msg.appUsesDarkUi)

      if (msg.kind === 'loading') {
        setInFlightLoading(true)
        return
      }

      if (msg.kind !== 'content' || typeof msg.payloadJson !== 'string') return

      const raw = msg.payloadJson
      if (raw === FEED_OVERLAY_LOADING_PAYLOAD) {
        setInFlightLoading(true)
        return
      }

      if (lastAppliedContentJsonRef.current === raw) {
        setInFlightLoading(false)
        return
      }

      const parsed = parseFeedOverlayPayload(raw)
      setInFlightLoading(false)
      lastAppliedContentJsonRef.current = raw
      if (!parsed) {
        setEntries((prev) => [...prev, { id: nextSegId(), kind: 'invalid' }])
        return
      }

      setEntries((prev) => [
        ...prev,
        { id: nextSegId(), kind: 'turn', parsed },
      ])
    }

    api.onSetState(handler)
    return () => {
      api.removeSetStateListener?.()
    }
  }, [nextSegId])

  useEffect(() => {
    const api = window.feedOverlayAPI
    if (typeof api?.onPageAgentStatus !== 'function') return undefined

    const onStatus = (payload: FeedOverlayPageAgentStatusPayload): void => {
      const t = typeof payload?.text === 'string' ? payload.text.trim() : ''
      if (!t) return
      setEntries((prev) => [
        ...prev,
        { id: nextSegId(), kind: 'agentStatus', text: t },
      ])
    }

    api.onPageAgentStatus(onStatus)
    return () => {
      api.removePageAgentStatusListener?.()
    }
  }, [nextSegId])

  useEffect(() => {
    if (!chromeOpen) {
      document.documentElement.classList.remove('dark')
      return
    }
    document.documentElement.classList.toggle('dark', isDark)
  }, [chromeOpen, isDark])

  const onComposerSubmit = useCallback(async () => {
    const api = window.feedOverlayAPI
    if (typeof api?.quickFeedFromUrl !== 'function') return
    const finalUrl = normalizeNavigateInput(composer)
    if (!finalUrl) return
    appendSubmittedQuery(composer.trim())
    setComposerBusy(true)
    const IPC_MS = 45_000
    try {
      const res = await Promise.race([
        api.quickFeedFromUrl(finalUrl),
        new Promise<{ ok: false; error: string }>((resolve) => {
          setTimeout(() => {
            resolve({
              ok: false,
              error: `Timed out after ${IPC_MS / 1000}s (waiting for navigation to settle in the browser process).`,
            })
          }, IPC_MS)
        }),
      ])
      if (!res.ok) {
        console.error('[quick-feed]', res.error)
      } else {
        setComposer('')
      }
    } catch (err) {
      console.error('[quick-feed]', err)
    } finally {
      setComposerBusy(false)
    }
  }, [composer, nextSegId, appendSubmittedQuery])

  const onComposerAgentSubmit = useCallback(async () => {
    const api = window.feedOverlayAPI
    const trimmed = composer.trim()

    let defaultGoal = FEED_OVERLAY_PAGE_AGENT_DEFAULT_GOAL_CONTENT_PAGE
    if (
      !trimmed &&
      typeof api?.getActiveTabUrl === 'function'
    ) {
      const activeUrl = await api.getActiveTabUrl()
      if (isFeedOverlayPageAgentStartPageUrl(activeUrl ?? '')) {
        defaultGoal = FEED_OVERLAY_PAGE_AGENT_DEFAULT_GOAL_START_PAGE
      }
    }

    const goal = trimmed || defaultGoal

    if (typeof api?.runFeedOverlayPageAgent !== 'function') {
      appendSubmittedQuery(goal)
      setEntries((prev) => [
        ...prev,
        {
          id: nextSegId(),
          kind: 'agentStatus',
          text: 'Page agent API missing — restart the app so the feed overlay preload picks up the latest build.',
        },
      ])
      return
    }

    appendSubmittedQuery(goal)
    setEntries((prev) => [
      ...prev,
      {
        id: nextSegId(),
        kind: 'agentStatus',
        text: 'Page agent — starting…',
      },
    ])
    setComposerAgentBusy(true)
    const IPC_MS = 180_000
    try {
      const res = await Promise.race([
        api.runFeedOverlayPageAgent(goal),
        new Promise<{ ok: false; error: string }>((resolve) => {
          setTimeout(() => {
            resolve({
              ok: false,
              error: `Agent timed out after ${IPC_MS / 1000}s.`,
            })
          }, IPC_MS)
        }),
      ])
      if (!res.ok) {
        setEntries((prev) => [
          ...prev,
          {
            id: nextSegId(),
            kind: 'agentSummary',
            text: res.error,
            iterationsUsed: 0,
          },
        ])
      } else {
        setEntries((prev) => [
          ...prev,
          {
            id: nextSegId(),
            kind: 'agentSummary',
            text: res.summary,
            iterationsUsed: res.iterationsUsed,
          },
        ])
        setComposer('')
      }
    } catch (err) {
      console.error('[feed-overlay-agent]', err)
      setEntries((prev) => [
        ...prev,
        {
          id: nextSegId(),
          kind: 'agentSummary',
          text:
            err instanceof Error
              ? err.message
              : 'Agent request failed unexpectedly.',
          iterationsUsed: 0,
        },
      ])
    } finally {
      setComposerAgentBusy(false)
      /** Main may push overlay loading on guest navigate without a follow-up flatten IPC — drop spinner once the agent RPC returns. */
      setInFlightLoading(false)
    }
  }, [composer, appendSubmittedQuery, nextSegId])

  const onRetryQuickFeedTurn = useCallback(
    async (url: string, segmentId: string) => {
      const api = window.feedOverlayAPI
      if (typeof api?.retryQuickFeedForUrl !== 'function') return
      const trimmed = typeof url === 'string' ? url.trim() : ''
      if (!trimmed) return

      setTurnControlsBusy(true)
      lastAppliedContentJsonRef.current = null
      setEntries((prev) => [
        ...prev.filter((e) => e.id !== segmentId),
        { id: nextSegId(), kind: 'submittedQuery', text: trimmed },
      ])

      const IPC_MS = 45_000
      try {
        const res = await Promise.race([
          api.retryQuickFeedForUrl(trimmed),
          new Promise<{ ok: false; error: string }>((resolve) => {
            setTimeout(() => {
              resolve({
                ok: false,
                error: `Timed out after ${IPC_MS / 1000}s (waiting for navigation to settle in the browser process).`,
              })
            }, IPC_MS)
          }),
        ])
        if (!res.ok) {
          console.error('[quick-feed-retry]', res.error)
        }
      } catch (err) {
        console.error('[quick-feed-retry]', err)
      } finally {
        setTurnControlsBusy(false)
      }
    },
    [nextSegId],
  )

  if (!chromeOpen) {
    return null
  }

  return (
    <FeedOverlayChatShell
      isDark={isDark}
      entries={entries}
      inFlightLoading={inFlightLoading}
      composerValue={composer}
      onComposerChange={setComposer}
      onComposerSubmit={onComposerSubmit}
      composerBusy={composerBusy}
      onComposerAgentSubmit={onComposerAgentSubmit}
      composerAgentBusy={composerAgentBusy}
      onQuickFeedLinkNavigate={appendSubmittedQuery}
      turnControlsBusy={turnControlsBusy}
      onRetryQuickFeedTurn={onRetryQuickFeedTurn}
    />
  )
}
