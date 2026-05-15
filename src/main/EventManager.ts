import { ipcMain, nativeTheme, WebContents } from "electron";
import type { Window } from "./Window";
import { domMapDiskCache } from "./DomMapDiskCache";
import { domMapCacheKey } from "../shared/domMapCacheKeys";
import { normalizeQuickOpenInput } from "../shared/navigateQuickOpen";
import type { FeedOverlayPageAgentInvokeResult } from "../shared/feedOverlayPageAgentPrompt";

export class EventManager {
  private mainWindow: Window;

  constructor(mainWindow: Window) {
    this.mainWindow = mainWindow;
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // Tab management events
    this.handleTabEvents();

    // Sidebar events
    this.handleSidebarEvents();

    // Page content events
    this.handlePageContentEvents();

    // Dark mode events
    this.handleDarkModeEvents();

    // Debug events
    this.handleDebugEvents();
  }

  private handleTabEvents(): void {
    // Create new tab
    ipcMain.handle("create-tab", (_, url?: string) => {
      const newTab = this.mainWindow.createTab(url);
      return { id: newTab.id, title: newTab.title, url: newTab.url };
    });

    // Close tab
    ipcMain.handle("close-tab", (_, id: string) => {
      this.mainWindow.closeTab(id);
    });

    // Switch tab
    ipcMain.handle("switch-tab", (_, id: string) => {
      this.mainWindow.switchActiveTab(id);
    });

    // Get tabs
    ipcMain.handle("get-tabs", () => {
      const activeTabId = this.mainWindow.activeTab?.id;
      return this.mainWindow.allTabs.map((tab) => ({
        id: tab.id,
        title: tab.title,
        url: tab.url,
        isActive: activeTabId === tab.id,
      }));
    });

    // Navigation (for compatibility with existing code)
    ipcMain.handle("navigate-to", (_, rawUrl: string) => {
      const trimmed = typeof rawUrl === "string" ? rawUrl.trim() : "";
      if (!trimmed) return;

      const tab = this.mainWindow.activeTab;
      if (!tab) return;

      const url = normalizeQuickOpenInput(trimmed);
      void tab.loadURL(url).catch((e) => {
        console.warn("[navigate-to] loadURL:", e);
      });
    });

    ipcMain.handle("quick-feed-from-url", async (_, rawUrl: string) => {
      this.mainWindow.sidebar.client.cancelOngoingAssistantStream();

      const trimmed = typeof rawUrl === "string" ? rawUrl.trim() : "";
      if (!trimmed) {
        return { ok: false as const, error: "Empty URL" };
      }

      const url = normalizeQuickOpenInput(trimmed);

      const tab = this.mainWindow.activeTab;
      if (!tab) return { ok: false as const, error: "No active tab" };

      /** Do not `await loadURL`: its promise settles on **full** load (assets), not DOM. */
      void tab.loadURL(url).catch((e) => {
        console.warn("[quick-feed] loadURL:", e);
      });

      await tab.waitUntilContentReady(0);

      this.mainWindow.sidebar.view.webContents.send("quick-feed-automation-run");
      return { ok: true as const };
    });

    /** Drop cached flatten JS for this page (both hidden-structure keys), then same run as quick-feed-from-url. */
    ipcMain.handle("quick-feed-retry-for-url", async (_, rawUrl: string) => {
      this.mainWindow.sidebar.client.cancelOngoingAssistantStream();

      const trimmed = typeof rawUrl === "string" ? rawUrl.trim() : "";
      if (!trimmed) {
        return { ok: false as const, error: "Empty URL" };
      }

      const url = normalizeQuickOpenInput(trimmed);
      domMapDiskCache.forgetFlatten(domMapCacheKey(url, false));
      domMapDiskCache.forgetFlatten(domMapCacheKey(url, true));

      const tab = this.mainWindow.activeTab;
      if (!tab) return { ok: false as const, error: "No active tab" };

      void tab.loadURL(url).catch((e) => {
        console.warn("[quick-feed-retry] loadURL:", e);
      });

      await tab.waitUntilContentReady(0);

      this.mainWindow.sidebar.view.webContents.send("quick-feed-automation-run");
      return { ok: true as const };
    });

    ipcMain.handle(
      "feed-overlay-page-agent",
      async (_, goal: string): Promise<FeedOverlayPageAgentInvokeResult> => {
        const g = typeof goal === "string" ? goal : "";
        return this.mainWindow.sidebar.client.runFeedOverlayPageAgent(g);
      },
    );

    ipcMain.handle("feed-overlay-active-tab-url", () => {
      const tab = this.mainWindow.activeTab;
      const u = tab?.url;
      return typeof u === "string" && u.trim() ? u.trim() : null;
    });

    ipcMain.handle(
      "wait-active-tab-content-ready",
      async (_, opts?: { settleMs?: number }) => {
        const tab = this.mainWindow.activeTab;
        if (!tab) {
          return { ok: false as const, error: "No active tab" };
        }
        const settle =
          opts != null && typeof opts.settleMs === "number"
            ? opts.settleMs
            : 0;
        await tab.waitUntilContentReady(settle);
        return { ok: true as const };
      },
    );

    ipcMain.handle("navigate-tab", async (_, tabId: string, url: string) => {
      const tab = this.mainWindow.getTab(tabId);
      if (tab) {
        await tab.loadURL(url);
        return true;
      }
      return false;
    });

    ipcMain.handle("go-back", () => {
      if (this.mainWindow.activeTab) {
        this.mainWindow.activeTab.goBack();
      }
    });

    ipcMain.handle("go-forward", () => {
      if (this.mainWindow.activeTab) {
        this.mainWindow.activeTab.goForward();
      }
    });

    ipcMain.handle("reload", () => {
      if (this.mainWindow.activeTab) {
        this.mainWindow.activeTab.reload();
      }
    });

    // Tab-specific navigation handlers
    ipcMain.handle("tab-go-back", (_, tabId: string) => {
      const tab = this.mainWindow.getTab(tabId);
      if (tab) {
        tab.goBack();
        return true;
      }
      return false;
    });

    ipcMain.handle("tab-go-forward", (_, tabId: string) => {
      const tab = this.mainWindow.getTab(tabId);
      if (tab) {
        tab.goForward();
        return true;
      }
      return false;
    });

    ipcMain.handle("tab-reload", (_, tabId: string) => {
      const tab = this.mainWindow.getTab(tabId);
      if (tab) {
        tab.reload();
        return true;
      }
      return false;
    });

    ipcMain.handle("tab-screenshot", async (_, tabId: string) => {
      const tab = this.mainWindow.getTab(tabId);
      if (tab) {
        const image = await tab.screenshot();
        return image.toDataURL();
      }
      return null;
    });

    ipcMain.handle("tab-run-js", async (_, tabId: string, code: string) => {
      const tab = this.mainWindow.getTab(tabId);
      if (tab) {
        return await tab.runJs(code);
      }
      return null;
    });

    // Tab info
    ipcMain.handle("get-active-tab-info", () => {
      const activeTab = this.mainWindow.activeTab;
      if (activeTab) {
        return {
          id: activeTab.id,
          url: activeTab.url,
          title: activeTab.title,
          canGoBack: activeTab.webContents.canGoBack(),
          canGoForward: activeTab.webContents.canGoForward(),
        };
      }
      return null;
    });
  }

