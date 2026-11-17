import { getStore, listStores } from "@/lib/stores/queries";
import { ViraInputError, ViraNotFoundError } from "../errors";

export type ResolvedStore = { id: string; code: string; name: string };

/**
 * A store from what a user typed: exact id, then exact code (case-insensitive), then a name that
 * contains the text (case-insensitive). Stops at the first rule that matches. Only id, code and
 * name leave this function — never the store's address, phone, contact or NPWP.
 */
export async function resolveStore(input: string): Promise<ResolvedStore> {
  const text = input.trim();
  if (!text) throw new ViraNotFoundError("Store not found");

  const byId = await getStore(text);
  if (byId) return { id: byId.id, code: byId.code, name: byId.name };

  const { items } = await listStores({ search: text });
  const lower = text.toLowerCase();

  const byCode = items.filter((s) => s.code.toLowerCase() === lower);
  if (byCode.length === 1) return { id: byCode[0].id, code: byCode[0].code, name: byCode[0].name };

  const byName = items.filter((s) => s.name.toLowerCase().includes(lower));
  if (byName.length === 0) throw new ViraNotFoundError("Store not found");
  if (byName.length > 1) {
    const list = byName
      .slice(0, 5)
      .map((s) => `${s.code} – ${s.name}`)
      .join(", ");
    throw new ViraInputError(`Several stores match: ${list}. Please be more specific.`);
  }
  return { id: byName[0].id, code: byName[0].code, name: byName[0].name };
}
