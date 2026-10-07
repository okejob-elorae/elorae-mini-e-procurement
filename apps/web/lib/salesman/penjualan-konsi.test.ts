import { describe, expect, it } from "vitest";
import {
  DASAR_OMZET_KONSI,
  kunciBulanSiklus,
  laporanSiklusDipakai,
  nilaiLaku,
  pcsDariLaku,
  pemegangPada,
  pemilikOmzetKonsi,
  pengirimPada,
  tanggalLaporanSiklus,
} from "./penjualan-konsi";

describe("omzet konsinyasi salesman — aturan murni", () => {
  it("dasarnya barang laku di toko, bukan transfer yang disetujui", () => {
    expect(DASAR_OMZET_KONSI).toBe("LAKU_DI_TOKO");
  });

  it("pemilik omzet: pemegang toko dulu, pengirim konsi terakhir sebagai cadangan", () => {
    expect(pemilikOmzetKonsi({ pemegangId: "budi", pengirimTerakhirId: "ani" })).toBe("budi");
    expect(pemilikOmzetKonsi({ pemegangId: null, pengirimTerakhirId: "ani" })).toBe("ani");
    expect(pemilikOmzetKonsi({ pemegangId: "", pengirimTerakhirId: "" })).toBeNull();
    expect(pemilikOmzetKonsi({ pemegangId: null, pengirimTerakhirId: null })).toBeNull();
  });

  it("laporan resmi hanya untuk bulan sebelum buku toko dimulai (WIB)", () => {
    // Buku dimulai 1 Agustus 00.30 WIB = 31 Juli UTC — bulannya Agustus.
    const buku = new Date("2026-07-31T17:30:00Z");
    expect(laporanSiklusDipakai("2026-07", buku)).toBe(true);
    expect(laporanSiklusDipakai("2026-08", buku)).toBe(false);
    expect(laporanSiklusDipakai("2026-09", buku)).toBe(false);
    expect(laporanSiklusDipakai("2026-09", null)).toBe(true);
    expect(kunciBulanSiklus(2026, 7)).toBe("2026-07");
  });

  it("tanggal laporan siklus = akhir bulan WIB, tidak melewati sekarang", () => {
    const sekarang = new Date("2026-10-07T03:00:00Z");
    expect(tanggalLaporanSiklus(2026, 8, sekarang).toISOString()).toBe("2026-08-31T16:59:59.999Z");
    expect(tanggalLaporanSiklus(2026, 12, new Date("2027-02-01T00:00:00Z")).toISOString()).toBe("2026-12-31T16:59:59.999Z");
    // Siklus bulan berjalan yang dikunci lebih awal: jatuh hari ini, bukan di masa depan.
    expect(tanggalLaporanSiklus(2026, 10, sekarang)).toEqual(sekarang);
  });

  it("nilai laku dihitung dalam sen bulat, retur pembeli negatif", () => {
    expect(nilaiLaku(4, 1_030_925)).toBe(41_237);
    expect(nilaiLaku(-1, 7_500_000)).toBe(-75_000);
    expect(nilaiLaku(3, 0)).toBe(0);
  });

  it("pcs untuk HP tidak membawa nilai rupiah", () => {
    const t = new Date("2026-08-10T03:00:00Z");
    const pcs = pcsDariLaku([{ tanggal: t, storeId: "s", itemId: "i", variantSku: "", pcs: 4, nilai: 41_237 }]);
    expect(pcs).toEqual([{ tanggal: t, pcs: 4 }]);
    expect(JSON.stringify(pcs)).not.toContain("41237");
  });

  it("pemegang pada saat laku: 'sebelum' dari pergantian pertama SESUDAHNYA, kalau tidak ada pemegang sekarang", () => {
    const t = (iso: string) => new Date(iso);
    const riwayat = [
      { pada: t("2026-08-15T03:00:00Z"), sebelum: "ani" },
      { pada: t("2026-09-10T03:00:00Z"), sebelum: null },
    ];
    expect(pemegangPada(riwayat, "budi", t("2026-08-01T03:00:00Z"))).toBe("ani");
    expect(pemegangPada(riwayat, "budi", t("2026-09-01T03:00:00Z"))).toBeNull();
    expect(pemegangPada(riwayat, "budi", t("2026-09-20T03:00:00Z"))).toBe("budi");
    expect(pemegangPada([], null, t("2026-09-20T03:00:00Z"))).toBeNull();
  });

  it("pengirim pada saat laku: konsi disetujui terakhir sampai saat itu, kalau belum ada yang pertama", () => {
    const t = (iso: string) => new Date(iso);
    const kirim = [
      { pada: t("2026-08-10T03:00:00Z"), salesmanId: "ani" },
      { pada: t("2026-09-05T03:00:00Z"), salesmanId: "budi" },
    ];
    expect(pengirimPada(kirim, t("2026-08-01T03:00:00Z"))).toBe("ani");
    expect(pengirimPada(kirim, t("2026-08-20T03:00:00Z"))).toBe("ani");
    expect(pengirimPada(kirim, t("2026-09-05T03:00:00Z"))).toBe("budi");
    expect(pengirimPada([], t("2026-09-05T03:00:00Z"))).toBeNull();
  });
});
