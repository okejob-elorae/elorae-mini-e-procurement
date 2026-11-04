import { describe, expect, it } from "vitest";
import { pesanRekomendasiWa, type BahanPesanRekomendasi } from "./pesan-rekomendasi-wa";

const bahan = (x: Partial<BahanPesanRekomendasi> = {}): BahanPesanRekomendasi => ({
  toko: "Toko Sinar",
  jenis: "KONSI",
  tanggal: new Date("2026-10-01T09:00:00+07:00"),
  baris: [
    { nama: "Kaos — Hitam · M", qty: 6, alasan: "LAKU_DI_SINI" },
    { nama: "Kemeja", qty: 3, alasan: "LAKU_DI_TOKO_LAIN" },
    { nama: "Topi", qty: 2, alasan: "MANUAL" },
  ],
  catatan: "Stok M habis minggu ini",
  salesman: "Budi",
  ...x,
});

describe("pesanRekomendasiWa", () => {
  it("konsinyasi: barang, ukuran, jumlah, catatan — tanpa harga, tanpa total rupiah, tanpa Rp", () => {
    const teks = pesanRekomendasiWa(bahan());
    expect(teks).toContain("Halo Toko Sinar,");
    expect(teks).toContain("1. Kaos — Hitam · M × 6 (laku di toko Anda)");
    expect(teks).toContain("2. Kemeja × 3 (laris di toko lain)");
    // Alasan manual tidak diberi keterangan.
    expect(teks).toContain("3. Topi × 2\n");
    expect(teks).toContain("Jumlah: 11 pcs");
    expect(teks).toContain("Catatan: Stok M habis minggu ini");
    expect(teks).toContain("1 Okt 2026");
    expect(teks.trimEnd().endsWith("Budi")).toBe(true);
    expect(teks).not.toMatch(/rp/i);
    expect(teks).not.toMatch(/harga/i);
    expect(teks).not.toMatch(/total/i);
  });

  it("putus: tetap tanpa angka harga, hanya pemberitahuan bahwa harga mengikuti saat pesanan dibuat", () => {
    const teks = pesanRekomendasiWa(bahan({ jenis: "PUTUS" }));
    expect(teks).toContain("Harga mengikuti harga yang berlaku saat pesanan dibuat.");
    expect(teks).not.toMatch(/rp/i);
    expect(teks).not.toMatch(/\d{1,3}(\.\d{3})+/);
  });

  it("tanpa catatan dan tanpa nama salesman", () => {
    const teks = pesanRekomendasiWa(bahan({ catatan: "  ", salesman: null }));
    expect(teks).not.toContain("Catatan:");
    expect(teks.trimEnd().endsWith("Terima kasih")).toBe(true);
  });
});
