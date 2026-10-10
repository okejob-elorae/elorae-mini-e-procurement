import { formatDateOnlyJakarta } from "@/lib/date-only";
import { kelompokKembar, normalisasiHandle, type CalonKembar, type SebabKembar } from "./kembar";
import { URUTAN_TAHAP, type Tahap } from "./tahap";
import { normalisasiWa } from "./wa";

/*
 * Periksa data Ruang KOL — aturan murni, aman untuk klien.
 *
 * Halaman `/backoffice/kreatif/periksa` hanya MEMBACA: setiap pemeriksaan di
 * sini menemukan baris yang perlu dibetulkan manusia, tidak ada yang dibetulkan
 * otomatis. Pembaca server (`periksa-data-queries.ts`) memilih calon baris
 * dengan SQL yang menjadi cermin aturan di sini, lalu aturan ini yang menyusun
 * rinciannya — jadi aturannya tertulis sekali dan dites di sini.
 *
 * `relationMode = "prisma"`: basis data tidak memasang foreign key, jadi baris
 * bisa menunjuk induk yang sudah tidak ada. Itu kelompok "yatim".
 */

/** Baris yang ditampilkan per pemeriksaan; jumlahnya tetap angka sebenarnya. */
export const BATAS_BARIS_PERIKSA = 50;

export const BAGIAN_PERIKSA = ["kembar", "yatim", "tanggal", "angka", "kelengkapan"] as const;
export type BagianPeriksa = (typeof BAGIAN_PERIKSA)[number];

/** Urutan tampil = urutan kunci di sini. */
export const BAGIAN_JENIS = {
  KOL_KEMBAR: "kembar",
  AKUN_TANPA_KOL: "yatim",
  KOLABORASI_TANPA_KOL: "yatim",
  KOLABORASI_TANPA_CAMPAIGN: "yatim",
  KONTEN_TANPA_KOLABORASI: "yatim",
  ANGKA_TANPA_KONTEN: "yatim",
  PENGIRIMAN_TANPA_KOLABORASI: "yatim",
  TERMIN_TANPA_KOLABORASI: "yatim",
  BRAND_TANPA_KOL: "yatim",
  CAMPAIGN_TANGGAL_TERBALIK: "tanggal",
  KOLABORASI_TANGGAL_TERBALIK: "tanggal",
  KONTEN_TAYANG_MASA_DEPAN: "tanggal",
  LIKE_LEBIH_DARI_VIEWS: "angka",
  VIEWS_TURUN: "angka",
  KOL_TANPA_AKUN: "kelengkapan",
  TAYANG_TANPA_KONTEN: "kelengkapan",
} as const satisfies Record<string, BagianPeriksa>;

export type JenisPeriksa = keyof typeof BAGIAN_JENIS;
export const URUTAN_PERIKSA = Object.keys(BAGIAN_JENIS) as JenisPeriksa[];

/** Tayang dan sesudahnya — kolaborasi di tahap ini pasti punya konten yang tayang. Jalur keluar tidak termasuk. */
export const TAHAP_SUDAH_TAYANG: readonly Tahap[] = URUTAN_TAHAP.slice(URUTAN_TAHAP.indexOf("TAYANG"));

export type RincianPeriksa =
  | { macam: "KEMBAR"; sebab: SebabKembar[]; anggota: { id: string; nama: string }[]; waSama: string | null; handleSama: string | null }
  /** `waktu` = ISO, untuk baris yang tidak punya nama (bacaan angka). */
  | { macam: "YATIM"; indukId: string; waktu?: string | null }
  /** ISO instan. */
  | { macam: "TANGGAL"; mulai: string; selesai: string }
  | { macam: "TAYANG"; tayang: string }
  | { macam: "LIKE_VIEWS"; waktu: string; likes: number; views: number; kali: number }
  | { macam: "VIEWS_TURUN"; waktuSebelum: string; sebelum: number; waktu: string; sesudah: number; kali: number }
  | { macam: "TAHAP"; tahap: Tahap }
  | { macam: "KOSONG" };

export type BarisPeriksa = {
  /** Id baris yang diperiksa (untuk KOL kembar: id anggota pertama). */
  id: string;
  judul: string;
  sub: string | null;
  /** Halaman baris itu; null bila tidak ada halaman yang bisa dibuka (mis. induknya sudah tidak ada). */
  tautan: string | null;
  rincian: RincianPeriksa;
};

export type GrupPeriksa = { jenis: JenisPeriksa; bagian: BagianPeriksa; jumlah: number; baris: BarisPeriksa[] };

export type HasilPeriksa = { grup: GrupPeriksa[]; total: number; diperiksaPada: string };

export const tautanKol = (id: string) => `/backoffice/kreatif/kol/${encodeURIComponent(id)}`;
export const tautanCampaign = (id: string) => `/backoffice/kreatif/campaign/${encodeURIComponent(id)}`;
export const tautanKolaborasi = (id: string, tab?: string) => `/backoffice/kreatif/kolaborasi/${encodeURIComponent(id)}${tab ? `?tab=${tab}` : ""}`;

