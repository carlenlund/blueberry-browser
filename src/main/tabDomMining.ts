/** Injected once per page — letters heat up red in the mining circle, then vanish. */
export const INSTALL_DOM_MINING_STYLES_SCRIPT = `
(function() {
  if (document.getElementById("blueberry-dom-mining-styles")) return true;
  const style = document.createElement("style");
  style.id = "blueberry-dom-mining-styles";
  style.textContent = [
    ".bb-mine-letter{display:inline;pointer-events:none;transition:color 90ms linear}",
    ".bb-mine-letter.bb-mine-done{visibility:hidden!important}",
    ".bb-mine-radius{",
    "position:fixed;",
    "pointer-events:none;",
    "z-index:2147483645;",
    "border:2px dashed rgba(239,68,68,0.95);",
    "background:radial-gradient(circle, rgba(239,68,68,0.12) 0%, rgba(239,68,68,0.06) 45%, rgba(239,68,68,0.02) 70%, rgba(239,68,68,0) 100%);",
    "box-shadow:0 0 22px rgba(239,68,68,0.35), inset 0 0 18px rgba(239,68,68,0.25);",
    "border-radius:9999px;",
    "transform:translate(-50%, -50%);",
    "opacity:0;",
    "transition:opacity 120ms ease-out;",
    "}",
  ].join("");
  (document.head || document.documentElement).appendChild(style);
  return true;
})()
`;

export interface MineDomBatchResult {
  mined: number;
}

export const HIDE_MINE_RADIUS_SCRIPT = `
(function() {
  const ring = document.getElementById("blueberry-mine-radius");
  if (ring) ring.remove();
  document.querySelectorAll(".bb-mine-particle").forEach((el) => el.remove());
  return true;
})()
`;

