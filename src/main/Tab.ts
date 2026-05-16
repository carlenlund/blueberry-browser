import { NativeImage, WebContentsView } from "electron";

export class Tab {
  private webContentsView: WebContentsView;
  private _id: string;
  private _title: string;
  private _url: string;
  private _isVisible: boolean = false;
  private _exclusiveRunChain: Promise<void> = Promise.resolve();

  constructor(id: string, url: string = "https://www.google.com") {
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

  // Queue this callback for execution.
  // So that JavaScript code or page navigation is not interrupted.
  async runExclusive<T>(callback: () => Promise<T>): Promise<T> {
    const previous = this._exclusiveRunChain;
    const current = previous.then(() => callback());
    this._exclusiveRunChain = current
      .then(() => {})
      .catch(() => {});
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
