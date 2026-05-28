import { is } from "@electron-toolkit/utils";
import { WebContentsView, type NativeImage } from "electron";
import { join } from "path";
import type { Tab } from "./Tab";
import type { Window } from "./Window";
import {
  STAGE_CAPTURE_VIEWPORT_HEIGHT,
  STAGE_CAPTURE_VIEWPORT_WIDTH,
} from "./tabDebugClickMarker";
import type {
  Card,
  StageState,
  ThumbnailEvent,
  RunToPointEvent,
} from "../preload/stageContract";
import { STAGE_CARD_STRIDE } from "../preload/stageContract";
import {
  buildMineDomBatchScript,
  HIDE_MINE_RADIUS_SCRIPT,
  INSTALL_DOM_MINING_STYLES_SCRIPT,
} from "./tabDomMining";

export interface MineDomOptions {
  lettersPerBatch?: number;
  persistRadius?: boolean;
}

/** Active card thumbnail refresh rate (~24 fps). */
const CAPTURE_FPS = 24;
const ACTIVE_INTERVAL_MS = Math.round(1000 / CAPTURE_FPS);
const CAPTURE_TICK_MS = ACTIVE_INTERVAL_MS;
const STAGE_THUMBNAIL_SIZE = 1000;
/** Active card capture scale while the sidebar (talk mode) is open. */
const STAGE_THUMBNAIL_HI_RES_SCALE = 4;
const STAGE_THUMBNAIL_HI_RES_SIZE = STAGE_THUMBNAIL_SIZE * STAGE_THUMBNAIL_HI_RES_SCALE;
// Capture from a fixed viewport so stage thumbnails are independent of
// browser window size/fullscreen. This stabilizes page layout in captures.
const CAPTURE_VIEWPORT_WIDTH = STAGE_CAPTURE_VIEWPORT_WIDTH;
const CAPTURE_VIEWPORT_HEIGHT = STAGE_CAPTURE_VIEWPORT_HEIGHT;

/**
 * Owns everything the 3D Stage needs in the main process:
 *
 *   - A `WebContentsView` that hosts the stage renderer.
 *   - A list of `Card`s — one per visited page (not per tab). Each navigation
 *     spawns a fresh card; the previous card on that tab becomes a ghost.
 *   - A simple capture loop that pushes screenshots keyed by cardId.
 *
 * Window.ts hooks tab navigations to `recordNavigation()` / `updateTitle()` /
 * `detachTab()`. The renderer is the only IPC recipient, so we just send
 * directly to `this.view.webContents` — no pub/sub class needed.
 */
export class StageOverlay {
  private window: Window;
  private webContentsView: WebContentsView;
  private isVisible = false;

  // ---- card model ----
  private cards: Card[] = [];
  private currentCardByTab = new Map<string, string>();
  private cardCounter = 0;

  // ---- screenshot loop ----
  private lastCaptureAt = new Map<string, number>();
  private hasGoodCapture = new Set<string>();
  /** Bumped when mining radii are cleared so in-flight mineDom cannot re-show a ring. */
  private mineRadiusGeneration = 0;
  private sidebarOpen = false;

  constructor(window: Window) {
    this.window = window;
    this.webContentsView = this.createWebContentsView();
    window.baseWindow.contentView.addChildView(this.webContentsView);
    this.applyBounds();
    this.startCaptureLoop();
  }

  // ---------- visibility ----------

  show(): void {
    this.isVisible = true;
    this.applyBounds();
  }

  hide(): void {
    this.isVisible = false;
    this.applyBounds();
  }

  toggle(): boolean {
    this.isVisible = !this.isVisible;
    this.applyBounds();
    return this.isVisible;
  }

  get visible(): boolean {
    return this.isVisible;
  }

  /** Talk mode: capture the active card at 4× thumbnail resolution. */
  setSidebarOpen(open: boolean): void {
    if (this.sidebarOpen === open) return;
    this.sidebarOpen = open;
    const activeTab = this.window.activeTab;
    if (!activeTab || !this.isVisible) return;
    const cardId = this.currentCardByTab.get(activeTab.id);
    if (!cardId) return;
    this.lastCaptureAt.delete(cardId);
    void this.captureTab(activeTab.id);
  }

  /** Keep keyboard routing on the stage overlay (not the active tab). */
  focusOverlay(): void {
    const wc = this.webContentsView.webContents;
    if (wc.isDestroyed()) return;
    wc.focus();
    this.sendToRenderer("stage:focus", null);
  }

