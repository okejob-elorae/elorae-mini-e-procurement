"use server";

import { revalidatePath } from "next/cache";
import { kaitBarangHilang, kaitPotongSales } from "@/lib/finance/operasional/kait";
import { prisma } from "@elorae/db";
import { cariTeks } from "@/lib/db/cari-teks";
import { auth } from "@/lib/auth";
import { parseItemVariants } from "@/lib/items/variants";
import { labelVarian } from "@/lib/konsinyasi/stok-di-toko";
import { bolehMemutuskanBeban, bolehMemverifikasi, bolehMengelola } from "@/lib/receivables/izin";
import {
  batalkanBarangHilang,
  buatBarangHilang,
  periksaKlaimEkspedisi,
  putuskanBarangHilang,
  putuskanKlaimEkspedisi,
  tandaiSalesDipotong,
  tandaiTokoDitagih,
  ubahKeputusanHilang,
  ubahNilaiKlaimEkspedisi,
} from "@/lib/spg/hilang-writer";

/**
 * Aksi kantor barang hilang. Tulisan dijaga `receivables:manage`
 * (`bolehMengelola`, lib/receivables/izin.ts), KECUALI memutuskan, mengubah, dan
 * membatalkan keputusan siapa menanggungnya: itu keputusan manager,
 * `receivables:decide_bearer` (`bolehMemutuskanBeban`, keputusan pemilik
 * 2026-11-01) — pemisahan tugas itulah yang membuat potongan gaji/komisi bisa
 * dipertanggungjawabkan. Melihat cukup `spg_sales:view` (halaman memagari
 * dirinya). Aksi mengembalikan `{ ok:false, code }`, tidak pernah melempar.
 *
 * Klaim ke ekspedisi (barang hilang di jalan, P36): mencatat jawaban ekspedisi
 * (dibayar lewat transfer/tunai/potong ongkir, atau ditolak) = `receivables:manage`;
 * uangnya baru diakui setelah dicek ke mutasi rekening oleh pemegang
 * `payments:verify` (`bolehMemverifikasi`, keputusan 11 — 29 Okt); mengubah nilai
 * klaim yang masih diajukan = keputusan penanggung, `receivables:decide_bearer`.
 * Tombol di halaman memakai izin yang SAMA.
 */

type Gagal = { ok: false; code: string };

async function pengelola(): Promise<string | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return bolehMengelola(session.user.permissions) ? session.user.id : null;
}

async function sesi(boleh: (izin: string[] | undefined) => boolean = bolehMengelola): Promise<{ userId: string } | Gagal> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, code: "UNAUTHORIZED" };
  if (!boleh(session.user.permissions)) return { ok: false, code: "FORBIDDEN" };
  return { userId: session.user.id };
}

const segarkan = (lossId?: string) => {
  revalidatePath("/backoffice/barang-hilang");
  if (lossId) revalidatePath(`/backoffice/barang-hilang/${lossId}`);
  revalidatePath("/pwa/beban");
};

export type BarangHilangCari = { itemId: string; sku: string; nama: string; varian: { variantSku: string; label: string | null }[] };

/** Cari barang jadi untuk formulir catat manual (nama atau SKU, minimal 2 huruf). */
export async function cariBarangHilangAction(query: string): Promise<{ ok: true; barang: BarangHilangCari[] } | Gagal> {
  if (!(await pengelola())) return { ok: false, code: "FORBIDDEN" };
  const q = String(query ?? "").trim().slice(0, 100);
  if (q.length < 2) return { ok: true, barang: [] };
  const rows = await prisma.item.findMany({
    where: {
      isActive: true,
      type: "FINISHED_GOOD",
      OR: [{ sku: cariTeks(q) }, { nameId: cariTeks(q) }],
    },
    orderBy: { nameId: "asc" },
    take: 20,
    select: { id: true, sku: true, nameId: true, variants: true },
  });
  return {
    ok: true,
    barang: rows.map((r) => {
      const skus = [...new Set(parseItemVariants(r.variants).map((v) => (v.sku ?? "").trim()).filter(Boolean))];
      return {
        itemId: r.id,
        sku: r.sku,
        nama: r.nameId,
        varian: skus.length ? skus.map((s) => ({ variantSku: s, label: labelVarian(r.variants, s) })) : [{ variantSku: "", label: null }],
      };
    }),
  };
}

export async function buatBarangHilangAction(input: {
  storeId?: string | null;
  baris: { itemId: string; variantSku: string; qty: number }[];
  catatan: string;
  idempotencyKey: string;
}): Promise<{ ok: true; id: string } | Gagal> {
  const s = await sesi();
  if ("ok" in s) return s;
  const r = await buatBarangHilang({ ...input, userId: s.userId });
  if (!r.ok) return { ok: false, code: r.kode };
  segarkan(r.id);
  return { ok: true, id: r.id };
}

/**
 * `bagian` = pembagian SEBELUM keringanan. Dengan `keringananPersen` (bulat
 * 1–100), server sendiri yang mengurangi bagian SPG/SALES dan memindahkan
 * selisihnya ke Elorae — angka hasil hitungan layar tidak dipercaya.
 */
