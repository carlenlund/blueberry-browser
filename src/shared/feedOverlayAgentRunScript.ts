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
 */
export function wrapFeedOverlayAgentUserScript(code: string): string {
  const encoded = JSON.stringify(typeof code === "string" ? code : "")
  return `(function () {
  "use strict";
  try {
    var __code = ${encoded};
    var __result = (0, eval)(__code);
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