  get view(): WebContentsView {
    return this.webContentsView;
  }

  updateBounds(): void {
    this.applyBounds();
  }

  // ---------- card model: called by Window on tab lifecycle ----------

  /** Called for each `did-navigate` / `did-navigate-in-page` on a tab. */
  recordNavigation(tab: Tab, url: string): void {
    if (!url || url === "about:blank") return;
    const lastId = this.currentCardByTab.get(tab.id);
    const last = lastId ? this.cards.find((c) => c.id === lastId) : undefined;

    // Same URL re-fired (Chromium emits did-navigate + did-navigate-in-page
    // back-to-back for the same page) — touch the existing card, don't spawn.
    if (last && last.active && last.url === url) {
      const title = tab.title || last.title;
      if (last.title !== title) {
        last.title = title;
        this.notifyChange();
      }
      return;
    }

    if (last) last.active = false;

    const card: Card = {
      id: `card-${++this.cardCounter}`,
      tabId: tab.id,
      url,
      title: tab.title || hostname(url) || "Loading…",
      visitedAt: Date.now(),
      active: true,
      stageX: this.cards.length * STAGE_CARD_STRIDE,
    };
    this.cards.push(card);
    this.currentCardByTab.set(tab.id, card.id);
    this.notifyChange();
    void this.refreshTab(tab.id);
  }

  /** Called on `page-title-updated` so the live card shows the new title. */
  updateTitle(tabId: string, title: string): void {
    const id = this.currentCardByTab.get(tabId);
    if (!id) return;
    const card = this.cards.find((c) => c.id === id);
    if (card && card.title !== title) {
      card.title = title;
      this.notifyChange();
    }
  }

  /** Called when a tab closes — its cards become ghosts. */
  detachTab(tabId: string): void {
    let changed = false;
    for (const c of this.cards) {
      if (c.tabId === tabId && c.active) {
        c.active = false;
        changed = true;
      }
    }
    this.currentCardByTab.delete(tabId);
    if (changed) this.notifyChange();
  }

  /** Called when the user switches the active tab (re-broadcast snapshot). */
  notifyTabActivated(): void {
    this.notifyChange();
  }

  /**
   * Dissolve random letters in the tab page DOM near a card click point.
   * Cards on the stage are unchanged; only the underlying web content is edited.
   */
  async mineDomAtCard(
    cardId: string,
    normX: number,
    normY: number,
    options: MineDomOptions = {}
  ): Promise<number> {
    const lettersPerBatch = options.lettersPerBatch ?? 6;
    const persistRadius = options.persistRadius ?? false;
    const card = this.cards.find((c) => c.id === cardId);
    if (!card) return 0;
    const tab = this.window.getTab(card.tabId);
    if (!tab) return 0;

    const wc = tab.webContents;
    if (wc.isDestroyed()) return 0;

    const bounds = tab.view.getBounds();
    const x = Math.max(0, Math.min(bounds.width - 1, Math.round(normX * bounds.width)));
    const y = Math.max(0, Math.min(bounds.height - 1, Math.round(normY * bounds.height)));
    const radiusPx = Math.round(Math.min(bounds.width, bounds.height) * 0.14);
    const generation = this.mineRadiusGeneration;

    try {
      await wc.executeJavaScript(INSTALL_DOM_MINING_STYLES_SCRIPT, true);
      const result = await wc.executeJavaScript(
        buildMineDomBatchScript(x, y, radiusPx, lettersPerBatch, persistRadius),
        true
      );
      if (persistRadius && generation !== this.mineRadiusGeneration) {
        await wc.executeJavaScript(HIDE_MINE_RADIUS_SCRIPT, true);
      }
      if (result && typeof result === "object" && typeof result.mined === "number") {
        return result.mined;
      }
      return 0;
    } catch {
      return 0;
    }
  }

  /** Hide mining radius overlays in every open tab. */
  async hideAllMineRadii(): Promise<void> {
    this.mineRadiusGeneration += 1;
    for (const tab of this.window.allTabs) {
      const wc = tab.webContents;
      if (wc.isDestroyed()) continue;
      try {
        await wc.executeJavaScript(HIDE_MINE_RADIUS_SCRIPT, true);
      } catch {
        // Tab may be mid-navigation.
      }
    }
  }

