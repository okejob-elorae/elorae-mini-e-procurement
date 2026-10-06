'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { bolehMemverifikasi, bolehMengelolaKonsi } from '@/lib/receivables/izin';
import {
  batalkanPembayaranToko,
  bayarKomisi,
  bukaKunci,
  bukaSiklus,
  catatLaporan,
  catatNomorDokumen,
  catatPembayaranToko,
  kirimTitipan,
  kunciAngka,
  type AlasanGagalKonsi,
  type BarisKirim,
  type BarisKurangKirim,
  type BarisLaporan,
  type BarisResmi,
} from '@/lib/konsinyasi/writer';
import { bahanLaporanSpg, type BarisBahan } from '@/lib/konsinyasi/laporan-spg';
import { pilihanVarianKirim, type PilihanVarianKirim } from '@/lib/konsinyasi/varian-kirim';
import { antrekanPushStok } from '@/lib/jubelio/antre-push-stok';
import { kabarkanKirimanBerangkat } from '@/lib/spg/pesanan-menuju-toko';

export type KodeAksiKonsi = 'TANPA_AKSES' | 'TANGGAL_TIDAK_VALID' | AlasanGagalKonsi | 'GAGAL';
export type HasilAksiKonsi = { ok: true } | { ok: false; kode: KodeAksiKonsi };

function segarkan() {
  revalidatePath('/backoffice/konsinyasi');
}