  private handleSidebarEvents(): void {
    // Toggle sidebar
    ipcMain.handle("toggle-sidebar", () => {
      this.mainWindow.sidebar.toggle();
      this.mainWindow.updateAllBounds();
      return true;
    });

    ipcMain.handle("get-feed-layout-overlay-enabled", () => {
      return this.mainWindow.feedLayoutOverlayEnabled;
    });

    ipcMain.handle("set-feed-layout-overlay-enabled", (_, enabled: unknown) => {
      this.mainWindow.setFeedLayoutOverlayEnabled(!!enabled);
      return true;
    });

    // Chat message
    ipcMain.handle("sidebar-chat-message", async (_, request) => {
      // The LLMClient now handles getting the screenshot and context directly
      await this.mainWindow.sidebar.client.sendChatMessage(request);
    });

    // Clear chat
    ipcMain.handle("sidebar-clear-chat", () => {
      this.mainWindow.sidebar.client.clearMessages();
      return true;
    });

    // Get messages
    ipcMain.handle("sidebar-get-messages", () => {
      return this.mainWindow.sidebar.client.getMessages();
    });

    ipcMain.handle(
      "set-main-area-feed-mode",
      async (_, payload: { show: boolean; payloadJson?: string }) => {
        if (payload?.show && payload.payloadJson) {
          await this.mainWindow.setMainAreaFeedMode(
            true,
            payload.payloadJson,
          );
        } else {
          await this.mainWindow.setMainAreaFeedMode(false);
        }
        return true;
      },
    );

    ipcMain.handle(
      "dom-map-cache-peek-flatten",
      (_, payload: { url: string; includeHidden: boolean }) => {
        const key = domMapCacheKey(payload.url, payload.includeHidden);
        return domMapDiskCache.peekFlatten(key);
      },
    );

    ipcMain.handle(
      "dom-map-cache-remember-flatten",
      (_, payload: { url: string; includeHidden: boolean; script: string }) => {
        const key = domMapCacheKey(payload.url, payload.includeHidden);
        domMapDiskCache.rememberFlatten(key, payload.script);
        return true;
      },
    );

    ipcMain.handle(
      "dom-map-cache-forget-flatten",
      (_, payload: { url: string; includeHidden: boolean }) => {
        const key = domMapCacheKey(payload.url, payload.includeHidden);
        domMapDiskCache.forgetFlatten(key);
        return true;
      },
    );
  }

