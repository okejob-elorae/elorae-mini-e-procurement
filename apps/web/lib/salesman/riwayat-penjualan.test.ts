import { describe, expect, it } from "vitest";
import type { BarisJual } from "./dasbor";
import {
  barangTeratas,
  bulanAwalBacaan,
  capaianTarget,
  daftarBulan,
  geserBulan,
  jumlahSatuBulan,
  persenPerubahan,
  pilihBulan,
  ringkasBulan,
  susunSeriBulanan,
  tokoTeratas,
} from "./riwayat-penjualan";

const wib = (s: string) => new Date(`${s}+07:00`);
const jual = (tanggal: string, jenis: BarisJual["jenis"], nilai: number): BarisJual => ({ tanggal: wib(tanggal), jenis, nilai });

describe("daftar bulan", () => {
  it("12 bulan WIB berakhir di bulan ini, dari yang terlama", () => {
    // 1 Oktober 00.30 WIB masih 30 September menurut UTC.
    const d = daftarBulan(wib("2026-10-01T00:30:00"));
    expect(d).toHaveLength(12);
    expect(d[0]).toBe("2025-11");
    expect(d[11]).toBe("2026-10");
  });

  it("geser bulan melewati batas tahun", () => {
    expect(geserBulan("2026-01", -1)).toBe("2025-12");
    expect(geserBulan("2026-03", -12)).toBe("2025-03");
    expect(geserBulan("2025-12", 1)).toBe("2026-01");
  });

  it("pilih bulan: hanya bulan di daftar; selain itu bulan ini", () => {
    const d = daftarBulan(wib("2026-10-15T10:00:00"));
    expect(pilihBulan("2026-03", d)).toBe("2026-03");
    expect(pilihBulan("2024-03", d)).toBe("2026-10");
    expect(pilihBulan("2026-13", d)).toBe("2026-10");
    expect(pilihBulan(undefined, d)).toBe("2026-10");
    expect(pilihBulan(["2026-03"], d)).toBe("2026-10");
  });

  it("bacaan dimulai setahun sebelum bulan terlama di grafik", () => {
    expect(bulanAwalBacaan(daftarBulan(wib("2026-10-15T10:00:00")))).toBe("2024-11");
  });
});

describe("jumlah per bulan", () => {
  const baris = [
    jual("2026-09-01T00:30:00", "van", 1_000), // 00.30 WIB tgl 1 = September
    jual("2026-08-31T23:30:00", "putus", 2_000), // 23.30 WIB = Agustus
    jual("2026-09-10T10:00:00", "putus", 5_000),
    jual("2026-09-12T10:00:00", "konsi", 3_000),
    jual("2026-09-25T10:00:00", "putus", 7_000), // sesudah "hari ini"
  ];
  const hariIni = wib("2026-09-20T12:00:00");

  it("kalender WIB; baris sesudah hari ini tidak dihitung", () => {
    expect(jumlahSatuBulan(baris, "2026-09", hariIni)).toEqual({ putus: 5_000, konsi: 3_000, van: 1_000, total: 9_000 });
    expect(jumlahSatuBulan(baris, "2026-08", hariIni).total).toBe(2_000);
  });

  it("sampaiTanggal membatasi ke tanggal 1..n", () => {
    expect(jumlahSatuBulan(baris, "2026-09", hariIni, 10).total).toBe(6_000);
  });

  it("seri bulanan: bulan kosong tetap ada, bernilai nol", () => {
    const seri = susunSeriBulanan(baris, ["2026-07", "2026-08", "2026-09"], hariIni);
    expect(seri.map((s) => s.total)).toEqual([0, 2_000, 9_000]);
    expect(seri[2]).toMatchObject({ bulan: "2026-09", putus: 5_000, konsi: 3_000, van: 1_000 });
  });
});

