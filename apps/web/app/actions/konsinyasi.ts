'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import {
  bolehMembayarKomisiSpg,
  bolehMencatatNomorKonsi,
  bolehMengelolaKonsi,
  bolehMengunciKonsi,
} from "@/lib/receivables/izin";
import {
  bayarKomisi,
  bukaKunci,
  bukaSiklus,
  catatLaporan,
  catatNomorDokumen,
  kunciAngka,
  type AlasanGagalKonsi,
  type BarisKirim,
  type BarisKurangKirim,
  type BarisLaporan,
  type BarisResmi,
} from '@/lib/konsinyasi/writer';
import { aturBulanSiklusPertama, type AlasanGagalSiklusPertama } from "@/lib/konsinyasi/siklus-pertama";
import { bahanLaporanSpg, type BarisBahan } from '@/lib/konsinyasi/laporan-spg';
import { pilihanVarianKirim, type PilihanVarianKirim } from '@/lib/konsinyasi/varian-kirim';
import { kaitBayarGajiKonsi, kaitSiklusKonsi } from '@/lib/finance/operasional/kait';

/**
 * `PAKAI_PENGIRIMAN`: "Kirim titipan" dihentikan (keputusan 2026-10-29 #3) — barang ke toko konsi
 * berangkat lewat Dorong konsi + dokumen pengiriman gudang→toko.
 */
export type KodeAksiKonsi = 'TANPA_AKSES' | 'TANGGAL_TIDAK_VALID' | AlasanGagalKonsi | 'PAKAI_PENGIRIMAN' | 'GAGAL';
export type HasilAksiKonsi = { ok: true } | { ok: false; kode: KodeAksiKonsi };

function segarkan() {
  revalidatePath('/backoffice/konsinyasi');
}

/** Kunci dan buka kunci melahirkan / membatalkan tagihan siklus di piutang (tagihan konsi). */
function segarkanPiutang() {
  revalidatePath("/backoffice/piutang");
  revalidatePath("/backoffice/pelunasan/baru");
  revalidatePath("/pwa/tagihan");
}

/** Kunci, buka kunci, dan bayar gaji mengubah komisi SPG — layar komisi kantor dan HP SPG ikut segar. */
function segarkanKomisi() {
  segarkan();
  revalidatePath("/backoffice/komisi-spg");
  revalidatePath("/backoffice/spg-commission");
  revalidatePath("/pwa/spg/gaji");
  revalidatePath("/pwa");
}

