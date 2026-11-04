/**
 * Salinan pesanan untuk toko, dikirim salesman lewat WhatsApp — bagian murni.
 *
 * Tidak ada API WhatsApp: yang dibuat hanya teksnya; tautan `wa.me` dirakit
 * pemanggil (`tautanWhatsApp`) dan salesman sendiri yang menekan kirim.
 *
 * SELALU Bahasa Indonesia, tidak lewat next-intl: pembacanya toko, bukan
 * pengguna aplikasi. Salesman yang memakai tampilan Inggris tetap mengirim
 * pesan yang dibaca toko — sama dengan `pesanToko` yang dipatok Indonesia.
 *
 * KONSINYASI TIDAK PERNAH MEMBAWA HARGA. Itu aturan tetap aplikasi salesman
 * (lihat `nilaiTampil`). Pembangun ini membuang harga dan total konsinyasi
 * SENDIRI, walau pemanggil mengisinya — tidak bergantung pada pemanggil yang
 * ingat. Teksnya diuji: tidak ada "Rp" sama sekali.
 */

import { formatIDR } from "@/lib/sales-orders/format";
import { formatDisplayDateTime } from "@/lib/date-only";
import { catatanUntukDiubah } from "./ganti-pesanan";

export type BarisPesanPesanan = {
  /** `productName` pesanan — untuk baris varian sudah memuat label variannya ("Kaos — M"). */
  nama: string;
  /** Label varian; ditambahkan hanya bila belum ada di `nama`. */
  varian: string | null;
  qty: number;
  bonus: boolean;
  /** Diabaikan untuk KONSI. */
  hargaSatuan?: number | null;
  /** Diabaikan untuk KONSI. */
  total?: number | null;
};

export type BahanPesanPesanan = {
  toko: string;
  orderNo: string;
  tanggal: Date | string;
  orderType: "PUTUS" | "KONSI";
  status: "PENDING_APPROVAL" | "APPROVED" | "REJECTED";
  baris: readonly BarisPesanPesanan[];
  /** Diabaikan untuk KONSI. */
  subtotal?: number | null;
  /** Jumlah potongan promo (baris + pesanan). Diabaikan untuk KONSI. */
  potongan?: number | null;
  /** Diabaikan untuk KONSI. */
  total?: number | null;
  catatan: string | null;
  salesman: string | null;
  /** Pre-order: nama jendelanya. */
  inden?: { nama: string } | null;
};

const AKHIRAN_BONUS = " (bonus)";

function namaBaris(b: BarisPesanPesanan): string {
  // Baris bonus disimpan dengan akhiran "(bonus)"; ditandai sekali di ujung baris.
  let nama = b.bonus && b.nama.endsWith(AKHIRAN_BONUS) ? b.nama.slice(0, -AKHIRAN_BONUS.length) : b.nama;
  const varian = b.varian?.trim();
  if (varian && !nama.includes(varian)) nama = `${nama} — ${varian}`;
  return nama;
}

export function pesanPesananWa(b: BahanPesanPesanan): string {
  const putus = b.orderType === "PUTUS";
  const baris: string[] = [`Halo ${b.toko},`, "", "Berikut salinan pesanan Anda:", ""];
  baris.push(`No. pesanan: ${b.orderNo}`);
  baris.push(`Tanggal: ${formatDisplayDateTime(b.tanggal, "id")} WIB`);
  if (b.inden?.nama) baris.push(`Pre-order: ${b.inden.nama}`);
  if (b.status === "PENDING_APPROVAL") baris.push("Status: menunggu persetujuan kantor");
  else if (b.status === "APPROVED") baris.push("Status: disetujui");
  baris.push("");

  b.baris.forEach((l, i) => {
    const kepala = `${i + 1}. ${namaBaris(l)} × ${l.qty}`;
    if (l.bonus) baris.push(`${kepala} (bonus)`);
    else if (putus && l.hargaSatuan != null && l.total != null) {
      baris.push(`${kepala} @ ${formatIDR(l.hargaSatuan)} = ${formatIDR(l.total)}`);
    } else baris.push(kepala);
  });
  if (b.baris.length > 0) baris.push("");

  if (putus) {
    if (b.subtotal != null) baris.push(`Subtotal: ${formatIDR(b.subtotal)}`);
    if (b.potongan) baris.push(`Potongan promo: -${formatIDR(b.potongan)}`);
    if (b.total != null) baris.push(`Total: ${formatIDR(b.total)}`);
    if (b.status === "PENDING_APPROVAL") baris.push("Harga final setelah disetujui kantor.");
  } else {
    baris.push(`Jumlah: ${b.baris.reduce((n, l) => n + l.qty, 0)} pcs`);
  }

  const catatan = catatanUntukDiubah(b.catatan);
  if (catatan) baris.push("", `Catatan: ${catatan}`);

  baris.push("", "Terima kasih");
  if (b.salesman?.trim()) baris.push(b.salesman.trim());
  return baris.join("\n");
}
