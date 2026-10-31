import { describe, expect, it, vi } from "vitest";

vi.mock("@elorae/db", () => ({ prisma: {} }));
vi.mock("@/lib/receivables/queries", () => ({ daftarPiutang: vi.fn() }));

const { ringkasKeadaanTagihan } = await import("./tagihan-toko");

const baris = (outstanding: number, keadaan: "lunas" | "klaim" | "tertahan" | "lewat" | "tt" | "belum", hariTerlambat?: number) => ({
  outstanding,
  keadaan,
  alasan: hariTerlambat === undefined ? {} : { hariTerlambat },
});

describe("ringkasKeadaanTagihan", () => {
  it("menjumlahkan sisa dan faktur terbuka, mengabaikan yang lunas", () => {
    expect(ringkasKeadaanTagihan([baris(1_000, "belum"), baris(2_000, "tt"), baris(0, "lunas")], 0)).toEqual({
      sisa: 3_000,
      fakturTerbuka: 2,
      lewatJanji: 0,
      fakturLewatJanji: 0,
    });
  });

  it("hanya keadaan 'lewat' yang dihitung lewat janji — klaim menunggu tidak", () => {
    expect(ringkasKeadaanTagihan([baris(5_000, "lewat", 3), baris(4_000, "klaim", 20)], 0)).toMatchObject({
      lewatJanji: 5_000,
      fakturLewatJanji: 1,
    });
  });

  it("toleransi hari: terlambat 3 hari dengan toleransi 3 belum dihitung", () => {
    expect(ringkasKeadaanTagihan([baris(5_000, "lewat", 3)], 3).lewatJanji).toBe(0);
    expect(ringkasKeadaanTagihan([baris(5_000, "lewat", 4)], 3).lewatJanji).toBe(5_000);
  });
});
