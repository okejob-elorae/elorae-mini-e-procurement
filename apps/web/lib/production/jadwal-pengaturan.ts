import { prisma, type Prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { hariIniWib } from "@/lib/tanggal-isian";
import {
  bacaHariKerjaProduksi,
  bacaTanggalMerah,
  kalenderKerja,
  KUNCI_HARI_KERJA_PRODUKSI,
  KUNCI_TANGGAL_MERAH,
  type KalenderKerja,
  type TanggalMerah,
} from "./hari-kerja";
import { ENTITAS_PENGATURAN, JEJAK_JADWAL, NAMA_LIBUR_MAKS } from "./jadwal-jejak";

/*
 * Pengaturan hari kerja produksi dan tanggal merah (2026-10-07) — server.
 *
 * Isinya JSON di SystemSetting (`produksi.hariKerja`, `produksi.tanggalMerah`),
 * dibaca lewat pembaca murni di `hari-kerja.ts`, jadi baris yang belum ada atau
 * rusak jatuh ke bawaan (Senin–Jumat, tanpa tanggal merah). Yang disimpan
 * selalu bentuk yang sudah dirapikan pembaca itu, jadi terbaca kembali persis.
 *
 * Mengubah kalender MENYUSUN ULANG tanggal target setiap tahap yang masih punya
 * langkah belum selesai, di transaksi yang sama: tanggal merah baru langsung
 * menggeser follow-up, bukan baru ketika tahapnya disentuh lagi.
 */

type PembacaPengaturan = { systemSetting: Pick<Prisma.TransactionClient["systemSetting"], "findMany"> };

export type IsiKalenderKerja = { kal: KalenderKerja; hariKerja: number[]; tanggalMerah: TanggalMerah[] };

/** Kalender kerja dari pengaturan — `db` boleh klien transaksi, supaya penulis membaca kalender yang sama dengan transaksinya. */
export async function bacaKalenderKerja(db: PembacaPengaturan = prisma): Promise<IsiKalenderKerja> {
  const baris = await db.systemSetting.findMany({
    where: { key: { in: [KUNCI_HARI_KERJA_PRODUKSI, KUNCI_TANGGAL_MERAH] } },
    select: { key: true, value: true },
  });
  const nilai = (kunci: string) => baris.find((b) => b.key === kunci)?.value ?? null;
  const hariKerja = bacaHariKerjaProduksi(nilai(KUNCI_HARI_KERJA_PRODUKSI));
  const tanggalMerah = bacaTanggalMerah(nilai(KUNCI_TANGGAL_MERAH));
  return { kal: kalenderKerja(hariKerja, tanggalMerah), hariKerja, tanggalMerah };
}

export function ambilKalenderKerja(): Promise<IsiKalenderKerja> {
  return bacaKalenderKerja(prisma);
}

type Tx = Prisma.TransactionClient;

/**
 * Susun ulang setiap tahap yang masih punya langkah belum selesai. Mengembalikan
 * banyaknya tahap. `cakupan` membatasi ke tahap tertentu — HANYA untuk tes,
 * supaya tes tidak menggeser jadwal sungguhan di basis data bersama.
 */
async function susunUlangTahapTerbuka(tx: Tx, kal: KalenderKerja, hariIni: string, cakupan?: string[]): Promise<number> {
  const { susunUlangTahap } = await import("./jadwal-writer");
  const tahap = await tx.planStageStep.findMany({
    where: { status: { not: "SELESAI" }, ...(cakupan ? { planStageId: { in: cakupan } } : {}) },
    select: { planStageId: true },
    distinct: ["planStageId"],
  });
  for (const t of tahap) await susunUlangTahap(tx, t.planStageId, kal, hariIni);
  return tahap.length;
}

export type HasilSimpanHariKerja = { ok: true; hariKerja: number[] } | { ok: false; code: "HARI_KERJA_TIDAK_SAH" };

/**
 * Ganti hari kerja produksi. Isian harus daftar bilangan bulat 0–6 (0 = Minggu)
 * dengan paling sedikit satu hari — daftar kosong DITOLAK, tidak diam-diam
 * menjadi bawaan.
 */
export async function simpanHariKerjaProduksi(masukan: {
  hariKerja: unknown;
  olehUserId: string;
  /** Hanya untuk tes: batasi penyusunan ulang ke tahap ini. */
  cakupanTahap?: string[];
}): Promise<HasilSimpanHariKerja> {
  const daftar = masukan.hariKerja;
  if (
    !Array.isArray(daftar) ||
    daftar.length === 0 ||
    !daftar.every((h) => typeof h === "number" && Number.isInteger(h) && h >= 0 && h <= 6)
  ) {
    return { ok: false, code: "HARI_KERJA_TIDAK_SAH" };
  }
  const hariKerja = bacaHariKerjaProduksi(daftar);
  const nilai = JSON.stringify({ hariKerja });
  const hariIni = hariIniWib();

  await runSerializable(async (tx) => {
    const lama = await bacaKalenderKerja(tx);
    await tx.systemSetting.upsert({
      where: { key: KUNCI_HARI_KERJA_PRODUKSI },
      create: { key: KUNCI_HARI_KERJA_PRODUKSI, value: nilai },
      update: { value: nilai },
    });
    const tahapDisusun = await susunUlangTahapTerbuka(
      tx,
      kalenderKerja(hariKerja, lama.tanggalMerah),
      hariIni,
      masukan.cakupanTahap,
    );
    await tx.auditLog.create({
      data: {
        userId: masukan.olehUserId,
        action: JEJAK_JADWAL.HARI_KERJA_DIUBAH,
        entityType: ENTITAS_PENGATURAN,
        entityId: KUNCI_HARI_KERJA_PRODUKSI,
        changes: { before: { hariKerja: lama.hariKerja }, after: { hariKerja } } as Prisma.InputJsonValue,
        metadata: { tahapDisusun } as Prisma.InputJsonValue,
      },
    });
  });
  return { ok: true, hariKerja };
}

export type HasilSimpanTanggalMerah =
  | { ok: true; tanggalMerah: TanggalMerah[] }
  | { ok: false; code: "TANGGAL_TIDAK_SAH" | "NAMA_TERLALU_PANJANG" | "ISIAN_TIDAK_SAH" };

/** Paling banyak sekian tanggal merah — sepuluh tahun libur nasional + cuti bersama masih jauh di bawahnya. */
const TANGGAL_MERAH_MAKS = 1000;

/**
 * Ganti SELURUH daftar tanggal merah. Setiap baris harus tanggal yang ada
 * ("YYYY-MM-DD", tahun 2000–2100); nama boleh kosong. Tanggal ganda: yang
 * pertama menang (sama dengan pembacanya).
 */
export async function simpanTanggalMerah(masukan: {
  daftar: unknown;
  olehUserId: string;
  /** Hanya untuk tes: batasi penyusunan ulang ke tahap ini. */
  cakupanTahap?: string[];
}): Promise<HasilSimpanTanggalMerah> {
  const daftar = masukan.daftar;
  if (!Array.isArray(daftar) || daftar.length > TANGGAL_MERAH_MAKS) return { ok: false, code: "ISIAN_TIDAK_SAH" };
  for (const baris of daftar) {
    if (!baris || typeof baris !== "object") return { ok: false, code: "ISIAN_TIDAK_SAH" };
    const { tanggal, nama } = baris as { tanggal?: unknown; nama?: unknown };
    if (bacaTanggalMerah([{ tanggal, nama: "" }]).length !== 1) return { ok: false, code: "TANGGAL_TIDAK_SAH" };
    const tahun = Number(String(tanggal).slice(0, 4));
    if (tahun < 2000 || tahun > 2100) return { ok: false, code: "TANGGAL_TIDAK_SAH" };
    if (nama !== undefined && nama !== null && typeof nama !== "string") return { ok: false, code: "ISIAN_TIDAK_SAH" };
    if (typeof nama === "string" && nama.trim().length > NAMA_LIBUR_MAKS) return { ok: false, code: "NAMA_TERLALU_PANJANG" };
  }
  const tanggalMerah = bacaTanggalMerah(
    daftar.map((b: { tanggal?: unknown; nama?: unknown }) => ({ tanggal: b.tanggal, nama: typeof b.nama === "string" ? b.nama : "" })),
  );
  const nilai = JSON.stringify(tanggalMerah);
  const hariIni = hariIniWib();

  await runSerializable(async (tx) => {
    const lama = await bacaKalenderKerja(tx);
    await tx.systemSetting.upsert({
      where: { key: KUNCI_TANGGAL_MERAH },
      create: { key: KUNCI_TANGGAL_MERAH, value: nilai },
      update: { value: nilai },
    });
    const tahapDisusun = await susunUlangTahapTerbuka(
      tx,
      kalenderKerja(lama.hariKerja, tanggalMerah),
      hariIni,
      masukan.cakupanTahap,
    );
    const sebelum = new Set(lama.tanggalMerah.map((t) => t.tanggal));
    const sesudah = new Set(tanggalMerah.map((t) => t.tanggal));
    await tx.auditLog.create({
      data: {
        userId: masukan.olehUserId,
        action: JEJAK_JADWAL.TANGGAL_MERAH_DIUBAH,
        entityType: ENTITAS_PENGATURAN,
        entityId: KUNCI_TANGGAL_MERAH,
        changes: { before: lama.tanggalMerah, after: tanggalMerah } as Prisma.InputJsonValue,
        metadata: {
          ditambah: [...sesudah].filter((t) => !sebelum.has(t)),
          dihapus: [...sebelum].filter((t) => !sesudah.has(t)),
          tahapDisusun,
        } as Prisma.InputJsonValue,
      },
    });
  });
  return { ok: true, tanggalMerah };
}
