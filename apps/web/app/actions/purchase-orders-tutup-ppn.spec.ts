import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Aksi PO tahap 3:
 * - `updatePO` menghitung ulang PPN dengan tarif yang TERSIMPAN di PO (bukan
 *   tarif Pengaturan hari ini); PO lama (tarif kosong) tetap tanpa PPN.
 * - `tutupPO` butuh `purchase_orders:approve` dan mengembalikan `{ ok:false, code }`.
 * - `changePOStatus("CLOSED")` tidak lagi menjadi pintu belakang tanpa alasan
 *   dan tanpa izin approve; `SUBMITTED` hanya dari DRAFT (PO tertutup tidak
 *   bisa dibuka lagi lewat "kirim").
 * Tanpa basis data: prisma ditiru.
 */

const state = vi.hoisted(() => ({
  sesi: null as { user: { id: string; permissions: string[] } } | null,
  statusPo: "DRAFT" as string,
  ppnRatePercent: null as number | null,
  updatePo: [] as Array<Record<string, unknown>>,
  riwayat: [] as Array<{ status?: string; changedById?: string }>,
  tutup: [] as Array<{ poId: string; userId: string; alasan: string }>,
  hasilTutup: { ok: true } as Record<string, unknown>,
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => state.sesi) }));
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
vi.mock("@/lib/items/validate-variant-lines", () => ({
  assertLinesVariantSkusMatchItemDefinitions: vi.fn(async () => {}),
}));
vi.mock("@/lib/leadtime/po-snapshot", () => ({
  resolvePoLeadTimeFields: vi.fn(async () => ({ chainSnapshot: null, chainTotalDays: null, etaDate: null })),
}));
vi.mock("@/app/actions/settings/ppn", () => ({ getPpnRatePercent: async () => 12 }));
vi.mock("@/lib/purchase-orders/tutup", async (importOriginal) => {
  const asli = await importOriginal<typeof import("@/lib/purchase-orders/tutup")>();
  return {
    ...asli,
    tutupPurchaseOrder: vi.fn(async (input: { poId: string; userId: string; alasan: string }) => {
      state.tutup.push(input);
      return state.hasilTutup;
    }),
  };
});
vi.mock("@elorae/db", async (importOriginal) => {
  const asli = await importOriginal<typeof import("@elorae/db")>();
  const klien = {
    purchaseOrder: {
      findUnique: vi.fn(async () => ({
        id: "po-1",
        status: state.statusPo,
        docNumber: "PO/2026/00001",
        ppnRatePercent: state.ppnRatePercent,
        grns: [],
        items: [],
      })),
      update: vi.fn(async (a: { data: Record<string, unknown> }) => {
        state.updatePo.push(a.data);
        return { id: "po-1", status: (a.data.status as string) ?? state.statusPo };
      }),
    },
    pOStatusHistory: {
      create: vi.fn(async (a: { data: { changedById?: string; status?: string } }) => {
        state.riwayat.push(a.data);
        return a.data;
      }),
    },
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

const po = await import("./purchase-orders");

const SESI = "pengguna-sesi";
const DATA_PO = {
  supplierId: "sup-1",
  items: [{ itemId: "item-1", qty: 12, price: 85_000, ppnIncluded: false, uomId: "uom-1" }],
} as unknown as Parameters<typeof po.updatePO>[1];

beforeEach(() => {
  state.sesi = { user: { id: SESI, permissions: ["*"] } };
  state.statusPo = "DRAFT";
  state.ppnRatePercent = null;
  state.updatePo = [];
  state.riwayat = [];
  state.tutup = [];
  state.hasilTutup = { ok: true, docNumber: "PO/2026/00001", statusSebelum: "PARTIAL", sisa: [], qtySisa: 40, nilaiSisa: 3_774_000 };
});

describe("updatePO menghitung PPN dengan tarif yang tersimpan di PO", () => {
  it("PO bertarif 11%: 12 × 85.000 tanpa PPN → PPN 112.200, total 1.132.200 (bukan tarif 12% hari ini)", async () => {
    state.ppnRatePercent = 11;
    await po.updatePO("po-1", DATA_PO);
    expect(state.updatePo).toHaveLength(1);
    expect(state.updatePo[0]).toMatchObject({ totalAmount: 1_020_000, taxAmount: 112_200, grandTotal: 1_132_200 });
  });

  it("PO lama (tarif kosong): tetap tanpa PPN", async () => {
    state.ppnRatePercent = null;
    await po.updatePO("po-1", DATA_PO);
    expect(state.updatePo[0]).toMatchObject({ totalAmount: 1_020_000, taxAmount: 0, grandTotal: 1_020_000 });
  });
});

describe("tutupPO", () => {
  it("tanpa purchase_orders:approve ditolak TANPA_AKSES, tidak memanggil penulis", async () => {
    state.sesi = { user: { id: SESI, permissions: ["purchase_orders:view", "purchase_orders:edit"] } };
    expect(await po.tutupPO("po-1", "pemasok berhenti")).toEqual({ ok: false, code: "TANPA_AKSES" });
    expect(state.tutup).toEqual([]);
  });

  it("tanpa sesi ditolak", async () => {
    state.sesi = null;
    expect(await po.tutupPO("po-1", "pemasok berhenti")).toEqual({ ok: false, code: "TANPA_AKSES" });
  });

  it("dengan approve: penulis dipanggil atas nama SESI, hasilnya diteruskan", async () => {
    state.sesi = { user: { id: SESI, permissions: ["purchase_orders:approve"] } };
    const hasil = await po.tutupPO("po-1", "pemasok berhenti");
    expect(hasil).toMatchObject({ ok: true, qtySisa: 40, nilaiSisa: 3_774_000 });
    expect(state.tutup).toEqual([{ poId: "po-1", userId: SESI, alasan: "pemasok berhenti" }]);
  });

  it("penolakan penulis diteruskan sebagai kode", async () => {
    state.hasilTutup = { ok: false, code: "GRN_MENUNGGU_PEMILIK" };
    expect(await po.tutupPO("po-1", "x")).toEqual({ ok: false, code: "GRN_MENUNGGU_PEMILIK" });
  });
});

describe("changePOStatus tidak jadi pintu belakang", () => {
  it("CLOSED butuh purchase_orders:approve (edit saja tidak cukup)", async () => {
    state.sesi = { user: { id: SESI, permissions: ["purchase_orders:edit"] } };
    await expect(po.changePOStatus("po-1", "CLOSED", undefined, "selesai")).rejects.toThrow(/Forbidden/);
    expect(state.tutup).toEqual([]);
  });

  it("CLOSED lewat penulis tutup; penolakannya dilempar dengan pesan", async () => {
    state.hasilTutup = { ok: false, code: "BELUM_ADA_PENERIMAAN" };
    await expect(po.changePOStatus("po-1", "CLOSED", undefined, "selesai")).rejects.toThrow(/Belum ada barang/);
    expect(state.updatePo).toEqual([]);
  });

  it("SUBMITTED dari PO yang sudah ditutup ditolak — PO tertutup tidak dibuka lagi", async () => {
    state.statusPo = "CLOSED";
    await expect(po.submitPO("po-1")).rejects.toThrow(/draf/i);
    expect(state.updatePo).toEqual([]);
    expect(state.riwayat).toEqual([]);
  });
});
