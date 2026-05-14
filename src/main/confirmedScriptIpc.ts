import { ipcMain } from "electron";
import type { Window } from "./Window";

const MAX_CONFIRMED_SCRIPT_CHARS = 12_000;

let getBrowserWindow: () => Window | null = () => null;

export function setConfirmedScriptWindowAccessor(fn: () => Window | null): void {
  getBrowserWindow = fn;
}

function serializeProbeResult(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/**
 * `webContents.executeJavaScript` evaluates a **script**, not a function body.
 * A top-level `return` throws "Illegal return statement". Wrapping makes `return` valid.
 */
function wrapProbeScriptForExecuteJavaScript(userCode: string): string {
  const body = userCode.trim();
  return `(() => {\n${body}\n})()`;
}

/**
 * Registers once at app boot. Uses the latest Window from the accessor so
 * macOS window recreate / dev reload does not depend on EventManager ctor order.
 */
export function registerConfirmedScriptIpc(): void {
  ipcMain.removeHandler("sidebar-run-confirmed-script");
  ipcMain.handle(
    "sidebar-run-confirmed-script",
    async (_, code: string): Promise<{ ok: boolean; display: string }> => {
      if (typeof code !== "string" || !code.trim()) {
        return { ok: false, display: "Error: empty script" };
      }
      if (code.length > MAX_CONFIRMED_SCRIPT_CHARS) {
        return {
          ok: false,
          display: `Error: script exceeds ${MAX_CONFIRMED_SCRIPT_CHARS} characters`,
        };
      }
      const mainWindow = getBrowserWindow();
      const tab = mainWindow?.activeTab ?? null;
      if (!tab) {
        return { ok: false, display: "Error: no active tab" };
      }
      try {
        const wrapped = wrapProbeScriptForExecuteJavaScript(code);
        const result = await tab.runJs(wrapped);
        return { ok: true, display: serializeProbeResult(result) };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { ok: false, display: `Error:\n${msg}` };
      }
    }
  );
}
