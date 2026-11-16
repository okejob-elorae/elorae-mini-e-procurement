import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { gateAllows } from "../akses";
import { serialize } from "../output";
import type { ViraToolContext } from "./types";

const m = vi.hoisted(() => ({ daftarPiutang: vi.fn() }));
// The real ringkasPiutang and saringPiutang run; only the DB read is faked.
vi.mock("@/lib/receivables/queries", async (asli) => ({
  ...(await asli<typeof import("@/lib/receivables/queries")>()),
  daftarPiutang: m.daftarPiutang,
}));

import { parityCases, tools } from "./receivables";

const tool = tools[0];
const schema = z.object(tool.inputShape);
const ctx: ViraToolContext = { actor: { id: "u1", name: "Uji", permissions: ["receivables:view"] }, baseUrl: "https://e.test" };

function baris(no: string, extra: Record<string, unknown> = {}) {
  return {
    id: `r-${no}`,
    invoiceNo: no,
    storeId: "s1",
    storeName: "Toko Melati",
    salesmanName: "Budi",
    invoiceDate: "2026-10-01",
    dueDate: "2026-10-31",
    amount: 100000,
    outstanding: 100000,
    bolehDilunasi: 100000,
    source: "DELIVERY",
    konsi: false,
    asal: "DELIVERY",
    siklusId: null,
    nomorNotaKonsi: null,
    keadaan: "belum",
    keadaanTampil: "belum",
    alasan: { pelaporKlaim: "Andi", janjiBayar: "2026-11-20" },
    ...extra,
  };
}

const SEMUA = [
  baris("INV/1", { keadaanTampil: "jatuh_tempo", alasan: { hariLewatJatuhTempo: 16 } }),
  baris("INV/2"),
  baris("INV/3", { konsi: true, storeId: "s2", storeName: "Toko Mawar", outstanding: 40000 }),
  baris("INV/4", { keadaan: "lunas", keadaanTampil: "lunas", outstanding: 0 }),
  baris("INV/5", { keadaan: "klaim", keadaanTampil: "klaim", alasan: { noKlaim: "BKM-1", klaimMenunggu: ["BKM-1"] } }),
];

beforeEach(() => {
  m.daftarPiutang.mockReset().mockResolvedValue(SEMUA);
});

async function run(input: Record<string, unknown>) {
  return serialize(await tool.handler(schema.parse(input), ctx)) as {
    summary: { totalOutstanding: number; openCount: number; byState: Record<string, { count: number; outstanding: number }> };
    items: Array<Record<string, unknown>>;
    total: number;
    hasMore: boolean;
  };
}

describe("list_receivables input", () => {
  it("accepts every saringPiutang state, jatuh_tempo included, and the source's kind values", () => {
    for (const state of ["lewat", "jatuh_tempo", "tertahan", "klaim", "tt", "belum", "lunas"]) {
      expect(schema.safeParse({ state }).success, state).toBe(true);
    }
    expect(schema.safeParse({ state: "overdue" }).success).toBe(false);
    expect(schema.safeParse({ kind: "konsi" }).success).toBe(true);
    expect(schema.safeParse({ kind: "nonkonsi" }).success).toBe(true);
    expect(schema.safeParse({ kind: "putus" }).success).toBe(false);
    expect(schema.safeParse({ search: "" }).success).toBe(false);
  });
});

describe("list_receivables handler", () => {
  it("maps exactly the listed fields (no salesman, claim reporter or promise date)", async () => {
    const out = await run({ state: "jatuh_tempo" });
    expect(out.items).toEqual([
      {
        invoiceNo: "INV/1",
        store: { id: "s1", name: "Toko Melati" },
        kind: "nonkonsi",
        state: "jatuh_tempo",
        amount: 100000,
        outstanding: 100000,
        dueDate: "2026-10-31",
        daysOverdue: 16,
        url: "https://e.test/backoffice/piutang?cari=INV%2F1",
      },
    ]);
    const json = JSON.stringify(out);
    expect(json).not.toContain("Budi");
    expect(json).not.toContain("Andi");
  });

  it("the summary is computed on the FILTERED rows, not all rows", async () => {
    const out = await run({ kind: "konsi" });
    expect(out.total).toBe(1);
    expect(out.summary.totalOutstanding).toBe(40000);
    expect(out.summary.openCount).toBe(1);
    expect(out.summary.byState.belum).toEqual({ count: 1, outstanding: 40000 });
    expect(out.summary.byState.klaim).toEqual({ count: 0, outstanding: 0 });
  });

  it("without a state, paid invoices are hidden — the page's own rule", async () => {
    const out = await run({});
    expect(out.items.map((i) => i.invoiceNo)).toEqual(["INV/1", "INV/2", "INV/3", "INV/5"]);
    expect(Object.keys(out.summary.byState)).toEqual(["lewat", "jatuh_tempo", "tertahan", "klaim", "tt", "belum", "lunas"]);
  });

  it("search matches the invoice number or store name", async () => {
    expect((await run({ search: "mawar" })).items.map((i) => i.invoiceNo)).toEqual(["INV/3"]);
    expect((await run({ search: "INV/5" })).items.map((i) => i.invoiceNo)).toEqual(["INV/5"]);
  });

  it("pages the filtered rows with sliceToPage", async () => {
    const out = await run({ limit: 2, offset: 2 });
    expect(out).toMatchObject({ total: 4, offset: 2, limit: 2, hasMore: false });
    expect(out.items.map((i) => i.invoiceNo)).toEqual(["INV/3", "INV/5"]);
  });

  it("gate: bolehMembacaPiutang — receivables:view or :manage, not payments:verify", () => {
    expect(gateAllows(tool.gate, ["receivables:view"])).toBe(true);
    expect(gateAllows(tool.gate, ["receivables:manage"])).toBe(true);
    expect(gateAllows(tool.gate, ["payments:verify"])).toBe(false);
    expect(gateAllows(tool.gate, [])).toBe(false);
    expect(parityCases).toEqual([
      { tool: "list_receivables", kind: "predicate", module: "@/lib/receivables/izin", exportName: "bolehMembacaPiutang" },
    ]);
  });
});
