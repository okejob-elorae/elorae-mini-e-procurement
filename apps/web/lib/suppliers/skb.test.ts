import { describe, expect, it } from "vitest";
import { isianSkbPemasok, perubahanSkb } from "./skb";

describe("isianSkbPemasok — isian SKB di formulir pemasok", () => {
  it("nomor + berlaku sampai (hari WIB, disimpan tengah malam WIB) + foto /api/foto", () => {
    expect(isianSkbPemasok({ skbNumber: " SKB-12/2026 ", skbValidUntil: "2026-12-31", skbPhotoUrl: "/api/foto/abc_1" })).toEqual({
      ok: true,
      data: { skbNumber: "SKB-12/2026", skbValidUntil: new Date("2026-12-31T00:00:00.000+07:00"), skbPhotoUrl: "/api/foto/abc_1" },
    });
  });

  it("nomor dikosongkan → SKB dihapus seluruhnya (tanggal dan foto ikut kosong)", () => {
    expect(isianSkbPemasok({ skbNumber: "", skbValidUntil: "2026-12-31", skbPhotoUrl: "/api/foto/abc" })).toEqual({
      ok: true,
      data: { skbNumber: null, skbValidUntil: null, skbPhotoUrl: null },
    });
    expect(isianSkbPemasok({ skbNumber: null })).toEqual({ ok: true, data: { skbNumber: null, skbValidUntil: null, skbPhotoUrl: null } });
  });

  it("tidak dikirim sama sekali → tidak diubah", () => {
    expect(isianSkbPemasok({})).toEqual({ ok: true, data: {} });
  });

  it("nomor tanpa tanggal, tanggal tidak sah, foto bukan /api/foto, nomor terlalu panjang → ditolak", () => {
    expect(isianSkbPemasok({ skbNumber: "SKB-1", skbValidUntil: null })).toEqual({ ok: false, kode: "SKB_TANGGAL_WAJIB" });
    expect(isianSkbPemasok({ skbNumber: "SKB-1", skbValidUntil: "2026-02-30" })).toEqual({ ok: false, kode: "SKB_TANGGAL_TIDAK_SAH" });
    expect(isianSkbPemasok({ skbNumber: "SKB-1", skbValidUntil: "2026-12-31", skbPhotoUrl: "https://contoh.id/x.jpg" })).toEqual({ ok: false, kode: "SKB_FOTO_TIDAK_SAH" });
    expect(isianSkbPemasok({ skbNumber: "x".repeat(192), skbValidUntil: "2026-12-31" })).toEqual({ ok: false, kode: "SKB_NOMOR_TERLALU_PANJANG" });
  });
});

describe("perubahanSkb — bahan jejak SUPPLIER_SKB_CHANGED", () => {
  const lama = { skbNumber: "SKB-1", skbValidUntil: new Date("2026-06-30T00:00:00.000+07:00"), skbPhotoUrl: null };
  it("berubah → pasangan sebelum/sesudah dengan tanggal hari WIB", () => {
    expect(perubahanSkb(lama, { skbValidUntil: new Date("2026-12-31T00:00:00.000+07:00") })).toEqual({
      before: { skbNumber: "SKB-1", skbValidUntil: "2026-06-30", skbPhotoUrl: null },
      after: { skbNumber: "SKB-1", skbValidUntil: "2026-12-31", skbPhotoUrl: null },
    });
  });
  it("tidak berubah atau tidak dikirim → null", () => {
    expect(perubahanSkb(lama, {})).toBeNull();
    expect(perubahanSkb(lama, { skbNumber: "SKB-1", skbValidUntil: new Date("2026-06-30T00:00:00.000+07:00") })).toBeNull();
    expect(perubahanSkb(null, { skbNumber: null, skbValidUntil: null, skbPhotoUrl: null })).toBeNull();
  });
  it("pemasok baru ber-SKB tercatat dari kosong", () => {
    expect(perubahanSkb(null, { skbNumber: "SKB-9", skbValidUntil: new Date("2026-12-31T00:00:00.000+07:00"), skbPhotoUrl: null })).toEqual({
      before: { skbNumber: null, skbValidUntil: null, skbPhotoUrl: null },
      after: { skbNumber: "SKB-9", skbValidUntil: "2026-12-31", skbPhotoUrl: null },
    });
  });
});
