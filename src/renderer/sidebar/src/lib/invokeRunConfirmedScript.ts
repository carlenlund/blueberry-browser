export interface RunConfirmedScriptResult {
  ok: boolean
  display: string
}

/**
 * Runs user-confirmed page JS via main process.
 * Uses `sidebarAPI.runConfirmedScript` when present; otherwise falls back to
 * `electron.ipcRenderer.invoke` (same channel) so older preload bundles still work.
 */
export async function invokeRunConfirmedScript(
  code: string
): Promise<RunConfirmedScriptResult> {
  const bound = window.sidebarAPI?.runConfirmedScript
  if (typeof bound === 'function') {
    return bound(code)
  }
  return window.electron.ipcRenderer.invoke(
    'sidebar-run-confirmed-script',
    code
  ) as Promise<RunConfirmedScriptResult>
}
