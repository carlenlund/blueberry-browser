import { FEED_OVERLAY_PAGE_AGENT_PAGE_TEXT_CAP } from "./feedOverlayPageAgentPrompt"

/** Brief pause so SPAs (Aftonbladet, SVT, etc.) can paint before we read the DOM. */
export const FEED_OVERLAY_PAGE_AGENT_SPA_SETTLE_MS = 550

/**
 * Injected via `executeJavaScript`. Collects title, meta, main-region text, and
 * viewport-visible text at several scroll positions (similar spirit to the page-map
 * scanner’s visibility checks, but compact for the overlay agent).
 */
export const FEED_OVERLAY_AGENT_PAGE_CONTEXT_JS = `(function () {
  function clip(s, max) {
    s = String(s || "").replace(/\\s+/g, " ").trim();
    if (s.length <= max) return s;
    return s.slice(0, max) + "…";
  }
  var root = document.body || document.documentElement;
  function visibleViewportText(maxLen) {
    if (!root) return "";
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var buf = [];
    var total = 0;
    var node;
    while ((node = w.nextNode())) {
      var el = node.parentElement;
      if (!el) continue;
      var st = window.getComputedStyle(el);
      var r = el.getBoundingClientRect();
      if (
        st.display === "none" ||
        st.visibility === "hidden" ||
        Number(st.opacity) <= 0
      )
        continue;
      if (r.width < 1 || r.height < 1) continue;
      if (r.bottom < 0 || r.top > window.innerHeight) continue;
      var t = (node.textContent || "").trim();
      if (t.length < 2) continue;
      var remaining = maxLen - total;
      if (remaining <= 0) break;
      if (t.length > remaining) {
        buf.push(clip(t, remaining));
        break;
      }
      buf.push(t);
      total += t.length + 1;
    }
    return buf.join(" ");
  }
  var selectors = [
    "main",
    "article",
    '[role="main"]',
    "#main",
    "#content",
    "[data-testid=story]",
    ".layout-article",
  ];
  var regionChunks = [];
  for (var i = 0; i < selectors.length; i++) {
    var el = document.querySelector(selectors[i]);
    if (el) {
      var txt = (el.innerText || "").trim();
      if (txt.length > 80)
        regionChunks.push(selectors[i] + ": " + clip(txt, 3500));
    }
  }
  var scrollSnippets = [];
  var scrollY0 = window.scrollY;
  var vh = Math.max(240, window.innerHeight || 600);
  var sh = Math.max(vh, document.documentElement.scrollHeight || 0);
  var steps = Math.min(4, Math.max(1, 1 + Math.floor((sh - vh) / vh)));
  window.scrollTo(0, 0);
  for (var s = 0; s < steps; s++) {
    window.scrollTo(0, Math.round(s * vh));
    scrollSnippets.push(
      "SCROLL_Y≈" +
        Math.round(window.scrollY) +
        ": " +
        clip(visibleViewportText(2800), 2800),
    );
  }
  window.scrollTo(0, scrollY0);
  var body = document.body ? (document.body.innerText || "").trim() : "";
  var mdesc = document.querySelector('meta[name="description"]');
  return {
    url: String(location.href || ""),
    title: String(document.title || ""),
    description: mdesc && mdesc.content ? String(mdesc.content) : "",
    regionText: regionChunks.join(String.fromCharCode(10, 10)),
    viewportScrollSamples: scrollSnippets.join(
      String.fromCharCode(10) + "---" + String.fromCharCode(10),
    ),
    bodyInnerTextLength: body.length,
    bodyInnerTextPreview: clip(body, 6000),
  };
})()`;

export function formatAgentPageContextForPrompt(raw: unknown): string {
  if (!raw || typeof raw !== "object") {
    return "(Could not read page context.)";
  }
  const o = raw as Record<string, unknown>;
  const lines: string[] = [];
  lines.push(`URL: ${String(o.url ?? "")}`);
  lines.push(`Title: ${String(o.title ?? "")}`);
  if (o.description) {
    lines.push(`Meta description: ${String(o.description)}`);
  }
  lines.push(`Body innerText length: ${String(o.bodyInnerTextLength ?? 0)}`);
  if (o.regionText) {
    lines.push(`\nMain regions:\n${String(o.regionText)}`);
  }
  if (o.viewportScrollSamples) {
    lines.push(
      `\nVisible text while scrolling (viewport samples):\n${String(o.viewportScrollSamples)}`,
    );
  }
  if (o.bodyInnerTextPreview) {
    lines.push(`\nBody text preview:\n${String(o.bodyInnerTextPreview)}`);
  }
  let s = lines.join("\n");
  if (s.length > FEED_OVERLAY_PAGE_AGENT_PAGE_TEXT_CAP) {
    s = `${s.slice(0, FEED_OVERLAY_PAGE_AGENT_PAGE_TEXT_CAP)}…`;
  }
  return s;
}
