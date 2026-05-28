import { contextBridge, ipcRenderer } from "electron";
import { electronAPI } from "@electron-toolkit/preload";
import type { StageState, ThumbnailEvent, RunToPointEvent } from "./stageContract";

export type { Card, StageState, ThumbnailEvent, RunToPointEvent } from "./stageContract";
export {
  STAGE_CARD_LENGTH,
  STAGE_CARD_GAP,
  STAGE_CARD_STRIDE,
} from "./stageContract";

/**
 * Stage IPC contract — small surface, all about "cards".
 *
 *   stage:get-state     (renderer → main)  request current snapshot
 *   stage:activate-card (renderer → main)  re-visit this card (switch tab + load URL)
 *   stage:close         (renderer → main)  hide the stage overlay
 *   stage:mine-dom      (renderer → main)  dissolve letters in a card's tab DOM
 *
 *   stage:state         (main → renderer)  pushed whenever cards change
 *   stage:thumbnail     (main → renderer)  pushed for each new screenshot
 */

const stageAPI = {
  getState: (): Promise<StageState> => ipcRenderer.invoke("stage:get-state"),
  activateCard: (cardId: string): Promise<boolean> =>
    ipcRenderer.invoke("stage:activate-card", cardId),
  clickCard: (cardId: string, normX: number, normY: number): Promise<boolean> =>
    ipcRenderer.invoke("stage:card-click", cardId, normX, normY),
  scrollCard: (
    cardId: string,
    normX: number,
    normY: number,
    deltaY: number
  ): Promise<boolean> =>
    ipcRenderer.invoke("stage:card-scroll", cardId, normX, normY, deltaY),
  closeStage: (): Promise<void> => ipcRenderer.invoke("stage:close"),
  mineDom: (
    cardId: string,
    normX: number,
    normY: number,
    options?: { lettersPerBatch?: number; persistRadius?: boolean }
  ): Promise<number> =>
    ipcRenderer.invoke("stage:mine-dom", cardId, normX, normY, options),
  hideMineRadii: (): Promise<void> => ipcRenderer.invoke("stage:hide-mine-radii"),

  openSidebar: (): Promise<boolean> => ipcRenderer.invoke("set-sidebar-visible", true),

  closeSidebar: (): Promise<boolean> => ipcRenderer.invoke("set-sidebar-visible", false),

  sendChatMessage: (request: { message: string; messageId: string }): Promise<void> =>
    ipcRenderer.invoke("sidebar-chat-message", request),

  getSidebarVisible: (): Promise<boolean> =>
    ipcRenderer.invoke("sidebar:get-visible"),

  onSidebarVisibility: (cb: (visible: boolean) => void): (() => void) => {
    const listener = (_: unknown, visible: boolean): void => cb(visible);
    ipcRenderer.on("sidebar:visibility", listener);
    return () => ipcRenderer.off("sidebar:visibility", listener);
  },

  onChatRequestActive: (cb: (active: boolean) => void): (() => void) => {
    const listener = (_: unknown, active: boolean): void => cb(active);
    ipcRenderer.on("sidebar:chat-request-active", listener);
    return () => ipcRenderer.off("sidebar:chat-request-active", listener);
  },

  onFocus: (cb: () => void): (() => void) => {
    const listener = (): void => cb();
    ipcRenderer.on("stage:focus", listener);
    return () => ipcRenderer.off("stage:focus", listener);
  },

  onState: (cb: (state: StageState) => void): (() => void) => {
    const listener = (_: unknown, state: StageState): void => cb(state);
    ipcRenderer.on("stage:state", listener);
    return () => ipcRenderer.off("stage:state", listener);
  },

  onThumbnail: (cb: (event: ThumbnailEvent) => void): (() => void) => {
    const listener = (_: unknown, event: ThumbnailEvent): void => cb(event);
    ipcRenderer.on("stage:thumbnail", listener);
    return () => ipcRenderer.off("stage:thumbnail", listener);
  },

  onRunToPoint: (cb: (event: RunToPointEvent) => void): (() => void) => {
    const listener = (_: unknown, event: RunToPointEvent): void => cb(event);
    ipcRenderer.on("stage:run-to-point", listener);
    return () => ipcRenderer.off("stage:run-to-point", listener);
  },
};

export type StageAPI = typeof stageAPI;

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("electron", electronAPI);
    contextBridge.exposeInMainWorld("stageAPI", stageAPI);
  } catch (error) {
    console.error(error);
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI;
  // @ts-ignore (define in dts)
  window.stageAPI = stageAPI;
}
