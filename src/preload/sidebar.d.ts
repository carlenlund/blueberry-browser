import { ElectronAPI } from "@electron-toolkit/preload";

interface ChatRequest {
  message: string;
  messageId: string;
  context?: {
    url: string | null;
    content: string | null;
    text: string | null;
  };
}

interface ChatResponse {
  messageId: string;
  content: string;
  isComplete: boolean;
}

interface RunConfirmedScriptResult {
  ok: boolean;
  display: string;
}

interface ActiveTabInfo {
  id: string;
  title: string;
  url: string;
  canGoBack: boolean;
  canGoForward: boolean;
}

interface SidebarAPI {
  sendChatMessage: (request: Partial<ChatRequest>) => Promise<void>;
  clearChat: () => Promise<boolean>;
  getMessages: () => Promise<unknown[]>;
  onChatResponse: (callback: (data: ChatResponse) => void) => void;
  onMessagesUpdated: (callback: (messages: unknown[]) => void) => void;
  removeChatResponseListener: () => void;
  removeMessagesUpdatedListener: () => void;
  runConfirmedScript?: (code: string) => Promise<RunConfirmedScriptResult>;
  getPageContent: () => Promise<string | null>;
  getPageText: () => Promise<string | null>;
  getCurrentUrl: () => Promise<string | null>;
  getActiveTabInfo: () => Promise<ActiveTabInfo | null>;
}

declare global {
  interface Window {
    electron: ElectronAPI;
    sidebarAPI: SidebarAPI;
  }
}
