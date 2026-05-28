import { contextBridge } from "electron";
import { electronAPI } from "@electron-toolkit/preload";

// TopBar specific APIs
const topBarAPI = {
  // Tab management
  createTab: (url?: string) =>
    electronAPI.ipcRenderer.invoke("create-tab", url),
  closeTab: (tabId: string) =>
    electronAPI.ipcRenderer.invoke("close-tab", tabId),
  switchTab: (tabId: string) =>
    electronAPI.ipcRenderer.invoke("switch-tab", tabId),
  getTabs: () => electronAPI.ipcRenderer.invoke("get-tabs"),

  // Tab navigation
  navigateTab: (tabId: string, url: string) =>
    electronAPI.ipcRenderer.invoke("navigate-tab", tabId, url),
  goBack: (tabId: string) =>
    electronAPI.ipcRenderer.invoke("tab-go-back", tabId),
  goForward: (tabId: string) =>
    electronAPI.ipcRenderer.invoke("tab-go-forward", tabId),
  reload: (tabId: string) =>
    electronAPI.ipcRenderer.invoke("tab-reload", tabId),

  // Sidebar
  toggleSidebar: (): Promise<boolean> =>
    electronAPI.ipcRenderer.invoke("toggle-sidebar"),
  setSidebarVisible: (visible: boolean): Promise<boolean> =>
    electronAPI.ipcRenderer.invoke("set-sidebar-visible", visible),
  getSidebarVisible: (): Promise<boolean> =>
    electronAPI.ipcRenderer.invoke("sidebar:get-visible"),
  onSidebarVisibility: (cb: (visible: boolean) => void): (() => void) => {
    const listener = (_: unknown, visible: boolean): void => cb(visible);
    electronAPI.ipcRenderer.on("sidebar:visibility", listener);
    return () => {
      electronAPI.ipcRenderer.removeListener("sidebar:visibility", listener);
    };
  },

  // Stage overlay (3D tab deck + agent avatar)
  toggleStage: (visible?: boolean) =>
    electronAPI.ipcRenderer.invoke("toggle-stage", visible),
  getStageVisible: () => electronAPI.ipcRenderer.invoke("stage:get-visible"),
};

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("electron", electronAPI);
    contextBridge.exposeInMainWorld("topBarAPI", topBarAPI);
  } catch (error) {
    console.error(error);
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI;
  // @ts-ignore (define in dts)
  window.topBarAPI = topBarAPI;
}

