import { describe, expect, it } from "vitest";
import { pesanGagalMutasi } from "./tampilan";

/*
 * Kalimat penolakan mutasi di HP — juga untuk ajuan dan tanda dikirim yang
 * ditolak saat antrean tanpa sinyal terkirim: setiap kode punya kalimatnya
 * sendiri (bukan "Gagal disimpan. Coba lagi." yang menyuruh mengulang hal
 * yang akan ditolak lagi).
 */
const td = ((kunci: string, nilai?: Record<string, unknown>) => (nilai ? `${kunci} ${JSON.stringify(nilai)}` : kunci)) as Parameters<
  typeof pesanGagalMutasi
>[1];

describe("pesanGagalMutasi", () => {
  it("gives each offline-queue refusal its own sentence", () => {
    for (const code of [
      "KUNJUNGAN_TIDAK_SAH",
      "KUNJUNGAN_DITOLAK",
      "WAKTU_TIDAK_VALID",
      "MUTASI_DITOLAK",
      "MUTASI_DIBATALKAN",
      "SUDAH_DIKIRIM",
      "AJUAN_DITOLAK",
      "AJUAN_TIDAK_ADA",
      "BELUM_DISETUJUI",
    ]) {
      expect(pesanGagalMutasi({ code }, td)).toBe(`err.${code}`);
    }
    expect(pesanGagalMutasi({ code: "TIDAK_DIKENAL" }, td)).toBe("err.GENERIC");
  });

  it("names the locked cycle and the short lines kept on a queued row", () => {
    expect(pesanGagalMutasi({ code: "SIKLUS_TERKUNCI", noKonsi: ["KNS/1", "KNS/2"] }, td)).toBe('err.SIKLUS_TERKUNCI {"siklus":"KNS/1, KNS/2"}');
    const kurang = [{ itemId: "i1", variantSku: "", qty: 3, tersedia: 1, productName: "Kemeja" }];
    expect(pesanGagalMutasi({ code: "SALDO_KURANG", kurang }, td)).toContain("kurangBaris");
  });
});