  /**
   * Click handler from the renderer: re-visit a card. If the owning tab is
   * still alive, switch to it (loading the URL again if needed). Otherwise
   * open the URL in a fresh tab.
   */
  async activateCard(cardId: string): Promise<boolean> {
    const card = this.cards.find((c) => c.id === cardId);
    if (!card) return false;
    const tab = this.window.getTab(card.tabId);
    if (!tab) {
      const created = this.window.createTab(card.url);
      this.window.switchActiveTab(created.id);
      return true;
    }
    this.window.switchActiveTab(card.tabId);
    return true;
  }

  /**
   * Forward a left-click from a stage card to the corresponding tab content.
   * `normX/normY` are normalized [0..1] coordinates from the card's image area.
   */
  async forwardCardClick(
    cardId: string,
    normX: number,
    normY: number
  ): Promise<boolean> {
    const card = this.cards.find((c) => c.id === cardId);
    if (!card) return false;
    const tab = this.window.getTab(card.tabId);
    if (!tab) return false;

    this.window.switchActiveTab(card.tabId);
    const bounds = tab.view.getBounds();
    const x = Math.max(
      0,
      Math.min(bounds.width - 1, Math.round(normX * bounds.width))
    );
    const y = Math.max(
      0,
      Math.min(bounds.height - 1, Math.round(normY * bounds.height))
    );
    await tab.showDebugClickMarkerAt(x, y);

    const linkHref = await this.resolveLinkHrefAtPoint(tab, x, y);
    if (linkHref) {
      const newTab = this.window.createTab(linkHref);
      await newTab.settleAfterNavigation(2000);
      this.window.switchActiveTab(newTab.id);
      return true;
    }

    await this.simulateRealMousePress(tab, x, y);
    return true;
  }