type IsianKeputusan = {
  lossId: string;
  bagian: { bearer: string; bearerUserId: string | null; amount: number }[];
  total?: number | null;
  catatan?: string | null;
  keringananPersen?: number | null;
};

export async function putuskanBarangHilangAction(input: IsianKeputusan): Promise<{ ok: true } | Gagal> {
  const s = await sesi(bolehMemutuskanBeban);
  if ("ok" in s) return s;
  const r = await putuskanBarangHilang({ ...input, olehUserId: s.userId });
  if (!r.ok) return { ok: false, code: r.kode };
  // Barang hilang di toko konsinyasi: persediaan konsinyasi → beban (sesudah commit, tidak pernah melempar).
  await kaitBarangHilang(r.id, s.userId);
  segarkan(r.id);
  return { ok: true };
}

export async function ubahKeputusanHilangAction(input: IsianKeputusan): Promise<{ ok: true } | Gagal> {
  const s = await sesi(bolehMemutuskanBeban);
  if ("ok" in s) return s;
  const r = await ubahKeputusanHilang({ ...input, catatan: input.catatan ?? "", olehUserId: s.userId });
  if (!r.ok) return { ok: false, code: r.kode };
  await kaitBarangHilang(r.id, s.userId);
  segarkan(r.id);
  return { ok: true };
}

/**
 * Membatalkan catatan yang masih TERBUKA = `receivables:manage`. Membatalkan yang
 * SUDAH diputuskan menghapus seluruh bagian penanggungnya dan membalik jurnalnya,
 * jadi itu membatalkan keputusan manager: `receivables:decide_bearer`, sama
 * dengan memutuskannya. Tanpa ini pemegang izin kelola bisa menganulir keputusan
 * yang tidak boleh ia buat. Status dibaca dulu di sini hanya untuk menolak cepat
 * (dan supaya catatan yang tak ada tidak sampai ke penulis); penentunya penulis,
 * yang menerima kedua izin dan memeriksanya lagi DI DALAM transaksinya
 * (TANPA_IZIN → FORBIDDEN), jadi keputusan yang masuk tepat di antara keduanya
 * tidak bisa dibatalkan dengan izin kelola saja.
 */
export async function batalkanBarangHilangAction(input: { lossId: string; alasan: string }): Promise<{ ok: true } | Gagal> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, code: "UNAUTHORIZED" };
  const izin = session.user.permissions;
  if (!bolehMengelola(izin) && !bolehMemutuskanBeban(izin)) return { ok: false, code: "FORBIDDEN" };
  if (typeof input?.lossId !== "string" || !input.lossId) return { ok: false, code: "TIDAK_DITEMUKAN" };
  const loss = await prisma.stockLoss.findUnique({ where: { id: input.lossId }, select: { status: true } });
  if (!loss) return { ok: false, code: "TIDAK_DITEMUKAN" };
  if (loss.status === "TERBUKA" && !bolehMengelola(izin)) return { ok: false, code: "FORBIDDEN" };
  if (loss.status !== "TERBUKA" && loss.status !== "DIBATALKAN" && !bolehMemutuskanBeban(izin)) {
    return { ok: false, code: "FORBIDDEN" };
  }
  const userId = session.user.id;
  const r = await batalkanBarangHilang({
    lossId: input.lossId,
    alasan: input.alasan,
    olehUserId: userId,
    bolehBatalkanTerbuka: bolehMengelola(izin),
    bolehBatalkanKeputusan: bolehMemutuskanBeban(izin),
  });
  if (!r.ok) return { ok: false, code: r.kode === "TANPA_IZIN" ? "FORBIDDEN" : r.kode };
  // Keputusan yang dibatalkan: jurnalnya dibalik (generasi penyesuaian), tidak dihapus.
  await kaitBarangHilang(r.id, userId);
  segarkan(r.id);
  return { ok: true };
}

/**
 * Jawaban ekspedisi atas klaimnya: `DIBAYAR` = pembayarannya DICATAT (cara wajib;
 * nomor tagihan ongkir wajib untuk potong ongkir) dan menunggu cek Keuangan;
 * `DITOLAK` = ekspedisi menolak (alasan wajib) — kantor lalu memilih penanggung
 * lain lewat "Ubah keputusan". Belum ada uang yang diakui, jadi belum ada jurnal.
 */
export async function putuskanKlaimEkspedisiAction(input: {
  shareId: string;
  hasil: "DIBAYAR" | "DITOLAK";
  cara?: string | null;
  referensi?: string | null;
  catatan?: string | null;
}): Promise<{ ok: true } | Gagal> {
  const s = await sesi();
  if ("ok" in s) return s;
  if (typeof input?.shareId !== "string" || !input.shareId) return { ok: false, code: "TIDAK_DITEMUKAN" };
  if (input.hasil !== "DIBAYAR" && input.hasil !== "DITOLAK") return { ok: false, code: "INVALID" };
  try {
    const r = await putuskanKlaimEkspedisi({
      shareId: input.shareId,
      hasil: input.hasil,
      cara: input.cara,
      referensi: input.referensi,
      catatan: input.catatan,
      olehUserId: s.userId,
    });
    if (!r.ok) return { ok: false, code: r.kode };
    segarkan(r.lossId);
    return { ok: true };
  } catch (err) {
    console.error("putuskanKlaimEkspedisi gagal:", err);
    return { ok: false, code: "GAGAL" };
  }
}

