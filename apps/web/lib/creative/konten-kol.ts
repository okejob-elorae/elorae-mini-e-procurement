/**
 * Konten KOL — bagian murni, aman untuk komponen klien (tanpa Prisma).
 *
 * Layar Konten KOL (`/backoffice/kreatif/konten-kol`) dan panel Konten di
 * rincian kolaborasi memakai berkas ini untuk: menebak platform dari link
 * yang ditempel, membaca/menulis alamat halaman (chip, cari, campaign,
 * halaman, bulan), peringatan angka H+1/H+3/H+7, dan kisi Jadwal tayang.
 *
 * Penulis dan kueri ada di `konten-kol-writer.ts` / `konten-kol-queries.ts`
 * (server; klien hanya `import type`).
 */

import { bacaTanggal, geserHari } from "@/lib/tanggal-isian";
import { AMBANG_BAWAAN, type AmbangKreatif } from "./ambang";
import { tenggatKolaborasi, type JenisTenggat } from "./tenggat";
import type { StatusDraf, Tahap } from "./tahap";

export type PlatformKol = "INSTAGRAM" | "TIKTOK" | "YOUTUBE" | "SHOPEE" | "LAINNYA";
export type FormatKonten = "FEED" | "REELS" | "STORY" | "VIDEO" | "LIVE" | "CAROUSEL";

export const SEMUA_PLATFORM_KONTEN: readonly PlatformKol[] = ["INSTAGRAM", "TIKTOK", "YOUTUBE", "SHOPEE", "LAINNYA"];
export const SEMUA_FORMAT_KONTEN: readonly FormatKonten[] = ["FEED", "REELS", "STORY", "VIDEO", "LIVE", "CAROUSEL"];

export function platformSah(v: unknown): v is PlatformKol {
  return typeof v === "string" && (SEMUA_PLATFORM_KONTEN as readonly string[]).includes(v);
}

export function formatSah(v: unknown): v is FormatKonten {
  return typeof v === "string" && (SEMUA_FORMAT_KONTEN as readonly string[]).includes(v);
}

/** Format yang paling lazim per platform — dipakai bila tidak ada deliverable yang menyebutnya. */
export const FORMAT_BAWAAN: Record<PlatformKol, FormatKonten> = {
  INSTAGRAM: "REELS",
  TIKTOK: "VIDEO",
  YOUTUBE: "VIDEO",
  SHOPEE: "VIDEO",
  LAINNYA: "VIDEO",
};

/** Panjang link paling panjang yang diterima. */
export const MAKS_PANJANG_LINK = 2000;

/**
 * Link yang ditempel orang → link yang disimpan, atau `null` bila bukan link.
 *
 * Link sering ditempel tanpa "https://" ("tiktok.com/@x/video/1"), jadi yang
 * tanpa skema tapi berbentuk nama situs diberi "https://". Teks bebas ("sudah
 * tayang kak") ditolak: yang disimpan di kolom link harus bisa dibuka.
 */
export function sahLink(teks: string | null | undefined): string | null {
  const t = (teks ?? "").trim();
  if (!t || t.length > MAKS_PANJANG_LINK || /\s/.test(t)) return null;
  const denganSkema = /^https?:\/\//i.test(t) ? t : /^[a-z0-9-]+(\.[a-z0-9-]+)+([/?#:].*)?$/i.test(t) ? `https://${t}` : null;
  if (!denganSkema) return null;
  try {
    const u = new URL(denganSkema);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname.includes(".")) return null;
    return denganSkema;
  } catch {
    return null;
  }
}

/** Platform dari link, atau `null` bila situsnya tidak dikenal. */
export function platformDariLink(link: string | null | undefined): PlatformKol | null {
  const sah = sahLink(link);
  if (!sah) return null;
  const host = new URL(sah).hostname.toLowerCase().replace(/^www\./, "");
  const cocok = (domain: string) => host === domain || host.endsWith(`.${domain}`);
  if (cocok("tiktok.com")) return "TIKTOK";
  if (cocok("instagram.com") || cocok("instagr.am")) return "INSTAGRAM";
  if (cocok("youtube.com") || cocok("youtu.be")) return "YOUTUBE";
  if (cocok("shopee.co.id") || cocok("shopee.com") || cocok("shp.ee")) return "SHOPEE";
  return null;
}

