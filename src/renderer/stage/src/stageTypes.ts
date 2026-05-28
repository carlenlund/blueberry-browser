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
