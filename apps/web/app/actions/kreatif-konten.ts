"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { parseDateOnly } from "@/lib/date-only";
import {
  catatAngka,
  kirimDraf,
  mintaRevisi,
  setujuiDraf,
  simpanKontenKol,
  type KodeGagalKontenKol,
  type MajuTahap,
} from "@/lib/creative/konten-kol-writer";
import { riwayatAngka, type BarisAngka } from "@/lib/creative/konten-kol-queries";
import { hapusPenjualan, simpanPenjualan, type KodeGagalPenjualanTulis } from "@/lib/creative/penjualan-writer";
import type { FormatKonten, PlatformKol } from "@/lib/creative/konten-kol";

/*
 * Aksi Konten KOL & penjualan afiliasi (2026-10-07).
 *
 * Setiap ekspor berkas "use server" adalah endpoint yang bisa dipanggil
 * langsung, jadi izinnya diperiksa di SETIAP aksi dan pengguna diambil dari
 * sesi — tidak pernah dari klien. Kegagalan dikembalikan sebagai kode, tidak
 * dilempar (lemparan tersamar jadi digest di produksi).
 */

export type HasilAksiKontenKol =
  | { ok: true; id: string; maju: MajuTahap }
  | { ok: false; kode: KodeGagalKontenKol | "TANPA_AKSES" | "GAGAL" };

export type HasilAksiPenjualan = { ok: true; id: string } | { ok: false; kode: KodeGagalPenjualanTulis | "TANPA_AKSES" | "GAGAL" };

async function penulis(): Promise<string | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return hasPermission(session.user.permissions ?? [], PERMISSIONS.CREATIVE_MANAGE) ? session.user.id : null;
}

async function pembaca(): Promise<boolean> {
  const session = await auth();
  if (!session?.user?.id) return false;
  return hasPermission(session.user.permissions ?? [], PERMISSIONS.CREATIVE_VIEW);
}

function segarkan() {
  revalidatePath("/backoffice/kreatif", "layout");
}

/** "YYYY-MM-DD" = tengah malam WIB; ISO lengkap apa adanya; undefined tetap undefined. */
function tanggal(v: string | null | undefined): Date | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? parseDateOnly(v) : new Date(v);
  return d && !Number.isNaN(d.getTime()) ? d : new Date(Number.NaN);
}

const teks = (v: unknown, maks = 2000): string | null | undefined =>
  v === undefined ? undefined : v === null ? null : typeof v === "string" ? v.slice(0, maks) : null;

const angka = (v: unknown): number | undefined => (v === undefined || v === null ? undefined : typeof v === "number" ? v : Number.NaN);

async function jalankan(nama: string, fn: () => Promise<{ ok: true; id: string; maju: MajuTahap } | { ok: false; kode: KodeGagalKontenKol }>): Promise<HasilAksiKontenKol> {
  try {
    const r = await fn();
    if (!r.ok) return { ok: false, kode: r.kode };
    segarkan();
    return { ok: true, id: r.id, maju: r.maju };
  } catch (err) {
    console.error(`${nama} gagal:`, err);
    return { ok: false, kode: "GAGAL" };
  }
}

export type IsianKontenKolAksi = {
  id?: string | null;
  kolaborasiId: string;
  platform?: PlatformKol;
  format?: FormatKonten;
  link?: string | null;
  /** Tanggal sebagai teks "YYYY-MM-DD" (WIB) atau ISO. */
  liveAt?: string | null;
  plannedAt?: string | null;
  draftLink?: string | null;
  adCode?: string | null;
  adCodeUntil?: string | null;
};

/** Buat/ubah konten KOL. Kolom yang tidak dikirim tidak diubah. */
export async function simpanKontenKolAction(isi: IsianKontenKolAksi): Promise<HasilAksiKontenKol> {
  const oleh = await penulis();
  if (!oleh) return { ok: false, kode: "TANPA_AKSES" };
  if (typeof isi?.kolaborasiId !== "string" || !isi.kolaborasiId) return { ok: false, kode: "KOLABORASI_TIDAK_DITEMUKAN" };
  return jalankan("simpanKontenKol", () =>
    simpanKontenKol({
      id: typeof isi.id === "string" ? isi.id : null,
      kolaborasiId: isi.kolaborasiId,
      platform: isi.platform,
      format: isi.format,
      link: teks(isi.link),
      liveAt: tanggal(isi.liveAt),
      plannedAt: tanggal(isi.plannedAt),
      draftLink: teks(isi.draftLink),
      adCode: teks(isi.adCode, 191),
      adCodeUntil: tanggal(isi.adCodeUntil),
      olehUserId: oleh,
    }),
  );
}

/** Catat draf masuk (link draf). Tanpa `kontenId` dibuat konten baru. */
export async function kirimDrafAction(isi: {
  kontenId?: string | null;
  kolaborasiId: string;
  draftLink: string;
  plannedAt?: string | null;
}): Promise<HasilAksiKontenKol> {
  const oleh = await penulis();
  if (!oleh) return { ok: false, kode: "TANPA_AKSES" };
  if (typeof isi?.kolaborasiId !== "string" || !isi.kolaborasiId) return { ok: false, kode: "KOLABORASI_TIDAK_DITEMUKAN" };
  return jalankan("kirimDraf", () =>
    kirimDraf({
      kontenId: typeof isi.kontenId === "string" ? isi.kontenId : null,
      kolaborasiId: isi.kolaborasiId,
      draftLink: typeof isi.draftLink === "string" ? isi.draftLink : "",
      plannedAt: tanggal(isi.plannedAt),
      olehUserId: oleh,
    }),
  );
}

