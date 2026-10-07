/**
 * Angka ringkas campaign — murni, aman untuk klien (hanya `import type` dari
 * kueri). Angka per kolaborasinya selalu dari `angkaKolaborasi`; berkas ini
 * hanya menjumlahkannya per campaign.
 */

import type { AngkaKolaborasi } from "./angka-queries";
import { jumlahUang, keadaanBudget, roas, type KeadaanBudget } from "./angka-konten";
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