export function grupPeriksa(jenis: JenisPeriksa, jumlah: number, baris: readonly BarisPeriksa[]): GrupPeriksa {
  return { jenis, bagian: BAGIAN_JENIS[jenis], jumlah: Math.max(jumlah, baris.length), baris: baris.slice(0, BATAS_BARIS_PERIKSA) };
}

/** Tanggal selesai/tenggat jatuh SEBELUM tanggal mulai. Salah satu kosong = tidak bisa dinilai. */
export function tanggalTerbalik(mulai: Date | null | undefined, selesai: Date | null | undefined): boolean {
  if (!mulai || !selesai) return false;
  return selesai.getTime() < mulai.getTime();
}

/** Konten tercatat tayang pada hari WIB SESUDAH hari ini. Jam berapa pun hari ini tidak dihitung. */
export function tayangDiMasaDepan(liveAt: Date | null | undefined, hariIni: string): boolean {
  if (!liveAt) return false;
  return formatDateOnlyJakarta(liveAt) > hariIni;
}

export type BacaanAngka = { id: string; recordedAt: Date; views: number; likes: number };

export type AnomaliAngka = {
  likeLebih: { waktu: string; likes: number; views: number; kali: number } | null;
  turun: { waktuSebelum: string; sebelum: number; waktu: string; sesudah: number; kali: number } | null;
};

/**
 * Angka janggal satu konten:
 *  - like lebih banyak dari views (hanya bila views > 0 — views 0 bisa berarti
 *    belum terbaca). Dilaporkan bacaan TERAKHIR yang begitu.
 *  - views lebih rendah dari bacaan SEBELUMNYA mana pun (views TikTok hanya
 *    bisa naik). Dibandingkan dengan bacaan tertinggi yang waktunya SEBELUM
 *    bacaan ini — dua bacaan di waktu yang sama tidak dibandingkan, sama dengan
 *    SQL pemilihnya. Dilaporkan penurunan TERAKHIR.
 */
export function anomaliAngka(bacaan: readonly BacaanAngka[]): AnomaliAngka {
  const urut = [...bacaan].sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  let likeLebih: AnomaliAngka["likeLebih"] = null;
  let likeKali = 0;
  for (const b of urut) {
    if (b.views > 0 && b.likes > b.views) {
      likeKali += 1;
      likeLebih = { waktu: b.recordedAt.toISOString(), likes: b.likes, views: b.views, kali: likeKali };
    }
  }

  let turun: AnomaliAngka["turun"] = null;
  let turunKali = 0;
  let maks: BacaanAngka | null = null;
  for (let i = 0; i < urut.length; ) {
    const waktu = urut[i].recordedAt.getTime();
    let j = i;
    while (j < urut.length && urut[j].recordedAt.getTime() === waktu) j += 1;
    const serentak = urut.slice(i, j);
    for (const b of serentak) {
      if (maks && b.views < maks.views) {
        turunKali += 1;
        turun = { waktuSebelum: maks.recordedAt.toISOString(), sebelum: maks.views, waktu: b.recordedAt.toISOString(), sesudah: b.views, kali: turunKali };
      }
    }
    for (const b of serentak) if (!maks || b.views > maks.views) maks = b;
    i = j;
  }

  return { likeLebih, turun };
}

/**
 * KOL kembar (`kelompokKembar`, rantai ikut digabung) → baris pemeriksaan.
 * Nomor WA atau handle yang sama ikut disebut, supaya orang tahu apa yang
 * membuat mereka dianggap kembar sebelum membuka profilnya.
 */
export function kelompokKembarPeriksa(daftar: readonly CalonKembar[]): BarisPeriksa[] {
  const per = new Map(daftar.map((k) => [k.id, k]));
  return kelompokKembar(daftar).map((g) => {
    const anggota = g.ids.map((id) => per.get(id)!);
    const hitungWa = new Map<string, number>();
    const hitungHandle = new Map<string, number>();
    for (const a of anggota) {
      const wa = normalisasiWa(a.waNormal);
      if (wa) hitungWa.set(wa, (hitungWa.get(wa) ?? 0) + 1);
      for (const h of new Set(a.handles.map(normalisasiHandle).filter((x): x is string => Boolean(x)))) {
        hitungHandle.set(h, (hitungHandle.get(h) ?? 0) + 1);
      }
    }
    const sama = (m: Map<string, number>) => [...m.entries()].find(([, n]) => n > 1)?.[0] ?? null;
    return {
      id: anggota[0].id,
      judul: anggota.map((a) => a.nama).join(" · "),
      sub: null,
      tautan: null,
      rincian: {
        macam: "KEMBAR",
        sebab: g.sebab,
        anggota: anggota.map((a) => ({ id: a.id, nama: a.nama })),
        waSama: sama(hitungWa),
        handleSama: sama(hitungHandle),
      },
    };
  });
}

export function totalTemuan(grup: readonly GrupPeriksa[]): number {
  return grup.reduce((s, g) => s + g.jumlah, 0);
}
