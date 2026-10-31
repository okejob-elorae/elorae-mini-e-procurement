import { describe, expect, it } from "vitest";
import { DURASI_ANGKA_MS, angkaPada, awalGerak, kemajuan, pelanKeluar, tampilAwal } from "./angka";

describe("pelanKeluar", () => {
  it("mulai di 0, berakhir di 1, dan cepat di awal", () => {
    expect(pelanKeluar(0)).toBe(0);
    expect(pelanKeluar(1)).toBe(1);
    // Kubik keluar: separuh waktu sudah 87,5 % jalan.
    expect(pelanKeluar(0.5)).toBeCloseTo(0.875, 10);
  });

  it("naik terus tanpa melewati 1", () => {
    let sebelum = -1;
    for (let i = 0; i <= 100; i++) {
      const v = pelanKeluar(i / 100);
      expect(v).toBeGreaterThanOrEqual(sebelum);
      expect(v).toBeLessThanOrEqual(1);
      sebelum = v;
    }
  });

  it("menjepit masukan di luar 0–1", () => {
    expect(pelanKeluar(-0.5)).toBe(0);
    expect(pelanKeluar(2)).toBe(1);
    expect(pelanKeluar(Number.NaN)).toBe(1);
  });
});

describe("kemajuan", () => {
  it("0 sebelum mulai, 1 sesudah durasi, separuh di tengah", () => {
    expect(kemajuan(1000, 900, 600)).toBe(0);
    expect(kemajuan(1000, 1000, 600)).toBe(0);
    expect(kemajuan(1000, 1300, 600)).toBeCloseTo(0.5, 10);
    expect(kemajuan(1000, 1600, 600)).toBe(1);
    expect(kemajuan(1000, 5000, 600)).toBe(1);
  });

  it("durasi nol atau negatif langsung selesai", () => {
    expect(kemajuan(1000, 1000, 0)).toBe(1);
    expect(kemajuan(1000, 1000, -5)).toBe(1);
  });
});

describe("angkaPada", () => {
  it("target bulat hanya melewati bilangan bulat — '3 PO' tidak sempat jadi '2,999'", () => {
    for (let k = 0; k <= 1; k += 0.05) {
      expect(Number.isInteger(angkaPada(0, 3000, k))).toBe(true);
    }
  });

  it("tepat di nilai akhir saat selesai, juga untuk pecahan", () => {
    expect(angkaPada(0, 1234.5, 1)).toBe(1234.5);
    expect(angkaPada(0, 1234.5, 0.5)).not.toBe(1234.5);
    expect(Number.isInteger(angkaPada(0, 1234.5, 0.5))).toBe(false);
  });

  it("bisa turun (nilai diperbarui lebih kecil)", () => {
    expect(angkaPada(10, 3, 1)).toBe(3);
    const tengah = angkaPada(10, 3, 0.5);
    expect(tengah).toBeLessThan(10);
    expect(tengah).toBeGreaterThan(3);
  });

  it("awal gerak sama dengan nilai asal", () => {
    expect(angkaPada(250, 900, 0)).toBe(250);
    expect(angkaPada(250, 900, -1)).toBe(250);
  });
});

describe("DURASI_ANGKA_MS", () => {
  it("sekitar 600 ms: cukup terlihat, tidak membuat menunggu", () => {
    expect(DURASI_ANGKA_MS).toBeGreaterThanOrEqual(500);
    expect(DURASI_ANGKA_MS).toBeLessThanOrEqual(700);
  });
});

describe("tampilAwal — angka yang dilukis pertama kali", () => {
  it("server dan hidrasi: angka akhir, sama dengan HTML server", () => {
    expect(tampilAwal({ sedangHidrasi: true, kurangiGerak: false, nilai: 42 })).toBe(42);
  });

  it("dipasang di klien (dibuka lewat menu): nol — angka akhir tidak sempat terlukis sekejap lalu turun ke nol", () => {
    expect(tampilAwal({ sedangHidrasi: false, kurangiGerak: false, nilai: 42 })).toBe(0);
  });

  it("kurangi gerakan: langsung angka akhir", () => {
    expect(tampilAwal({ sedangHidrasi: false, kurangiGerak: true, nilai: 42 })).toBe(42);
  });
});

describe("awalGerak — kapan dan dari mana angka bergerak", () => {
  const dasar = { kurangiGerak: false, sudahMulai: false, lahirSaatHidrasi: false, adaTirai: false, tampil: 0, nilai: 42 };

  it("dipasang di klien: naik dari nol", () => {
    expect(awalGerak(dasar)).toEqual({ jenis: "jalan", dari: 0 });
  });

  it("dimuat ulang penuh (hidrasi, tanpa tirai): diam di angka akhir", () => {
    expect(awalGerak({ ...dasar, lahirSaatHidrasi: true, tampil: 42 })).toEqual({ jenis: "diam" });
  });

  it("datang dari halaman masuk (hidrasi di bawah tirai): menunggu tirai terbuka", () => {
    expect(awalGerak({ ...dasar, lahirSaatHidrasi: true, adaTirai: true, tampil: 42 })).toEqual({ jenis: "tunggu-tirai" });
  });

  it("kurangi gerakan: tidak pernah bergerak", () => {
    expect(awalGerak({ ...dasar, kurangiGerak: true })).toEqual({ jenis: "diam" });
    expect(awalGerak({ ...dasar, kurangiGerak: true, sudahMulai: true, tampil: 10 })).toEqual({ jenis: "diam" });
  });

  it("nilai diperbarui: bergerak dari angka yang SEDANG terlihat", () => {
    expect(awalGerak({ ...dasar, sudahMulai: true, tampil: 10, nilai: 20 })).toEqual({ jenis: "jalan", dari: 10 });
    // Diperbarui lagi di tengah gerak 10 → 20 (sedang di 15): lanjut dari 15, tidak melompat balik ke 10.
    expect(awalGerak({ ...dasar, sudahMulai: true, tampil: 15, nilai: 30 })).toEqual({ jenis: "jalan", dari: 15 });
  });

  it("nilai kembali ke nilai lama di tengah gerak: tetap bergerak ke sana, tidak macet di angka antara", () => {
    // 10 → 20 terputus di 15, lalu nilainya kembali 10. Tanpa ini layar tertinggal di "15".
    expect(awalGerak({ ...dasar, sudahMulai: true, tampil: 15, nilai: 10 })).toEqual({ jenis: "jalan", dari: 15 });
  });

  it("nilai sama dengan yang terlihat: diam", () => {
    expect(awalGerak({ ...dasar, sudahMulai: true, tampil: 42, nilai: 42 })).toEqual({ jenis: "diam" });
  });
});
