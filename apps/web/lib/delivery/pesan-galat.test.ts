import { describe, expect, it } from "vitest";
import { pesanGagalPengiriman, type PenerjemahGalat } from "./pesan-galat";

/* Penerjemah tiruan: mencatat kunci dan nilainya, jadi kalimatnya bisa diperiksa tanpa next-intl. */
const SEBAB: Record<string, string> = { SUDAH_DITERIMA: "Kiriman ini sudah diterima." };
const t: PenerjemahGalat = {
  teks: (kunci, nilai) => (nilai ? `${kunci}|${JSON.stringify(nilai)}` : kunci),
  adaSebab: (kode) => kode in SEBAB,
  sebab: (kode) => SEBAB[kode],
};

describe("pesanGagalPengiriman", () => {
  it("TERIMA_GAGAL: kode alasan penerimaan toko diterjemahkan, tidak pernah tampil mentah", () => {
    expect(pesanGagalPengiriman("TERIMA_GAGAL", "SUDAH_DITERIMA", t)).toBe(`err.TERIMA_GAGAL|${JSON.stringify({ detail: "Kiriman ini sudah diterima." })}`);
    // Kode tanpa kalimat, atau tanpa kode: kalimat umum.
    const umum = `err.TERIMA_GAGAL|${JSON.stringify({ detail: "err.TERIMA_GAGAL_LAIN" })}`;
    expect(pesanGagalPengiriman("TERIMA_GAGAL", "CATATAN_STOK_TIDAK_COCOK", t)).toBe(umum);
    expect(pesanGagalPengiriman("TERIMA_GAGAL", undefined, t)).toBe(umum);
    expect(pesanGagalPengiriman("TERIMA_GAGAL", "SUDAH_DITERIMA", t)).not.toContain('"SUDAH_DITERIMA"');
  });

  it("RECEIVABLE_PAID tanpa nomor laporan memakai kalimatnya sendiri; dengan nomor, nomornya disebut", () => {
    expect(pesanGagalPengiriman("RECEIVABLE_PAID", undefined, t)).toBe("err.RECEIVABLE_PAID_TANPA_LAPORAN");
    expect(pesanGagalPengiriman("RECEIVABLE_PAID", "  ", t)).toBe("err.RECEIVABLE_PAID_TANPA_LAPORAN");
    expect(pesanGagalPengiriman("RECEIVABLE_PAID", "BKM-1", t)).toBe(`err.RECEIVABLE_PAID|${JSON.stringify({ detail: "BKM-1" })}`);
  });

  it("penolakan lain: err.<kode> dengan detail apa adanya (atau kosong)", () => {
    expect(pesanGagalPengiriman("RECEIVABLE_IN_USE", "kontrabon KB-1", t)).toBe(`err.RECEIVABLE_IN_USE|${JSON.stringify({ detail: "kontrabon KB-1" })}`);
    expect(pesanGagalPengiriman("INVALID_STATE", undefined, t)).toBe(`err.INVALID_STATE|${JSON.stringify({ detail: "" })}`);
  });
});