/** Mine random letters whose glyph center lies inside the mining circle. */
export function buildMineDomBatchScript(
  centerX: number,
  centerY: number,
  radiusPx: number,
  maxLetters: number,
  persistRadius = false
): string {
  const cx = Math.round(centerX);
  const cy = Math.round(centerY);
  const r = Math.max(24, Math.round(radiusPx));
  const cap = Math.max(0, Math.min(12, Math.round(maxLetters)));
  const keepRadiusVisible = persistRadius ? "true" : "false";

  return `
(function() {
  ${INSTALL_DOM_MINING_STYLES_SCRIPT.trim()}

  const cx = ${cx};
  const cy = ${cy};
  const radius = ${r};
  const maxLetters = ${cap};
  const radiusSq = radius * radius;
  const MAX_HEAT = 6;

  const SKIP_TAGS = new Set([
    "SCRIPT", "STYLE", "NOSCRIPT", "SVG", "PATH", "IFRAME", "CANVAS", "VIDEO", "AUDIO",
  ]);

  const keepRadiusVisible = ${keepRadiusVisible};

  function showRadiusOverlay() {
    const id = "blueberry-mine-radius";
    let ring = document.getElementById(id);
    if (!ring) {
      ring = document.createElement("div");
      ring.id = id;
      ring.className = "bb-mine-radius";
      document.body.appendChild(ring);
    }
    ring.style.left = cx + "px";
    ring.style.top = cy + "px";
    ring.style.width = radius * 2 + "px";
    ring.style.height = radius * 2 + "px";
    ring.style.opacity = "1";
    if (!keepRadiusVisible) {
      const hideToken = String(Date.now());
      ring.setAttribute("data-hide-token", hideToken);
      window.setTimeout(() => {
        if (ring && ring.getAttribute("data-hide-token") === hideToken) {
          ring.remove();
        }
      }, 180);
    }
  }

  function isPointInCircle(px, py) {
    const dx = px - cx;
    const dy = py - cy;
    return dx * dx + dy * dy <= radiusSq;
  }

  function isInMiningOverlay(el) {
    if (!(el instanceof Element)) return false;
    return !!el.closest(
      ".bb-mine-letter, .bb-mine-radius, [data-blueberry-mine], [data-blueberry-debug]"
    );
  }

  function getHeat(el) {
    const raw = el.getAttribute("data-bb-heat");
    const n = raw ? parseInt(raw, 10) : 0;
    return Number.isFinite(n) ? n : 0;
  }

  function applyHeatStyle(span, heat) {
    if (heat >= MAX_HEAT) {
      span.classList.add("bb-mine-done");
      span.style.visibility = "hidden";
      return;
    }
    span.classList.remove("bb-mine-done");
    span.style.visibility = "visible";
    const t = heat / (MAX_HEAT - 1);
    const cool = Math.round(255 * (1 - t * 0.94));
    span.style.color = "rgb(255, " + cool + ", " + cool + ")";
  }

  function isTextNodeMineable(textNode) {
    const parent = textNode.parentElement;
    if (!parent) return false;
    if (isInMiningOverlay(parent)) return false;
    const blocked = parent.closest(
      "script, style, noscript, svg, iframe, canvas, video, audio"
    );
    if (blocked) return false;
    if (SKIP_TAGS.has(parent.tagName)) return false;
    return true;
  }

  function getLetterCenter(textNode, offset) {
    const range = document.createRange();
    range.setStart(textNode, offset);
    range.setEnd(textNode, offset + 1);
    const rects = range.getClientRects();
    const rect = rects.length > 0 ? rects[0] : range.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) return null;
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  function getSpanCenter(el) {
    const rect = el.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) return null;
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  function collectTargets() {
    const targets = [];
    const body = document.body;
    if (!body) return targets;

    body.querySelectorAll(".bb-mine-letter[data-blueberry-mine]").forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      if (el.classList.contains("bb-mine-done")) return;
      if (getHeat(el) >= MAX_HEAT) return;
      const center = getSpanCenter(el);
      if (!center || !isPointInCircle(center.x, center.y)) return;
      targets.push({ kind: "span", el });
    });

    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return isTextNodeMineable(node)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      },
    });

    let tn;
    while ((tn = walker.nextNode())) {
      const text = tn.textContent || "";
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (!ch || /\\s/.test(ch)) continue;
        const center = getLetterCenter(tn, i);
        if (!center || !isPointInCircle(center.x, center.y)) continue;
        targets.push({ kind: "text", node: tn, offset: i });
      }
    }
    return targets;
  }

  function shuffleInPlace(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  function heatSpan(span) {
    const next = getHeat(span) + 1;
    span.setAttribute("data-bb-heat", String(next));
    applyHeatStyle(span, next);
    return true;
  }

  function mineLetter(target) {
    if (target.kind === "span") {
      return heatSpan(target.el);
    }

    const textNode = target.node;
    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return false;
    if (!isTextNodeMineable(textNode)) return false;

    const text = textNode.textContent || "";
    const offset = target.offset;
    if (offset < 0 || offset >= text.length) return false;
    const ch = text[offset];
    if (!ch || /\\s/.test(ch)) return false;

    const center = getLetterCenter(textNode, offset);
    if (!center || !isPointInCircle(center.x, center.y)) return false;

    const range = document.createRange();
    range.setStart(textNode, offset);
    range.setEnd(textNode, offset + 1);

    const letterSpan = document.createElement("span");
    letterSpan.className = "bb-mine-letter";
    letterSpan.setAttribute("data-blueberry-mine", "1");
    letterSpan.setAttribute("data-bb-heat", "1");
    letterSpan.textContent = ch;

    range.deleteContents();
    range.insertNode(letterSpan);

    const spanCenter = getSpanCenter(letterSpan);
    if (!spanCenter || !isPointInCircle(spanCenter.x, spanCenter.y)) {
      letterSpan.replaceWith(document.createTextNode(ch));
      return false;
    }

    applyHeatStyle(letterSpan, 1);
    return true;
  }

  showRadiusOverlay();
  if (maxLetters <= 0) return { mined: 0 };

  const targets = shuffleInPlace(collectTargets());
  let mined = 0;
  for (let i = 0; i < targets.length && mined < maxLetters; i++) {
    if (mineLetter(targets[i])) mined++;
  }

  return { mined };
})()
`;
}
