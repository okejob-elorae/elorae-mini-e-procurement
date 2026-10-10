/**
 * Angka ringkas campaign — murni, aman untuk klien (hanya `import type` dari
 * kueri). Angka per kolaborasinya selalu dari `angkaKolaborasi`; berkas ini
 * hanya menjumlahkannya per campaign.
 */

import type { AngkaKolaborasi } from "./angka-queries";
import { cpe, cpv, jumlahUang, keadaanBudget, roas, type KeadaanBudget } from "./angka-konten";
import { isJalurKeluar, type Tahap } from "./tahap";

/**
 * Biaya satu kolaborasi yang TERPAKAI dari budget campaign.
 *
 * Kolaborasi yang keluar jalur (ditolak, ghosting, batal) tanpa satu konten
 * pun tayang tidak lagi menjanjikan fee dan boost — yang tetap terpakai hanya
 * yang benar-benar keluar: ongkir, modal sampel yang sudah berangkat, komisi.
 * Selain itu biaya penuh `angkaKolaborasi` (fee dihitung sejak dijanjikan:
 * budget adalah komitmen, bukan beban yang diakui).
 */
export function terpakaiKolaborasi(tahap: Tahap, a: Pick<AngkaKolaborasi, "biaya" | "jumlahKonten">): number {
  if (isJalurKeluar(tahap) && a.jumlahKonten === 0) {
    return jumlahUang([a.biaya.ongkir, a.biaya.sampel, a.biaya.komisi]);
  }
  return a.biaya.total;
}

export type KolaborasiCampaign = { kolId: string; tahap: Tahap; angka: AngkaKolaborasi };

export type RingkasanCampaign = {
  /** KOL berbeda yang kolaborasinya belum keluar jalur. */
  jumlahKol: number;
  jumlahKolaborasi: number;
  /** Konten yang sudah tayang (punya link). */
  jumlahKonten: number;
  views: number;
  /** Like + komentar + share + save konten tayang (`angkaKolaborasi.interaksi`). */
  interaksi: number;
  orders: number;
  terpakai: number;
  gmv: number;
  roas: number | null;
  budget: { keadaan: KeadaanBudget; persen: number | null; sisa: number | null };
};

export function ringkasCampaign(kolaborasi: readonly KolaborasiCampaign[], budget: number | null): RingkasanCampaign {
  const terpakai = jumlahUang(kolaborasi.map((k) => terpakaiKolaborasi(k.tahap, k.angka)));
  const gmv = jumlahUang(kolaborasi.map((k) => k.angka.gmv));
  return {
    jumlahKol: new Set(kolaborasi.filter((k) => !isJalurKeluar(k.tahap)).map((k) => k.kolId)).size,
    jumlahKolaborasi: kolaborasi.length,
    jumlahKonten: kolaborasi.reduce((s, k) => s + k.angka.jumlahKonten, 0),
    views: kolaborasi.reduce((s, k) => s + k.angka.angka.views, 0),
    interaksi: kolaborasi.reduce((s, k) => s + k.angka.interaksi, 0),
    orders: kolaborasi.reduce((s, k) => s + k.angka.orders, 0),
    terpakai,
    gmv,
    roas: roas(gmv, terpakai),
    budget: keadaanBudget(terpakai, budget),
  };
}

/** Lebar bar budget (0–100). */
export function lebarBarBudget(persen: number | null): number {
  if (persen === null || !Number.isFinite(persen)) return 0;
  return Math.max(0, Math.min(100, persen));
}

/* ───────────────────────── status campaign ───────────────────────── */

/** Status campaign (`KolStatusCampaign`). Arsip terpisah: menyembunyikan dari daftar aktif. */
export const SEMUA_STATUS_CAMPAIGN = ["DRAFT", "BERJALAN", "SELESAI", "BATAL"] as const;

export type StatusCampaignKol = (typeof SEMUA_STATUS_CAMPAIGN)[number];

/** Bawaan campaign baru (sama dengan bawaan kolom di basis data). */
export const STATUS_CAMPAIGN_BAWAAN: StatusCampaignKol = "BERJALAN";

/** `?keadaan=` → status, tidak peka huruf; yang tidak dikenal = "" (semua). */
export function bacaStatusCampaignKol(v: string | string[] | undefined | null): StatusCampaignKol | "" {
  const s = (Array.isArray(v) ? v[0] : v)?.trim().toUpperCase() ?? "";
  return (SEMUA_STATUS_CAMPAIGN as readonly string[]).includes(s) ? (s as StatusCampaignKol) : "";
}

/* ─────────────────────── CPV, CPE, ER, persen target ─────────────────────── */

export type MetrikCampaign = {
  /** Biaya per view = terpakai ÷ views. */
  cpv: number | null;
  /** Biaya per interaksi = terpakai ÷ (like + komentar + share + save). */
  cpe: number | null;
  /** ER aktual (persen) = interaksi ÷ views × 100 — rumus ER Elorae, save ikut. */
  er: number | null;
  /** Views ÷ target views × 100. */
  persenViews: number | null;
  /** Konten tayang ÷ target konten × 100. */
  persenKonten: number | null;
};

const bulat2 = (n: number): number => Math.round(Number((n * 100).toFixed(4))) / 100;
const persen = (n: number, dari: number | null | undefined): number | null =>
  dari && dari > 0 && Number.isFinite(n) ? bulat2((n / dari) * 100) : null;

/**
 * Angka efisiensi satu campaign dari ringkasannya. Biayanya `terpakai` — angka
 * yang sama dengan ROAS dan bar budget di layar yang sama. Pembagian dengan
 * nol = `null` (layar menulis "—").
 */
export function metrikCampaign(
  r: Pick<RingkasanCampaign, "terpakai" | "views" | "interaksi" | "jumlahKonten">,
  target: { targetViews: number | null; targetContent: number | null },
): MetrikCampaign {
  return {
    cpv: cpv(r.terpakai, r.views),
    cpe: cpe(r.terpakai, r.interaksi),
    er: persen(r.interaksi, r.views),
    persenViews: persen(r.views, target.targetViews),
    persenKonten: persen(r.jumlahKonten, target.targetContent),
  };
}

/* ─────────────────────── ringkasan atas daftar campaign ─────────────────────── */

export type RingkasanDaftarCampaign = {
  /** KOL aktif (tidak dinonaktifkan dan tidak diblokir). */
  jumlahKol: number;
  /** Σ pengikut akun TERBESAR tiap KOL aktif — orang yang sama tidak dihitung dua kali. */
  totalPengikut: number;
  /** Campaign berstatus BERJALAN yang tidak diarsip. */
  berjalan: number;
  /** Σ budget, terpakai, dan views campaign yang tidak diarsip. */
  budget: number;
  terpakai: number;
  views: number;
};

export function ringkasDaftarCampaign(
  campaign: readonly { status: StatusCampaignKol; arsip: boolean; anggaran: number | null; terpakai: number; views: number }[],
  pengikutKolAktif: readonly (readonly number[])[],
): RingkasanDaftarCampaign {
  const hidup = campaign.filter((c) => !c.arsip);
  return {
    jumlahKol: pengikutKolAktif.length,
    totalPengikut: pengikutKolAktif.reduce((s, akun) => s + (akun.length ? Math.max(...akun) : 0), 0),
    berjalan: hidup.filter((c) => c.status === "BERJALAN").length,
    budget: jumlahUang(hidup.map((c) => c.anggaran ?? 0)),
    terpakai: jumlahUang(hidup.map((c) => c.terpakai)),
    views: hidup.reduce((s, c) => s + c.views, 0),
  };
}
