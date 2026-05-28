import { is } from "@electron-toolkit/utils";
import { BaseWindow, WebContentsView } from "electron";
import { join } from "path";
import { LLMClient } from "./LLMClient";

/** Anchored-right chat panel. */
export const SIDEBAR_WIDTH = 400;

export class SideBar {
  private webContentsView: WebContentsView;
  private baseWindow: BaseWindow;
  private llmClient: LLMClient;
  private isVisible: boolean = false;

  constructor(baseWindow: BaseWindow) {
    this.baseWindow = baseWindow;
    this.webContentsView = this.createWebContentsView();
    baseWindow.contentView.addChildView(this.webContentsView);
    // Start hidden so layout matches the topbar React state on launch.
    this.applyHiddenBounds();

    // Initialize LLM client
    this.llmClient = new LLMClient(this.webContentsView.webContents);
  }

  private createWebContentsView(): WebContentsView {
    const webContentsView = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, "../preload/sidebar.js"),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false, // Need to disable sandbox for preload to work
      },
    });

    // Load the Sidebar React app
    if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
      // In development, load through Vite dev server
      const sidebarUrl = new URL(
        "/sidebar/",
        process.env["ELECTRON_RENDERER_URL"]
      );
      webContentsView.webContents.loadURL(sidebarUrl.toString());
    } else {
      webContentsView.webContents.loadFile(
        join(__dirname, "../renderer/sidebar.html")
      );
    }

    return webContentsView;
  }

  private applyVisibleBounds(): void {
    const bounds = this.baseWindow.getBounds();
    const width = Math.min(SIDEBAR_WIDTH, bounds.width);
    this.webContentsView.setBounds({
      x: bounds.width - width,
      y: 88,
      width,
      height: bounds.height - 88,
    });
  }

  private applyHiddenBounds(): void {
    this.webContentsView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
  }

  updateBounds(): void {
    if (this.isVisible) {
      this.applyVisibleBounds();
    } else {
      this.applyHiddenBounds();
    }
  }

  get view(): WebContentsView {
    return this.webContentsView;
  }

  get client(): LLMClient {
    return this.llmClient;
  }

  show(): void {
    this.isVisible = true;
    this.applyVisibleBounds();
  }

  hide(): void {
    this.isVisible = false;
    this.applyHiddenBounds();
  }

  toggle(): void {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }

  getIsVisible(): boolean {
    return this.isVisible;
  }
}
