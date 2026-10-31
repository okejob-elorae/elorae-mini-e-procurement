import { describe, expect, it } from "vitest";
import { pesanTolakBatalPo } from "./pesan-batal-po";

/*
 * Layar PO (daftar dan detail) membatalkan lewat `batalkanPO`, yang
 * mengembalikan `{ ok:false, code }` — dulu lewat `changePOStatus`/`cancelPO`
 * yang MELEMPAR, dan di build produksi Next menyamarkan pesan lemparan, jadi
 * "sudah ada barang diterima" tampil sebagai galat umum.
 */
describe("pesanTolakBatalPo", () => {
  it.each(["TIDAK_DITEMUKAN", "SUDAH_DIBATALKAN", "SUDAH_ADA_PENERIMAAN", "TANPA_AKSES", "GAGAL"] as const)(
    "%s → purchaseOrders.batal.err.%s, jendela PIN ditutup",
    (code) => {
      expect(pesanTolakBatalPo({ ok: false, code })).toEqual({
        ruang: "purchaseOrders",
        kunci: `batal.err.${code}`,
        ulangiPin: false,
      });
    },
  );

  it("PIN_WAJIB → pesan PO, jendela PIN tetap terbuka", () => {
    expect(pesanTolakBatalPo({ ok: false, code: "PIN_WAJIB" })).toEqual({
      ruang: "purchaseOrders",
      kunci: "batal.err.PIN_WAJIB",
      ulangiPin: true,
    });
  });

  it("PIN_DITOLAK memakai kunci security dari pemeriksa PIN, jendela PIN tetap terbuka", () => {
    expect(pesanTolakBatalPo({ ok: false, code: "PIN_DITOLAK", kunciPesan: "tooManyAttempts" })).toEqual({
      ruang: "security",
      kunci: "tooManyAttempts",
      ulangiPin: true,
    });
  });

  it("PIN_DITOLAK tanpa kunci pesan → security.pinInvalid", () => {
    expect(pesanTolakBatalPo({ ok: false, code: "PIN_DITOLAK", kunciPesan: "  " })).toMatchObject({
      ruang: "security",
      kunci: "pinInvalid",
    });
  });
});
