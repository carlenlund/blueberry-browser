import { ElectronAPI } from "@electron-toolkit/preload";

export declare const STAGE_CARD_LENGTH: 3.6;
export declare const STAGE_CARD_GAP: 0.54;
export declare const STAGE_CARD_STRIDE: number;

export interface Card {
  id: string;
  tabId: string;
  url: string;
  title: string;
  visitedAt: number;
  active: boolean;
  stageX: number;
}

export interface StageState {
  cards: Card[];
  activeCardId: string | null;
}

export interface ThumbnailEvent {
  cardId: string;
  dataUrl: string;
  width: number;
  height: number;
}

export interface RunToPointEvent {
  cardId: string;
  normX: number;
  normY: number;
  mineAfter?: boolean;
}

export interface StageAPI {
  getState: () => Promise<StageState>;
  activateCard: (cardId: string) => Promise<boolean>;
  clickCard: (cardId: string, normX: number, normY: number) => Promise<boolean>;
  scrollCard: (
    cardId: string,
    normX: number,
    normY: number,
    deltaY: number
  ) => Promise<boolean>;
  mineDom: (
    cardId: string,
    normX: number,
    normY: number,
    options?: { lettersPerBatch?: number; persistRadius?: boolean }
  ) => Promise<number>;
  hideMineRadii: () => Promise<void>;
  openSidebar: () => Promise<boolean>;
  closeSidebar: () => Promise<boolean>;
  sendChatMessage: (request: { message: string; messageId: string }) => Promise<void>;
  getSidebarVisible: () => Promise<boolean>;
  onSidebarVisibility: (cb: (visible: boolean) => void) => () => void;
  onChatRequestActive: (cb: (active: boolean) => void) => () => void;
  onFocus: (cb: () => void) => () => void;
  onState: (cb: (state: StageState) => void) => () => void;
  onThumbnail: (cb: (event: ThumbnailEvent) => void) => () => void;
  onRunToPoint: (cb: (event: RunToPointEvent) => void) => () => void;
}

declare global {
  interface Window {
    electron: ElectronAPI;
    stageAPI: StageAPI;
  }
}