  /** Send a more realistic click sequence for sites relying on press timing/hover state. */
  private async simulateRealMousePress(tab: Tab, x: number, y: number): Promise<void> {
    tab.webContents.sendInputEvent({ type: "mouseMove", x, y });
    tab.webContents.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 });
    // Give the page one frame to process mousedown-dependent UI before mouseup.
    await sleep(16);
    tab.webContents.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 });
  }

  /** Resolve anchor href at viewport coordinates (elementFromPoint). */
  private async resolveLinkHrefAtPoint(tab: Tab, x: number, y: number): Promise<string | null> {
    const result = await tab.runJs(`
      (function() {
        const x = ${x};
        const y = ${y};
        const pickAnchor = (el) => {
          if (!el) return null;
          const a = el.closest?.("a[href]");
          if (a?.href && !a.href.startsWith("javascript:")) return a.href;
          return null;
        };

        const deepElementFromPoint = (root, px, py) => {
          let el = root.elementFromPoint?.(px, py) ?? null;
          while (el?.shadowRoot?.elementFromPoint) {
            const nested = el.shadowRoot.elementFromPoint(px, py);
            if (!nested || nested === el) break;
            el = nested;
          }
          return el;
        };

        let el = deepElementFromPoint(document, x, y);
        let href = pickAnchor(el);
        if (href) return href;

        // Same-origin iframe fallback.
        const iframe = el && el.tagName === "IFRAME" ? el : el?.closest?.("iframe");
        if (iframe instanceof HTMLIFrameElement && iframe.contentDocument) {
          const r = iframe.getBoundingClientRect();
          const fx = x - r.left;
          const fy = y - r.top;
          const inside = deepElementFromPoint(iframe.contentDocument, fx, fy);
          href = pickAnchor(inside);
          if (href) return href;
        }
        return null;
      })()
    `);
    return typeof result === "string" && result.length > 0 ? result : null;
  }

  async forwardCardScroll(
    cardId: string,
    normX: number,
    normY: number,
    deltaY: number
  ): Promise<boolean> {
    const card = this.cards.find((c) => c.id === cardId);
    if (!card) return false;
    const tab = this.window.getTab(card.tabId);
    if (!tab) return false;

    this.window.switchActiveTab(card.tabId);

    const bounds = tab.view.getBounds();
    const x = Math.max(0, Math.min(bounds.width - 1, Math.round(normX * bounds.width)));
    const y = Math.max(0, Math.min(bounds.height - 1, Math.round(normY * bounds.height)));
    // DOM wheel deltaY is opposite Electron's mouseWheel convention on Windows.
    tab.webContents.sendInputEvent({
      type: "mouseWheel",
      x,
      y,
      deltaX: 0,
      deltaY: Math.round(-deltaY),
      canScroll: true,
    });
    return true;
  }

  runToTabPoint(
    tabId: string,
    normX: number,
    normY: number,
    mineAfter: boolean = false
  ): void {
    const cardId = this.currentCardByTab.get(tabId);
    if (!cardId) return;
    const payload: RunToPointEvent = {
      cardId,
      normX: Math.max(0, Math.min(1, normX)),
      normY: Math.max(0, Math.min(1, normY)),
      mineAfter,
    };
    this.sendToRenderer("stage:run-to-point", payload);
  }

  /** Snapshot for `stage:get-state` and `stage:state` broadcasts. */
  snapshot(): StageState {
    return {
      cards: this.cards.map((c) => ({ ...c })),
      activeCardId: this.getActiveCardId(),
    };
  }

  /** Force-capture the current card on a tab (e.g. on `did-stop-loading`). */
  async refreshTab(tabId: string): Promise<void> {
    await this.captureTab(tabId);
  }

  // ---------- internals ----------

  private getActiveCardId(): string | null {
    const activeTabId = this.window.activeTab?.id;
    if (!activeTabId) return null;
    return this.currentCardByTab.get(activeTabId) ?? null;
  }

  private createWebContentsView(): WebContentsView {
    const view = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, "../preload/stage.js"),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
        transparent: true,
      },
    });
    view.setBackgroundColor("#00000000");

    if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
      const url = new URL("/stage/", process.env["ELECTRON_RENDERER_URL"]);
      view.webContents.loadURL(url.toString());
    } else {
      view.webContents.loadFile(join(__dirname, "../renderer/stage.html"));
    }
    return view;
  }

  private applyBounds(): void {
    if (this.isVisible) {
      this.webContentsView.setBounds(this.window.getContentBounds());
    } else {
      this.webContentsView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    }
  }

  private sendToRenderer(channel: string, payload: unknown): void {
    const wc = this.webContentsView.webContents;
    if (!wc.isDestroyed()) wc.send(channel, payload);
  }

  private notifyChange(): void {
    this.sendToRenderer("stage:state", this.snapshot());
  }

  private startCaptureLoop(): void {
    const tick = (): void => {
      this.captureDueTabs().catch(() => {});
      setTimeout(tick, CAPTURE_TICK_MS);
    };
    tick();
  }

  private async captureDueTabs(): Promise<void> {
    if (!this.isVisible) return;
    const activeTab = this.window.activeTab;
    if (!activeTab) return;
    const cardId = this.currentCardByTab.get(activeTab.id);
    if (!cardId) return;
    const now = Date.now();
    const last = this.lastCaptureAt.get(cardId) ?? 0;
    if (now - last < ACTIVE_INTERVAL_MS) return;
    await this.captureTab(activeTab.id);
  }

  private async captureTab(tabId: string): Promise<void> {
    const tab = this.window.getTab(tabId);
    if (!tab) return;
    // Hidden tabs can produce black captures on some platforms/GPU paths.
    // We only capture visible tabs so historical cards retain their last
    // good screenshot rather than being overwritten by black frames.
    if (!tab.isVisible) return;
    const cardId = this.currentCardByTab.get(tabId);
    if (!cardId) return;
    const wc = tab.webContents;
    if (wc.isDestroyed() || wc.isLoading()) return;
    const hiRes =
      this.sidebarOpen && cardId === this.getActiveCardId();
    try {
      let image = await this.captureFromFixedViewport(tab, hiRes);
      if (image.isEmpty()) return;
      let resized = resizeForStage(
        image,
        hiRes ? STAGE_THUMBNAIL_HI_RES_SIZE : STAGE_THUMBNAIL_SIZE
      );
      const directStats = getImageStats(resized);
      if (directStats.isMostlyBlack || directStats.isMostlyTransparent) {
        // On some Windows/GPU paths capturePage can return fully black frames
        // for occluded views. Keep the previous texture instead of overwriting.
        // If this card has never had a good capture, do one forced capture pass
        // with the stage briefly hidden to avoid occlusion.
        if (this.hasGoodCapture.has(cardId)) {
          return;
        }
        image = await this.captureWithStageTemporarilyHidden(tab, hiRes);
        if (image.isEmpty()) return;
        resized = resizeForStage(
          image,
          hiRes ? STAGE_THUMBNAIL_HI_RES_SIZE : STAGE_THUMBNAIL_SIZE
        );
        const fallbackStats = getImageStats(resized);
        if (fallbackStats.isMostlyBlack || fallbackStats.isMostlyTransparent) {
          return;
        }
      }
      const dim = resized.getSize();
      const payload: ThumbnailEvent = {
        cardId,
        // Preserve alpha; JPEG can flatten transparent compositor frames to black.
        dataUrl: `data:image/png;base64,${resized.toPNG().toString("base64")}`,
        width: dim.width,
        height: dim.height,
      };
      this.hasGoodCapture.add(cardId);
      this.lastCaptureAt.set(cardId, Date.now());
      this.sendToRenderer("stage:thumbnail", payload);
    } catch {
      // Tab may be mid-navigation or capture may fail transiently.
    }
  }

  /**
   * One-shot fallback for black captures:
   *  1) hide stage bounds for one frame
   *  2) capture underlying tab
   *  3) restore stage bounds
   */
  private async captureWithStageTemporarilyHidden(
    tab: Tab,
    hiRes: boolean
  ): Promise<NativeImage> {
    const wasVisible = this.isVisible;
    if (!wasVisible) {
      return tab.screenshot();
    }
    this.webContentsView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    await sleep(16);
    try {
      return await this.captureFromFixedViewport(tab, hiRes);
    } finally {
      this.applyBounds();
    }
  }

  private async captureFromFixedViewport(tab: Tab, hiRes: boolean): Promise<NativeImage> {
    const scale = hiRes ? STAGE_THUMBNAIL_HI_RES_SCALE : 1;
    const original = tab.view.getBounds();
    // Keep top-left anchor so input mapping remains intuitive.
    tab.view.setBounds({
      x: original.x,
      y: original.y,
      width: CAPTURE_VIEWPORT_WIDTH * scale,
      height: CAPTURE_VIEWPORT_HEIGHT * scale,
    });
    await sleep(16);
    try {
      return await tab.screenshot();
    } finally {
      tab.view.setBounds(original);
    }
  }

}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

