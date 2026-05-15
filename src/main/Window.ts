import { BaseWindow, nativeTheme, shell } from "electron";
import { Tab } from "./Tab";
import { TopBar } from "./TopBar";
import { SideBar } from "./SideBar";
import { FeedOverlaySurface } from "./FeedOverlaySurface";
import { FEED_OVERLAY_LOADING_PAYLOAD } from "../shared/feedOverlaySentinel";
import { FEED_OVERLAY_PAGE_AGENT_STATUS_CHANNEL } from "../shared/feedOverlayIpc";

export class Window {
  private _baseWindow: BaseWindow;
  private tabsMap: Map<string, Tab> = new Map();
  private activeTabId: string | null = null;
  private tabCounter: number = 0;
  private _topBar: TopBar;
  private _sideBar: SideBar;
  private readonly _feedOverlay: FeedOverlaySurface;
  /** True when the overlay surface last accepted a content payload. */
  private _feedOverlayInjectActive = false;
  /** Top-bar toggle: mirror flattened feed in main web content. Default on. */
  private _feedLayoutOverlayEnabled = true;
  /**
   * Last payload we showed (or loading sentinel). Kept so toggling the overlay back on
   * or refreshing theme can re-apply without re-fetching from the sidebar.
   */
  private _lastFeedOverlayPayload: string | null = null;
  /**
   * Blueberry UI dark mode (from chrome localStorage via IPC). Feed overlay must not use
   * the guest page for theme or for DOM injection.
   */
  private _appUsesDarkUi = nativeTheme.shouldUseDarkColors;

  constructor() {
    // Create the browser window.
    this._baseWindow = new BaseWindow({
      width: 1000,
      height: 800,
      show: true,
      autoHideMenuBar: false,
      titleBarStyle: "hidden",
      ...(process.platform !== "darwin" ? { titleBarOverlay: true } : {}),
      trafficLightPosition: { x: 15, y: 13 },
    });

    this.syncTitleBarOverlayWithAppUi();

    this._baseWindow.setMinimumSize(1000, 800);

    this._topBar = new TopBar(this._baseWindow);
    this._sideBar = new SideBar(this._baseWindow);

    // Set the window reference on the LLM client to avoid circular dependency
    this._sideBar.client.setWindow(this);

    this._feedOverlay = new FeedOverlaySurface();
    this._baseWindow.contentView.addChildView(this._feedOverlay.view);
    this._feedOverlay.setBounds(this.getMainContentBounds());

    // Create the first tab (added above the overlay in z-order).
    this.createTab();
    this._feedOverlay.bringAbovePeers(this._baseWindow.contentView);

    this.updateTabBounds();

    const relayContentResizeToGuest = (): void => {
      const bounds = this._baseWindow.getContentBounds();
      if (this.activeTab) {
        this.activeTab.webContents.send("window-resized", {
          width: bounds.width,
          height: bounds.height,
        });
      }
    };

    // Set up window resize handler
    this._baseWindow.on("resize", () => {
      this.updateTabBounds();
      this._topBar.updateBounds();
      this._sideBar.updateBounds();
      relayContentResizeToGuest();
    });

    this._baseWindow.on("enter-full-screen", () => {
      this.updateTabBounds();
      this._topBar.updateBounds();
      this._sideBar.updateBounds();
      relayContentResizeToGuest();
    });

    this._baseWindow.on("leave-full-screen", () => {
      this.updateTabBounds();
      this._topBar.updateBounds();
      this._sideBar.updateBounds();
      relayContentResizeToGuest();
    });

    // Handle external link opening
    this.tabsMap.forEach((tab) => {
      tab.webContents.setWindowOpenHandler((details) => {
        shell.openExternal(details.url);
        return { action: "deny" };
      });
    });

    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this._baseWindow.on("closed", () => {
      // Clean up all tabs when window is closed
      this.tabsMap.forEach((tab) => tab.destroy());
      this.tabsMap.clear();
      this._feedOverlay.destroy();
    });
  }

  // Getters
  get window(): BaseWindow {
    return this._baseWindow;
  }

  get activeTab(): Tab | null {
    if (this.activeTabId) {
      return this.tabsMap.get(this.activeTabId) || null;
    }
    return null;
  }

  get allTabs(): Tab[] {
    return Array.from(this.tabsMap.values());
  }

  get tabCount(): number {
    return this.tabsMap.size;
  }

  // Tab management methods
  createTab(url?: string): Tab {
    const tabId = `tab-${++this.tabCounter}`;
    const tab = new Tab(tabId, url);

    // Add the tab's WebContentsView to the window
    this._baseWindow.contentView.addChildView(tab.view);

    // Set the bounds to fill the window below the topbar and to the left of sidebar
    const b = this.getMainContentBounds();
    tab.view.setBounds(b);

    // Store the tab
    this.tabsMap.set(tabId, tab);

    tab.webContents.on(
      "did-start-navigation",
      (_event, _url, isSameDocument, isMainFrame) => {
        if (!isMainFrame || isSameDocument) return;
        if (this.activeTab?.id !== tab.id) return;
        this.handleGuestCrossDocumentNavigateStart(tab);
      },
    );

    tab.webContents.on("did-finish-load", () => {
      if (this.activeTab?.id !== tab.id) return;
      this.refreshCachedFeedOverlayAfterGuestLoad();
    });

    // Activate the first tab before the initial loadURL so did-start-navigation
    // sees it as active and can show the feed loading overlay.
    if (this.tabsMap.size === 1) {
      this.switchActiveTab(tabId);
    } else {
      tab.hide();
    }

    tab.flushPendingInitialLoad();

    this._feedOverlay.bringAbovePeers(this._baseWindow.contentView);

    return tab;
  }

