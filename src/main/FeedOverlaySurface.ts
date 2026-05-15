import { is } from "@electron-toolkit/utils";
import { View, WebContentsView } from "electron";
import { join } from "path";
import {
  FEED_OVERLAY_SET_STATE_CHANNEL,
  type FeedOverlaySetStatePayload,
} from "../shared/feedOverlayIpc";
import { FEED_OVERLAY_LOADING_PAYLOAD } from "../shared/feedOverlaySentinel";

/**
 * Separate WebContentsView stacked above guest tabs so the feed overlay survives
 * in-page navigations and is not subject to guest-page CSP.
 */
export class FeedOverlaySurface {
  private readonly webContentsView: WebContentsView;
  private documentReady = false;
  /** Latest payload main asked for; applied once the overlay document is ready. */
  private queuedPayload: string | null = null;
  private queuedUsesDarkUi = true;

  constructor() {
    this.webContentsView = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, "../preload/feedOverlay.js"),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
        backgroundColor: "#1c1c1e",
      } as Electron.WebPreferences,
    });

    this.webContentsView.setVisible(false);

    const wc = this.webContentsView.webContents;
    wc.on("did-start-navigation", (_event, _url, isSameDocument, isMainFrame) => {
      if (!isMainFrame || isSameDocument) return;
      this.documentReady = false;
    });
    wc.on("did-finish-load", () => {
      this.documentReady = true;
      void this.flushQueuedPayload();
    });

    if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
      const u = new URL(
        "/feedOverlay/",
        process.env["ELECTRON_RENDERER_URL"],
      );
      void wc.loadURL(u.toString());
    } else {
      void wc.loadFile(join(__dirname, "../renderer/feedOverlay/index.html"));
    }
  }

  get view(): WebContentsView {
    return this.webContentsView;
  }

  /** Stack this view above all sibling views (guest tabs). */
  bringAbovePeers(parent: View): void {
    parent.removeChildView(this.webContentsView);
    parent.addChildView(this.webContentsView);
  }

  setBounds(bounds: Electron.Rectangle): void {
    this.webContentsView.setBounds(bounds);
  }

  setVisible(visible: boolean): void {
    this.webContentsView.setVisible(visible);
  }

  destroy(): void {
    this.documentReady = false;
    this.webContentsView.webContents.close();
  }

  cancelPendingPayload(): void {
    this.queuedPayload = null;
  }

  private pushState(payload: FeedOverlaySetStatePayload): void {
    const wc = this.webContentsView.webContents;
    if (wc.isDestroyed()) return;
    wc.send(FEED_OVERLAY_SET_STATE_CHANNEL, payload);
  }

  /**
   * Show or update overlay content. When the document is not ready yet, the payload is
   * queued and applied on `did-finish-load`.
   */
  async setPayload(payloadJson: string, appUsesDarkUi: boolean): Promise<boolean> {
    this.queuedPayload = payloadJson;
    this.queuedUsesDarkUi = appUsesDarkUi;
    if (!this.documentReady) return true;
    return this.flushQueuedPayload();
  }

  private async flushQueuedPayload(): Promise<boolean> {
    const payloadJson = this.queuedPayload;
    if (payloadJson == null || payloadJson.length === 0) return false;
    const appUsesDarkUi = this.queuedUsesDarkUi;
    const wc = this.webContentsView.webContents;
    if (wc.isDestroyed()) return false;
    try {
      if (payloadJson === FEED_OVERLAY_LOADING_PAYLOAD) {
        this.pushState({ kind: "loading", appUsesDarkUi });
        return true;
      }
      this.pushState({
        kind: "content",
        payloadJson,
        appUsesDarkUi,
      });
      return true;
    } catch (e) {
      console.warn("feed overlay surface IPC push failed:", e);
      return false;
    }
  }

  async runHideAnimation(
    preserveChatHistory: boolean = false,
  ): Promise<void> {
    const wc = this.webContentsView.webContents;
    if (wc.isDestroyed()) return;
    this.pushState({ kind: "hidden", preserveChatHistory });
  }
}
