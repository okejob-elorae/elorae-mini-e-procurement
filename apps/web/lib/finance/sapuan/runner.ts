import { prisma } from "@elorae/db";
import { readGlCutover } from "@/lib/finance/sales/sweep";
import type { DokumenTanpaJurnal, SumberSapuan } from "./registri";
import { sumberSapuanTerdaftar } from "./semua";

/*
 * Runner sapuan dokumen tanpa jurnal (bagian A1, prinsip 2). Menanyai setiap
 * sumber terdaftar "dokumen mana yang seharusnya berjurnal tetapi belum",
 * lalu (bila diminta) memanggil `posting`-nya satu per satu.
 *
 * LANTAI TANGGAL MULAI. Dokumen sebelum tanggal mulai buku besar
 * (`finance.glCutoverDate`) dibukukan di luar sistem dan TIDAK PERNAH disapu —
 * runner memotong `sejak` ke tanggal itu untuk setiap sumber, jadi sumber yang
 * lupa menyaringnya tetap aman. Tanpa tanggal mulai, runner tidak menyapu apa
 * pun (`TANPA_TANGGAL_MULAI`), sama dengan sapuan penjualan marketplace.
 *
 * Satu sumber yang gagal (kuerinya melempar) tidak menghentikan yang lain:
 * galatnya dicatat di hasil sumber itu.
 *
 * DOKUMEN NIHIL. Pencari seharusnya tidak pernah mengembalikan dokumen yang
 * postingnya `NOTHING_TO_POST` (lihat `./registri.ts`), tetapi pencari yang
 * terlalu longgar membuat dokumen itu tampil selamanya sebagai "tanpa jurnal"
 * dan menahan tutup buku bulannya (tukar barang bernilai seimbang, uji
 * akuntansi gelombang 2). Jaring pengamannya: setiap kali sapuan mendapat
 * `NOTHING_TO_POST`, dokumen itu ditandai (`JEJAK_SAPUAN_NIHIL` di `AuditLog`,
 * sekali per dokumen), dan pemeriksaan (daftar periksa tutup buku, halaman
 * Integritas) memanggil `cariSemuaTanpaJurnal({ abaikanNihil: true })`, yang
 * melewati dokumen bertanda — KECUALI dokumen itu punya `JOURNAL_PENDING`
 * yang belum selesai (kegagalan sungguhan tetap tampil). Sapuan sendiri tidak
 * melewatinya: setiap putaran mencoba lagi, jadi dokumen yang berubah menjadi
 * bernilai tetap terjurnal.
 */

/** Nama tindakan `AuditLog` penanda "sapuan mendapat NOTHING_TO_POST untuk dokumen ini" (entityType = sourceType). */
export const JEJAK_SAPUAN_NIHIL = "JOURNAL_SWEEP_NOTHING_TO_POST";

export type HasilCariSumber = {
  sourceType: string;
  label: string;
  dokumen: DokumenTanpaJurnal[];
  /** Ada lebih banyak dokumen dari `batasPerSumber`. */
  terpotong: boolean;
  galat: string | null;
};

export type OpsiCariSemua = {
  sejak: Date;
  sampai: Date;
  batasPerSumber: number;
  /** Hanya sumber ber-sourceType ini (bawaan semua terdaftar). */
  jenis?: readonly string[];
  /** Sumber yang dipakai — bawaan registri (`sumberSapuanTerdaftar`). Tes menyuntikkan sumbernya sendiri. */
  sumber?: readonly SumberSapuan[];
  /**
   * Hanya dokumen ber-id ini per sourceType — diteruskan ke pencari sebagai
   * `ids` (diterapkan SEBELUM batas). Sumber tanpa entri tidak disaring id.
   */
  cakupan?: Readonly<Record<string, readonly string[]>>;
  /** Lewati dokumen bertanda nihil yang tidak punya `JOURNAL_PENDING` terbuka (pemeriksaan, bukan sapuan). */
  abaikanNihil?: boolean;
  /** Tes: pembaca tanda nihil. Bawaan `bacaTandaNihil` (basis data). */
  bacaNihil?: (sourceType: string, ids: readonly string[]) => Promise<Set<string>>;
};

function pilihSumber(opsi: { jenis?: readonly string[]; sumber?: readonly SumberSapuan[] }): readonly SumberSapuan[] {
  const semua = opsi.sumber ?? sumberSapuanTerdaftar();
  return opsi.jenis ? semua.filter((s) => opsi.jenis!.includes(s.sourceType)) : semua;
}

/**
 * Dokumen tanpa jurnal per sumber dalam rentang tanggal dokumen. TIDAK
 * menerapkan lantai tanggal mulai — pemanggil memberi `sejak` yang sudah
 * dipotong (`rentangSapuan`).
 */
