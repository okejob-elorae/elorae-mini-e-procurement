import { prisma } from "@elorae/db";
import { formatDisplayDate } from "@/lib/date-only";
import {
  batasKreditBerlaku,
  nilaiKredit,
  type AlasanKredit,
  type KeadaanTagihan,
  type ModeKredit,
  type SumberBatas,
  type TingkatKredit,
} from "@/lib/salesman/kredit";
import { muatKreditToko } from "./kredit-toko";

/**
 * Bahan panel kredit di halaman persetujuan pesanan PUTUS (backoffice).
 *
 * Dua sisi berdampingan: catatan SAAT PESANAN DIBUAT (`kreditCatatan`, teks
 * yang dibekukan penulis pesanan) dan keadaan tagihan toko SEKARANG — karena
 * di antara keduanya toko bisa saja sudah melunasi, atau justru menunggak lagi.
 */

export type FakturPanelKredit = {
  id: string;
  invoiceNo: string;
  /** Sudah diformat di server (WIB) — hindari selisih hidrasi di Safari. */
  jatuhTempo: string;
  sisa: number;
  lewat: boolean;
  hariTerlambat: number | null;
};

export type PanelKredit = {
  ditahan: boolean;
  catatan: string | null;
  mode: ModeKredit;
  /** Batas yang BERLAKU (sesudah bawaan dan "Tanpa batas"); null = tidak dibatasi. */
  batasNilai: number | null;
  batasFaktur: number | null;
  /** Asal batas di atas — "khusus toko ini", "ikut bawaan", atau "tanpa batas". */
  sumberBatasNilai: SumberBatas;
  sumberBatasFaktur: SumberBatas;
  /** Penilaian dengan tagihan sekarang; null = tagihan toko gagal dibaca. */
  sekarang: { tingkat: TingkatKredit; alasan: AlasanKredit[]; keadaan: KeadaanTagihan; nilaiPesanan: number } | null;
  /** Faktur terbuka, yang lewat janji dulu; paling banyak `BATAS_FAKTUR_PANEL`. */
  faktur: FakturPanelKredit[];
  fakturLainnya: number;
};

const BATAS_FAKTUR_PANEL = 5;

/** null untuk pesanan konsinyasi, pesanan yang tidak ada, atau toko yang kini konsinyasi. */
export async function muatPanelKredit(orderId: string): Promise<PanelKredit | null> {
  const order = await prisma.fieldSalesOrder.findUnique({
    where: { id: orderId },
    select: { storeId: true, orderType: true, status: true, total: true, kreditDitahan: true, kreditCatatan: true },
  });
  if (!order || order.orderType !== "PUTUS") return null;
  const kredit = await muatKreditToko(order.storeId);
  if (!kredit) return null;

  // Selama menunggu persetujuan, pesanan ini belum menjadi faktur — nilainya
  // ikut dihitung seperti saat dibuat. Sesudah diputuskan, yang dinilai hanya tagihan toko.
  const nilaiPesanan = order.status === "PENDING_APPROVAL" ? Number(order.total) : 0;
  const sekarang = kredit.keadaan
    ? { ...nilaiKredit(kredit.keadaan, kredit.aturan, kredit.batas, nilaiPesanan), keadaan: kredit.keadaan, nilaiPesanan }
    : null;

  const urut = [...kredit.baris].sort((a, b) => Number(b.keadaan === "lewat") - Number(a.keadaan === "lewat"));
  const faktur = urut.slice(0, BATAS_FAKTUR_PANEL).map((b) => ({
    id: b.id,
    invoiceNo: b.invoiceNo,
    // Bahasa aplikasi tersimpan di browser, server tidak tahu — memakai bawaan id-ID seperti halaman lain.
    jatuhTempo: formatDisplayDate(b.dueDate),
    sisa: b.outstanding,
    lewat: b.keadaan === "lewat",
    hariTerlambat: b.alasan.hariTerlambat ?? null,
  }));

  // Batas dibaca lewat pemutus yang sama dengan penilaian `sekarang` dan gerbang persetujuan.
  const batas = batasKreditBerlaku(kredit.batas, kredit.aturan);
  return {
    ditahan: order.kreditDitahan,
    catatan: order.kreditCatatan,
    mode: kredit.aturan.mode,
    batasNilai: batas.nilai.nilai,
    batasFaktur: batas.faktur.nilai,
    sumberBatasNilai: batas.nilai.sumber,
    sumberBatasFaktur: batas.faktur.sumber,
    sekarang,
    faktur,
    fakturLainnya: Math.max(0, urut.length - faktur.length),
  };
}

/** Id pesanan (dari `orderIds`) yang menunggu persetujuan dengan kredit ditahan — untuk lencana di daftar. */
export async function idPesananKreditDitahan(orderIds: string[]): Promise<string[]> {
  if (orderIds.length === 0) return [];
  const rows = await prisma.fieldSalesOrder.findMany({
    where: { id: { in: orderIds }, kreditDitahan: true, status: "PENDING_APPROVAL" },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}