function tanggalWib(teks: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(teks)) return null;
  const d = new Date(`${teks}T00:00:00+07:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Pagar aksi konsinyasi (`lib/receivables/izin.ts`).
 *
 * Menjalankan siklus — membuka siklus, kiriman titipan, laporan SPG/toko —
 * memakai `consignment:manage` (`butuh()`). Tiga pekerjaan yang brief berikan
 * kepada orang berbeda memakai izinnya sendiri (keputusan pemilik 2026-11-01):
 * mengunci/membuka kunci angka (`consignment:lock`, manager), nomor nota
 * (`consignment:note_number`, admin penjualan), dan nomor faktur pajak
 * (`consignment:tax_number`, admin pajak). Menandai gaji SPG dibayar memakai
 * `spg_commission:pay`. Pembayaran toko tidak dicatat di sini lagi: kunci angka melahirkan tagihan
 * siklus di piutang, dan uang toko masuk lewat BKM seperti tagihan lain.
 */
async function butuh(): Promise<string | null> {
  return butuhIzin(bolehMengelolaKonsi);
}

/** Pengguna yang lolos `boleh`, atau null bila tidak masuk / tidak berizin. */
async function butuhIzin(boleh: (izin: string[] | undefined) => boolean): Promise<string | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return boleh(session.user.permissions) ? session.user.id : null;
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

/**
 * "Kirim titipan" dihentikan (keputusan 2026-10-29 #3): menolak `PAKAI_PENGIRIMAN` tanpa menulis
 * apa pun. Barang ke toko konsi berangkat lewat Dorong konsi (`/backoffice/stores/<id>/konsi-push`)
 * dan dokumen pengiriman gudang→toko. Penulis `kirimTitipan` tetap ada sampai kueri buktinya
 * (kiriman titipan sesudah tanggal ini) menunjukkan 0.
 */
export async function kirimTitipanAction(_input: {
  storeId: string;
  cycleId?: string | null;
  shippedAt: string;
  items: BarisKirim[];
  note?: string;
  idempotencyKey?: string;
}): Promise<HasilKirimTitipanAksi> {
  const userId = await butuh();
  if (!userId) return { ok: false, kode: 'TANPA_AKSES' };
  return { ok: false, kode: 'PAKAI_PENGIRIMAN' };
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

/**
 * Kunci angka siklus. Gaji pokok SPG TIDAK diketik di sini lagi: dihitung dari gaji bulanan dan
 * jadwal / catatan check-in yang disetujui (P7a–P7e). Mengunci juga melahirkan tagihan siklus di
 * piutang (nomor = nomor konsi), jadi halaman piutang ikut segar.
 */
export async function kunciAngkaAction(cycleId: string, baris: BarisResmi[]): Promise<HasilAksiKonsi> {
  const userId = await butuhIzin(bolehMengunciKonsi);
  if (!userId) return { ok: false, kode: 'TANPA_AKSES' };
  if (typeof cycleId !== "string" || !cycleId || !Array.isArray(baris)) return { ok: false, kode: "NILAI_TIDAK_VALID" };

  try {
    const hasil = await kunciAngka({ cycleId, baris, olehUserId: userId });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    // Penjualan siklus, tagihannya, dan gaji SPG ke buku besar (sesudah commit, tidak pernah melempar).
    await kaitSiklusKonsi(cycleId, userId);
    segarkanKomisi();
    segarkanPiutang();
    return { ok: true };
  } catch (err) {
    console.error('kunciAngka gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}

export async function bukaKunciAction(cycleId: string): Promise<HasilAksiKonsi> {
  const userId = await butuhIzin(bolehMengunciKonsi);
  if (!userId) return { ok: false, kode: 'TANPA_AKSES' };

  try {
    const hasil = await bukaKunci({ cycleId, olehUserId: userId });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    // Jurnal siklus dan gaji SPG-nya dibalik (generasi penyesuaian), tidak dihapus; tagihannya dibatalkan.
    await kaitSiklusKonsi(cycleId, userId);
    segarkanKomisi();
    segarkanPiutang();
    return { ok: true };
  } catch (err) {
    console.error('bukaKunci gagal:', err);
    return { ok: false, kode: 'GAGAL' };
  }
}

export async function bayarKomisiAction(
  commissionId: string,
  catatan: string | undefined,
  jumlahDiharapkan: number,
): Promise<HasilAksiKonsi> {
  const userId = await butuhIzin(bolehMembayarKomisiSpg);
  if (!userId) return { ok: false, kode: 'TANPA_AKSES' };
  // Yang dilihat kantor wajib ikut: angka yang berubah sejak halaman dibuka ditolak, bukan dibayar.
  if (typeof jumlahDiharapkan !== "number" || !Number.isFinite(jumlahDiharapkan) || jumlahDiharapkan < 0) {
    return { ok: false, kode: "NILAI_TIDAK_VALID" };
  }

  try {
    const hasil = await bayarKomisi({ commissionId, olehUserId: userId, catatan, jumlahDiharapkan });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    // Akrual gaji SPG siklusnya diselaraskan dulu (pembayaran bisa menghitung ulang angkanya),
    // lalu jurnal pembayarannya dengan koreksi yang dibawanya — keduanya di `kaitBayarGajiKonsi`.
    await kaitBayarGajiKonsi(commissionId, userId);
    segarkanKomisi();
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
  // Nomor nota = admin penjualan, nomor faktur pajak = admin pajak; jenis lain ditolak di pagarnya.
  const userId = await butuhIzin((izin) => bolehMencatatNomorKonsi(izin, jenis));
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
 * Bulan siklus pertama konsinyasi (P59) — `consignment:lock`. Selama belum diatur, siklus mana pun
 * tidak bisa dikunci. Ditolak kalau sudah ada siklus terkunci sebelumnya atau tagihan konsi
 * impor/manual sejak bulan itu (`nomor` menyebut dokumennya).
 */
export async function aturBulanSiklusPertamaAction(
  bulan: string,
): Promise<{ ok: true } | { ok: false; kode: 'TANPA_AKSES' | 'GAGAL' | AlasanGagalSiklusPertama; nomor?: string }> {
  const userId = await butuhIzin(bolehMengunciKonsi);
  if (!userId) return { ok: false, kode: 'TANPA_AKSES' };
  try {
    const hasil = await aturBulanSiklusPertama({ bulan: typeof bulan === "string" ? bulan : "", olehUserId: userId });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan, ...(hasil.nomor ? { nomor: hasil.nomor } : {}) };
    segarkan();
    return { ok: true };
  } catch (err) {
    console.error("aturBulanSiklusPertama gagal:", err);
    return { ok: false, kode: "GAGAL" };
  }
}
