import { BaseWindow, nativeTheme } from "electron";
import { Tab } from "./Tab";
import { TopBar } from "./TopBar";
import { SideBar, SIDEBAR_WIDTH } from "./SideBar";
import { StageOverlay } from "./StageOverlay";

const TOPBAR_HEIGHT = 88;

/** Matches `--muted` / `--foreground` in `src/renderer/topbar/src/index.css` */
const TITLE_BAR_OVERLAY_LIGHT = {
  color: "#f5f5f5",
  symbolColor: "#141414",
} as const;

const TITLE_BAR_OVERLAY_DARK = {
  color: "#282828",
  symbolColor: "#fafafa",
} as const;

/**
 * Owns the BrowserWindow and its three overlay views:
 *
 *   ┌─ TopBar (address bar, tab strip)
 *   ├─ Tab content (one WebContentsView per tab, only the active one shown)
 *   ├─ StageOverlay (the 3D tab deck, hidden by default)
 *   └─ SideBar (chat panel, anchored to the right when visible)
 *
 * The Stage is mostly self-contained — Window just tells it when tabs change.
 */
export class Window {
  private _baseWindow: BaseWindow;
  private tabsMap: Map<string, Tab> = new Map();
  private activeTabId: string | null = null;
  private tabCounter: number = 0;
  private _topBar: TopBar;
  private _sideBar: SideBar;
  private _stage: StageOverlay;

  constructor() {
    this._baseWindow = new BaseWindow({
      width: 1000,
      height: 800,
      show: true,
      autoHideMenuBar: false,
      titleBarStyle: "hidden",
      ...(process.platform !== "darwin" ? { titleBarOverlay: true } : {}),
      trafficLightPosition: { x: 15, y: 13 },
    });

    this._baseWindow.setMinimumSize(1000, 500);

    this._topBar = new TopBar(this._baseWindow);
    this._sideBar = new SideBar(this._baseWindow);
    this._stage = new StageOverlay(this);
    this._stage.setSidebarOpen(this._sideBar.getIsVisible());

    this._sideBar.client.setWindow(this);

    this.createTab();

    this._baseWindow.on("resize", () => {
      this._topBar.updateBounds();
      this.updateAllBounds();
      const bounds = this._baseWindow.getBounds();
      if (this.activeTab) {
        this.activeTab.webContents.send("window-resized", {
          width: bounds.width,
          height: bounds.height,
        });
      }
    });

    this._baseWindow.on("closed", () => {
      this.tabsMap.forEach((tab) => tab.destroy());
      this.tabsMap.clear();
    });

    this.syncTitleBarOverlayTheme(nativeTheme.shouldUseDarkColors);
  }

  /**
   * Window Controls Overlay (Windows / Linux): keep maximize / minimize / close
   * colors in sync with in-app light/dark mode.
   */
  syncTitleBarOverlayTheme(isDarkMode: boolean): void {
    if (process.platform === "darwin") {
      return;
    }
    this._baseWindow.setTitleBarOverlay(
      isDarkMode ? TITLE_BAR_OVERLAY_DARK : TITLE_BAR_OVERLAY_LIGHT
    );
  }

  // ---------- getters ----------

  get baseWindow(): BaseWindow {
    return this._baseWindow;
  }

  get window(): BaseWindow {
    return this._baseWindow;
  }

  get activeTab(): Tab | null {
    return this.activeTabId ? this.tabsMap.get(this.activeTabId) ?? null : null;
  }

  get allTabs(): Tab[] {
    return Array.from(this.tabsMap.values());
  }

  get tabs(): Tab[] {
    return Array.from(this.tabsMap.values());
  }

  get tabCount(): number {
    return this.tabsMap.size;
  }

  get sidebar(): SideBar {
    return this._sideBar;
  }

  get topBar(): TopBar {
    return this._topBar;
  }

  get stage(): StageOverlay {
    return this._stage;
  }

  // ---------- tab management ----------

  createTab(url?: string): Tab {
    const tabId = `tab-${++this.tabCounter}`;
    const tab = new Tab(tabId, url);

    this._baseWindow.contentView.addChildView(tab.view);
    tab.view.setBounds(this.getContentBounds());

    this.raiseOverlaysAboveTabs();
    this.tabsMap.set(tabId, tab);
    this.attachNewWindowHandler(tab);

    // Every navigation in this tab spawns a fresh card on the stage.
    tab.webContents.on("did-navigate", (_, navUrl) => {
      this._stage.recordNavigation(tab, navUrl);
    });
    tab.webContents.on("did-navigate-in-page", (_, navUrl, isMainFrame) => {
      if (isMainFrame) this._stage.recordNavigation(tab, navUrl);
    });
    tab.webContents.on("page-title-updated", (_, title) => {
      this._stage.updateTitle(tab.id, title);
    });
    tab.webContents.on("did-stop-loading", () => {
      void this._stage.refreshTab(tab.id);
    });

    if (this.tabsMap.size === 1) {
      this.switchActiveTab(tabId);
    } else {
      tab.hide();
      this._stage.notifyTabActivated();
    }

    const refocusStage = (): void => this.refocusStageIfVisible();
    tab.webContents.once("did-finish-load", refocusStage);
    this.refocusStageIfVisible();
    return tab;
  }

