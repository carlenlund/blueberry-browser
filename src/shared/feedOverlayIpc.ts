export type FeedOverlaySetStatePayload =
  | { kind: 'loading'; appUsesDarkUi: boolean }
  | { kind: 'content'; payloadJson: string; appUsesDarkUi: boolean }
  /** `preserveChatHistory`: feed-layout toggle off — hide surface but keep overlay transcript in renderer. */
  | { kind: 'hidden'; preserveChatHistory?: boolean }

export const FEED_OVERLAY_SET_STATE_CHANNEL = 'feed-overlay:set-state' as const

export type FeedOverlayPageAgentStatusPayload = {
  text: string
}

export const FEED_OVERLAY_PAGE_AGENT_STATUS_CHANNEL =
  'feed-overlay:page-agent-status' as const