/**
 * Platform dan format untuk konten baru yang dibuat dari link yang ditempel.
 *
 * Urutan: situs link-nya → deliverable kolaborasi → akun KOL → LAINNYA.
 * Formatnya dari deliverable dengan platform yang sama, atau format lazim
 * platform itu. Tebakan, bukan keputusan: bisa diubah di rincian kolaborasi.
 */
export function tebakPlatformFormat(input: {
  link?: string | null;
  deliverables?: readonly { platform: string; format: string }[];
  akun?: readonly { platform: string }[];
}): { platform: PlatformKol; format: FormatKonten } {
  const dl = (input.deliverables ?? []).filter((d) => platformSah(d.platform) && formatSah(d.format)) as {
    platform: PlatformKol;
    format: FormatKonten;
  }[];
  const akun = (input.akun ?? []).map((a) => a.platform).filter(platformSah);
  const platform = platformDariLink(input.link) ?? dl[0]?.platform ?? akun[0] ?? "LAINNYA";
  const format = dl.find((d) => d.platform === platform)?.format ?? FORMAT_BAWAAN[platform];
  return { platform, format };
}

/* ──────────────────────────── Alamat halaman ──────────────────────────── */

export const RUTE_KONTEN_KOL = "/backoffice/kreatif/konten-kol";

/** Chip layar Konten KOL, berurutan seperti di layar. */
export const CHIP_KONTEN_KOL = ["menunggu", "draf", "disetujui", "tayang", "jadwal"] as const;
export type ChipKontenKol = (typeof CHIP_KONTEN_KOL)[number];
/** Chip berupa daftar (punya angka); "jadwal" berupa kalender. */
export type ChipDaftarKontenKol = Exclude<ChipKontenKol, "jadwal">;
export const CHIP_DAFTAR_KONTEN_KOL: readonly ChipDaftarKontenKol[] = ["menunggu", "draf", "disetujui", "tayang"];

export const PER_HALAMAN_KONTEN_KOL = 25;

export type ParamKontenKol = {
  chip: ChipKontenKol;
  cari: string;
  /** `?campaign=<id>`; null = semua campaign. */
  campaign: string | null;
  /** `?kolaborasi=<id>` — hanya baris satu kolaborasi (tautan dari Hari ini); null = semua. */
  kolaborasi: string | null;
  halaman: number;
  /** "YYYY-MM" — bulan Jadwal tayang. */
  bulan: string;
};

type IsiAlamat = Record<string, string | string[] | undefined>;
const satu = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
const POLA_BULAN = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function bulanSah(teks: string | null | undefined): boolean {
  const m = POLA_BULAN.exec(teks ?? "");
  if (!m) return false;
  const tahun = Number(m[1]);
  return tahun >= 2000 && tahun <= 2100;
}

/**
 * Alamat: `?tab=` (nama yang dipakai tautan Hari ini; `?chip=` lama tetap
 * terbaca), `?cari=`, `?campaign=`, `?kolaborasi=`, `?halaman=`, `?bulan=`.
 */
export function bacaParamKontenKol(sp: IsiAlamat, hariIni: string): ParamKontenKol {
  const chipMentah = satu(sp.tab) ?? satu(sp.chip);
  const chip = (CHIP_KONTEN_KOL as readonly string[]).includes(chipMentah ?? "") ? (chipMentah as ChipKontenKol) : "menunggu";
  const cari = (satu(sp.cari) ?? "").trim().slice(0, 100);
  const campaignMentah = (satu(sp.campaign) ?? "").trim();
  const campaign = campaignMentah && campaignMentah.length <= 64 ? campaignMentah : null;
  const kolaborasiMentah = (satu(sp.kolaborasi) ?? "").trim();
  const kolaborasi = kolaborasiMentah && kolaborasiMentah.length <= 64 ? kolaborasiMentah : null;
  const halamanMentah = Number(satu(sp.halaman));
  const halaman = Number.isInteger(halamanMentah) && halamanMentah >= 1 && halamanMentah <= 10_000 ? halamanMentah : 1;
  const bulanMentah = satu(sp.bulan);
  const bulan = bulanSah(bulanMentah) ? (bulanMentah as string) : hariIni.slice(0, 7);
  return { chip, cari, campaign, kolaborasi, halaman, bulan };
}