  /**
   * Route popup/new-window requests to in-app tabs instead of external browser.
   * This keeps stage-triggered link clicks and target="_blank" behavior internal.
   */
  private attachNewWindowHandler(tab: Tab): void {
    tab.webContents.setWindowOpenHandler((details) => {
      const created = this.createTab(details.url);
      this.switchActiveTab(created.id);
      return { action: "deny" };
    });
  }

  closeTab(tabId: string): boolean {
    const tab = this.tabsMap.get(tabId);
    if (!tab) return false;

    this._baseWindow.contentView.removeChildView(tab.view);
    tab.destroy();
    this.tabsMap.delete(tabId);
    this._stage.detachTab(tabId);

    if (this.activeTabId === tabId) {
      this.activeTabId = null;
      const remaining = Array.from(this.tabsMap.keys());
      if (remaining.length > 0) {
        this.switchActiveTab(remaining[0]);
      }
    }

    if (this.tabsMap.size === 0) {
      this._baseWindow.close();
    }
    return true;
  }

  switchActiveTab(tabId: string): boolean {
    const tab = this.tabsMap.get(tabId);
    if (!tab) return false;

    if (this.activeTabId && this.activeTabId !== tabId) {
      this.tabsMap.get(this.activeTabId)?.hide();
    }

    tab.show();
    this.activeTabId = tabId;
    this._baseWindow.setTitle(tab.title || "Blueberry Browser");
    this._stage.notifyTabActivated();
    this.refocusStageIfVisible();
    return true;
  }

  /** Stage overlay should keep focus so arrow keys / prompt work after tab changes. */
  refocusStageIfVisible(): void {
    if (this._stage.visible) {
      this._stage.focusOverlay();
    }
  }

  getTab(tabId: string): Tab | null {
    return this.tabsMap.get(tabId) ?? null;
  }

  // ---------- window controls ----------

  show(): void { this._baseWindow.show(); }
  hide(): void { this._baseWindow.hide(); }
  close(): void { this._baseWindow.close(); }
  focus(): void { this._baseWindow.focus(); }
  minimize(): void { this._baseWindow.minimize(); }
  maximize(): void { this._baseWindow.maximize(); }
  unmaximize(): void { this._baseWindow.unmaximize(); }
  isMaximized(): boolean { return this._baseWindow.isMaximized(); }
  setTitle(title: string): void { this._baseWindow.setTitle(title); }
  setBounds(bounds: { x?: number; y?: number; width?: number; height?: number }): void {
    this._baseWindow.setBounds(bounds);
  }
  getBounds(): { x: number; y: number; width: number; height: number } {
    return this._baseWindow.getBounds();
  }

  // ---------- layout ----------

  /** Area available for tab content + stage (everything but topbar + sidebar). */
  getContentBounds(): { x: number; y: number; width: number; height: number } {
    const bounds = this._baseWindow.getBounds();
    const sidebarReserved =
      this._sideBar?.getIsVisible() ? Math.min(SIDEBAR_WIDTH, bounds.width) : 0;
    return {
      x: 0,
      y: TOPBAR_HEIGHT,
      width: Math.max(0, bounds.width - sidebarReserved),
      height: Math.max(0, bounds.height - TOPBAR_HEIGHT),
    };
  }

  /** Re-apply layout to all child views (called on resize + sidebar toggle). */
  updateAllBounds(): void {
    // Sidebar first so getContentBounds() reflects its visibility for the rest.
    this._sideBar.updateBounds();
    const content = this.getContentBounds();
    this.tabsMap.forEach((tab) => tab.view.setBounds(content));
    this._stage.updateBounds();
  }

  setSidebarVisible(visible: boolean): void {
    if (visible) this._sideBar.show();
    else this._sideBar.hide();
    this.updateAllBounds();
    this.broadcastSidebarVisibility();
  }

  toggleSidebar(): boolean {
    this._sideBar.toggle();
    this.updateAllBounds();
    this.broadcastSidebarVisibility();
    return this._sideBar.getIsVisible();
  }

  /** Notify renderers that anchor to the right edge (e.g. stage speech bubble). */
  broadcastSidebarVisibility(): void {
    const visible = this._sideBar.getIsVisible();
    const payload = visible;
    this._stage.setSidebarOpen(visible);
    this._stage.view.webContents.send("sidebar:visibility", payload);
    this._topBar.view.webContents.send("sidebar:visibility", payload);
  }

  /** Stage avatar uses this to play thinking vs idle while the LLM is working. */
  broadcastChatRequestActive(active: boolean): void {
    const wc = this._stage.view.webContents;
    if (wc.isDestroyed()) return;
    wc.send("sidebar:chat-request-active", active);
  }

  /** Keep the sidebar + stage z-order above tab content so they receive input. */
  private raiseOverlaysAboveTabs(): void {
    const content = this._baseWindow.contentView;
    content.removeChildView(this._sideBar.view);
    content.addChildView(this._sideBar.view);
    content.removeChildView(this._stage.view);
    content.addChildView(this._stage.view);
  }
}