  private handlePageContentEvents(): void {
    // Get page content
    ipcMain.handle("get-page-content", async () => {
      if (this.mainWindow.activeTab) {
        try {
          return await this.mainWindow.activeTab.getTabHtml();
        } catch (error) {
          console.error("Error getting page content:", error);
          return null;
        }
      }
      return null;
    });

    // Get page text
    ipcMain.handle("get-page-text", async () => {
      if (this.mainWindow.activeTab) {
        try {
          return await this.mainWindow.activeTab.getTabText();
        } catch (error) {
          console.error("Error getting page text:", error);
          return null;
        }
      }
      return null;
    });

    // Get current URL
    ipcMain.handle("get-current-url", () => {
      if (this.mainWindow.activeTab) {
        return this.mainWindow.activeTab.url;
      }
      return null;
    });
  }

  private handleDarkModeEvents(): void {
    // Dark mode broadcasting
    ipcMain.on("dark-mode-changed", (event, isDarkMode) => {
      this.broadcastDarkMode(event.sender, isDarkMode);
    });
  }

  private handleDebugEvents(): void {
    // Ping test
    ipcMain.on("ping", () => console.log("pong"));
  }

  private broadcastDarkMode(sender: WebContents, isDarkMode: boolean): void {
    const isDark = !!isDarkMode;
    nativeTheme.themeSource = isDark ? "dark" : "light";
    this.mainWindow.setAppUsesDarkUiFromChrome(isDark);

    // Send to topbar
    if (this.mainWindow.topBar.view.webContents !== sender) {
      this.mainWindow.topBar.view.webContents.send(
        "dark-mode-updated",
        isDark
      );
    }

    // Send to sidebar
    if (this.mainWindow.sidebar.view.webContents !== sender) {
      this.mainWindow.sidebar.view.webContents.send(
        "dark-mode-updated",
        isDark
      );
    }

    // Send to all tabs
    this.mainWindow.allTabs.forEach((tab) => {
      if (tab.webContents !== sender) {
        tab.webContents.send("dark-mode-updated", isDark);
      }
    });
  }

  // Clean up event listeners
  public cleanup(): void {
    ipcMain.removeAllListeners();
  }
}
