import type {
  FeedOverlaySetStatePayload,
  FeedOverlayPageAgentStatusPayload,
} from '../shared/feedOverlayIpc'
import type { FeedOverlayPageAgentInvokeResult } from '../shared/feedOverlayPageAgentPrompt'

export interface FeedOverlayAPI {
  onSetState: (callback: (payload: FeedOverlaySetStatePayload) => void) => void
  removeSetStateListener: () => void
  onPageAgentStatus: (
    callback: (payload: FeedOverlayPageAgentStatusPayload) => void,
  ) => void
  removePageAgentStatusListener: () => void
  quickFeedFromUrl: (
    url: string,
  ) => Promise<{ ok: true } | { ok: false; error: string }>
  retryQuickFeedForUrl: (
    url: string,
  ) => Promise<{ ok: true } | { ok: false; error: string }>
  runFeedOverlayPageAgent: (
    goal: string,
  ) => Promise<FeedOverlayPageAgentInvokeResult>
  getActiveTabUrl: () => Promise<string | null>
  navigateActiveTabToUrl: (url: string) => Promise<void>
  getFeedLayoutOverlayEnabled: () => Promise<boolean>
  setFeedLayoutOverlayEnabled: (enabled: boolean) => Promise<unknown>
  onFeedLayoutOverlayEnabledChanged: (
    callback: (enabled: boolean) => void,
  ) => void
  removeFeedLayoutOverlayEnabledListener: () => void
}

declare global {
  interface Window {
    feedOverlayAPI: FeedOverlayAPI
  }
}

export {}
