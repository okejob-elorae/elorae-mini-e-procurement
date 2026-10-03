import { describe, expect, it, vi } from "vitest";

/*
 * `kabar-pengguna` menarik Prisma dan Firebase Admin; tes ini hanya butuh
 * daftar `JENIS_KABAR`-nya, jadi keduanya dipalsukan agar tidak ada yang
 * tersambung ke mana pun.
 */
vi.mock("@elorae/db", () => ({ prisma: {} }));
vi.mock("./recipients", () => ({ sendNotificationToUsers: vi.fn() }));

import { JENIS_KABAR } from "./kabar-pengguna";
import { tautanKabar } from "./tautan-kabar";

describe("tautanKabar", () => {
  it("setiap jenis kabar punya tautan PWA", () => {
    for (const jenis of Object.values(JENIS_KABAR)) {
      const href = tautanKabar(jenis, { orderId: "o1", storeId: "s1" });
      expect(href, jenis).not.toBeNull();
      expect(href?.startsWith("/pwa/"), jenis).toBe(true);
    }
  });

  it("kabar pesanan membawa ke halaman pesanannya", () => {
    expect(tautanKabar("PESANAN_DISETUJUI", { orderId: "abc" })).toBe("/pwa/orders/abc");
    expect(tautanKabar("PESANAN_DITOLAK", { orderId: "abc" })).toBe("/pwa/orders/abc");
    expect(tautanKabar("PESANAN_DIKIRIM", { orderId: "abc", deliveryId: "d1" })).toBe("/pwa/orders/abc");
    expect(tautanKabar("PESANAN_DITUTUP", { orderId: "abc" })).toBe("/pwa/orders/abc");
  });

  it("jadwal kunjungan membuka tanggalnya; pengumuman membuka pengumumannya", () => {
    expect(tautanKabar("JADWAL_KUNJUNGAN", { tanggal: "2026-10-05" })).toBe("/pwa/jadwal?tanggal=2026-10-05");
    expect(tautanKabar("JADWAL_KUNJUNGAN", { tanggal: "besok" })).toBe("/pwa/jadwal");
    expect(tautanKabar("PENGUMUMAN", { announcementId: "a1" })).toBe("/pwa/pengumuman/a1");
    expect(tautanKabar("PENGUMUMAN", {})).toBe("/pwa/pengumuman");
  });

  it("ringkasan harian membuka hari yang diringkas, bukan hari ini", () => {
    expect(tautanKabar("RINGKASAN_HARIAN", { tanggal: "2026-09-30" })).toBe("/pwa/hari-ini?tanggal=2026-09-30");
    expect(tautanKabar("RINGKASAN_HARIAN", {})).toBe("/pwa/hari-ini");
    expect(tautanKabar("RINGKASAN_HARIAN", { tanggal: "kemarin" })).toBe("/pwa/hari-ini");
    expect(tautanKabar("RINGKASAN_HARIAN", { tanggal: "2026-09-30&x=1" })).toBe("/pwa/hari-ini");
  });

  it("kabar pesanan tanpa id membawa ke daftar pesanan, bukan ke /pwa/orders/undefined", () => {
    expect(tautanKabar("PESANAN_DIKIRIM", {})).toBe("/pwa/orders");
    expect(tautanKabar("PESANAN_DIKIRIM", { orderId: "" })).toBe("/pwa/orders");
    expect(tautanKabar("PESANAN_DIKIRIM", { orderId: 12 })).toBe("/pwa/orders");
    expect(tautanKabar("PESANAN_DIKIRIM", null)).toBe("/pwa/orders");
  });

  it("pelunasan, retur, dan beban membawa ke daftarnya masing-masing", () => {
    expect(tautanKabar("PELUNASAN_TERVERIFIKASI", { claimId: "c1" })).toBe("/pwa/bkm");
    expect(tautanKabar("PELUNASAN_DITOLAK", { claimId: "c1" })).toBe("/pwa/bkm");
    expect(tautanKabar("PELUNASAN_DIBATALKAN", { claimId: "c1" })).toBe("/pwa/bkm");
    expect(tautanKabar("RETUR_DIHITUNG", { returnId: "r1" })).toBe("/pwa/retur");
    expect(tautanKabar("RETUR_DIBEBANKAN", { chargeId: "b1" })).toBe("/pwa/beban");
  });

  it("perubahan data toko membawa ke halaman tokonya", () => {
    expect(tautanKabar("PERUBAHAN_TOKO_DISETUJUI", { storeId: "s9" })).toBe("/pwa/stores/s9");
    expect(tautanKabar("PERUBAHAN_TOKO_DITOLAK", { storeId: "s9" })).toBe("/pwa/stores/s9");
    expect(tautanKabar("PERUBAHAN_TOKO_DITOLAK", {})).toBe("/pwa/stores");
  });

  it("id dari data di-encode, jadi tidak bisa membelokkan jalur", () => {
    expect(tautanKabar("PESANAN_DIKIRIM", { orderId: "../../backoffice" })).toBe("/pwa/orders/..%2F..%2Fbackoffice");
  });

  it("jenis yang tidak dikenal, termasuk nama bawaan objek, tidak punya tautan", () => {
    expect(tautanKabar("WO_COMPLETED", { woId: "w1" })).toBeNull();
    expect(tautanKabar("", {})).toBeNull();
    expect(tautanKabar("toString", {})).toBeNull();
    expect(tautanKabar("__proto__", {})).toBeNull();
  });

  it("data berbentuk larik atau teks diperlakukan sebagai kosong", () => {
    expect(tautanKabar("PESANAN_DIKIRIM", ["abc"])).toBe("/pwa/orders");
    expect(tautanKabar("PERUBAHAN_TOKO_DISETUJUI", "s1")).toBe("/pwa/stores");
  });
});
