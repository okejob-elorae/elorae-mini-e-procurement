/**
 * The SPG count sheet's unsent draft, kept in the browser so a reload mid-count keeps both the
 * typed figures and the moment each was counted. Without it a reload drops the count times, and
 * every row is stamped at the submit instant, so a sale between counting a shelf and submitting
 * reads as a surplus. Per-device convenience only: the server never reads it.
 *
 * Import-free and storage-injected so it runs in a unit test. Every storage call is wrapped:
 * storage can be missing or throw (private mode, blocked site data), and the sheet must still work.
 */
export type SpgDraftPendingLine = { key: string; itemId: string; itemSku: string; variantSku: string; productName: string };

export type SpgDraft = {
  counts: Record<string, string>;
  countedAtByKey: Record<string, number>;
  pendingLines: SpgDraftPendingLine[];
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const VERSION = 1;

export function spgDraftKey(storeId: string): string {
  return `elorae:spg-stocktake-draft:${storeId}`;
}

function isStringRecord(v: unknown): v is Record<string, string> {
  return typeof v === "object" && v !== null && !Array.isArray(v) && Object.values(v).every((x) => typeof x === "string");
}

function isNumberRecord(v: unknown): v is Record<string, number> {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    Object.values(v).every((x) => typeof x === "number" && Number.isFinite(x))
  );
}

function isPendingLine(v: unknown): v is SpgDraftPendingLine {
  if (typeof v !== "object" || v === null) return false;
  const p = v as Record<string, unknown>;
  return ["key", "itemId", "itemSku", "variantSku", "productName"].every((k) => typeof p[k] === "string");
}

/** The saved draft for this store, or null when there is none or it does not parse. */
export function readSpgDraft(storage: StorageLike | undefined, storeId: string): SpgDraft | null {
  try {
    const raw = storage?.getItem(spgDraftKey(storeId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.v !== VERSION) return null;
    if (!isStringRecord(parsed.counts) || !isNumberRecord(parsed.countedAtByKey)) return null;
    if (!Array.isArray(parsed.pendingLines) || !parsed.pendingLines.every(isPendingLine)) return null;
    return { counts: parsed.counts, countedAtByKey: parsed.countedAtByKey, pendingLines: parsed.pendingLines };
  } catch {
    return null;
  }
}

export function writeSpgDraft(storage: StorageLike | undefined, storeId: string, draft: SpgDraft): void {
  try {
    const empty =
      Object.keys(draft.counts).length === 0 && Object.keys(draft.countedAtByKey).length === 0 && draft.pendingLines.length === 0;
    if (empty) storage?.removeItem(spgDraftKey(storeId));
    else storage?.setItem(spgDraftKey(storeId), JSON.stringify({ v: VERSION, ...draft }));
  } catch {
    /* Quota or blocked storage: the sheet keeps working, only the reload safety net is lost. */
  }
}

export function clearSpgDraft(storage: StorageLike | undefined, storeId: string): void {
  try {
    storage?.removeItem(spgDraftKey(storeId));
  } catch {
    /* See writeSpgDraft. */
  }
}

/** `window.localStorage`, or undefined where reading it throws or there is no window. */
export function browserStorage(): StorageLike | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}
