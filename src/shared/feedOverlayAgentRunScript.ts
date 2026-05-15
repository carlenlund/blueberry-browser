/** Marker on values returned from {@link wrapFeedOverlayAgentUserScript}. */
export const FEED_OVERLAY_AGENT_SCRIPT_MARKER = "__bbAgent" as const

export type FeedOverlayAgentScriptEnvelope =
  | { __bbAgent: true; ok: true; value: unknown }
  | {
      __bbAgent: true
      ok: false
      error: string
      name?: string
    }

export function isFeedOverlayAgentScriptEnvelope(
  v: unknown,
): v is FeedOverlayAgentScriptEnvelope {
  if (v == null || typeof v !== "object") return false
  return (v as Record<string, unknown>).__bbAgent === true
}

/**
 * Wrap LLM-produced page code so syntax/runtime errors (and Promise rejections)
 * resolve to a plain object instead of rejecting `executeJavaScript` with Electron’s
 * generic “Script failed to execute” message.
 *
 * User code is stitched in as real source text (not `eval`), so strict pages that
 * omit `unsafe-eval` (e.g. news.ycombinator.com) can still run agent scripts.
 */
export function wrapFeedOverlayAgentUserScript(code: string): string {
  const body = typeof code === "string" ? code : ""
  return `(function () {
  "use strict";
  try {
    var __result = (
${body}
    );
    if (__result != null && typeof __result.then === "function") {
      return __result.then(
        function (v) {
          return { __bbAgent: true, ok: true, value: v };
        },
        function (e) {
          return {
            __bbAgent: true,
            ok: false,
            error: e && e.message ? String(e.message) : String(e),
            name: e && e.name ? String(e.name) : "Error",
          };
        },
      );
    }
    return { __bbAgent: true, ok: true, value: __result };
  } catch (e) {
    return {
      __bbAgent: true,
      ok: false,
      error: e && e.message ? String(e.message) : String(e),
      name: e && e.name ? String(e.name) : "Error",
    };
  }
})()`;
}
