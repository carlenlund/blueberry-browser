/**
 * Redirect same-tab anchor clicks to window.open so Electron's
 * setWindowOpenHandler can route them into a new in-app tab.
 */
export const INSTALL_LINK_NEW_TAB_SCRIPT = `
(function() {
  if (window.__blueberryLinkNewTabInstalled) return true;

  function shouldOpenInNewTab(anchor, event) {
    if (!(anchor instanceof HTMLAnchorElement)) return false;
    if (event.defaultPrevented) return false;
    if (event.button !== 0) return false;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
    const href = anchor.href;
    if (!href || href.startsWith("javascript:")) return false;
    if (anchor.hasAttribute("download")) return false;
    if (anchor.target === "_blank") return false;
    try {
      const next = new URL(href, location.href);
      const here = new URL(location.href);
      if (next.origin === here.origin && next.pathname === here.pathname && next.search === here.search && next.hash) {
        return false;
      }
    } catch (_) {
      return false;
    }
    return true;
  }

  document.addEventListener(
    "click",
    function(event) {
      const path = typeof event.composedPath === "function" ? event.composedPath() : [];
      let anchor = null;
      for (let i = 0; i < path.length; i++) {
        const node = path[i];
        if (node instanceof HTMLAnchorElement) {
          anchor = node;
          break;
        }
      }
      if (!anchor) {
        const target = event.target;
        if (target instanceof Element) anchor = target.closest("a[href]");
      }
      if (!shouldOpenInNewTab(anchor, event)) return;
      event.preventDefault();
      event.stopPropagation();
      window.open(anchor.href, "_blank", "noopener,noreferrer");
    },
    true
  );

  window.__blueberryLinkNewTabInstalled = true;
  return true;
})()
`;