/**
 * Cek pembayaran klaim ekspedisi ke mutasi rekening (`payments:verify`): `SAH` →
 * bagian ekspedisi lunas dan pemulihan bebannya dijurnal sesudah commit;
 * `KEMBALIKAN` (catatan wajib) → kembali diajukan supaya pencatatnya merevisi.
 * Pencatat pembayarannya tidak pernah memeriksanya sendiri (`PEMERIKSA_SAMA`, di
 * penulis).
 */
export async function periksaKlaimEkspedisiAction(input: {
  shareId: string;
  hasil: "SAH" | "KEMBALIKAN";
  catatan?: string | null;
}): Promise<{ ok: true; dibayar: boolean } | Gagal> {
  const s = await sesi(bolehMemverifikasi);
  if ("ok" in s) return s;
  if (typeof input?.shareId !== "string" || !input.shareId) return { ok: false, code: "TIDAK_DITEMUKAN" };
  if (input.hasil !== "SAH" && input.hasil !== "KEMBALIKAN") return { ok: false, code: "INVALID" };
  let hasil: Awaited<ReturnType<typeof periksaKlaimEkspedisi>>;
  try {
    hasil = await periksaKlaimEkspedisi({ shareId: input.shareId, hasil: input.hasil, catatan: input.catatan, olehUserId: s.userId });
  } catch (err) {
    console.error("periksaKlaimEkspedisi gagal:", err);
    return { ok: false, code: "GAGAL" };
  }
  if (!hasil.ok) return { ok: false, code: hasil.kode };
  // Uang klaim sudah terlihat di rekening: pemulihan beban (sesudah commit, tidak pernah melempar).
  if (hasil.dibayar) await kaitBarangHilang(hasil.lossId, s.userId);
  segarkan(hasil.lossId);
  return { ok: true, dibayar: hasil.dibayar };
}

/**
 * Nilai klaim ekspedisi diubah sesuai kesepakatan dengan ekspedisi selama masih
 * diajukan (alasan wajib). Bawaannya nilai jual di nota / surat jalan; mengubahnya
 * mengubah keputusan penanggung, jadi izinnya `receivables:decide_bearer`. Jurnal
 * catatannya diselaraskan sesudah commit, sama seperti "Ubah keputusan".
 */
export async function ubahNilaiKlaimEkspedisiAction(input: {
  shareId: string;
  nilai: number;
  catatan?: string | null;
}): Promise<{ ok: true } | Gagal> {
  const s = await sesi(bolehMemutuskanBeban);
  if ("ok" in s) return s;
  if (typeof input?.shareId !== "string" || !input.shareId) return { ok: false, code: "TIDAK_DITEMUKAN" };
  let hasil: Awaited<ReturnType<typeof ubahNilaiKlaimEkspedisi>>;
  try {
    hasil = await ubahNilaiKlaimEkspedisi({ shareId: input.shareId, nilai: input.nilai, catatan: input.catatan, olehUserId: s.userId });
  } catch (err) {
    console.error("ubahNilaiKlaimEkspedisi gagal:", err);
    return { ok: false, code: "GAGAL" };
  }
  if (!hasil.ok) return { ok: false, code: hasil.kode };
  await kaitBarangHilang(hasil.lossId, s.userId);
  segarkan(hasil.lossId);
  return { ok: true };
}

/** Bagian TOKO di toko putus sudah ditagih ke toko (di luar sistem). */
export async function tandaiTokoDitagihAction(input: { shareId: string; catatan?: string | null }): Promise<{ ok: true } | Gagal> {
  const s = await sesi();
  if ("ok" in s) return s;
  const r = await tandaiTokoDitagih({ shareId: input.shareId, catatan: input.catatan, olehUserId: s.userId });
  if (!r.ok) return { ok: false, code: r.kode };
  segarkan(r.lossId);
  return { ok: true };
}

/** Laporan komisi salesman: beban SALES sudah dipotong dari komisi bulan itu. */
export async function tandaiSalesDipotongAction(input: {
  salesmanId: string;
  bulan: string;
  jumlah: number;
  kunci: string;
  catatan?: string | null;
}): Promise<{ ok: true; dipotong: number } | Gagal> {
  const s = await sesi();
  if ("ok" in s) return s;
  if (typeof input.salesmanId !== "string" || !input.salesmanId) return { ok: false, code: "INVALID" };
  const r = await tandaiSalesDipotong({ ...input, olehUserId: s.userId });
  if (!r.ok) return { ok: false, code: r.kode };
  // Potongan beban SALES → pemulihan beban (kunci rujukan sama dengan penulisnya).
  await kaitPotongSales(`${input.salesmanId}:${input.bulan}:${String(input.kunci ?? "").trim()}`, s.userId);
  segarkan();
  revalidatePath("/backoffice/laporan/komisi-salesman");
  return { ok: true, dipotong: r.dipotong };
}