function tanggalWib(teks: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(teks)) return null;
  const d = new Date(`${teks}T00:00:00+07:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Seluruh aksi konsinyasi memakai `receivables:manage`.
 *
 * Brief aslinya memisahkan admin penjualan dan admin pajak sebagai peran
 * sendiri. Elorae belum punya keduanya, dan MENGARANG peran baru di sini akan
 * membuat izin yang tidak pernah diberikan kepada siapa pun — layarnya jadi
 * tidak bisa dibuka sama sekali. Pemisahan itu dicatat sebagai pekerjaan
 * berikutnya, bukan dipura-purakan sudah ada.
 */
async function butuh(): Promise<string | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return bolehMengelolaKonsi(session.user.permissions) ? session.user.id : null;
}

export async function bukaSiklusAction(input: {
  storeId: string;
  periodYear: number;
  periodMonth: number;
  spgDueDate?: string;
}): Promise<HasilAksiKonsi> {
  const userId = await butuh();
  if (!userId) return { ok: false, kode: 'TANPA_AKSES' };

  const tenggat = input.spgDueDate ? tanggalWib(input.spgDueDate) : null;
  if (input.spgDueDate && !tenggat) return { ok: false, kode: 'TANGGAL_TIDAK_VALID' };

  try {
    const hasil = await bukaSiklus({ ...input, spgDueDate: tenggat, olehUserId: userId });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    segarkan();
    return { ok: true };
  } catch (err) {
    console.error('bukaSiklus gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}

/** Hasil "Kirim titipan" untuk layar: nomor kiriman, atau rincian barang/varian yang kurang. */
export type HasilKirimTitipanAksi =
  | { ok: true; noKirim: string; ulang: boolean }
  | { ok: false; kode: KodeAksiKonsi; kurang?: BarisKurangKirim[] };

/** Baris dari formulir: bentuk dan angkanya diperiksa di sini, sebelum penulis. */
function barisKirimSah(items: unknown): BarisKirim[] | null {
  if (!Array.isArray(items)) return null;
  const hasil: BarisKirim[] = [];
  for (const b of items as Record<string, unknown>[]) {
    if (!b || typeof b !== 'object') return null;
    const { itemId, variantSku, itemName, qty, price } = b;
    if (typeof itemName !== 'string') return null;
    if (itemId != null && typeof itemId !== 'string') return null;
    if (variantSku != null && typeof variantSku !== 'string') return null;
    // Kolom qty bilangan bulat; harga tidak boleh negatif atau kosong terbaca NaN.
    if (typeof qty !== 'number' || !Number.isInteger(qty) || qty < 0) return null;
    if (typeof price !== 'number' || !Number.isFinite(price) || price < 0) return null;
    hasil.push({ itemId: itemId ?? null, variantSku: variantSku ?? null, itemName, qty, price });
  }
  return hasil;
}

export async function kirimTitipanAction(input: {
  storeId: string;
  cycleId?: string | null;
  shippedAt: string;
  items: BarisKirim[];
  note?: string;
  /** Dibuat formulir SEKALI per isian: klik ganda / kirim ulang = kiriman yang sama. */
  idempotencyKey?: string;
}): Promise<HasilKirimTitipanAksi> {
  const userId = await butuh();
  if (!userId) return { ok: false, kode: 'TANPA_AKSES' };

  const tanggal = tanggalWib(input.shippedAt);
  if (!tanggal) return { ok: false, kode: 'TANGGAL_TIDAK_VALID' };

  const items = barisKirimSah(input.items);
  if (!items) return { ok: false, kode: 'NILAI_TIDAK_VALID' };
  const kunci =
    typeof input.idempotencyKey === 'string' && input.idempotencyKey.trim().length <= 200
      ? input.idempotencyKey.trim() || null
      : null;

  let hasil: Awaited<ReturnType<typeof kirimTitipan>>;
  try {
    hasil = await kirimTitipan({
      storeId: input.storeId,
      cycleId: input.cycleId,
      note: input.note,
      items,
      shippedAt: tanggal,
      olehUserId: userId,
      idempotencyKey: kunci,
    });
  } catch (err) {
    console.error('kirimTitipan gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
  if (!hasil.ok) {
    return 'kurang' in hasil ? { ok: false, kode: hasil.alasan, kurang: hasil.kurang } : { ok: false, kode: hasil.alasan };
  }

  // Stok gudang sudah berkurang dan sudah commit: kabari Jubelio supaya marketplace tidak
  // menjual barang yang sudah di toko konsinyasi. Best-effort — kirimannya sudah sah. Kiriman
  // ulang tidak mengantre lagi: pushnya sudah diantrekan oleh kiriman pertama.
  if (!hasil.ulang && hasil.barangBerubah.length > 0) {
    try {
      await antrekanPushStok(hasil.barangBerubah, { sumber: 'ADJUSTMENT', ref: hasil.noKirim, userId });
    } catch (err) {
      console.error(`push stok kiriman titipan ${hasil.noKirim} tidak masuk antrean:`, err);
    }
  }
  // Barang berangkat ke toko → SPG toko itu dikabari, sekali per kiriman (kiriman ulang tidak).
  void kabarkanKirimanBerangkat({ sourceType: 'KONSI_SHIPMENT', sourceId: hasil.id, pelakuId: userId });
  segarkan();
  return { ok: true, noKirim: hasil.noKirim, ulang: hasil.ulang };
}

/** Varian barang untuk pemilih "Kirim titipan" — stok tersedia per varian di gudang. */
export async function pilihanVarianKirimAction(
  itemId: string,
): Promise<{ ok: true; pilihan: PilihanVarianKirim } | { ok: false; kode: 'TANPA_AKSES' | 'GAGAL' }> {
  const userId = await butuh();
  if (!userId) return { ok: false, kode: 'TANPA_AKSES' };
  if (typeof itemId !== 'string' || !itemId) return { ok: false, kode: 'GAGAL' };
  try {
    return { ok: true, pilihan: await pilihanVarianKirim(itemId) };
  } catch (err) {
    console.error('pilihanVarianKirim gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}

export async function catatLaporanAction(input: {
  cycleId: string;
  source: 'SPG' | 'TOKO';
  reportedAt: string;
  items: BarisLaporan[];
  note?: string;
}): Promise<HasilAksiKonsi> {
  const userId = await butuh();
  if (!userId) return { ok: false, kode: 'TANPA_AKSES' };

  const tanggal = tanggalWib(input.reportedAt);
  if (!tanggal) return { ok: false, kode: 'TANGGAL_TIDAK_VALID' };

  try {
    const hasil = await catatLaporan({
      ...input,
      reportedAt: tanggal,
      reportedById: userId,
      olehUserId: userId,
    });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    segarkan();
    return { ok: true };
  } catch (err) {
    console.error('catatLaporan gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}

export async function kunciAngkaAction(
  cycleId: string,
  baris: BarisResmi[],
  gajiPokokPerSpg?: number,
): Promise<HasilAksiKonsi> {
  const userId = await butuh();
  if (!userId) return { ok: false, kode: 'TANPA_AKSES' };

  try {
    const hasil = await kunciAngka({ cycleId, baris, gajiPokokPerSpg, olehUserId: userId });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    segarkan();
    return { ok: true };
  } catch (err) {
    console.error('kunciAngka gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}

export async function bukaKunciAction(cycleId: string): Promise<HasilAksiKonsi> {
  const userId = await butuh();
  if (!userId) return { ok: false, kode: 'TANPA_AKSES' };

  try {
    const hasil = await bukaKunci({ cycleId, olehUserId: userId });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    segarkan();
    return { ok: true };
  } catch (err) {
    console.error('bukaKunci gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}

export async function bayarKomisiAction(
  commissionId: string,
  catatan?: string,
): Promise<HasilAksiKonsi> {
  const userId = await butuh();
  if (!userId) return { ok: false, kode: 'TANPA_AKSES' };

  try {
    const hasil = await bayarKomisi({ commissionId, olehUserId: userId, catatan });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    segarkan();
    return { ok: true };
  } catch (err) {
    console.error('bayarKomisi gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}

export async function catatNomorDokumenAction(
  cycleId: string,
  jenis: 'NOTA' | 'PAJAK',
  nomor: string,
): Promise<HasilAksiKonsi> {
  const userId = await butuh();
  if (!userId) return { ok: false, kode: 'TANPA_AKSES' };

  try {
    const hasil = await catatNomorDokumen({ cycleId, jenis, nomor, olehUserId: userId });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    segarkan();
    return { ok: true };
  } catch (err) {
    console.error('catatNomorDokumen gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}

/**
 * Isi formulir laporan SPG dari catatan penjualan harian SPG di toko itu, bulan
 * siklus itu. Hanya membaca — admin memeriksa lalu menyimpan lewat
 * `catatLaporanAction` seperti biasa.
 */
export async function bahanLaporanSpgAction(
  cycleId: string,
): Promise<{ ok: true; items: BarisBahan[] } | { ok: false; kode: 'TANPA_AKSES' | 'TIDAK_DITEMUKAN' }> {
  const userId = await butuh();
  if (!userId) return { ok: false, kode: 'TANPA_AKSES' };
  const items = await bahanLaporanSpg(cycleId);
  if (!items) return { ok: false, kode: 'TIDAK_DITEMUKAN' };
  return { ok: true, items };
}

/**
 * Pembayaran toko dicatat oleh keuangan (`journals:manage`), bukan oleh admin
 * konsinyasi: yang dicatat adalah uang yang sudah terlihat di rekening, dan
 * memverifikasi uang masuk adalah tugas yang sama dengan memverifikasi BKM.
 */
async function butuhKeuangan(): Promise<string | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return bolehMemverifikasi(session.user.permissions) ? session.user.id : null;
}

export async function catatPembayaranTokoAction(input: {
  cycleId: string;
  jumlah: number;
  tanggal: string;
  cara: string;
  catatan?: string;
}): Promise<HasilAksiKonsi> {
  const userId = await butuhKeuangan();
  if (!userId) return { ok: false, kode: "TANPA_AKSES" };

  const tanggal = tanggalWib(input.tanggal);
  if (!tanggal) return { ok: false, kode: "TANGGAL_TIDAK_VALID" };

  try {
    const hasil = await catatPembayaranToko({
      cycleId: input.cycleId,
      jumlah: Number(input.jumlah),
      tanggal,
      cara: input.cara,
      catatan: input.catatan,
      olehUserId: userId,
    });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    segarkan();
    return { ok: true };
  } catch (err) {
    console.error("catatPembayaranToko gagal:", err);
    return { ok: false, kode: "GAGAL" };
  }
}

export async function batalkanPembayaranTokoAction(paymentId: string, alasan: string): Promise<HasilAksiKonsi> {
  const userId = await butuhKeuangan();
  if (!userId) return { ok: false, kode: "TANPA_AKSES" };

  try {
    const hasil = await batalkanPembayaranToko({ paymentId, alasan, olehUserId: userId });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    segarkan();
    return { ok: true };
  } catch (err) {
    console.error("batalkanPembayaranToko gagal:", err);
    return { ok: false, kode: "GAGAL" };
  }
}
