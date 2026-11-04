import { describe, expect, it } from "vitest";
import {
  bagianPemasokTersembunyi,
  formatAngka,
  hitungPemasokTersembunyi,
  lepasMembuangPengaturan,
  ringkasLamaRantai,
  totalTersembunyi,
} from "./papan-aturan";

describe("format angka lead time", () => {
  it("memakai pemisah Indonesia: ribuan titik, desimal koma", () => {
    expect(formatAngka(10000, "id")).toBe("10.000");
    expect(formatAngka(1.4285, "id", 1)).toBe("1,4");
    expect(formatAngka(2, "id", 1)).toBe("2");
  });

  it("locale en memakai pemisah Inggris", () => {
    expect(formatAngka(10000, "en")).toBe("10,000");
    expect(formatAngka(1.4285, "en", 1)).toBe("1.4");
  });

  it("ringkasan rantai 10 hari = ~1,4 minggu, ~0,3 bulan", () => {
    expect(ringkasLamaRantai(10, "id")).toEqual({ hari: "10", minggu: "1,4", bulan: "0,3" });
    expect(ringkasLamaRantai(30, "id")).toEqual({ hari: "30", minggu: "4,3", bulan: "1" });
  });
});

describe("pemasok yang tidak tampil di papan", () => {
  it("yang aktif dan disetujui tidak dihitung; nonaktif lebih dulu apa pun statusnya", () => {
    const r = hitungPemasokTersembunyi([
      { status: "ACTIVE", isActive: true, jumlah: 11 },
      { status: "PENDING_APPROVAL", isActive: true, jumlah: 2 },
      { status: "ACTIVE", isActive: false, jumlah: 1 },
      { status: "PENDING_APPROVAL", isActive: false, jumlah: 1 },
      { status: "REJECTED", isActive: true, jumlah: 3 },
    ]);
    expect(r).toEqual({ menunggu: 2, nonaktif: 2, ditolak: 3 });
    expect(totalTersembunyi(r)).toBe(7);
  });

  it("bagian catatan hanya yang bukan nol, berurutan, dengan alamat daftar pemasok tersaring", () => {
    expect(bagianPemasokTersembunyi({ menunggu: 2, nonaktif: 1, ditolak: 0 })).toEqual([
      { jenis: "menunggu", jumlah: 2, href: "/backoffice/suppliers?status=PENDING_APPROVAL" },
      { jenis: "nonaktif", jumlah: 1, href: "/backoffice/suppliers?aktif=nonaktif" },
    ]);
    expect(bagianPemasokTersembunyi({ menunggu: 0, nonaktif: 0, ditolak: 4 })).toEqual([
      { jenis: "ditolak", jumlah: 4, href: "/backoffice/suppliers?status=REJECTED" },
    ]);
  });

  it("semua tampil → tanpa catatan", () => {
    const r = hitungPemasokTersembunyi([{ status: "ACTIVE", isActive: true, jumlah: 5 }]);
    expect(totalTersembunyi(r)).toBe(0);
    expect(bagianPemasokTersembunyi(r)).toEqual([]);
    expect(hitungPemasokTersembunyi([])).toEqual({ menunggu: 0, nonaktif: 0, ditolak: 0 });
  });
});

describe("lepasMembuangPengaturan", () => {
  it("hanya langkah dengan lama khusus atau catatan yang kehilangan pengaturannya", () => {
    expect(lepasMembuangPengaturan({ overrideDays: null, overrideRateQty: null, notes: null })).toBe(false);
    expect(lepasMembuangPengaturan({ overrideDays: null, overrideRateQty: null, notes: "  " })).toBe(false);
    expect(lepasMembuangPengaturan({ overrideDays: 5, overrideRateQty: null, notes: null })).toBe(true);
    expect(lepasMembuangPengaturan({ overrideDays: null, overrideRateQty: 500, notes: null })).toBe(true);
    expect(lepasMembuangPengaturan({ overrideDays: null, overrideRateQty: null, notes: "kain tebal" })).toBe(true);
  });
});
