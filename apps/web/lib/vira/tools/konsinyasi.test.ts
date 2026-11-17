import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { gateAllows } from "../akses";
import { serialize } from "../output";
import type { ViraToolContext } from "./types";

const m = vi.hoisted(() => ({
  daftarSiklus: vi.fn(),
  rincianSiklus: vi.fn(),
  catatNomorDokumen: vi.fn(),
}));
vi.mock("@/lib/konsinyasi/queries", () => ({ daftarSiklus: m.daftarSiklus, rincianSiklus: m.rincianSiklus }));
vi.mock("@/lib/konsinyasi/writer", () => ({ catatNomorDokumen: m.catatNomorDokumen }));

import { __sampleInput, parityCases, tools, writeTools } from "./konsinyasi";
import { ViraInputError } from "../errors";

const tool = tools[0];
const record = writeTools.find((t) => t.name === "record_consignment_document_number")!;
const schema = z.object(tool.inputShape);
const recordSchema = z.object(record.inputShape);
const ctx: ViraToolContext = { actor: { id: "u1", name: "Uji", permissions: ["consignment:view"] }, baseUrl: "https://e.test" };
const notaCtx: ViraToolContext = {
  actor: { id: "u-nota", name: "Admin", permissions: ["consignment:note_number", "vira:write"] },
  baseUrl: "https://e.test",
};

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
  m.daftarSiklus.mockReset().mockResolvedValue([
    siklus("a", "nota", { sisaTagihan: 0 }),
    siklus("b", "selesai", { sisaTagihan: 0 }),
    siklus("c", "laporan", { storeName: "Toko Mawar" }),
  ]);
  m.rincianSiklus.mockReset();
  m.catatNomorDokumen.mockReset().mockResolvedValue({ ok: true });
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
        soldValue: 750000,
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
    expect(parityCases).toEqual(
      expect.arrayContaining([
        { tool: "list_consignment_cycles", kind: "predicate", module: "@/lib/receivables/izin", exportName: "bolehMembukaKonsi" },
      ]),
    );
  });
});

describe("record_consignment_document_number", () => {
  it("__sampleInput + parity", () => {
    expect(__sampleInput.record_consignment_document_number).toEqual({
      cycle: "c-1",
      kind: "NOTA",
      number: "001",
    });
    expect(parityCases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tool: "record_consignment_document_number",
          kind: "writeAction",
          args: ["c-1", "NOTA", "001"],
        }),
        expect.objectContaining({
          tool: "record_consignment_document_number",
          kind: "writeAction",
          args: ["c-1", "PAJAK", "010"],
        }),
      ]),
    );
  });

  it("note_number can prepare NOTA but PAJAK → ViraInputError", async () => {
    const prepared = await record.prepare(
      recordSchema.parse({ cycle: "a", kind: "NOTA", number: "N-99" }),
      notaCtx,
    );
    expect(prepared.preview.title).toContain("NOTA");
    expect(prepared.args).toEqual({ cycleId: "a", kind: "NOTA", number: "N-99" });
    await expect(
      record.prepare(recordSchema.parse({ cycle: "a", kind: "PAJAK", number: "010" }), notaCtx),
    ).rejects.toEqual(new ViraInputError("Anda tidak punya izin mencatat nomor PAJAK."));
  });

  it("execute calls writer with actor", async () => {
    const res = await record.execute({ cycleId: "a", kind: "NOTA", number: "N-99" }, notaCtx);
    expect(m.catatNomorDokumen).toHaveBeenCalledWith({
      cycleId: "a",
      jenis: "NOTA",
      nomor: "N-99",
      olehUserId: "u-nota",
    });
    expect(res).toMatchObject({ ok: true, message: "Nomor NOTA dicatat.", entityType: "ConsignmentCycle" });
  });
});
