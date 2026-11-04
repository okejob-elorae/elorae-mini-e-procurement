import { describe, expect, it } from "vitest";
import { ringkasTermin } from "./termin-queries";

/*
 * Kartu Pembayaran KOL (audit ulang 2026-10-08): "fee" = jumlah yang
 * disepakati (basis termin), PPh dipisah antara yang dipotong dari KOL dan
 * yang ditanggung Elorae, dan beban yang sudah diakui dibaca dari termin
 * kolaborasi yang sudah tayang — bukan 0 dari kolom lain.
 */
describe("ringkasTermin", () => {
  const dipotong = { jumlah: 10_000_000, bruto: 10_000_000, pph: 300_000, neto: 9_700_000, grossUp: false, status: "BELUM", tahap: "DEAL" } as const;
  const dp = { jumlah: 4_875_000, bruto: 5_025_773, pph: 150_773, neto: 4_875_000, grossUp: true, status: "DIBAYAR", tahap: "DEAL" } as const;
  const pelunasan = { ...dp, status: "BELUM" } as const;

  it("memisahkan fee yang disepakati, bruto, dan dua jenis PPh", () => {
    const r = ringkasTermin([dipotong, dp, pelunasan]);
    expect(r.fee).toBe(19_750_000);
    expect(r.bruto).toBe(20_051_546);
    expect(r.pph).toBe(601_546);
    expect(r.pphDipotong).toBe(300_000);
    expect(r.pphDitanggung).toBe(301_546);
    expect(r.neto).toBe(19_450_000);
    expect(r.belumJumlah).toBe(2);
    expect(r.belumNeto).toBe(14_575_000);
    // Belum ada yang tayang: uang muka DP bukan beban.
    expect(r.bebanDiakui).toBe(0);
  });

  it("beban diakui = bruto termin hidup dari kolaborasi yang sudah tayang", () => {
    const r = ringkasTermin([
      { ...dp, tahap: "TAYANG" },
      { ...pelunasan, tahap: "TAYANG" },
      { ...dipotong, tahap: "SELESAI", status: "BATAL" },
    ]);
    expect(r.bebanDiakui).toBe(10_051_546);
  });

  it("kosong = nol", () => {
    expect(ringkasTermin([])).toMatchObject({ jumlah: 0, fee: 0, bruto: 0, bebanDiakui: 0 });
  });
});
