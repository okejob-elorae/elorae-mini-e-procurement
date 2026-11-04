import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Izin aksi tagihan pemasok baru (keputusan pemilik 2026-11-02, P19, P27, P50, P52, P53): setiap aksi
 * memeriksa izinnya SEBELUM menyentuh penulisnya, dan izinnya sama dengan yang diperiksa tombolnya.
 * `vendor_bills:manage` saja TIDAK bisa memutuskan selisih harga (persetujuan, bawaannya hanya admin).
 * Penulis ditiru; tidak ada basis data.
 */

const state = vi.hoisted(() => ({ sesi: null as { user: { id: string; permissions: string[] } } | null }));
const penulis = vi.hoisted(() => ({
  putuskanSelisihHarga: vi.fn(async () => ({ ok: true, billId: "b1" })),
  mintaInvoice: vi.fn(async () => ({ ok: true, id: "r1", ulang: false })),
  mintaUlangInvoice: vi.fn(async () => ({ ok: true, id: "r1", ulang: false })),
  batalkanPermintaanInvoice: vi.fn(async () => ({ ok: true, id: "r1", ulang: false })),
  tandaiTidakPerluInvoice: vi.fn(async () => ({ ok: true, ids: ["w1"] })),
  batalkanTidakPerluInvoice: vi.fn(async () => ({ ok: true, ids: ["w1"] })),
  bacaInvoiceUntukBayar: vi.fn(async () => ({ invoice: [], penerimaan: [] })),
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => state.sesi) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/vendor-billing/koreksi-utang-writer", () => ({ putuskanSelisihHarga: penulis.putuskanSelisihHarga }));
vi.mock("@/lib/vendor-billing/permintaan-invoice-writer", () => ({
  mintaInvoice: penulis.mintaInvoice,
  mintaUlangInvoice: penulis.mintaUlangInvoice,
  batalkanPermintaanInvoice: penulis.batalkanPermintaanInvoice,
}));
vi.mock("@/lib/vendor-billing/tidak-perlu-invoice-writer", () => ({
  tandaiTidakPerluInvoice: penulis.tandaiTidakPerluInvoice,
  batalkanTidakPerluInvoice: penulis.batalkanTidakPerluInvoice,
}));
vi.mock("@/lib/vendor-billing/invoice-bayar-queries", () => ({ bacaInvoiceUntukBayar: penulis.bacaInvoiceUntukBayar }));

const { putuskanSelisihHargaAction } = await import("./vendor-bill-koreksi");
const permintaan = await import("./vendor-bill-permintaan");
const { invoiceUntukBayarAction } = await import("./supplier-payment-invoice");

const sebagai = (permissions: string[]) => {
  state.sesi = { user: { id: "u1", permissions } };
};

type Kasus = [string, () => Promise<unknown>, keyof typeof penulis, string];

const kasus: Kasus[] = [
  ["putuskanSelisihHargaAction", () => putuskanSelisihHargaAction({ koreksiId: "k1", keputusan: "TERIMA" }), "putuskanSelisihHarga", "vendor_bills:decide_price"],
  [
    "mintaInvoiceAction",
    () => permintaan.mintaInvoiceAction({ supplierId: "s1", sumber: [{ jenis: "GRN", id: "g1" }], saluran: "WHATSAPP" }),
    "mintaInvoice",
    "vendor_bills:manage",
  ],
  ["mintaUlangInvoiceAction", () => permintaan.mintaUlangInvoiceAction({ requestId: "r1", saluran: "TELEPON" }), "mintaUlangInvoice", "vendor_bills:manage"],
  ["batalkanPermintaanInvoiceAction", () => permintaan.batalkanPermintaanInvoiceAction({ requestId: "r1", alasan: "salah" }), "batalkanPermintaanInvoice", "vendor_bills:manage"],
  [
    "tidakPerluInvoiceAction",
    () => permintaan.tidakPerluInvoiceAction({ supplierId: "s1", sumber: [{ jenis: "GRN", id: "g1", itemId: "i1", variantSku: null }], alasan: "jasa sendiri" }),
    "tandaiTidakPerluInvoice",
    "vendor_bills:manage",
  ],
  ["batalkanTidakPerluInvoiceAction", () => permintaan.batalkanTidakPerluInvoiceAction({ waiverId: "w1", alasan: "salah" }), "batalkanTidakPerluInvoice", "vendor_bills:manage"],
  ["invoiceUntukBayarAction", () => invoiceUntukBayarAction({ pemasokId: "s1" }), "bacaInvoiceUntukBayar", "supplier_payments:view"],
];

describe("izin aksi tagihan pemasok", () => {
  beforeEach(() => {
    state.sesi = null;
    for (const f of Object.values(penulis)) f.mockClear();
  });

  it.each(kasus)("%s refuses without a session and never reaches its writer", async (_n, panggil, fungsi) => {
    expect(await panggil()).toEqual({ ok: false, kode: "TANPA_AKSES" });
    expect(penulis[fungsi]).not.toHaveBeenCalled();
  });

  it.each(kasus)("%s refuses a session without its code and never reaches its writer", async (_n, panggil, fungsi) => {
    // Tidak satu pun kode aksi ini: izin persis, tidak ada yang menyiratkan yang lain.
    sebagai(["vendor_bills:view", "inventory:manage", "supplier_payments:create"]);
    expect(await panggil()).toEqual({ ok: false, kode: "TANPA_AKSES" });
    expect(penulis[fungsi]).not.toHaveBeenCalled();
  });

  it.each(kasus)("%s passes with its own code, with the actor taken from the session", async (_n, panggil, fungsi, kode) => {
    sebagai([kode]);
    expect(await panggil()).toMatchObject({ ok: true });
    expect(penulis[fungsi]).toHaveBeenCalledTimes(1);
    if (fungsi !== "bacaInvoiceUntukBayar") expect(penulis[fungsi]).toHaveBeenCalledWith(expect.objectContaining({ olehUserId: "u1" }));
  });

  it("vendor_bills:manage alone cannot decide a price difference (P27: a manager decision, admin only by default)", async () => {
    sebagai(["vendor_bills:view", "vendor_bills:manage"]);
    expect(await putuskanSelisihHargaAction({ koreksiId: "k1", keputusan: "TERIMA" })).toEqual({ ok: false, kode: "TANPA_AKSES" });
    expect(penulis.putuskanSelisihHarga).not.toHaveBeenCalled();
  });

  it("vendor_bills:decide_price alone cannot ask for an invoice or waive one", async () => {
    sebagai(["vendor_bills:decide_price"]);
    expect(await permintaan.mintaInvoiceAction({ supplierId: "s1", sumber: [{ jenis: "GRN", id: "g1" }], saluran: "WHATSAPP" })).toEqual({ ok: false, kode: "TANPA_AKSES" });
    expect(await permintaan.tidakPerluInvoiceAction({ supplierId: "s1", sumber: [{ jenis: "GRN", id: "g1" }], alasan: "x" })).toEqual({ ok: false, kode: "TANPA_AKSES" });
    expect(penulis.mintaInvoice).not.toHaveBeenCalled();
    expect(penulis.tandaiTidakPerluInvoice).not.toHaveBeenCalled();
  });

  it("an admin wildcard passes every action", async () => {
    sebagai(["*"]);
    for (const [, panggil] of kasus) expect(await panggil()).toMatchObject({ ok: true });
  });

  it("a writer that throws becomes GAGAL, never a raw error the browser would see masked", async () => {
    sebagai(["*"]);
    penulis.putuskanSelisihHarga.mockRejectedValueOnce(new Error("db exploded"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await putuskanSelisihHargaAction({ koreksiId: "k1", keputusan: "TERIMA" })).toEqual({ ok: false, kode: "GAGAL" });
    err.mockRestore();
  });
});
