import { contextBridge } from "electron";
import { electronAPI } from "@electron-toolkit/preload";

const blueberryGuest = {
  quickFeedNavigate: (rawUrl: string) =>
    electronAPI.ipcRenderer.invoke("quick-feed-from-url", rawUrl),
};

/** Browser tabs only — feed overlay uses this instead of navigating in-page. */
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("blueberryGuest", blueberryGuest);
  } catch (e) {
    console.error(e);
  }
} else {
  // @ts-ignore (non-isolated; guest tabs normally use context isolation)
  window.blueberryGuest = blueberryGuest;
}