interface ImageStats {
  width: number;
  height: number;
  avgLum: number;
  avgAlpha: number;
  sampleCount: number;
  isMostlyBlack: boolean;
  isMostlyTransparent: boolean;
}

function getImageStats(image: NativeImage): ImageStats {
  const { width, height } = image.getSize();
  if (width <= 0 || height <= 0) {
    return {
      width,
      height,
      avgLum: 0,
      avgAlpha: 0,
      sampleCount: 0,
      isMostlyBlack: true,
      isMostlyTransparent: true,
    };
  }
  const bitmap = image.toBitmap();
  if (bitmap.length < 4) {
    return {
      width,
      height,
      avgLum: 0,
      avgAlpha: 0,
      sampleCount: 0,
      isMostlyBlack: true,
      isMostlyTransparent: true,
    };
  }

  const stepX = Math.max(1, Math.floor(width / 12));
  const stepY = Math.max(1, Math.floor(height / 12));
  let sampleCount = 0;
  let luminanceTotal = 0;
  let alphaTotal = 0;

  for (let y = 0; y < height; y += stepY) {
    for (let x = 0; x < width; x += stepX) {
      const i = (y * width + x) * 4;
      const b = bitmap[i];
      const g = bitmap[i + 1];
      const r = bitmap[i + 2];
      const a = bitmap[i + 3];
      luminanceTotal += 0.2126 * r + 0.7152 * g + 0.0722 * b;
      alphaTotal += a;
      sampleCount++;
    }
  }

  const avgLum = luminanceTotal / Math.max(1, sampleCount);
  const avgAlpha = alphaTotal / Math.max(1, sampleCount);
  return {
    width,
    height,
    avgLum,
    avgAlpha,
    sampleCount,
    isMostlyBlack: avgLum < 10,
    isMostlyTransparent: avgAlpha < 8,
  };
}

function resizeForStage(image: NativeImage, targetMaxSize: number): NativeImage {
  const size = image.getSize();
  if (size.width === 0 || size.height === 0) return image;
  // Keep full page (no clipping). Normalize output size so texture resolution
  // is stable across browser window sizes.
  const scale = targetMaxSize / Math.max(size.width, size.height);
  if (scale >= 1) return image;
  return image.resize({
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
    quality: "good",
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
