/**
 * Teks rekomendasi barang untuk manager toko, dikirim salesman lewat WhatsApp —
 * bagian murni. Tautan `wa.me` dirakit pemanggil (`tautanWhatsApp`), dan
 * salesman sendiri yang menekan kirim.
 *
 * SELALU Bahasa Indonesia, tidak lewat next-intl: pembacanya toko.
 *
 * TIDAK ADA HARGA, untuk jenis toko apa pun. Bentuk bahannya bahkan tidak punya
 * kolom harga. Untuk konsinyasi itu aturan tetap aplikasi salesman (harga dan
 * total konsinyasi tidak pernah sampai ke HP). Untuk toko putus itu pilihan
 * yang paling aman: rekomendasi belum pesanan — harga final dihitung server
 * saat pesanan dibuat (promo ikut, kantor menyetujui), jadi angka di pesan ini
 * akan menjadi janji harga yang belum tentu sama. Toko putus hanya diberi tahu
 * bahwa harga mengikuti saat pesanan dibuat; konsinyasi tidak menyebut harga
 * sama sekali. Teksnya diuji: tidak ada "Rp".
 */

import { formatDisplayDate } from "@/lib/date-only";
import type { AlasanRekomendasi } from "./rekomendasi-aturan";

export type BahanPesanRekomendasi = {
  toko: string;
  jenis: "PUTUS" | "KONSI";
  tanggal: Date | string;
  /** `productName` baris — sudah memuat label ukurannya ("Kaos — Hitam · M"). */
  baris: readonly { nama: string; qty: number; alasan: string | null }[];
  catatan: string | null;
  salesman: string | null;
};

const ALASAN_TEKS: Partial<Record<AlasanRekomendasi, string>> = {
  LAKU_DI_SINI: "laku di toko Anda",
  LAKU_DI_TOKO_LAIN: "laris di toko lain",
  BARANG_BARU: "barang baru",
  SERING_DIKIRIM: "sering dikirim",
};

export function pesanRekomendasiWa(b: BahanPesanRekomendasi): string {
  const teks: string[] = [`Halo ${b.toko},`, "", `Berikut rekomendasi barang untuk toko Anda (${formatDisplayDate(b.tanggal, "id")}):`, ""];
  b.baris.forEach((l, i) => {
    const alasan = l.alasan ? ALASAN_TEKS[l.alasan as AlasanRekomendasi] : undefined;
    teks.push(`${i + 1}. ${l.nama} × ${l.qty}${alasan ? ` (${alasan})` : ""}`);
  });
  if (b.baris.length > 0) teks.push("");
  teks.push(`Jumlah: ${b.baris.reduce((n, l) => n + l.qty, 0)} pcs`);
  const catatan = b.catatan?.trim();
  if (catatan) teks.push("", `Catatan: ${catatan}`);
  teks.push("", "Bila setuju, balas pesan ini — kami siapkan pesanannya.");
  if (b.jenis === "PUTUS") teks.push("Harga mengikuti harga yang berlaku saat pesanan dibuat.");
  teks.push("", "Terima kasih");
  if (b.salesman?.trim()) teks.push(b.salesman.trim());
  return teks.join("\n");
}
