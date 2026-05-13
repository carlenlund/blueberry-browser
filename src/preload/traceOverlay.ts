import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("traceOverlayAPI", {
  traceFlow: (
    color: "red" | "green" | "blue",
    source: "overlay"
  ) => ipcRenderer.invoke("debug-trace-flow", { color, source }),
});
