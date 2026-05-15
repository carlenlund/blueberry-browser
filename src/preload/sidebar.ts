import { contextBridge } from "electron";
import { electronAPI } from "@electron-toolkit/preload";

interface ChatRequest {
  message: string;
  context: {
    url: string | null;
    content: string | null;
    text: string | null;
  };
  messageId: string;
}

interface ChatResponse {
  messageId: string;
  content: string;
  isComplete: boolean;
}

// Sidebar specific APIs
const sidebarAPI = {
  // Chat functionality
  sendChatMessage: (request: Partial<ChatRequest>) =>
    electronAPI.ipcRenderer.invoke("sidebar-chat-message", request),

  clearChat: () => electronAPI.ipcRenderer.invoke("sidebar-clear-chat"),

  getMessages: () => electronAPI.ipcRenderer.invoke("sidebar-get-messages"),

  onChatResponse: (callback: (data: ChatResponse) => void) => {
    electronAPI.ipcRenderer.on("chat-response", (_, data) => callback(data));
  },

  onMessagesUpdated: (callback: (messages: any[]) => void) => {
    electronAPI.ipcRenderer.on("chat-messages-updated", (_, messages) =>
      callback(messages)
    );
  },

  removeChatResponseListener: () => {
    electronAPI.ipcRenderer.removeAllListeners("chat-response");
  },

  removeMessagesUpdatedListener: () => {
    electronAPI.ipcRenderer.removeAllListeners("chat-messages-updated");
  },

  // Page content access
  getPageContent: () => electronAPI.ipcRenderer.invoke("get-page-content"),
  getPageText: () => electronAPI.ipcRenderer.invoke("get-page-text"),
  getCurrentUrl: () => electronAPI.ipcRenderer.invoke("get-current-url"),

  // Tab information
  getActiveTabInfo: () => electronAPI.ipcRenderer.invoke("get-active-tab-info"),

  tabRunJs: (tabId: string, code: string) =>
    electronAPI.ipcRenderer.invoke("tab-run-js", tabId, code),

  waitActiveTabContentReady: (opts?: { settleMs?: number }) =>
    electronAPI.ipcRenderer.invoke("wait-active-tab-content-ready", opts),

  setMainAreaFeedMode: (show: boolean, payloadJson?: string) =>
    electronAPI.ipcRenderer.invoke("set-main-area-feed-mode", {
      show,
      payloadJson,
    }),

  onDismissMainFeedOverlay: (callback: () => void) => {
    electronAPI.ipcRenderer.on(
      "page-map-reset-main-feed-overlay",
      callback,
    );
  },

  removeDismissMainFeedOverlayListener: () => {
    electronAPI.ipcRenderer.removeAllListeners(
      "page-map-reset-main-feed-overlay",
    );
  },

  getFeedLayoutOverlayEnabled: (): Promise<boolean> =>
    electronAPI.ipcRenderer.invoke("get-feed-layout-overlay-enabled"),

  setFeedLayoutOverlayEnabled: (enabled: boolean) =>
    electronAPI.ipcRenderer.invoke("set-feed-layout-overlay-enabled", enabled),

  onFeedLayoutOverlayEnabledChanged: (callback: (enabled: boolean) => void) => {
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

  onQuickFeedAutomationRun: (callback: () => void) => {
    electronAPI.ipcRenderer.on("quick-feed-automation-run", callback);
  },

  removeQuickFeedAutomationRunListener: () => {
    electronAPI.ipcRenderer.removeAllListeners("quick-feed-automation-run");
  },

  domMapCachePeekFlatten: (url: string, includeHidden: boolean) =>
    electronAPI.ipcRenderer.invoke("dom-map-cache-peek-flatten", {
      url,
      includeHidden,
    }) as Promise<string | null>,

  domMapCacheRememberFlatten: (
    url: string,
    includeHidden: boolean,
    script: string,
  ) =>
    electronAPI.ipcRenderer.invoke("dom-map-cache-remember-flatten", {
      url,
      includeHidden,
      script,
    }),

  domMapCacheForgetFlatten: (url: string, includeHidden: boolean) =>
    electronAPI.ipcRenderer.invoke("dom-map-cache-forget-flatten", {
      url,
      includeHidden,
    }),

  onGuestTabDocumentNavigated: (callback: () => void) => {
    electronAPI.ipcRenderer.on("guest-tab-document-navigated", callback);
  },

  removeGuestTabDocumentNavigatedListener: () => {
    electronAPI.ipcRenderer.removeAllListeners("guest-tab-document-navigated");
  },
};

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("electron", electronAPI);
    contextBridge.exposeInMainWorld("sidebarAPI", sidebarAPI);
  } catch (error) {
    console.error(error);
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI;
  // @ts-ignore (define in dts)
  window.sidebarAPI = sidebarAPI;
}