/** Alamat untuk keadaan `p`; nilai bawaan tidak ditulis supaya alamatnya pendek. */
export function alamatKontenKol(p: ParamKontenKol, hariIni: string): string {
  const q = new URLSearchParams();
  if (p.chip !== "menunggu") q.set("tab", p.chip);
  if (p.cari) q.set("cari", p.cari);
  if (p.campaign) q.set("campaign", p.campaign);
  if (p.kolaborasi) q.set("kolaborasi", p.kolaborasi);
  if (p.chip === "jadwal") {
    if (p.bulan !== hariIni.slice(0, 7)) q.set("bulan", p.bulan);
  } else if (p.halaman > 1) {
    q.set("halaman", String(p.halaman));
  }
  const qs = q.toString();
  return qs ? `${RUTE_KONTEN_KOL}?${qs}` : RUTE_KONTEN_KOL;
}

/* ─────────────────────────── Peringatan angka ─────────────────────────── */

export type JenisAngka = Extract<JenisTenggat, "ANGKA_H1" | "ANGKA_H3" | "ANGKA_H7">;

export type PeringatanAngka = {
  /** Titik angka yang sudah lewat dan belum diisi — paling banyak satu (yang terbaru). */
  kosong: { jenis: JenisAngka; tanggal: string; lewatHari: number }[];
  /** Titik angka berikutnya yang belum jatuh tempo. */
  berikut: { jenis: JenisAngka; tanggal: string } | null;
};

/**
 * Peringatan "H+N kosong" untuk SATU konten tayang. Dihitung lewat
 * `tenggatKolaborasi` supaya Hari ini, Kalender, dan layar ini tidak pernah
 * berbeda pendapat soal kapan angka terlambat. Kolaborasi yang sudah selesai
 * atau keluar jalur tidak menagih angka lagi.
 */
export function peringatanAngka(
  input: {
    tahap: Tahap;
    tahapAt: string;
    kontenId: string;
    link: string | null;
    /** Hari WIB tayang. */
    liveAt: string | null;
    /** Hari WIB angka terakhir dicatat. */
    angkaTerakhirHari: string | null;
  },
  hariIni: string,
  ambang: AmbangKreatif = AMBANG_BAWAAN,
): PeringatanAngka {
  const tenggat = tenggatKolaborasi(
    {
      tahap: input.tahap,
      tahapAt: input.tahapAt,
      fee: 0,
      payStatus: "TIDAK_PERLU",
      pengiriman: [],
      konten: [
        {
          id: input.kontenId,
          link: input.link,
          liveAt: input.liveAt,
          draftStatus: null,
          draftAt: null,
          angkaTerakhirHari: input.angkaTerakhirHari,
        },
      ],
    },
    ambang,
    hariIni,
  ).filter((t): t is typeof t & { jenis: JenisAngka } => t.jenis === "ANGKA_H1" || t.jenis === "ANGKA_H3" || t.jenis === "ANGKA_H7");
  const kosong = tenggat.filter((t) => t.lewat).map((t) => ({ jenis: t.jenis, tanggal: t.tanggal, lewatHari: t.lewatHari }));
  const b = tenggat.find((t) => !t.lewat);
  return { kosong, berikut: b ? { jenis: b.jenis, tanggal: b.tanggal } : null };
}

/** "H+3" dari jenisnya — sama di kedua bahasa. */
export function labelTitikAngka(jenis: JenisAngka, ambang: AmbangKreatif = AMBANG_BAWAAN): string {
  return jenis === "ANGKA_H1" ? "H+1" : jenis === "ANGKA_H7" ? "H+7" : `H+${ambang.tayangKeAngkaHari}`;
}

/* ──────────────────────────── Isian angka ──────────────────────────── */

export const KOLOM_ANGKA = ["views", "likes", "comments", "shares", "saves"] as const;
export type KolomAngka = (typeof KOLOM_ANGKA)[number];
export type IsianAngka = Record<KolomAngka, number>;

/** Batas atas kolom Int di basis data. */
export const MAKS_ANGKA = 2_147_483_647;

/**
 * Angka konten yang sah untuk disimpan: bilangan bulat 0…MAKS, dan tidak
 * semuanya nol — baris angka nol menghapus pengingat H+N padahal belum ada
 * angka apa pun yang diisi.
 */
