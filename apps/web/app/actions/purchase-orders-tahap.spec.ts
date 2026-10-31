import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * PO terhubung ke tahap produksi (`PurchaseOrder.planStageId`): "Buat PO" di
 * ruang kerja tahap membuka formulir dengan `?planStageId=`, dan PO yang
 * disimpan menyimpan tautannya. Edit PO mempertahankan tautan kecuali dilepas.
 * Tanpa basis data: prisma ditiru, yang diperiksa adalah isi yang ditulis dan
 * penolakan tahap yang tidak ada (relationMode = "prisma": tanpa kunci asing,
 * jadi pemeriksaan penulis adalah satu-satunya penjaga tautan menggantung).
 */

const state = vi.hoisted(() => ({
  /** Tahap yang "ada" di basis data. */
  tahapAda: new Set<string>(),
  /** `planStageId` PO yang sedang diedit. */
  tahapLama: null as string | null,
  dicari: [] as string[],
  dibuat: [] as Array<Record<string, unknown>>,
  diubah: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: "pengguna-sesi", permissions: ["*"] } })),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/app/actions/notifications", () => ({
  getActorName: vi.fn(async () => "Uji"),
  notifyPOCreated: vi.fn(async () => {}),
  notifyPOStatusUpdated: vi.fn(async () => {}),
  notifyPOPaymentToggled: vi.fn(async () => {}),
}));
vi.mock("@/app/actions/security/pin-auth", () => ({
  verifyPinForAction: vi.fn(async () => ({ success: true })),
}));
vi.mock("@/app/actions/settings/ppn", () => ({ getPpnRatePercent: vi.fn(async () => 11) }));
vi.mock("@/lib/docNumber", () => ({ generateDocNumber: vi.fn(async () => "PO/2026/00077") }));
vi.mock("@/lib/items/validate-variant-lines", () => ({
  assertLinesVariantSkusMatchItemDefinitions: vi.fn(async () => {}),
}));
vi.mock("@/lib/leadtime/po-snapshot", () => ({
  resolvePoLeadTimeFields: vi.fn(async () => ({ chainSnapshot: null, chainTotalDays: null, etaDate: null })),
}));
vi.mock("@elorae/db", async (importOriginal) => {
  const asli = await importOriginal<typeof import("@elorae/db")>();
  const klien = {
    planStage: {
      findUnique: vi.fn(async (a: { where: { id: string } }) => {
        state.dicari.push(a.where.id);
        return state.tahapAda.has(a.where.id) ? { id: a.where.id } : null;
      }),
    },
    purchaseOrder: {
      create: vi.fn(async (a: { data: Record<string, unknown> }) => {
        state.dibuat.push(a.data);
        return { id: "po-baru", docNumber: "PO/2026/00077", planStageId: a.data.planStageId ?? null, items: [] };
      }),
      findUnique: vi.fn(async () => ({ id: "po-1", status: "DRAFT", ppnRatePercent: null, planStageId: state.tahapLama })),
      update: vi.fn(async (a: { data: Record<string, unknown> }) => {
        state.diubah.push(a.data);
        return { id: "po-1" };
      }),
    },
    pOStatusHistory: { create: vi.fn(async () => ({})) },
    pOItem: {
      findMany: vi.fn(async () => []),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
  };
  return {
    ...asli,
    prisma: { ...klien, $transaction: vi.fn(async (fn: (tx: typeof klien) => unknown) => fn(klien)) },
  };
});

const { createPO, updatePO } = await import("./purchase-orders");

type DataPo = Parameters<typeof createPO>[0];
const dataPo = (tambahan: Record<string, unknown> = {}) =>
  ({
    supplierId: "sup-1",
    items: [{ itemId: "item-1", qty: 50, price: 42_000, ppnIncluded: false, uomId: "uom-kg" }],
    ...tambahan,
  }) as unknown as DataPo;

beforeEach(() => {
  state.tahapAda = new Set(["tahap-kaos-a"]);
  state.tahapLama = null;
  state.dicari = [];
  state.dibuat = [];
  state.diubah = [];
});

describe("createPO menyimpan tahap produksi", () => {
  it("PO dari ruang kerja tahap: planStageId tersimpan, tahapnya diperiksa", async () => {
    expect(await createPO(dataPo({ planStageId: "tahap-kaos-a" }))).toEqual({
      ok: true,
      id: "po-baru",
      docNumber: "PO/2026/00077",
    });
    expect(state.dicari).toEqual(["tahap-kaos-a"]);
    expect(state.dibuat).toHaveLength(1);
    expect(state.dibuat[0].planStageId).toBe("tahap-kaos-a");
  });

  it("PO biasa (tanpa tahap) atau tahap dilepas (null): planStageId null, tanpa pencarian tahap", async () => {
    await createPO(dataPo());
    await createPO(dataPo({ planStageId: null }));
    expect(state.dicari).toEqual([]);
    expect(state.dibuat.map((d) => d.planStageId)).toEqual([null, null]);
  });

  it("tahap sudah tidak ada → { ok:false, TAHAP_TIDAK_ADA }, tidak ada PO tertulis", async () => {
    expect(await createPO(dataPo({ planStageId: "tahap-dihapus" }))).toEqual({ ok: false, code: "TAHAP_TIDAK_ADA" });
    expect(state.dibuat).toEqual([]);
  });

  it("planStageId kosong ditolak validasi formulir (bukan disimpan sebagai teks kosong)", async () => {
    await expect(createPO(dataPo({ planStageId: "" }))).rejects.toThrow();
    expect(state.dibuat).toEqual([]);
  });
});

describe("updatePO mempertahankan tahap kecuali dilepas", () => {
  it("planStageId tidak dikirim → kolomnya tidak disentuh", async () => {
    state.tahapLama = "tahap-kaos-a";
    expect(await updatePO("po-1", dataPo())).toEqual({ ok: true, id: "po-1" });
    expect(state.diubah).toHaveLength(1);
    expect("planStageId" in state.diubah[0]).toBe(false);
    expect(state.dicari).toEqual([]);
  });

  it("tahap yang sama dikirim ulang → tetap, tanpa pemeriksaan ulang (edit tidak gagal karena tahapnya)", async () => {
    state.tahapLama = "tahap-lama-hilang";
    expect(await updatePO("po-1", dataPo({ planStageId: "tahap-lama-hilang" }))).toEqual({ ok: true, id: "po-1" });
    expect(state.diubah[0].planStageId).toBe("tahap-lama-hilang");
    expect(state.dicari).toEqual([]);
  });

  it("chip dilepas (null) → planStageId dikosongkan", async () => {
    state.tahapLama = "tahap-kaos-a";
    expect(await updatePO("po-1", dataPo({ planStageId: null }))).toEqual({ ok: true, id: "po-1" });
    expect(state.diubah[0].planStageId).toBeNull();
  });

  it("tahap BARU yang ada → ditautkan; yang tidak ada → TAHAP_TIDAK_ADA tanpa tulisan", async () => {
    expect(await updatePO("po-1", dataPo({ planStageId: "tahap-kaos-a" }))).toEqual({ ok: true, id: "po-1" });
    expect(state.diubah[0].planStageId).toBe("tahap-kaos-a");
    expect(state.dicari).toEqual(["tahap-kaos-a"]);

    state.diubah = [];
    expect(await updatePO("po-1", dataPo({ planStageId: "tahap-dihapus" }))).toEqual({
      ok: false,
      code: "TAHAP_TIDAK_ADA",
    });
    expect(state.diubah).toEqual([]);
  });
});
