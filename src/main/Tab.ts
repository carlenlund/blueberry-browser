import { NativeImage, WebContentsView } from "electron";
import {
  buildShowClickMarkerScript,
  INSTALL_DEBUG_CLICK_LISTENER_SCRIPT,
  type ClickMarkerDebugResult,
} from "./tabDebugClickMarker";
import { INSTALL_LINK_NEW_TAB_SCRIPT } from "./tabLinkCapture";

export class Tab {
  private webContentsView: WebContentsView;
  private _id: string;
  private _title: string;
  private _url: string;
  private _isVisible: boolean = false;
  private _exclusiveRunChain: Promise<void> = Promise.resolve();

  constructor(id: string, url: string = "https://hackernews.com") {
    this._id = id;
    this._url = url;
    this._title = "New Tab";

    // Create the WebContentsView for web content only
    this.webContentsView = new WebContentsView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
      },
    });

    // Set up event listeners
    this.setupEventListeners();

    // Load the initial URL
    this.loadURL(url);
  }

  private setupEventListeners(): void {
    const wc = this.webContentsView.webContents;

    // Update title when page title changes
    wc.on("page-title-updated", (_, title) => {
      this._title = title;
    });

    // Update URL when navigation occurs
    wc.on("did-navigate", (_, url) => {
      this._url = url;
    });

    wc.on("did-navigate-in-page", (_, url) => {
      this._url = url;
    });

    // In-page debug click markers on real user clicks (works without stage overlay).
    const installPageScripts = (): void => {
      void wc.executeJavaScript(INSTALL_DEBUG_CLICK_LISTENER_SCRIPT, true).catch(() => {});
      void wc.executeJavaScript(INSTALL_LINK_NEW_TAB_SCRIPT, true).catch(() => {});
    };
    wc.on("dom-ready", installPageScripts);
    wc.on("did-finish-load", installPageScripts);
  }

  /** Show debug marker at viewport coordinates (also used for stage-forwarded clicks). */
  async showDebugClickMarkerAt(x: number, y: number): Promise<ClickMarkerDebugResult | null> {
    const wc = this.webContentsView.webContents;
    if (wc.isDestroyed()) return null;
    try {
      await wc.executeJavaScript(INSTALL_DEBUG_CLICK_LISTENER_SCRIPT, true);
      return (await wc.executeJavaScript(
        buildShowClickMarkerScript(x, y),
        true
      )) as ClickMarkerDebugResult;
    } catch {
      return null;
    }
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

  // Queue this callback for execution, to prevent race conditions.
  // Example: To make sure LLM tool calls are executed in order.
  async runExclusive(callback: () => Promise<void>): Promise<void> {
    // Get head of the chain.
    const previous = this._exclusiveRunChain;
    // Current link in chain. Add callback when previous is resolved.
    const current = previous.then(() => callback());
    // Replace head with current.
    // Need a .catch() to prevent exceptions from stopping the chain.
    this._exclusiveRunChain = current.catch(() => {});
    return current;
  }

  async runJs(code: string): Promise<any> {
    // Wrap in closure to avoid global scope pollution.
    // Assumes code has `return <result>` as its final statement.
    const wrappedCode = `
      (function() {
        try {
          ${code}
        } catch (error) {
          return error.message;
        }
      })()
    `;
    return await this.webContentsView.webContents.executeJavaScript(wrappedCode);
  }

  async getTabHtml(): Promise<string> {
    return await this.runJs("return document.documentElement.outerHTML");
  }

  async getTabText(): Promise<string> {
    return await this.runJs("return document.documentElement.innerText");
  }

  /** Resolve once the document has fired `load` (no-op if already complete). */
  async ensureDocumentReady(): Promise<void> {
    await this.runJs(`
      return new Promise((resolve) => {
        if (document.readyState === "complete") {
          resolve(true);
          return;
        }
        window.addEventListener("load", () => resolve(true), { once: true });
      });
    `);
  }

  /** After a navigation, wait for load then a short window so SPAs/iframes can populate. */
  async settleAfterNavigation(extraMs: number = 500): Promise<void> {
    await this.ensureDocumentReady();
    if (extraMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, extraMs));
    }
  }

  /**
   * After injected JS that may start navigation (e.g. anchor.click()), Chromium updates URL/DOM asynchronously.
   * Without a short pause, the next tool call can read stale tab.url / innerText and loop on the old page.
   */
  async settleAfterInjectedScript(minMs: number = 450): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, minMs));
    await this.ensureDocumentReady();
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

  stop(): void {
    this.webContentsView.webContents.stop();
  }

  destroy(): void {
    this.webContentsView.webContents.close();
  }
}
