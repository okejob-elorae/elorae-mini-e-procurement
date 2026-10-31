import type { Kabar } from "@/lib/notifications/kabar-pengguna";
import { formatIDR } from "@/lib/sales-orders/format";

/**
 * Isi kabar ke salesman saat pesanannya diputuskan kantor. Murni (impor
 * `kabar-pengguna` hanya tipe) supaya bisa dites tanpa basis data.
 *
 * Teksnya bahasa Indonesia tetap, bukan i18n: kabar dikirim ke HP salesman,
 * sedangkan bahasa yang aktif saat penulisnya berjalan adalah bahasa ADMIN
 * yang menyetujui. Kabar tersimpan sebagai teks jadi di `NotificationQueue`.
 */

export type KeputusanDisetujui = {
  orderId: string;
  orderNo: string;
  orderType: "PUTUS" | "KONSI";
  storeName: string;
  total: number;
  /** Baris ajuan harga yang harga akhirnya BERBEDA dari yang diajukan salesman. */
  ajuanDiubah: number;
  /** Baris ajuan harga yang disetujui persis seperti yang diajukan. */
  ajuanDiterima: number;
  /** Barang yang ditambahkan kantor ke transfer konsinyasi saat menyetujui. */
  ditambahKantor: number;
};

export function kabarPesananDisetujui(k: KeputusanDisetujui): Kabar {
  const bagian: string[] = [];
  if (k.orderType === "KONSI") {
    // Salesman konsinyasi tidak pernah diperlihatkan harga, jadi totalnya tidak disebut.
    bagian.push(`${k.storeName} · transfer konsinyasi disetujui.`);
    if (k.ditambahKantor > 0) bagian.push(`Kantor menambahkan ${k.ditambahKantor} barang baru.`);
  } else {
    bagian.push(`${k.storeName} · total ${formatIDR(k.total)}.`);
    if (k.ajuanDiubah > 0) bagian.push(`Harga ajuan Anda diubah kantor untuk ${k.ajuanDiubah} barang.`);
    else if (k.ajuanDiterima > 0) bagian.push("Harga ajuan Anda disetujui.");
  }
  return {
    jenis: "PESANAN_DISETUJUI",
    judul: `Pesanan ${k.orderNo} disetujui`,
    isi: bagian.join(" "),
    data: { orderId: k.orderId },
  };
}

export function kabarPesananDitolak(k: { orderId: string; orderNo: string; storeName: string; alasan: string | null }): Kabar {
  const alasan = k.alasan?.trim();
  return {
    jenis: "PESANAN_DITOLAK",
    judul: `Pesanan ${k.orderNo} ditolak`,
    isi: alasan ? `${k.storeName} · alasan: ${alasan}` : `${k.storeName} · tanpa alasan tertulis.`,
    data: { orderId: k.orderId },
  };
}
