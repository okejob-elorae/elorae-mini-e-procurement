import { beforeEach, describe, expect, it, vi } from "vitest";
import { ViraInputError, ViraNotFoundError } from "../errors";

const m = vi.hoisted(() => ({ getStore: vi.fn(), listStores: vi.fn() }));
vi.mock("@/lib/stores/queries", () => ({ getStore: m.getStore, listStores: m.listStores }));

import { resolveStore } from "./_resolve-store";

function toko(id: string, code: string, name: string) {
  return { id, code, name, address: "Jl. Rahasia 1", phone: "0812", contactName: "Bu Ani", npwp: "01.234" };
}

const MELATI = toko("s1", "TK-MEL", "Toko Melati");
const MAWAR = toko("s2", "TK-MAW", "Toko Mawar");
const MELATI2 = toko("s3", "TK-MEL2", "Melati Jaya");

beforeEach(() => {
  m.getStore.mockReset().mockResolvedValue(null);
  m.listStores.mockReset().mockResolvedValue({ items: [MELATI, MAWAR, MELATI2], totalCount: 3 });
});

describe("resolveStore", () => {
  it("1. exact id wins, and returns only id, code and name", async () => {
    m.getStore.mockResolvedValue(MAWAR);
    expect(await resolveStore("s2")).toEqual({ id: "s2", code: "TK-MAW", name: "Toko Mawar" });
    expect(m.listStores).not.toHaveBeenCalled();
  });

  it("2. exact code, case-insensitive, beats a name match", async () => {
    m.listStores.mockResolvedValue({ items: [MELATI, MELATI2], totalCount: 2 });
    expect(await resolveStore("tk-mel")).toEqual({ id: "s1", code: "TK-MEL", name: "Toko Melati" });
    expect(m.listStores).toHaveBeenCalledWith({ search: "tk-mel" });
  });

  it("3. a single name containing the text, case-insensitive", async () => {
    expect(await resolveStore("MAWAR")).toEqual({ id: "s2", code: "TK-MAW", name: "Toko Mawar" });
  });

  it("several names → ViraInputError listing up to 5 as 'code – name'", async () => {
    const banyak = Array.from({ length: 7 }, (_, i) => toko(`x${i}`, `K${i}`, `Toko Sari ${i}`));
    m.listStores.mockResolvedValue({ items: banyak, totalCount: 7 });
    const err = await resolveStore("sari").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ViraInputError);
    expect((err as Error).message).toBe(
      "Several stores match: K0 – Toko Sari 0, K1 – Toko Sari 1, K2 – Toko Sari 2, K3 – Toko Sari 3, K4 – Toko Sari 4. Please be more specific.",
    );
  });

  it("the ambiguity message for two matches", async () => {
    await expect(resolveStore("melati")).rejects.toEqual(
      new ViraInputError("Several stores match: TK-MEL – Toko Melati, TK-MEL2 – Melati Jaya. Please be more specific."),
    );
  });

  it("no match → ViraNotFoundError", async () => {
    m.listStores.mockResolvedValue({ items: [], totalCount: 0 });
    await expect(resolveStore("kenanga")).rejects.toEqual(new ViraNotFoundError("Store not found"));
  });

  it("search hits that match neither code nor name (e.g. a partial code) → not found", async () => {
    m.listStores.mockResolvedValue({ items: [MELATI], totalCount: 1 });
    await expect(resolveStore("TK-M")).rejects.toBeInstanceOf(ViraNotFoundError);
  });
});
