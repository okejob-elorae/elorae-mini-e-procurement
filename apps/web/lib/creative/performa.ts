/**
 * Kreatif → Performa video — bagian murni, aman untuk komponen klien.
 *
 * Satu baris per video TikTok yang dipantau (KOL dan afiliasi): angka terbaru,
 * ER (rumus tunggal `engagementRate` di `angka-konten.ts`), kenaikan views
 * sejak bacaan sebelumnya, dan status ceknya. Saringan, urutan, dan halaman
 * tinggal di alamat (`?cari=&jenis=&dari=&sampai=&urut=&halaman=`), jadi
 * tautannya bisa dibagikan. Kueri di `performa-queries.ts` (server; klien
 * hanya `import type`); penulis "Tempel link" di `tempel-link-writer.ts`.
 *
 * "Afiliasi" = video yang tercatat di kolaborasi berjenis KOMISI; selain itu
 * "KOL" (keputusan sementara, ingatkan pemilik).
 */

import { bacaTanggal, urutkanRentang } from "@/lib/tanggal-isian";

export const RUTE_PERFORMA = "/backoffice/kreatif/performa";
export const PER_HALAMAN_PERFORMA = 50;

export const JENIS_SARING_PERFORMA = ["semua", "kol", "afiliasi"] as const;
export type JenisSaringPerforma = (typeof JENIS_SARING_PERFORMA)[number];

/** Urutan daftar; semuanya dari yang terbesar/terbaru. */
export const URUTAN_PERFORMA = ["views", "naik", "er", "tayang", "dicek"] as const;
export type UrutanPerforma = (typeof URUTAN_PERFORMA)[number];

export type ParamPerforma = {
  cari: string;
  jenis: JenisSaringPerforma;
  /** Rentang tanggal tayang, hari WIB "YYYY-MM-DD"; null = terbuka. */
  dari: string | null;
  sampai: string | null;
  urut: UrutanPerforma;
  halaman: number;
};

type IsiAlamat = Record<string, string | string[] | undefined>;
const satu = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
const tanggal = (v: string | undefined): string | null => (v && bacaTanggal(v) ? v : null);
const salahSatu = <T extends string>(daftar: readonly T[], v: string | undefined, bawaan: T): T =>
  (daftar as readonly string[]).includes(v ?? "") ? (v as T) : bawaan;

export function bacaParamPerforma(sp: IsiAlamat): ParamPerforma {
  const cari = (satu(sp.cari) ?? "").trim().slice(0, 100);
  const jenis = salahSatu(JENIS_SARING_PERFORMA, satu(sp.jenis), "semua");
  const urut = salahSatu(URUTAN_PERFORMA, satu(sp.urut), "views");
  let dari = tanggal(satu(sp.dari));
  let sampai = tanggal(satu(sp.sampai));
  if (dari && sampai) ({ dari, sampai } = urutkanRentang(dari, sampai));
  const h = Number(satu(sp.halaman));
  const halaman = Number.isInteger(h) && h >= 1 && h <= 100_000 ? h : 1;
  return { cari, jenis, dari, sampai, urut, halaman };
}

/** Alamat untuk keadaan `p`; nilai bawaan tidak ditulis supaya alamatnya pendek. */
export function alamatPerforma(p: ParamPerforma): string {
  const q = new URLSearchParams();
  if (p.cari) q.set("cari", p.cari);
  if (p.jenis !== "semua") q.set("jenis", p.jenis);
  if (p.dari) q.set("dari", p.dari);
  if (p.sampai) q.set("sampai", p.sampai);
  if (p.urut !== "views") q.set("urut", p.urut);
  if (p.halaman > 1) q.set("halaman", String(p.halaman));
  const qs = q.toString();
  return qs ? `${RUTE_PERFORMA}?${qs}` : RUTE_PERFORMA;
}

/** Pola `LIKE` abai huruf (dibandingkan dengan `LOWER(kolom)`): %, _ dan \ dilepas dari artinya. */
export function polaCari(cari: string): string | null {
  const t = cari.trim().toLowerCase();
  if (!t) return null;
  return `%${t.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/* ─────────────────────────── Status cek ─────────────────────────── */

export type StatusVideo = "MENUNGGU" | "TERBACA" | "GAGAL" | "BELUM";

type TugasRingkas = { status: string; galatTerakhir: string | null; selesaiAt: Date | string | null };

const waktu = (d: Date | string | null): number => (d ? new Date(d).getTime() : Number.NEGATIVE_INFINITY);

/**
 * Status cek sebuah video dari tugas-tugas pantaunya dan bacaan terakhirnya:
 * tugas terbuka → MENUNGGU; cek terakhir yang selesai GAGAL dan tidak disusul
 * bacaan → GAGAL (alasan = `galatTerakhir`); ada bacaan → TERBACA (termasuk
 * angka yang diisi tangan); selain itu BELUM. Tugas DILEWATI diabaikan.
 */
export function statusVideo(i: { tugas: readonly TugasRingkas[]; dicekAt: Date | string | null }): { status: StatusVideo; alasan: string | null } {
  if (i.tugas.some((t) => t.status === "ANTRE" || t.status === "DIPINJAM")) return { status: "MENUNGGU", alasan: null };
  const selesai = i.tugas
    .filter((t) => t.status === "SELESAI" || t.status === "GAGAL")
    .sort((a, b) => waktu(b.selesaiAt) - waktu(a.selesaiAt))[0];
  if (selesai?.status === "GAGAL" && waktu(selesai.selesaiAt) > waktu(i.dicekAt)) return { status: "GAGAL", alasan: selesai.galatTerakhir };
  if (i.dicekAt) return { status: "TERBACA", alasan: null };
  if (selesai?.status === "GAGAL") return { status: "GAGAL", alasan: selesai.galatTerakhir };
  return { status: "BELUM", alasan: null };
}
