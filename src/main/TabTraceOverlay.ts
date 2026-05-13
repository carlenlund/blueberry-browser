import { is } from "@electron-toolkit/utils";
import { BaseWindow, WebContentsView } from "electron";
import { join } from "path";

const OVERLAY_WIDTH = 280;
const OVERLAY_HEIGHT = 34;
const MARGIN = 10;

export class TabTraceOverlay {
  private webContentsView: WebContentsView;
  private baseWindow: BaseWindow;

  constructor(baseWindow: BaseWindow) {
    this.baseWindow = baseWindow;
    this.webContentsView = this.createWebContentsView();
    baseWindow.contentView.addChildView(this.webContentsView);
    this.webContentsView.setBackgroundColor("#00000000");
    this.updateBounds();
  }

  private createWebContentsView(): WebContentsView {
    const webContentsView = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, "../preload/traceOverlay.js"),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
      },
    });

    if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
      // Must match Vite root path `src/renderer/trace-overlay/` (not the Rollup input key)
      webContentsView.webContents.loadURL(
        new URL(
          "/trace-overlay/",
          process.env["ELECTRON_RENDERER_URL"]
        ).toString()
      );
    } else {
      webContentsView.webContents.loadFile(
        join(__dirname, "../renderer/trace-overlay/index.html")
      );
    }

    return webContentsView;
  }

  /** Keep the chip above stacked tab WebContentsViews. */
  raiseAboveTabs(): void {
    // Re-adding the same child bumps it to the topmost layer.
    this.baseWindow.contentView.addChildView(this.webContentsView);
  }

  updateBounds(): void {
    const [, contentHeight] = this.baseWindow.getContentSize();
    this.webContentsView.setBounds({
      x: MARGIN,
      y: contentHeight - MARGIN - OVERLAY_HEIGHT,
      width: OVERLAY_WIDTH,
      height: OVERLAY_HEIGHT,
    });
  }

  get view(): WebContentsView {
    return this.webContentsView;
  }
}
