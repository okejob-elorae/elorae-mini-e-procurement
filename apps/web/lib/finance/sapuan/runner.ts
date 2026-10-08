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
 */

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
  const hasil: HasilCariSumber[] = [];
  for (const s of pilihSumber(opsi)) {
    try {
      // Satu lebih dari batas: cukup untuk tahu ada yang terpotong tanpa menghitung semuanya.
      const dok = await s.cariTanpaJurnal({ sejak: opsi.sejak, sampai: opsi.sampai, batas: batas + 1 });
      hasil.push({
        sourceType: s.sourceType,
        label: s.label,
        dokumen: dok.slice(0, batas),
        terpotong: dok.length > batas,
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
  });

  const hasil: HasilSapuanSumber[] = [];
  for (const t of temuan) {
    const sumber = daftar.find((s) => s.sourceType === t.sourceType)!;
    const izinkan = opsi.cakupan ? new Set(opsi.cakupan[t.sourceType]) : null;
    const dok = izinkan ? t.dokumen.filter((d) => izinkan.has(d.id)) : t.dokumen;
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
