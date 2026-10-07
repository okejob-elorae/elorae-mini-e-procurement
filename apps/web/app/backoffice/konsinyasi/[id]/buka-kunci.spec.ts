import { describe, expect, it } from "vitest";
import { alasanTolakBukaKunci } from "./buka-kunci";

/*
 * Tombol "Buka kunci" dulu langsung menjalankan aksinya, dan tetap aktif di
 * KONSI/26/08/0001 yang sudah punya nomor nota, nomor faktur pajak, dan gaji SPG
 * yang dibayar — pembukaan yang pasti ditolak `bukaKunci`. Urutannya sama
 * dengan penulisnya, supaya alasan yang tertulis = alasan yang akan ditolak.
 */
const siklus = (p: Partial<Parameters<typeof alasanTolakBukaKunci>[0]> = {}) => ({
  terkunci: true,
  noNota: null,
  noFakturPajak: null,
  komisi: [{ dibayarPada: null }],
  pembayaranToko: [] as { dibatalkanPada: string | null }[],
  ...p,
});

describe("alasanTolakBukaKunci", () => {
  it("boleh dibuka selama belum ada yang bergantung pada angkanya", () => {
    expect(alasanTolakBukaKunci(siklus())).toBeNull();
  });

  it("menyebut alasan pertama menurut urutan penulis", () => {
    expect(
      alasanTolakBukaKunci(
        siklus({
          noNota: "NP-202608-0058",
          noFakturPajak: "010.000-26.00000871",
          komisi: [{ dibayarPada: "2026-08-26T00:00:00.000Z" }],
        }),
      ),
    ).toBe("ADA_GAJI_SUDAH_DIBAYAR");
    expect(alasanTolakBukaKunci(siklus({ noNota: "NP-1", noFakturPajak: "010" }))).toBe("ADA_NOTA");
    expect(alasanTolakBukaKunci(siklus({ noFakturPajak: "010" }))).toBe("ADA_FAKTUR_PAJAK");
  });

  it("pembayaran toko yang dibatalkan tidak menahan", () => {
    expect(alasanTolakBukaKunci(siklus({ pembayaranToko: [{ dibatalkanPada: "2026-09-01T00:00:00.000Z" }] }))).toBeNull();
    expect(alasanTolakBukaKunci(siklus({ pembayaranToko: [{ dibatalkanPada: null }] }))).toBe("ADA_PEMBAYARAN_TOKO");
  });

  it("siklus yang belum dikunci tidak punya apa pun untuk dibuka", () => {
    expect(alasanTolakBukaKunci(siklus({ terkunci: false }))).toBe("BELUM_DIKUNCI");
  });
});