export async function cariSemuaTanpaJurnal(opsi: OpsiCariSemua): Promise<HasilCariSumber[]> {
  const batas = Math.max(1, Math.floor(opsi.batasPerSumber));
  const bacaNihil = opsi.bacaNihil ?? bacaTandaNihil;
  const hasil: HasilCariSumber[] = [];
  for (const s of pilihSumber(opsi)) {
    try {
      const ids = opsi.cakupan?.[s.sourceType];
      // Satu lebih dari batas: cukup untuk tahu ada yang terpotong tanpa menghitung semuanya.
      let dok = await s.cariTanpaJurnal({ sejak: opsi.sejak, sampai: opsi.sampai, batas: batas + 1, ...(ids ? { ids } : {}) });
      const terpotong = dok.length > batas;
      // Pengaman bagi pencari yang lupa menerapkan `ids` di kuerinya.
      if (ids) {
        const izinkan = new Set(ids);
        dok = dok.filter((d) => izinkan.has(d.id));
      }
      if (opsi.abaikanNihil && dok.length > 0) {
        const nihil = await bacaNihil(s.sourceType, dok.map((d) => d.id));
        if (nihil.size > 0) dok = dok.filter((d) => !nihil.has(d.id));
      }
      hasil.push({
        sourceType: s.sourceType,
        label: s.label,
        dokumen: dok.slice(0, batas),
        // Dokumen nihil yang dilewati tidak menghapus tanda terpotong: di luar batas mungkin masih ada yang sungguhan.
        terpotong,
        galat: null,
      });
    } catch (e) {
      console.error(`[sapuan] pencari ${s.sourceType} gagal`, e);
      hasil.push({
        sourceType: s.sourceType,
        label: s.label,
        dokumen: [],
        terpotong: false,
        galat: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return hasil;
}

/**
 * Dokumen (dari `ids`) yang bertanda nihil (`JEJAK_SAPUAN_NIHIL`) dan TIDAK
 * punya `JOURNAL_PENDING` yang belum selesai.
 */
export async function bacaTandaNihil(sourceType: string, ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const tanda = await prisma.auditLog.findMany({
    where: { action: JEJAK_SAPUAN_NIHIL, entityType: sourceType, entityId: { in: [...ids] } },
    select: { entityId: true },
  });
  if (tanda.length === 0) return new Set();
  // Impor malas: modul notifikasi (dan inisialisasinya) hanya dimuat bila ada dokumen bertanda.
  const { daftarJurnalTertunda } = await import("@/lib/finance/jurnal-tertunda");
  const gagal = new Set(
    (await daftarJurnalTertunda()).flatMap((t) => (t.sumber?.tipe === "dokumen" && t.sumber.sourceType === sourceType ? [t.sumber.sourceId] : [])),
  );
  return new Set(tanda.map((t) => t.entityId).filter((id) => !gagal.has(id)));
}

/** Tandai dokumen nihil (sekali per dokumen). Tidak pernah melempar: tanda hanya penyaring pemeriksaan. */
export async function catatTandaNihil(sourceType: string, d: DokumenTanpaJurnal, olehUserId: string): Promise<void> {
  try {
    const ada = await prisma.auditLog.findFirst({
      where: { action: JEJAK_SAPUAN_NIHIL, entityType: sourceType, entityId: d.id },
      select: { id: true },
    });
    if (ada) return;
    await prisma.auditLog.create({
      data: {
        userId: olehUserId,
        action: JEJAK_SAPUAN_NIHIL,
        entityType: sourceType,
        entityId: d.id,
        metadata: { label: d.label, tanggal: d.tanggal.toISOString() },
      },
    });
  } catch (e) {
    console.error(`[sapuan] tanda nihil ${sourceType} ${d.id} gagal ditulis`, e);
  }
}

/**
 * Rentang sapuan yang sah: `sejak` tidak pernah sebelum tanggal mulai buku
 * besar. null = tanggal mulai belum ditetapkan, atau rentangnya kosong
 * seluruhnya sebelum tanggal mulai.
 */
export async function rentangSapuan(opsi: {
  sejak?: Date;
  sampai: Date;
  tanggalMulai?: Date | null;
}): Promise<{ sejak: Date; sampai: Date } | null> {
  const lantai = opsi.tanggalMulai !== undefined ? opsi.tanggalMulai : await readGlCutover();
  if (!lantai) return null;
  const sejak = opsi.sejak && opsi.sejak.getTime() > lantai.getTime() ? opsi.sejak : lantai;
  if (sejak.getTime() > opsi.sampai.getTime()) return null;
  return { sejak, sampai: opsi.sampai };
}

export type HasilSapuanSumber = {
  sourceType: string;
  label: string;
  ditemukan: number;
  /** Jurnal baru yang berdiri. */
  diposting: number;
  /** Jurnalnya ternyata sudah ada (balapan dengan penulis lain) — tidak dihitung gagal. */
  sudahAda: number;
  /** Tidak ada yang perlu diposting (nilai nol) — pencari sumber ini terlalu longgar. */
  nihil: number;
  gagal: Array<{ id: string; label: string; kode: string }>;
  terpotong: boolean;
  galat: string | null;
};

export type RingkasanSapuan =
  | { dilewati: "TANPA_TANGGAL_MULAI" | "TANPA_PENGGUNA"; sumber: [] }
  | { dilewati: null; sejak: Date; sampai: Date; sumber: HasilSapuanSumber[] };

export type OpsiSapuan = {
  /** Bawaan: tanggal mulai buku besar. Selalu dipotong ke tanggal mulai. */
  sejak?: Date;
  /** Bawaan: sekarang. */
  sampai?: Date;
  /** Bawaan 200 per sumber per putaran. */
  batasPerSumber?: number;
  /** Pengguna pencatat jurnal; bawaan admin pertama (seperti sapuan penjualan). */
  olehUserId?: string;
  jenis?: readonly string[];
  /**
   * Cakupan: hanya dokumen ber-id ini per sourceType (tes di basis data
   * bersama, posting ulang terarah). Sumber yang tidak ada di cakupan dilewati.
   */
  cakupan?: Readonly<Record<string, readonly string[]>>;
  sumber?: readonly SumberSapuan[];
  /** Tes: lantai tanggal mulai tanpa membaca pengaturan. */
  tanggalMulai?: Date | null;
  /** Tes: penulis tanda nihil. Bawaan `catatTandaNihil` (basis data). */
  catatNihil?: (sourceType: string, d: DokumenTanpaJurnal, olehUserId: string) => Promise<void>;
};

async function penggunaSistem(olehUserId?: string): Promise<string | null> {
  if (olehUserId) return olehUserId;
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" }, orderBy: { createdAt: "asc" }, select: { id: true } });
  return admin?.id ?? null;
}

/**
 * Menyapu dan memposting dokumen tanpa jurnal. Idempoten: `posting` setiap
 * sumber lewat `generateAutoJournal`, jadi dokumen yang sudah berjurnal
 * (balapan dengan penulisnya) hanya terhitung `sudahAda`. Dokumen di bulan
 * yang sudah ditutup ikut diposting — jurnalnya digeser ke bulan terbuka
 * berikutnya oleh `postJournal`.
 */
export async function jalankanSapuan(opsi: OpsiSapuan = {}): Promise<RingkasanSapuan> {
  const rentang = await rentangSapuan({
    sejak: opsi.sejak,
    sampai: opsi.sampai ?? new Date(),
    tanggalMulai: opsi.tanggalMulai,
  });
  if (!rentang) return { dilewati: "TANPA_TANGGAL_MULAI", sumber: [] };
  const poster = await penggunaSistem(opsi.olehUserId);
  if (!poster) return { dilewati: "TANPA_PENGGUNA", sumber: [] };

  let daftar = pilihSumber(opsi);
  if (opsi.cakupan) daftar = daftar.filter((s) => opsi.cakupan![s.sourceType] !== undefined);

  const temuan = await cariSemuaTanpaJurnal({
    sejak: rentang.sejak,
    sampai: rentang.sampai,
    batasPerSumber: opsi.batasPerSumber ?? 200,
    sumber: daftar,
    ...(opsi.cakupan ? { cakupan: opsi.cakupan } : {}),
  });
  const catatNihil = opsi.catatNihil ?? catatTandaNihil;

  const hasil: HasilSapuanSumber[] = [];
  for (const t of temuan) {
    const sumber = daftar.find((s) => s.sourceType === t.sourceType)!;
    // Cakupan sudah diterapkan pencari (`ids`) dan disaring ulang oleh `cariSemuaTanpaJurnal`.
    const dok = t.dokumen;
    const r: HasilSapuanSumber = {
      sourceType: t.sourceType,
      label: t.label,
      ditemukan: dok.length,
      diposting: 0,
      sudahAda: 0,
      nihil: 0,
      gagal: [],
      terpotong: t.terpotong,
      galat: t.galat,
    };
    for (const d of dok) {
      try {
        const p = await sumber.posting(d.id, poster);
        if (p.ok) {
          if (p.created) r.diposting += 1;
          else r.sudahAda += 1;
        } else if (p.code === "NOTHING_TO_POST") {
          r.nihil += 1;
          await catatNihil(t.sourceType, d, poster);
        } else {
          r.gagal.push({ id: d.id, label: d.label, kode: p.code });
        }
      } catch (e) {
        console.error(`[sapuan] posting ${t.sourceType} ${d.id} gagal`, e);
        r.gagal.push({ id: d.id, label: d.label, kode: "ERROR" });
      }
    }
    hasil.push(r);
  }
  return { dilewati: null, sejak: rentang.sejak, sampai: rentang.sampai, sumber: hasil };
}

/** Satu baris log cron: hanya sumber yang menemukan sesuatu. */
export function ringkasLogSapuan(r: RingkasanSapuan): string {
  if (r.dilewati) return `dilewati (${r.dilewati})`;
  const isi = r.sumber
    .filter((s) => s.ditemukan > 0 || s.galat)
    .map((s) => `${s.sourceType}: ${s.diposting} diposting, ${s.gagal.length} gagal${s.galat ? `, galat ${s.galat}` : ""}${s.terpotong ? " (terpotong)" : ""}`);
  return isi.length ? isi.join("; ") : "tidak ada dokumen tanpa jurnal";
}