describe("ringkasan bulan", () => {
  const baris = [
    jual("2026-08-05T10:00:00", "putus", 10_000),
    jual("2026-08-25T10:00:00", "putus", 30_000),
    jual("2025-08-03T10:00:00", "van", 5_000),
    jual("2025-08-28T10:00:00", "van", 5_000),
    jual("2026-07-10T10:00:00", "putus", 20_000),
    jual("2026-09-04T10:00:00", "putus", 12_000),
  ];

  it("bulan yang sudah lewat dibandingkan penuh: bulan lalu dan bulan yang sama tahun lalu", () => {
    const r = ringkasBulan(baris, "2026-08", wib("2026-09-04T12:00:00"));
    expect(r.sampaiTanggal).toBeNull();
    expect(r.jumlah.total).toBe(40_000);
    expect(r.sebulanLalu).toEqual({ bulan: "2026-07", total: 20_000, persen: 100 });
    expect(r.setahunLalu).toEqual({ bulan: "2025-08", total: 10_000, persen: 300 });
  });

  it("bulan berjalan dibandingkan pada tanggal yang sama", () => {
    const r = ringkasBulan(baris, "2026-09", wib("2026-09-04T12:00:00"));
    expect(r.sampaiTanggal).toBe(4);
    expect(r.jumlah.total).toBe(12_000);
    // Agustus s.d. tanggal 4: belum ada; 5 Agustus tidak ikut.
    expect(r.sebulanLalu).toEqual({ bulan: "2026-08", total: 0, persen: null });
  });

  it("hari terakhir bulan berjalan = bulan penuh", () => {
    const r = ringkasBulan(baris, "2026-08", wib("2026-08-31T20:00:00"));
    expect(r.sampaiTanggal).toBeNull();
    expect(r.setahunLalu.total).toBe(10_000);
  });

  it("persen perubahan null tanpa pembanding", () => {
    expect(persenPerubahan(5, 0)).toBeNull();
    expect(persenPerubahan(50, 100)).toBe(-50);
  });
});

describe("target", () => {
  it("null tanpa target; kurang tidak pernah negatif", () => {
    expect(capaianTarget(null, 5)).toBeNull();
    expect(capaianTarget(0, 5)).toBeNull();
    expect(capaianTarget(1_000, 250)).toEqual({ target: 1_000, capai: 250, persen: 25, kurang: 750, tercapai: false });
    expect(capaianTarget(1_000, 1_200)).toMatchObject({ kurang: 0, tercapai: true, persen: 120 });
  });
});

describe("toko teratas", () => {
  it("urut pcs; konsi hanya menyumbang pcs; pembeli tanpa toko dilewati", () => {
    const r = tokoTeratas([
      { storeId: "A", jenis: "putus", nilai: 50_000, pcs: 5 },
      { storeId: "A", jenis: "van", nilai: 10_000.5, pcs: 1 },
      { storeId: "B", jenis: "konsi", nilai: 99_000, pcs: 9 },
      { storeId: null, jenis: "van", nilai: 70_000, pcs: 20 },
      { storeId: "C", jenis: "putus", nilai: 1_000, pcs: 0 },
    ]);
    expect(r).toEqual([
      { storeId: "B", pcs: 9, pcsKonsi: 9, nilaiTanpaKonsi: 0 },
      { storeId: "A", pcs: 6, pcsKonsi: 0, nilaiTanpaKonsi: 60_000.5 },
      { storeId: "C", pcs: 0, pcsKonsi: 0, nilaiTanpaKonsi: 1_000 },
    ]);
    // Nilai konsi tidak pernah muncul di hasil.
    expect(JSON.stringify(r)).not.toContain("99000");
  });

  it("dibatasi", () => {
    const baris = Array.from({ length: 8 }, (_, i) => ({ storeId: `S${i}`, jenis: "putus" as const, nilai: 1, pcs: i + 1 }));
    expect(tokoTeratas(baris).map((t) => t.storeId)).toEqual(["S7", "S6", "S5", "S4", "S3"]);
  });
});

describe("barang teratas", () => {
  it("rupiah tanpa konsinyasi, pcs semua saluran", () => {
    const r = barangTeratas(
      { i1: { nilai: 52_999.99, pcs: 7 }, i2: { nilai: 40_000, pcs: 4 }, i3: { nilai: 100, pcs: 0 } },
      { i1: { nilai: 40_000, pcs: 4 }, i2: { nilai: 40_000, pcs: 4 } },
    );
    expect(r).toEqual([
      { itemId: "i1", pcs: 7, pcsKonsi: 4, nilaiTanpaKonsi: 12_999.99 },
      { itemId: "i2", pcs: 4, pcsKonsi: 4, nilaiTanpaKonsi: 0 },
    ]);
  });
});