  closeTab(tabId: string): boolean {
    const tab = this.tabsMap.get(tabId);
    if (!tab) {
      return false;
    }

    // Remove the WebContentsView from the window
    this._baseWindow.contentView.removeChildView(tab.view);

    // Destroy the tab
    tab.destroy();

    // Remove from our map
    this.tabsMap.delete(tabId);

    // If this was the active tab, switch to another tab
    if (this.activeTabId === tabId) {
      this.activeTabId = null;
      if (this._feedOverlayInjectActive) {
        void this._feedOverlay.runHideAnimation();
        this._feedOverlay.setVisible(false);
        this._feedOverlay.cancelPendingPayload();
        this._feedOverlayInjectActive = false;
        this._sideBar.view.webContents.send(
          "page-map-reset-main-feed-overlay",
        );
      }
      const remainingTabs = Array.from(this.tabsMap.keys());
      if (remainingTabs.length > 0) {
        this.switchActiveTab(remainingTabs[0]);
      }
    }

    // If no tabs left, close the window
    if (this.tabsMap.size === 0) {
      this._baseWindow.close();
    }

    this._feedOverlay.bringAbovePeers(this._baseWindow.contentView);

    return true;
  }

  switchActiveTab(tabId: string): boolean {
    const tab = this.tabsMap.get(tabId);
    if (!tab) {
      return false;
    }

    // Hide the currently active tab
    if (this.activeTabId && this.activeTabId !== tabId) {
      const currentTab = this.tabsMap.get(this.activeTabId);
      if (currentTab) {
        if (this._feedOverlayInjectActive) {
          void this._feedOverlay.runHideAnimation();
          this._feedOverlay.setVisible(false);
          this._feedOverlay.cancelPendingPayload();
          this._feedOverlayInjectActive = false;
          this._sideBar.view.webContents.send(
            "page-map-reset-main-feed-overlay",
          );
        }
        currentTab.hide();
      }
    }

    // Show the new active tab
    tab.show();
    this.activeTabId = tabId;

    // Update the window title to match the tab title
    this._baseWindow.setTitle(tab.title || "Blueberry Browser");

    this._feedOverlay.bringAbovePeers(this._baseWindow.contentView);

    return true;
  }

  getTab(tabId: string): Tab | null {
    return this.tabsMap.get(tabId) || null;
  }

  // Window methods
  show(): void {
    this._baseWindow.show();
  }

  hide(): void {
    this._baseWindow.hide();
  }

  close(): void {
    this._baseWindow.close();
  }

  focus(): void {
    this._baseWindow.focus();
  }

  minimize(): void {
    this._baseWindow.minimize();
  }

  maximize(): void {
    this._baseWindow.maximize();
  }

  unmaximize(): void {
    this._baseWindow.unmaximize();
  }

  isMaximized(): boolean {
    return this._baseWindow.isMaximized();
  }

  setTitle(title: string): void {
    this._baseWindow.setTitle(title);
  }

