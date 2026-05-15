import { app } from "electron";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname, join } from "path";

const MAX_ENTRIES = 64;
/** v1 stored scans + flattens; v2 stores only flatten JS snippets keyed by URL (see `domMapCacheKey`). */
const FILE_VERSION = 2 as const;

type PersistedV2 = {
  v: typeof FILE_VERSION;
  flattenOrder: string[];
  flattens: Record<string, string>;
};

/** Legacy on-disk shape — scans removed; flattens migrated to v2. */
type PersistedV1 = {
  v: 1;
  scanOrder: string[];
  scans: Record<string, string>;
  flattenOrder: string[];
  flattens: Record<string, string>;
};

function emptyPersisted(): PersistedV2 {
  return {
    v: FILE_VERSION,
    flattenOrder: [],
    flattens: {},
  };
}

function isPersistedV2(x: unknown): x is PersistedV2 {
  if (x === null || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    o.v === FILE_VERSION &&
    Array.isArray(o.flattenOrder) &&
    typeof o.flattens === "object" &&
    o.flattens !== null
  );
}

function isPersistedV1(x: unknown): x is PersistedV1 {
  if (x === null || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    o.v === 1 &&
    Array.isArray(o.flattenOrder) &&
    typeof o.flattens === "object" &&
    o.flattens !== null
  );
}

function migrateV1ToV2(old: PersistedV1): PersistedV2 {
  const flattenOrder = [...old.flattenOrder];
  const flattens = { ...old.flattens };
  while (flattenOrder.length > MAX_ENTRIES) {
    const drop = flattenOrder.shift();
    if (drop !== undefined) delete flattens[drop];
  }
  return { v: FILE_VERSION, flattenOrder, flattens };
}

function touchOrder(order: string[], key: string): void {
  const i = order.indexOf(key);
  if (i !== -1) order.splice(i, 1);
  order.push(key);
}

function evictExcess(
  order: string[],
  map: Record<string, string>,
  max: number,
): void {
  while (order.length > max) {
    const drop = order.shift();
    if (drop !== undefined) delete map[drop];
  }
}

export function getDomMapCacheFilePath(): string {
  if (app.isPackaged) {
    return join(app.getPath("userData"), "dom-map-cache.json");
  }
  return join(process.cwd(), ".blueberry", "dom-map-cache.json");
}

export class DomMapDiskCache {
  private data: PersistedV2 = emptyPersisted();
  private loaded = false;
  private readonly filePath: string;

  constructor() {
    this.filePath = getDomMapCacheFilePath();
  }

  private ensureDir(): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      try {
        mkdirSync(dir, { recursive: true });
      } catch (e) {
        console.warn("[dom-map-cache] mkdir:", e);
      }
    }
  }

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      if (existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath, "utf8");
        const parsed: unknown = JSON.parse(raw);
        if (isPersistedV2(parsed)) {
          this.data = parsed;
          return;
        }
        if (isPersistedV1(parsed)) {
          this.data = migrateV1ToV2(parsed);
          this.persist();
          return;
        }
      }
    } catch (e) {
      console.warn("[dom-map-cache] load:", e);
    }
    this.data = emptyPersisted();
  }

  private persist(): void {
    this.ensureDir();
    const tmp = `${this.filePath}.tmp`;
    const payload = JSON.stringify(this.data);
    try {
      writeFileSync(tmp, payload, "utf8");
      renameSync(tmp, this.filePath);
    } catch (e) {
      console.warn("[dom-map-cache] persist:", e);
    }
  }

  peekFlatten(key: string | null): string | null {
    if (!key) return null;
    this.load();
    const v = this.data.flattens[key];
    if (v === undefined) return null;
    touchOrder(this.data.flattenOrder, key);
    return v;
  }

  rememberFlatten(key: string | null, script: string): void {
    if (!key) return;
    this.load();
    this.data.flattens[key] = script;
    touchOrder(this.data.flattenOrder, key);
    evictExcess(this.data.flattenOrder, this.data.flattens, MAX_ENTRIES);
    this.persist();
  }

  forgetFlatten(key: string | null): void {
    if (!key) return;
    this.load();
    delete this.data.flattens[key];
    const i = this.data.flattenOrder.indexOf(key);
    if (i !== -1) this.data.flattenOrder.splice(i, 1);
    this.persist();
  }
}

export const domMapDiskCache = new DomMapDiskCache();
