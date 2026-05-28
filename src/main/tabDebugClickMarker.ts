/** DOM id prefix for in-page debug click markers (Tab webContents). */
export const DEBUG_CLICK_MARKER_ID = "blueberry-stage-click-marker";
/** Visible duration before the marker fades out and is removed. */
export const DEBUG_CLICK_MARKER_VISIBLE_MS = 1000;
export const DEBUG_CLICK_MARKER_FADE_MS = 280;

/**
 * Installs a capture-phase click listener in the page main world.
 * Re-run safe on every navigation.
 */
export const INSTALL_DEBUG_CLICK_LISTENER_SCRIPT = `
(function() {
  const MARKER_ID = ${JSON.stringify(DEBUG_CLICK_MARKER_ID)};
  const VISIBLE_MS = ${DEBUG_CLICK_MARKER_VISIBLE_MS};
  const FADE_MS = ${DEBUG_CLICK_MARKER_FADE_MS};

  function scheduleMarkerFade(marker) {
    const fadeToken = String(Date.now());
    marker.setAttribute("data-fade-token", fadeToken);
    const removeMarker = () => {
      if (marker.isConnected) marker.remove();
    };
    window.setTimeout(() => {
      if (!marker.isConnected || marker.getAttribute("data-fade-token") !== fadeToken) return;
      marker.style.transition = "opacity " + FADE_MS + "ms ease-out";
      marker.style.opacity = "0";
      let removed = false;
      const onEnd = () => {
        if (removed) return;
        removed = true;
        marker.removeEventListener("transitionend", onEnd);
        removeMarker();
      };
      marker.addEventListener("transitionend", onEnd);
      window.setTimeout(onEnd, FADE_MS + 80);
    }, VISIBLE_MS);
  }

  function showMarker(doc, localX, localY, suffix) {
    const fullId = MARKER_ID + suffix;
    doc.getElementById(fullId)?.remove();
    const marker = doc.createElement("div");
    marker.id = fullId;
    marker.setAttribute("data-blueberry-debug", "click-marker");
    marker.style.cssText = [
      "position:fixed",
      "left:" + localX + "px",
      "top:" + localY + "px",
      "width:36px",
      "height:36px",
      "transform:translate(-50%, -50%)",
      "border:3px solid #ff00ff",
      "border-radius:50%",
      "background:rgba(255,0,255,0.35)",
      "box-shadow:0 0 0 2px rgba(255,255,255,0.95), 0 0 14px rgba(255,0,255,0.95)",
      "z-index:2147483647",
      "pointer-events:none",
      "box-sizing:border-box",
      "opacity:1",
    ].join(";");

    const crossH = doc.createElement("div");
    crossH.style.cssText =
      "position:absolute;left:50%;top:50%;width:22px;height:2px;transform:translate(-50%,-50%);background:#fff;opacity:0.95;";
    const crossV = doc.createElement("div");
    crossV.style.cssText =
      "position:absolute;left:50%;top:50%;width:2px;height:22px;transform:translate(-50%,-50%);background:#fff;opacity:0.95;";
    marker.appendChild(crossH);
    marker.appendChild(crossV);

    const root = doc.body || doc.documentElement;
    if (root) {
      root.appendChild(marker);
      scheduleMarkerFade(marker);
    }
  }

  window.__blueberryShowClickMarker = function(x, y) {
    showMarker(document, x, y, "-top");
    const target = document.elementFromPoint(x, y);
    const iframe =
      target && target.tagName === "IFRAME" ? target : target?.closest?.("iframe");
    if (iframe instanceof HTMLIFrameElement && iframe.contentDocument) {
      const r = iframe.getBoundingClientRect();
      showMarker(iframe.contentDocument, x - r.left, y - r.top, "-iframe");
    }
  };

  if (!window.__blueberryClickDebugInstalled) {
    document.addEventListener(
      "click",
      function(e) {
        if (e.button !== 0) return;
        window.__blueberryShowClickMarker(e.clientX, e.clientY);
      },
      true
    );
    window.__blueberryClickDebugInstalled = true;
  }

  return true;
})()
`;

/** Viewport size used for stage thumbnails and forwarded click mapping. */
export const STAGE_CAPTURE_VIEWPORT_WIDTH = 1000;
export const STAGE_CAPTURE_VIEWPORT_HEIGHT = 1000;

export interface ClickMarkerDebugResult {
  ok: boolean;
  hasListener: boolean;
  markerPresent: boolean;
  markerId: string | null;
  x: number;
  y: number;
  innerWidth: number;
  innerHeight: number;
}

export function buildShowClickMarkerScript(x: number, y: number): string {
  return `(function() {
    const MARKER_ID = ${JSON.stringify(DEBUG_CLICK_MARKER_ID)};
    const x = ${x};
    const y = ${y};
    const hasListener = typeof window.__blueberryShowClickMarker === "function";
    if (hasListener) {
      window.__blueberryShowClickMarker(x, y);
    }
    const marker = document.getElementById(MARKER_ID + "-top");
    return {
      ok: hasListener && !!marker,
      hasListener,
      markerPresent: !!marker,
      markerId: marker ? marker.id : null,
      x,
      y,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
    };
  })()`;
}
