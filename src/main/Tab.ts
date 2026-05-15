import { NativeImage, WebContentsView, nativeTheme } from "electron";
import { join } from "path";

/** Guest tab WebContentsView; window attaches navigation listeners for overlay sync. */
export class Tab {
  private webContentsView: WebContentsView;
  private _id: string;
  private _title: string;
  private _url: string;
  private _isVisible: boolean = false;
  private pendingInitialNavigateUrl?: string | null;

  constructor(id: string, url: string = "https://www.google.com") {
    this._id = id;
    this._url = url;
    this._title = "New Tab";

    // Create the WebContentsView for web content only
    this.webContentsView = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, "../preload/guestTab.js"),
        nodeIntegration: false,
        contextIsolation: true,
        // sandbox must be false for preload to expose blueberryGuest into the tab
        // (same constraint as SideBar / TopBar in this codebase).
        sandbox: false,
        webSecurity: true,
        backgroundColor: nativeTheme.shouldUseDarkColors ? "#1c1c1e" : "#f2f2f7",
      } as Electron.WebPreferences,
    });

    this.pendingInitialNavigateUrl = url;

    // Set up event listeners
    this.setupEventListeners();
  }

  flushPendingInitialLoad(): void {
    const u = this.pendingInitialNavigateUrl;
    this.pendingInitialNavigateUrl = null;
    const target = typeof u === "string" ? u : "https://www.google.com";
    void this.loadURL(target);
  }

  private setupEventListeners(): void {
    // Update title when page title changes
    this.webContentsView.webContents.on("page-title-updated", (_, title) => {
      this._title = title;
    });

    // Update URL when navigation occurs
    this.webContentsView.webContents.on("did-navigate", (_, url) => {
      this._url = url;
    });

    this.webContentsView.webContents.on("did-navigate-in-page", (_, url) => {
      this._url = url;
    });
  }

  // Getters
  get id(): string {
    return this._id;
  }

  get title(): string {
    return this._title;
  }

  get url(): string {
    return this._url;
  }

  get isVisible(): boolean {
    return this._isVisible;
  }

  get webContents() {
    return this.webContentsView.webContents;
  }

  get view(): WebContentsView {
    return this.webContentsView;
  }

  // Public methods
  show(): void {
    this._isVisible = true;
    this.webContentsView.setVisible(true);
  }

  hide(): void {
    this._isVisible = false;
    this.webContentsView.setVisible(false);
  }

  async screenshot(): Promise<NativeImage> {
    return await this.webContentsView.webContents.capturePage();
  }

  async runJs(code: string): Promise<any> {
    return await this.webContentsView.webContents.executeJavaScript(code);
  }

  async getTabHtml(): Promise<string> {
    return await this.runJs("return document.documentElement.outerHTML");
  }

  async getTabText(): Promise<string> {
    return await this.runJs("return document.documentElement.innerText");
  }

  loadURL(url: string): Promise<void> {
    this._url = url;
    return this.webContentsView.webContents.loadURL(url);
  }

  goBack(): void {
    if (this.webContentsView.webContents.navigationHistory.canGoBack()) {
      this.webContentsView.webContents.navigationHistory.goBack();
    }
  }

  goForward(): void {
    if (this.webContentsView.webContents.navigationHistory.canGoForward()) {
      this.webContentsView.webContents.navigationHistory.goForward();
    }
  }

  reload(): void {
    this.webContentsView.webContents.reload();
  }

  /**
   * Resolve when parsed HTML is available to script — `document.readyState` **interactive**
   * (or **complete**), matching DOMContentLoaded / early DOM — **not** window load and not
   * after all images/stylesheets. Also resolves on `did-fail-load`.
   *
   * Does **not** wait for Electron’s `loadURL()` promise (that tracks full load). Callers that
   * need this should start navigation with **`void tab.loadURL(url)`** and then await this.
   */
  async waitUntilContentReady(settleMs: number): Promise<void> {
    const wc = this.webContentsView.webContents;
    const maxNavWaitMs = Math.max(3500, settleMs + 600);

    const isDomInteractive = (): Promise<boolean> =>
      wc
        .executeJavaScript(
          "document.readyState === 'interactive' || document.readyState === 'complete'",
        )
        .then((v) => v === true)
        .catch(() => false);

    await new Promise<void>((resolve) => {
      let finished = false;
      let poll: ReturnType<typeof setInterval>;
      let tmax: ReturnType<typeof setTimeout>;

      const done = (): void => {
        if (finished) return;
        finished = true;
        clearInterval(poll);
        clearTimeout(tmax);
        wc.off("dom-ready", onDomReady);
        wc.off("did-fail-load", onFail);
        resolve();
      };

      const onDomReady = (): void => done();
      const onFail = (): void => done();

      wc.on("dom-ready", onDomReady);
      wc.on("did-fail-load", onFail);

      poll = setInterval(() => {
        void isDomInteractive().then((ok) => {
          if (ok) done();
        });
      }, 24);

      void isDomInteractive().then((ok) => {
        if (ok) done();
      });

      tmax = setTimeout(done, maxNavWaitMs);
    });

    if (settleMs > 0) {
      await new Promise<void>((r) => setTimeout(r, settleMs));
    }
  }

  stop(): void {
    this.webContentsView.webContents.stop();
  }

  destroy(): void {
    this.webContentsView.webContents.close();
  }
}