export async function setujuiDrafAction(kontenId: string): Promise<HasilAksiKontenKol> {
  const oleh = await penulis();
  if (!oleh) return { ok: false, kode: "TANPA_AKSES" };
  return jalankan("setujuiDraf", () => setujuiDraf({ kontenId: String(kontenId ?? ""), olehUserId: oleh }));
}

export async function mintaRevisiAction(kontenId: string, catatan: string): Promise<HasilAksiKontenKol> {
  const oleh = await penulis();
  if (!oleh) return { ok: false, kode: "TANPA_AKSES" };
  return jalankan("mintaRevisi", () =>
    mintaRevisi({ kontenId: String(kontenId ?? ""), catatan: typeof catatan === "string" ? catatan : "", olehUserId: oleh }),
  );
}

/** Catat angka konten — selalu baris baru. Angka dikirim sebagai bilangan (dibaca `bacaAngka` di klien). */
export async function catatAngkaAction(isi: {
  kontenId: string;
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  /** "YYYY-MM-DD"; kosong = sekarang. */
  recordedAt?: string | null;
  source?: string | null;
  note?: string | null;
}): Promise<HasilAksiKontenKol> {
  const oleh = await penulis();
  if (!oleh) return { ok: false, kode: "TANPA_AKSES" };
  return jalankan("catatAngka", async () => {
    // Tanggal tanpa jam = hari itu; dicatat pukul 12.00 WIB supaya tidak
    // jatuh ke hari sebelumnya di zona mana pun, dan tidak di masa depan
    // bila hari itu hari ini.
    let waktu: Date | null = null;
    if (typeof isi.recordedAt === "string" && isi.recordedAt) {
      const awal = tanggal(isi.recordedAt);
      if (!awal || Number.isNaN(awal.getTime())) return { ok: false as const, kode: "TANGGAL_TIDAK_SAH" as const };
      const tengah = new Date(awal.getTime() + 12 * 3_600_000);
      waktu = tengah.getTime() > Date.now() ? new Date() : tengah;
    }
    return catatAngka({
      kontenId: String(isi?.kontenId ?? ""),
      views: angka(isi.views),
      likes: angka(isi.likes),
      comments: angka(isi.comments),
      shares: angka(isi.shares),
      saves: angka(isi.saves),
      recordedAt: waktu,
      source: teks(isi.source, 191),
      note: teks(isi.note),
      olehUserId: oleh,
    });
  });
}

/** Riwayat angka satu konten (popover "Riwayat"). */
export async function riwayatAngkaAction(kontenId: string): Promise<{ ok: true; baris: BarisAngka[] } | { ok: false; kode: "TANPA_AKSES" | "GAGAL" }> {
  if (!(await pembaca())) return { ok: false, kode: "TANPA_AKSES" };
  try {
    return { ok: true, baris: await riwayatAngka(String(kontenId ?? "")) };
  } catch (err) {
    console.error("riwayatAngka gagal:", err);
    return { ok: false, kode: "GAGAL" };
  }
}

/* ──────────────────────────── Penjualan ──────────────────────────── */

export async function simpanPenjualanAction(isi: {
  id?: string | null;
  kolaborasiId: string;
  /** "YYYY-MM-DD" (WIB). */
  date?: string | null;
  orders?: number;
  gmv?: number;
  commission?: number;
  source?: string | null;
  note?: string | null;
}): Promise<HasilAksiPenjualan> {
  const oleh = await penulis();
  if (!oleh) return { ok: false, kode: "TANPA_AKSES" };
  if (typeof isi?.kolaborasiId !== "string" || !isi.kolaborasiId) return { ok: false, kode: "KOLABORASI_TIDAK_DITEMUKAN" };
  try {
    const r = await simpanPenjualan({
      id: typeof isi.id === "string" ? isi.id : null,
      kolaborasiId: isi.kolaborasiId,
      date: tanggal(isi.date),
      orders: angka(isi.orders),
      gmv: angka(isi.gmv),
      commission: angka(isi.commission),
      source: teks(isi.source, 191),
      note: teks(isi.note),
      olehUserId: oleh,
    });
    if (!r.ok) return { ok: false, kode: r.kode };
    segarkan();
    return { ok: true, id: r.id };
  } catch (err) {
    console.error("simpanPenjualan gagal:", err);
    return { ok: false, kode: "GAGAL" };
  }
}

export async function hapusPenjualanAction(id: string): Promise<HasilAksiPenjualan> {
  const oleh = await penulis();
  if (!oleh) return { ok: false, kode: "TANPA_AKSES" };
  try {
    const r = await hapusPenjualan({ id: String(id ?? ""), olehUserId: oleh });
    if (!r.ok) return { ok: false, kode: r.kode };
    segarkan();
    return { ok: true, id: r.id };
  } catch (err) {
    console.error("hapusPenjualan gagal:", err);
    return { ok: false, kode: "GAGAL" };
  }
}