export function periksaIsianAngka(a: Partial<Record<KolomAngka, unknown>>): "ANGKA_TIDAK_SAH" | "ANGKA_KOSONG" | null {
  for (const k of KOLOM_ANGKA) {
    const v = a[k] ?? 0;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > MAKS_ANGKA) return "ANGKA_TIDAK_SAH";
  }
  return KOLOM_ANGKA.every((k) => (a[k] ?? 0) === 0) ? "ANGKA_KOSONG" : null;
}

/* ──────────────────────────── Jadwal tayang ──────────────────────────── */

/** Sel hari dengan sebanyak ini konten atau lebih diberi latar kuning (padat). */
export const HARI_PADAT = 5;
/** Butir yang tampil per sel sebelum "+N lagi". */
export const BUTIR_PER_HARI = 3;

export type ButirJadwal = {
  /** Id konten, atau id kolaborasi untuk rencana tayang tanpa konten. */
  id: string;
  kolaborasiId: string;
  /** Hari WIB. */
  tanggal: string;
  jenis: "RENCANA" | "TAYANG";
  label: string;
  platform: string | null;
};

/** Butir dikelompokkan per hari: yang sudah tayang dulu, lalu menurut label. */
export function kelompokJadwal(butir: readonly ButirJadwal[]): Map<string, ButirJadwal[]> {
  const hasil = new Map<string, ButirJadwal[]>();
  for (const b of butir) {
    if (!bacaTanggal(b.tanggal)) continue;
    const daftar = hasil.get(b.tanggal) ?? [];
    daftar.push(b);
    hasil.set(b.tanggal, daftar);
  }
  for (const daftar of hasil.values()) {
    daftar.sort((a, b) => (a.jenis === b.jenis ? a.label.localeCompare(b.label) : a.jenis === "TAYANG" ? -1 : 1));
  }
  return hasil;
}

export function hariPadat(jumlah: number): boolean {
  return jumlah >= HARI_PADAT;
}

/** Geser "YYYY-MM" sebanyak `n` bulan (boleh negatif). */
export function geserBulanKonten(bulan: string, n: number): string {
  if (!bulanSah(bulan)) return bulan;
  const [th, bl] = bulan.split("-").map(Number);
  const indeks = th * 12 + (bl - 1) + n;
  return `${Math.floor(indeks / 12)}-${String((indeks % 12) + 1).padStart(2, "0")}`;
}

/** Hari pertama dan terakhir "YYYY-MM". */
export function batasBulan(bulan: string): { dari: string; sampai: string } | null {
  if (!bulanSah(bulan)) return null;
  const dari = `${bulan}-01`;
  const sampai = geserHari(`${geserBulanKonten(bulan, 1)}-01`, -1);
  return { dari, sampai };
}

export type HariKisiKonten = { tanggal: string; diBulan: boolean };

/** Kisi satu bulan, minggu dimulai SENIN; hari bulan tetangga mengisi minggu pertama/terakhir. */
export function kisiBulanKonten(bulan: string): HariKisiKonten[][] {
  const batas = batasBulan(bulan);
  if (!batas) return [];
  const b = bacaTanggal(batas.dari)!;
  const hariMinggu = new Date(Date.UTC(b.tahun, b.bulan - 1, b.hari)).getUTCDay();
  let kursor = geserHari(batas.dari, -((hariMinggu + 6) % 7));
  const minggu: HariKisiKonten[][] = [];
  while (minggu.length < 6) {
    const baris: HariKisiKonten[] = [];
    for (let j = 0; j < 7; j++) {
      baris.push({ tanggal: kursor, diBulan: kursor.slice(0, 7) === bulan });
      kursor = geserHari(kursor, 1);
    }
    minggu.push(baris);
    if (kursor > batas.sampai) break;
  }
  return minggu;
}

/* ──────────────────────────── Draf ──────────────────────────── */

/**
 * Apakah lama menunggu draf ini disorot merah. Hanya draf MENUNGGU: itu
 * giliran tim kita mereview. Draf REVISI menunggu KOL, bukan kita.
 */
export function drafTerlambat(status: StatusDraf | null, menungguHari: number, ambang: AmbangKreatif = AMBANG_BAWAAN): boolean {
  return status === "MENUNGGU" && menungguHari > ambang.reviewDrafHari;
}

/** Potong catatan revisi untuk baris daftar. */
export function cuplikan(teks: string | null | undefined, panjang = 60): string {
  const t = (teks ?? "").replace(/\s+/g, " ").trim();
  return t.length > panjang ? `${t.slice(0, panjang - 1).trimEnd()}…` : t;
}