  setBounds(bounds: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  }): void {
    this._baseWindow.setBounds(bounds);
  }

  getBounds(): { x: number; y: number; width: number; height: number } {
    return this._baseWindow.getBounds();
  }

  private getMainContentBounds(): {
    x: number;
    y: number;
    width: number;
    height: number;
  } {
    const bounds = this._baseWindow.getContentBounds();
    const sidebarWidth = this._sideBar.getIsVisible() ? 400 : 0;
    return {
      x: 0,
      y: 88,
      width: bounds.width - sidebarWidth,
      height: bounds.height - 88,
    };
  }

  // Handle window resize to update tab bounds
  private updateTabBounds(): void {
    const b = this.getMainContentBounds();
    this.tabsMap.forEach((tab) => {
      tab.view.setBounds(b);
    });
    this._feedOverlay.setBounds(b);
  }

  /** Dark mode for feed overlay surface; kept in sync with chrome via IPC. */
  setAppUsesDarkUiFromChrome(isDark: boolean): void {
    if (this._appUsesDarkUi === isDark) return;
    this._appUsesDarkUi = isDark;
    this.syncTitleBarOverlayWithAppUi();
    void this.reapplyCachedFeedOverlay();
  }

  /**
   * Align WCO caption buttons with Blueberry chrome (matches topbar Tailwind `--background`).
   */
  private syncTitleBarOverlayWithAppUi(): void {
    if (process.platform === "darwin") return;
    this._baseWindow.setTitleBarOverlay({
      color: this._appUsesDarkUi ? "#141414" : "#ffffff",
      symbolColor: this._appUsesDarkUi ? "#fafafa" : "#141414",
    });
  }

  /** Active guest tab navigated to a different document; clear stale map UI in the sidebar. */
  private handleGuestCrossDocumentNavigateStart(tab: Tab): void {
    if (this.activeTab?.id !== tab.id) return;

    const side = this._sideBar.view.webContents;
    if (!side.isDestroyed()) {
      side.send("guest-tab-document-navigated");
    }

    if (!this._feedLayoutOverlayEnabled) return;

    /** Transient loading only — never overwrite `_lastFeedOverlayPayload` with the sentinel (would strand reapply / spinner without a new flatten). */
    this._feedOverlay.setVisible(true);
    void this._feedOverlay.setPayload(
      FEED_OVERLAY_LOADING_PAYLOAD,
      this._appUsesDarkUi,
    ).then((ok) => {
      this._feedOverlayInjectActive = ok;
    });
  }

  /** After guest load settles, flush transient loading UI by re-pushing cached content when available. */
  private refreshCachedFeedOverlayAfterGuestLoad(): void {
    if (!this._feedLayoutOverlayEnabled) return;
    const payload = this._lastFeedOverlayPayload;
    if (
      payload == null ||
      payload.length === 0 ||
      payload === FEED_OVERLAY_LOADING_PAYLOAD
    ) {
      return;
    }
    this._feedOverlay.setVisible(true);
    void this._feedOverlay.setPayload(payload, this._appUsesDarkUi).then(
      (ok) => {
        this._feedOverlayInjectActive = ok;
      },
    );
  }

  get feedLayoutOverlayEnabled(): boolean {
    return this._feedLayoutOverlayEnabled;
  }

  setFeedLayoutOverlayEnabled(enabled: boolean): void {
    this._feedLayoutOverlayEnabled = enabled;
    this.broadcastFeedLayoutOverlayEnabled();
  }

  broadcastFeedLayoutOverlayEnabled(): void {
    const v = this._feedLayoutOverlayEnabled;
    const top = this._topBar.view.webContents;
    const side = this._sideBar.view.webContents;
    if (!top.isDestroyed()) {
      top.send("feed-layout-overlay-enabled-changed", v);
    }
    if (!side.isDestroyed()) {
      side.send("feed-layout-overlay-enabled-changed", v);
    }
    if (v) {
      void this.reapplyCachedFeedOverlay();
    }
  }

  /** Re-show overlay after refresh or tab operations (payload is cached in main). */
  private async reapplyCachedFeedOverlay(): Promise<boolean> {
    if (!this._feedLayoutOverlayEnabled) return false;
    const payload = this._lastFeedOverlayPayload;
    if (payload == null || payload.length === 0) return false;
    if (!this.activeTab?.webContents || this.activeTab.webContents.isDestroyed()) {
      return false;
    }
    this._feedOverlay.setVisible(true);
    const ok = await this._feedOverlay.setPayload(payload, this._appUsesDarkUi);
    this._feedOverlayInjectActive = ok;
    return ok;
  }

  /**
   * Show or hide blueberry flatten feed in a dedicated overlay view above the active tab.
   */
  async setMainAreaFeedMode(
    show: boolean,
    payloadJson?: string | null,
  ): Promise<void> {
    const tab = this.activeTab;
    if (!tab) return;

    if (
      show &&
      payloadJson != null &&
      payloadJson.length > 0
    ) {
      this._lastFeedOverlayPayload = payloadJson;
      this._feedOverlay.setVisible(true);
      const ok = await this._feedOverlay.setPayload(payloadJson, this._appUsesDarkUi);
      this._feedOverlayInjectActive = ok;
      return;
    }

    this._lastFeedOverlayPayload = null;
    this._feedOverlay.cancelPendingPayload();
    await this._feedOverlay.runHideAnimation(true);
    this._feedOverlay.setVisible(false);
    this._feedOverlayInjectActive = false;
  }

  // Public method to update all bounds when sidebar is toggled
  updateAllBounds(): void {
    this.updateTabBounds();
    this._sideBar.updateBounds();
  }

  // Getter for sidebar to access from main process
  get sidebar(): SideBar {
    return this._sideBar;
  }

  /** Live status lines for the feed-overlay page agent (renderer appends to chat). */
  sendFeedOverlayPageAgentStatus(text: string): void {
    const wc = this._feedOverlay.view.webContents;
    if (wc.isDestroyed()) return;
    const t = typeof text === "string" ? text.trim() : "";
    if (!t) return;
    wc.send(FEED_OVERLAY_PAGE_AGENT_STATUS_CHANNEL, { text: t });
  }

  // Getter for topBar to access from Menu
  get topBar(): TopBar {
    return this._topBar;
  }

  // Getter for all tabs as array
  get tabs(): Tab[] {
    return Array.from(this.tabsMap.values());
  }

  // Getter for baseWindow to access from Menu
  get baseWindow(): BaseWindow {
    return this._baseWindow;
  }
}
