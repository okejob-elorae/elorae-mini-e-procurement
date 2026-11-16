import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { gateAllows } from "../akses";
import { serialize } from "../output";
import type { ViraToolContext } from "./types";

const m = vi.hoisted(() => ({ daftarSiklus: vi.fn(), rincianSiklus: vi.fn() }));
vi.mock("@/lib/konsinyasi/queries", () => ({ daftarSiklus: m.daftarSiklus, rincianSiklus: m.rincianSiklus }));

import { parityCases, tools } from "./konsinyasi";

const tool = tools[0];
const schema = z.object(tool.inputShape);
const ctx: ViraToolContext = { actor: { id: "u1", name: "Uji", permissions: ["consignment:view"] }, baseUrl: "https://e.test" };

function siklus(id: string, tahap: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    noKonsi: `KNS-${id}`,
    storeId: "s1",
    storeName: "Toko Melati",
    periode: "Oktober 2026",
    tahap,
    giliran: "admin",
    nilaiTerjual: 750000,
    sisaTagihan: null,
    noNota: "NOTA-9",
    noFakturPajak: null,
    tenggatSpg: "2026-11-05T00:00:00.000Z",
    gajiTerlambat: true,
    penandaCocok: null,
    // Not on BarisSiklus today; a source that ever carries them must not leak them.
    gajiPokok: 3500000,
    komisiSpg: 125000,
    spg: [{ nama: "Rina", gajiPokok: 3500000, upah: 100000 }],
    ...extra,
  };
}

beforeEach(() => {
  m.daftarSiklus.mockReset().mockResolvedValue([siklus("a", "nota"), siklus("b", "selesai"), siklus("c", "laporan", { storeName: "Toko Mawar" })]);
  m.rincianSiklus.mockReset();
});

async function run(input: Record<string, unknown>) {
  return serialize(await tool.handler(schema.parse(input), ctx)) as { items: Array<Record<string, unknown>>; total: number };
}

describe("list_consignment_cycles", () => {
  it("input: SaringSiklus values", () => {
    for (const stage of ["berjalan", "semua", "laporan", "cocok", "bayar_spg", "nota", "pajak", "bayar_toko", "selesai"]) {
      expect(schema.safeParse({ stage }).success, stage).toBe(true);
    }
    expect(schema.safeParse({ stage: "lunas" }).success).toBe(false);
    expect(schema.safeParse({ search: "x".repeat(101) }).success).toBe(false);
  });

  it("maps exactly the listed fields and never calls rincianSiklus", async () => {
    const out = await run({ stage: "nota" });
    expect(out.items).toEqual([
      {
        id: "a",
        store: { id: "s1", name: "Toko Melati" },
        stage: "nota",
        notaNo: "NOTA-9",
        fakturPajakNo: null,
        billedTotal: 750000,
        url: "https://e.test/backoffice/konsinyasi/a",
      },
    ]);
    expect(m.rincianSiklus).not.toHaveBeenCalled();
  });

  it("a source row containing gajiPokok (or any salary, wage or commission) never leaks it", async () => {
    const json = JSON.stringify(await run({ stage: "semua" }));
    for (const banned of ["gaji", "komisi", "upah", "3500000", "125000", "Rina", "tenggatSpg", "gajiTerlambat"]) {
      expect(json, banned).not.toContain(banned);
    }
  });

  it("no stage = the page's default (not finished); search filters", async () => {
    expect((await run({})).items.map((i) => i.id)).toEqual(["a", "c"]);
    expect((await run({ stage: "semua", search: "mawar" })).items.map((i) => i.id)).toEqual(["c"]);
  });

  it("pages with sliceToPage", async () => {
    expect(await run({ stage: "semua", limit: 2, offset: 0 })).toMatchObject({ total: 3, offset: 0, limit: 2, hasMore: true });
  });

  it("gate: bolehMembukaKonsi — consignment:view only", () => {
    expect(gateAllows(tool.gate, ["consignment:view"])).toBe(true);
    expect(gateAllows(tool.gate, ["receivables:manage"])).toBe(false);
    expect(gateAllows(tool.gate, [])).toBe(false);
    expect(parityCases).toEqual([
      { tool: "list_consignment_cycles", kind: "predicate", module: "@/lib/receivables/izin", exportName: "bolehMembukaKonsi" },
    ]);
  });
});
