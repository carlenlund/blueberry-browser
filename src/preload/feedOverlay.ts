import { contextBridge } from "electron";
import { electronAPI } from "@electron-toolkit/preload";
import {
  FEED_OVERLAY_SET_STATE_CHANNEL,
  FEED_OVERLAY_PAGE_AGENT_STATUS_CHANNEL,
  type FeedOverlaySetStatePayload,
  type FeedOverlayPageAgentStatusPayload,
} from "../shared/feedOverlayIpc";
import type { FeedOverlayPageAgentInvokeResult } from "../shared/feedOverlayPageAgentPrompt";

/** Same bridge as guest tabs — overlay links call quick-feed pipeline from main. */
const blueberryGuest = {
  quickFeedNavigate: (rawUrl: string) =>
    electronAPI.ipcRenderer.invoke("quick-feed-from-url", rawUrl),
};

const feedOverlayAPI = {
  onSetState: (callback: (payload: FeedOverlaySetStatePayload) => void) => {
    electronAPI.ipcRenderer.on(
      FEED_OVERLAY_SET_STATE_CHANNEL,
      (_event, payload: FeedOverlaySetStatePayload) => callback(payload),
    );
  },
  removeSetStateListener: () => {
    electronAPI.ipcRenderer.removeAllListeners(FEED_OVERLAY_SET_STATE_CHANNEL);
  },

  onPageAgentStatus: (
    callback: (payload: FeedOverlayPageAgentStatusPayload) => void,
  ) => {
    electronAPI.ipcRenderer.on(
      FEED_OVERLAY_PAGE_AGENT_STATUS_CHANNEL,
      (_event, payload: FeedOverlayPageAgentStatusPayload) =>
        callback(payload),
    );
  },

  removePageAgentStatusListener: () => {
    electronAPI.ipcRenderer.removeAllListeners(
      FEED_OVERLAY_PAGE_AGENT_STATUS_CHANNEL,
    );
  },

  quickFeedFromUrl: (url: string) =>
    electronAPI.ipcRenderer.invoke("quick-feed-from-url", url),

  retryQuickFeedForUrl: (url: string) =>
    electronAPI.ipcRenderer.invoke("quick-feed-retry-for-url", url),

  runFeedOverlayPageAgent: (
    goal: string,
  ): Promise<FeedOverlayPageAgentInvokeResult> =>
    electronAPI.ipcRenderer.invoke("feed-overlay-page-agent", goal),

  /** Guest URL after navigation events (`did-navigate`) — for overlay UX tied to active tab. */
  getActiveTabUrl: (): Promise<string | null> =>
    electronAPI.ipcRenderer.invoke("feed-overlay-active-tab-url"),

  /** Active guest tab: raw `loadURL` only (no quick-feed automation). */
  navigateActiveTabToUrl: (url: string) =>
    electronAPI.ipcRenderer.invoke("navigate-to", url),

  getFeedLayoutOverlayEnabled: (): Promise<boolean> =>
    electronAPI.ipcRenderer.invoke("get-feed-layout-overlay-enabled"),

  setFeedLayoutOverlayEnabled: (enabled: boolean) =>
    electronAPI.ipcRenderer.invoke("set-feed-layout-overlay-enabled", enabled),

  onFeedLayoutOverlayEnabledChanged: (
    callback: (enabled: boolean) => void,
  ) => {
    electronAPI.ipcRenderer.on(
      "feed-layout-overlay-enabled-changed",
      (_event, enabled: unknown) => callback(!!enabled),
    );
  },

  removeFeedLayoutOverlayEnabledListener: () => {
    electronAPI.ipcRenderer.removeAllListeners(
      "feed-layout-overlay-enabled-changed",
    );
  },
};

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("blueberryGuest", blueberryGuest);
    contextBridge.exposeInMainWorld("feedOverlayAPI", feedOverlayAPI);
  } catch (e) {
    console.error(e);
  }
} else {
  // @ts-ignore (non-isolated)
  window.blueberryGuest = blueberryGuest;
  // @ts-ignore (non-isolated)
  window.feedOverlayAPI = feedOverlayAPI;
}
