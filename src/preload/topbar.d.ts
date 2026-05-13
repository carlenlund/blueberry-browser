import { ElectronAPI } from "@electron-toolkit/preload";

interface TabInfo {
  id: string;
  title: string;
  url: string;
  isActive: boolean;
}

interface DebugTraceFlowResult {
  color: "red" | "green" | "blue";
  source: "topbar" | "sidebar";
  module: string;
  detail: Record<string, unknown>;
}

interface TopBarAPI {
  // Tab management
  createTab: (
    url?: string
  ) => Promise<{ id: string; title: string; url: string } | null>;
  closeTab: (tabId: string) => Promise<boolean>;
  switchTab: (tabId: string) => Promise<boolean>;
  getTabs: () => Promise<TabInfo[]>;

  // Tab navigation
  navigateTab: (tabId: string, url: string) => Promise<void>;
  goBack: (tabId: string) => Promise<void>;
  goForward: (tabId: string) => Promise<void>;
  reload: (tabId: string) => Promise<void>;

  // Tab actions
  tabScreenshot: (tabId: string) => Promise<string | null>;
  tabRunJs: (tabId: string, code: string) => Promise<any>;

  // Sidebar
  toggleSidebar: () => Promise<void>;

  traceFlow: (
    color: "red" | "green" | "blue",
    source: "topbar" | "sidebar"
  ) => Promise<DebugTraceFlowResult>;
}

declare global {
  interface Window {
    electron: ElectronAPI;
    topBarAPI: TopBarAPI;
  }
}

