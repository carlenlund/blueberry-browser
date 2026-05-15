import { ElectronAPI } from "@electron-toolkit/preload";

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

interface TabInfo {
  id: string;
  title: string;
  url: string;
  isActive: boolean;
}

interface SidebarAPI {
  sendChatMessage: (request: Partial<ChatRequest>) => Promise<void>;
  clearChat: () => Promise<void>;
  getMessages: () => Promise<unknown[]>;
  onChatResponse: (callback: (data: ChatResponse) => void) => void;
  removeChatResponseListener: () => void;
  onMessagesUpdated: (callback: (messages: unknown[]) => void) => void;
  removeMessagesUpdatedListener: () => void;

  getPageContent: () => Promise<string | null>;
  getPageText: () => Promise<string | null>;
  getCurrentUrl: () => Promise<string | null>;

  getActiveTabInfo: () => Promise<TabInfo | null>;

  tabRunJs: (tabId: string, code: string) => Promise<unknown>;

  waitActiveTabContentReady: (
    opts?: { settleMs?: number },
  ) => Promise<{ ok: true } | { ok: false; error: string }>;

  setMainAreaFeedMode: (
    show: boolean,
    payloadJson?: string,
  ) => Promise<boolean>;

  onDismissMainFeedOverlay: (callback: () => void) => void;
  removeDismissMainFeedOverlayListener: () => void;

  getFeedLayoutOverlayEnabled: () => Promise<boolean>;
  setFeedLayoutOverlayEnabled: (enabled: boolean) => Promise<unknown>;

  onFeedLayoutOverlayEnabledChanged: (
    callback: (enabled: boolean) => void,
  ) => void;
  removeFeedLayoutOverlayEnabledListener: () => void;

  onQuickFeedAutomationRun: (callback: () => void) => void;
  removeQuickFeedAutomationRunListener: () => void;

  domMapCachePeekFlatten: (
    url: string,
    includeHidden: boolean,
  ) => Promise<string | null>;
  domMapCacheRememberFlatten: (
    url: string,
    includeHidden: boolean,
    script: string,
  ) => Promise<unknown>;
  domMapCacheForgetFlatten: (
    url: string,
    includeHidden: boolean,
  ) => Promise<unknown>;

  onGuestTabDocumentNavigated: (callback: () => void) => void;
  removeGuestTabDocumentNavigatedListener: () => void;
}

declare global {
  interface Window {
    electron: ElectronAPI;
    sidebarAPI: SidebarAPI;
  }
}
