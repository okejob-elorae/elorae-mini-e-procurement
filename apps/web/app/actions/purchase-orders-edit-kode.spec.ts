import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * `updatePO` mengembalikan `{ ok:false, code }`, bukan melempar. Dulu setiap
 * penolakan (PO ditutup, PIN salah, qty di bawah yang sudah diterima, varian
 * salah) dilempar; di build produksi Next menyamarkan pesan lemparan aksi
 * server, jadi layar edit PO hanya bisa menampilkan galat umum.
 * Tanpa basis data: prisma ditiru (balapan nyata ada di
 * `purchase-orders-edit-balapan.spec.ts`).
 */

const state = vi.hoisted(() => ({
  sesi: null as { user: { id: string; permissions: string[] } } | null,
  po: { status: "DRAFT" as string, ppnRatePercent: null as number | null } as
    | { status: string; ppnRatePercent: number | null }
    | null,
  diterima: [] as Array<{ itemId: string; variantSku: string | null; receivedQty: number; item?: { nameId: string; sku: string } }>,
  pin: { success: true } as { success: boolean; messageKey?: string; message?: string },
  varian: null as Error | null,
  /** Barang untuk pemeriksa varian ASLI (null = pemeriksa ditiru lewat `varian`). */
  barangAsli: null as Array<{ id: string; sku: string; variants: unknown }> | null,
  galatTulis: null as Error | null,
  ditulis: 0,
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
  verifyPinForAction: vi.fn(async () => state.pin),
}));
vi.mock("@/lib/items/validate-variant-lines", async (importOriginal) => {
  const asli = await importOriginal<typeof import("@/lib/items/validate-variant-lines")>();
  return {
    assertLinesVariantSkusMatchItemDefinitions: vi.fn(
      async (_delegasi: unknown, lines: Array<{ itemId: string; variantSku?: string | null }>) => {
        if (state.varian) throw state.varian;
        // Teks galat ASLI pemeriksa: kode VARIAN_TIDAK_VALID dikenali dari teks itu.
        if (state.barangAsli) {
          const barang = state.barangAsli;
          await asli.assertLinesVariantSkusMatchItemDefinitions({ findMany: async () => barang }, lines);
        }
      },
    ),
  };
});
vi.mock("@/lib/leadtime/po-snapshot", () => ({
  resolvePoLeadTimeFields: vi.fn(async () => ({ chainSnapshot: null, chainTotalDays: null, etaDate: null })),
}));
vi.mock("@elorae/db", async (importOriginal) => {
  const asli = await importOriginal<typeof import("@elorae/db")>();
  const klien = {
    purchaseOrder: {
      findUnique: vi.fn(async () => (state.po ? { id: "po-1", ...state.po } : null)),
      update: vi.fn(async () => {
        if (state.galatTulis) throw state.galatTulis;
        state.ditulis += 1;
        return { id: "po-1" };
      }),
    },
    pOStatusHistory: { create: vi.fn(async () => ({})) },
    pOItem: {
      findMany: vi.fn(async () => state.diterima),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
  };
  return {
    ...asli,
    prisma: { ...klien, $transaction: vi.fn(async (fn: (tx: typeof klien) => unknown) => fn(klien)) },
  };
});

const { updatePO } = await import("./purchase-orders");

type DataPo = Parameters<typeof updatePO>[1];
const baris = (qty: number) =>
  ({ supplierId: "sup-1", items: [{ itemId: "item-1", qty, price: 1_000, ppnIncluded: true, uomId: "uom-1" }] }) as unknown as DataPo;

beforeEach(() => {
  state.sesi = { user: { id: "pengguna-sesi", permissions: ["*"] } };
  state.po = { status: "DRAFT", ppnRatePercent: null };
  state.diterima = [];
  state.pin = { success: true };
  state.varian = null;
  state.barangAsli = null;
  state.galatTulis = null;
  state.ditulis = 0;
});

describe("updatePO mengembalikan kode penolakan", () => {
  it("PO draf → { ok:true, id }, satu tulisan", async () => {
    expect(await updatePO("po-1", baris(12))).toEqual({ ok: true, id: "po-1" });
    expect(state.ditulis).toBe(1);
  });

  it("tanpa sesi / tanpa purchase_orders:edit → TANPA_AKSES, tidak ada tulisan", async () => {
    state.sesi = null;
    expect(await updatePO("po-1", baris(12))).toEqual({ ok: false, code: "TANPA_AKSES" });
    state.sesi = { user: { id: "pengguna-sesi", permissions: ["purchase_orders:view"] } };
    expect(await updatePO("po-1", baris(12))).toEqual({ ok: false, code: "TANPA_AKSES" });
    expect(state.ditulis).toBe(0);
  });

  it("PO tidak ada → TIDAK_DITEMUKAN; PO ditutup / dibatalkan → PO_TERTUTUP", async () => {
    state.po = null;
    expect(await updatePO("po-1", baris(12))).toEqual({ ok: false, code: "TIDAK_DITEMUKAN" });
    for (const status of ["CLOSED", "CANCELLED"]) {
      state.po = { status, ppnRatePercent: null };
      expect(await updatePO("po-1", baris(12), undefined, "123456")).toEqual({ ok: false, code: "PO_TERTUTUP" });
    }
    expect(state.ditulis).toBe(0);
  });

  it("PO terkirim tanpa PIN → PIN_WAJIB; PIN salah → PIN_DITOLAK dengan kunci pesan pemeriksa PIN", async () => {
    state.po = { status: "SUBMITTED", ppnRatePercent: null };
    expect(await updatePO("po-1", baris(12))).toEqual({ ok: false, code: "PIN_WAJIB" });
    state.pin = { success: false, messageKey: "pinIncorrect", message: "PIN salah" };
    expect(await updatePO("po-1", baris(12), undefined, "000000")).toEqual({
      ok: false,
      code: "PIN_DITOLAK",
      kunciPesan: "pinIncorrect",
    });
    state.pin = { success: false, message: "PIN salah" };
    expect(await updatePO("po-1", baris(12), undefined, "000000")).toEqual({
      ok: false,
      code: "PIN_DITOLAK",
      kunciPesan: "pinInvalid",
    });
    expect(state.ditulis).toBe(0);
  });

  it("PO PARTIAL, 4 pcs sudah diterima, qty diubah ke 3 → QTY_DI_BAWAH_DITERIMA (barang, 4); baris dihapus → sama", async () => {
    state.po = { status: "PARTIAL", ppnRatePercent: null };
    state.diterima = [{ itemId: "item-1", variantSku: null, receivedQty: 4, item: { nameId: "Benang uji", sku: "BN-1" } }];
    expect(await updatePO("po-1", baris(3), undefined, "123456")).toEqual({
      ok: false,
      code: "QTY_DI_BAWAH_DITERIMA",
      barang: "Benang uji",
      diterima: 4,
    });
    const tanpaBaris = { supplierId: "sup-1", items: [{ itemId: "item-2", qty: 5, price: 1, ppnIncluded: true, uomId: "u" }] };
    expect(await updatePO("po-1", tanpaBaris as unknown as DataPo, undefined, "123456")).toEqual({
      ok: false,
      code: "QTY_DI_BAWAH_DITERIMA",
      barang: "Benang uji",
      diterima: 4,
    });
    expect(state.ditulis).toBe(0);
    // qty = yang sudah diterima tetap boleh.
    expect(await updatePO("po-1", baris(4), undefined, "123456")).toEqual({ ok: true, id: "po-1" });
  });

  it("varian tidak cocok dengan master barang → VARIAN_TIDAK_VALID menyebut SKU", async () => {
    state.varian = new Error("Select a valid variant for item BN-1");
    expect(await updatePO("po-1", baris(12))).toEqual({ ok: false, code: "VARIAN_TIDAK_VALID", barang: "BN-1" });
    state.varian = new Error("Item BN-2 has no variants; clear variant selection");
    expect(await updatePO("po-1", baris(12))).toEqual({ ok: false, code: "VARIAN_TIDAK_VALID", barang: "BN-2" });
    expect(state.ditulis).toBe(0);
  });

  it("teks galat pemeriksa varian ASLI dikenali: tanpa varian / varian di barang tanpa varian / barang hilang", async () => {
    const denganVarian = { id: "item-1", sku: "BN-9", variants: [{ sku: "BN-9-M" }] };
    state.barangAsli = [denganVarian];
    expect(await updatePO("po-1", baris(12))).toEqual({ ok: false, code: "VARIAN_TIDAK_VALID", barang: "BN-9" });
    state.barangAsli = [{ id: "item-1", sku: "BN-8", variants: [] }];
    const berVarian = {
      ...baris(12),
      items: [{ itemId: "item-1", variantSku: "BN-8-L", qty: 12, price: 1_000, ppnIncluded: true, uomId: "uom-1" }],
    } as unknown as DataPo;
    expect(await updatePO("po-1", berVarian)).toEqual({ ok: false, code: "VARIAN_TIDAK_VALID", barang: "BN-8" });
    state.barangAsli = [];
    expect(await updatePO("po-1", baris(12))).toEqual({ ok: false, code: "VARIAN_TIDAK_VALID", barang: "item-1" });
    expect(state.ditulis).toBe(0);
    // Varian yang benar lolos dan ditulis.
    state.barangAsli = [denganVarian];
    const benar = {
      ...baris(12),
      items: [{ itemId: "item-1", variantSku: "BN-9-M", qty: 12, price: 1_000, ppnIncluded: true, uomId: "uom-1" }],
    } as unknown as DataPo;
    expect(await updatePO("po-1", benar)).toEqual({ ok: true, id: "po-1" });
  });

  it("galat tak terduga saat menulis → GAGAL (dicatat), bukan lemparan", async () => {
    const catat = vi.spyOn(console, "error").mockImplementation(() => {});
    state.galatTulis = new Error("koneksi putus");
    expect(await updatePO("po-1", baris(12))).toEqual({ ok: false, code: "GAGAL" });
    expect(catat).toHaveBeenCalled();
    catat.mockRestore();
  });
});
