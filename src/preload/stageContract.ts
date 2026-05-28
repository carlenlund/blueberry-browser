/**
 * Shared stage types + layout constants (safe for main and preload).
 * Do not import electron or touch `window` here.
 */

/** Layout stride for stage cards (must match StageApp card spacing). */
export const STAGE_CARD_LENGTH = 3.6;
export const STAGE_CARD_GAP = 0.36;
export const STAGE_CARD_STRIDE = STAGE_CARD_LENGTH + STAGE_CARD_GAP;

export interface Card {
  id: string;
  tabId: string;
  url: string;
  title: string;
  visitedAt: number;
  /** False once the owning tab has navigated away or been closed. */
  active: boolean;
  /** Fixed X on the stage runway; assigned at card creation and never changed. */
  stageX: number;
}

export interface StageState {
  cards: Card[];
  /** The card currently shown in the active tab (where the avatar stands). */
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
