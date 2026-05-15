/**
 * Bounds DOM-map payloads sent to the LLM (HN / long articles) while keeping JSON valid.
 */

export const DOM_MAP_JSON_SECTION_MARKER = "--- DOM map JSON ---";

/** Max characters of serialized map JSON appended after the DOM map marker (~45k tokens upper bound-ish). */
export const DEFAULT_DOM_MAP_JSON_CHARS_FOR_LLM = 180_000;

type WalkerNode = Record<string, unknown>;

function pruneWalkerNode(
  node: WalkerNode | null | undefined,
  depth: number,
  siblingCap: number,
): WalkerNode | null {
  if (node === null || node === undefined) return null;
  if (typeof node !== "object") return null;
  if (depth <= 0) {
    const stub: WalkerNode = {};
    if (typeof node.t === "string") stub.t = node.t;
    if (typeof node.z === "string") stub.z = node.z;
    stub.x = "…";
    return stub;
  }
  const copy: WalkerNode = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === "k" || k === "w") continue;
    copy[k] = v;
  }
  const kids = node.k;
  if (Array.isArray(kids)) {
    copy.k = kids
      .slice(0, siblingCap)
      .map((ch) =>
        pruneWalkerNode(ch as WalkerNode, depth - 1, siblingCap),
      )
      .filter((c): c is WalkerNode => c != null);
  }
  const shadow = node.w;
  if (Array.isArray(shadow)) {
    copy.w = shadow
      .slice(0, siblingCap)
      .map((ch) =>
        pruneWalkerNode(ch as WalkerNode, depth - 1, siblingCap),
      )
      .filter((c): c is WalkerNode => c != null);
  }
  return copy;
}

/** Clone v4-ish dom map metadata + pruned tree. */
export function pruneDomMapValueForLLM(
  dom: Record<string, unknown>,
  depth: number,
  siblingCap: number,
): Record<string, unknown> {
  const treeRaw = dom.tree;
  let treePruned: unknown = treeRaw;
  if (
    typeof treeRaw === "object" &&
    treeRaw !== null &&
    !Array.isArray(treeRaw)
  ) {
    treePruned = pruneWalkerNode(
      treeRaw as WalkerNode,
      depth,
      siblingCap,
    ) as unknown;
  }
  const out: Record<string, unknown> = { ...dom };
  out.tree = treePruned ?? null;
  const metaRaw = dom.meta;
  const metaPatch = {
    llmDomMapTruncated: true,
    llmPruneDepth: depth,
    llmSiblingCap: siblingCap,
  };
  if (metaRaw !== null && typeof metaRaw === "object" && !Array.isArray(metaRaw)) {
    out.meta = { ...(metaRaw as object), ...metaPatch };
  } else {
    out.meta = metaPatch;
  }
  return out;
}

function minimalEmergencyDomSummary(dom: Record<string, unknown>): string {
  return JSON.stringify({
    ok: dom.ok ?? true,
    schema: typeof dom.schema === "string" ? dom.schema : "blueberry-dom-map-v4",
    pageTitle: dom.pageTitle,
    url: dom.url,
    root: dom.root,
    meta: {
      llmDomMapTruncateFailed: true,
      message:
        "Tree could not fit model context even after pruning; rerun with narrower page or omit comments.",
    },
    tree: { t: "_", x: "(omitted)", k: [] },
  });
}

/**
 * Produce compact JSON suitable for DOM-map flatten prompts, under `maxChars` when possible.
 * Use the **same parsed object** for `runDomMapFlattenCallable` as the assistant saw (`JSON.parse` this string).
 */
export function stringifyDomMapForTransformLlm(
  dom: unknown,
  maxChars: number = DEFAULT_DOM_MAP_JSON_CHARS_FOR_LLM,
): string {
  if (typeof dom !== "object" || dom === null) {
    return JSON.stringify(dom);
  }
  const obj = dom as Record<string, unknown>;
  let depth = 48;
  let cap = 200;
  for (let iter = 0; iter < 72; iter++) {
    let candidateObj: Record<string, unknown>;
    if (obj.ok === true && "tree" in obj) {
      candidateObj = pruneDomMapValueForLLM(obj, depth, cap);
    } else {
      candidateObj = obj;
    }
    const compact = JSON.stringify(candidateObj);
    if (compact.length <= maxChars) {
      return compact;
    }
    depth = Math.max(4, depth - 4);
    cap = Math.max(8, Math.floor(cap * 0.82));
  }
  const desperate = pruneDomMapValueForLLM(obj, 4, 8);
  const s = JSON.stringify(desperate);
  if (s.length <= maxChars) return s;
  return minimalEmergencyDomSummary(obj);
}

/** If body uses the DOM map JSON section marker, truncate only the serialized map part before send. */
export function budgetTruncateDomMapUserMessage(
  fullMessage: string,
  maxJsonChars: number = DEFAULT_DOM_MAP_JSON_CHARS_FOR_LLM,
): string {
  const idx = fullMessage.indexOf(DOM_MAP_JSON_SECTION_MARKER);
  if (idx === -1) return fullMessage;
  const preamble = fullMessage.slice(
    0,
    idx + DOM_MAP_JSON_SECTION_MARKER.length,
  );
  let jsonPart = fullMessage.slice(idx + DOM_MAP_JSON_SECTION_MARKER.length).trimStart();
  if (jsonPart.length === 0) return fullMessage;
  try {
    const parsed = JSON.parse(jsonPart) as unknown;
    const capped =
      stringifyDomMapForTransformLlm(parsed, maxJsonChars);
    return `${preamble.trimEnd()}\n\n${capped}`;
  } catch {
    if (jsonPart.length <= maxJsonChars) return fullMessage;
    return `${preamble.trimEnd()}\n\n${jsonPart.slice(0, maxJsonChars)}\n\n/* Note: truncated raw JSON (${jsonPart.length} chars); parsing failed earlier. */\n`;
  }
}
