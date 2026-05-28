import { ipcMain, WebContents } from "electron";
import type { Window } from "./Window";

/**
 * Wires up every IPC channel the renderers can call. Each section maps to a
 * single feature area (tabs, sidebar, page content, dark mode, stage).
 */
export class EventManager {
  private mainWindow: Window;

  constructor(mainWindow: Window) {
    this.mainWindow = mainWindow;
    this.handleTabEvents();
    this.handleSidebarEvents();
    this.handlePageContentEvents();
    this.handleDarkModeEvents();
    this.handleStageEvents();
    ipcMain.on("ping", () => console.log("pong"));
  }

  cleanup(): void {
    ipcMain.removeAllListeners();
  }

  // ---------- tabs ----------

  private handleTabEvents(): void {
    ipcMain.handle("create-tab", (_, url?: string) => {
      const tab = this.mainWindow.createTab(url);
      return { id: tab.id, title: tab.title, url: tab.url };
    });

    ipcMain.handle("close-tab", (_, id: string) => {
      this.mainWindow.closeTab(id);
    });

    ipcMain.handle("switch-tab", (_, id: string) => {
      this.mainWindow.switchActiveTab(id);
    });

    ipcMain.handle("get-tabs", () => {
      const activeId = this.mainWindow.activeTab?.id;
      return this.mainWindow.allTabs.map((tab) => ({
        id: tab.id,
        title: tab.title,
        url: tab.url,
        isActive: activeId === tab.id,
      }));
    });

    ipcMain.handle("navigate-to", async (_, url: string) => {
      const tab = this.mainWindow.createTab(url);
      await tab.settleAfterNavigation(1500);
      this.mainWindow.switchActiveTab(tab.id);
    });

    ipcMain.handle("navigate-tab", async (_, tabId: string, url: string) => {
      const tab = this.mainWindow.getTab(tabId);
      if (!tab) return false;
      const newTab = this.mainWindow.createTab(url);
      await newTab.settleAfterNavigation(1500);
      this.mainWindow.switchActiveTab(newTab.id);
      return true;
    });

    ipcMain.handle("go-back", () => this.mainWindow.activeTab?.goBack());
    ipcMain.handle("go-forward", () => this.mainWindow.activeTab?.goForward());
    ipcMain.handle("reload", () => this.mainWindow.activeTab?.reload());

    ipcMain.handle("tab-go-back", (_, tabId: string) => {
      const tab = this.mainWindow.getTab(tabId);
      if (!tab) return false;
      tab.goBack();
      return true;
    });

    ipcMain.handle("tab-go-forward", (_, tabId: string) => {
      const tab = this.mainWindow.getTab(tabId);
      if (!tab) return false;
      tab.goForward();
      return true;
    });

    ipcMain.handle("tab-reload", (_, tabId: string) => {
      const tab = this.mainWindow.getTab(tabId);
      if (!tab) return false;
      tab.reload();
      return true;
    });

    ipcMain.handle("get-active-tab-info", () => {
      const tab = this.mainWindow.activeTab;
      if (!tab) return null;
      return {
        id: tab.id,
        url: tab.url,
        title: tab.title,
        canGoBack: tab.webContents.canGoBack(),
        canGoForward: tab.webContents.canGoForward(),
      };
    });
  }

  // ---------- sidebar / stage visibility ----------

  private handleSidebarEvents(): void {
    ipcMain.handle("toggle-sidebar", () => this.mainWindow.toggleSidebar());

    ipcMain.handle("set-sidebar-visible", (_, visible: boolean) => {
      this.mainWindow.setSidebarVisible(visible);
      return this.mainWindow.sidebar.getIsVisible();
    });

    ipcMain.handle("sidebar:get-visible", () =>
      this.mainWindow.sidebar.getIsVisible()
    );

    ipcMain.handle("toggle-stage", (_, visible?: boolean) => {
      const stage = this.mainWindow.stage;
      const next = typeof visible === "boolean" ? visible : !stage.visible;
      if (next) stage.show();
      else stage.hide();
      this.mainWindow.updateAllBounds();
      return next;
    });

    ipcMain.handle("stage:get-visible", () => this.mainWindow.stage.visible);

    ipcMain.handle("sidebar-chat-message", async (_, request) => {
      await this.mainWindow.sidebar.client.sendChatMessage(request);
    });

    ipcMain.handle("sidebar-clear-chat", () => {
      this.mainWindow.sidebar.client.clearMessages();
      return true;
    });

    ipcMain.handle("sidebar-get-messages", () =>
      this.mainWindow.sidebar.client.getMessages()
    );
  }

  // ---------- page content ----------

  private handlePageContentEvents(): void {
    ipcMain.handle("get-page-content", async () => {
      const tab = this.mainWindow.activeTab;
      if (!tab) return null;
      try {
        return await tab.getTabHtml();
      } catch (err) {
        console.error("get-page-content failed", err);
        return null;
      }
    });

    ipcMain.handle("get-page-text", async () => {
      const tab = this.mainWindow.activeTab;
      if (!tab) return null;
      try {
        return await tab.getTabText();
      } catch (err) {
        console.error("get-page-text failed", err);
        return null;
      }
    });

    ipcMain.handle("get-current-url", () => this.mainWindow.activeTab?.url ?? null);
  }

  // ---------- dark mode ----------

  private handleDarkModeEvents(): void {
    ipcMain.on("dark-mode-changed", (event, isDarkMode: boolean) => {
      this.broadcastDarkMode(event.sender, isDarkMode);
    });
  }

  private broadcastDarkMode(sender: WebContents, isDarkMode: boolean): void {
    this.mainWindow.syncTitleBarOverlayTheme(isDarkMode);
    const recipients = [
      this.mainWindow.topBar.view.webContents,
      this.mainWindow.sidebar.view.webContents,
      this.mainWindow.stage.view.webContents,
      ...this.mainWindow.allTabs.map((tab) => tab.webContents),
    ];
    for (const wc of recipients) {
      if (wc !== sender) wc.send("dark-mode-updated", isDarkMode);
    }
  }

  // ---------- stage ----------

  private handleStageEvents(): void {
    ipcMain.handle("stage:get-state", () => this.mainWindow.stage.snapshot());

    ipcMain.handle("stage:activate-card", (_, cardId: string) =>
      this.mainWindow.stage.activateCard(cardId)
    );
    ipcMain.handle(
      "stage:card-click",
      async (_, cardId: string, normX: number, normY: number) => {
        const ok = await this.mainWindow.stage.forwardCardClick(cardId, normX, normY);
        return ok;
      }
    );
    ipcMain.handle(
      "stage:card-scroll",
      (_, cardId: string, normX: number, normY: number, deltaY: number) =>
        this.mainWindow.stage.forwardCardScroll(cardId, normX, normY, deltaY)
    );

    ipcMain.handle("stage:close", () => {
      this.mainWindow.stage.hide();
      this.mainWindow.updateAllBounds();
      return true;
    });

    ipcMain.handle(
      "stage:mine-dom",
      (
        _,
        cardId: string,
        normX: number,
        normY: number,
        options?: { lettersPerBatch?: number; persistRadius?: boolean }
      ) => this.mainWindow.stage.mineDomAtCard(cardId, normX, normY, options)
    );

    ipcMain.handle("stage:hide-mine-radii", () => this.mainWindow.stage.hideAllMineRadii());
  }
}
