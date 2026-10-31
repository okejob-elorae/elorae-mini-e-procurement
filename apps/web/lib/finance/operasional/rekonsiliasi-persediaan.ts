import type { PostingRole } from "@/lib/constants/journal-roles";

/*
 * Rekonsiliasi persediaan — MURNI, aman untuk komponen klien. Saldo akun
 * persediaan di buku besar dibandingkan dengan nilai stok sistem:
 *
 * - `INVENTORY` (bahan): kartu stok kain/aksesori + bahan yang sedang di
 *   produksi (keluar bahan belum dijurnal — tidak ada akun WIP).
 * - `INVENTORY_FG`: kartu stok barang jadi gudang utama.
 * - `INVENTORY_CONSIGNMENT`: stok di toko konsinyasi (buku toko / titipan)
 *   × biaya saat dikirim.
 * - `INVENTORY_DAMAGED`: nilai gudang barang rusak.
 * - `INVENTORY_VAN`: stok van kanvas × harga rata-ratanya.
 *
 * Bila beberapa peran dipetakan ke akun yang SAMA, yang dibandingkan adalah
 * akun itu terhadap jumlah nilai sistem semua perannya — saldo per peran tidak
 * bisa dipisah dari satu akun.
 */

export const PERAN_REKON_PERSEDIAAN = ["INVENTORY", "INVENTORY_FG", "INVENTORY_CONSIGNMENT", "INVENTORY_DAMAGED", "INVENTORY_VAN"] as const satisfies readonly PostingRole[];

export type PeranRekonPersediaan = (typeof PERAN_REKON_PERSEDIAAN)[number];

export type AkunPeta = { id: string; code: string; name: string };

export type BarisRekonPersediaan = {
  /** null = peran belum dipetakan ke akun. */
  akun: AkunPeta | null;
  peran: PeranRekonPersediaan[];
  /** null bila peran belum dipetakan (tidak ada akun yang bisa dibaca). */
  bukuBesar: number | null;
  sistem: number;
  /** bukuBesar − sistem; null bila peran belum dipetakan. */
  selisih: number | null;
  cocok: boolean;
};

/** Selisih di bawah Rp1 dianggap pembulatan harga rata-rata. */
export const TOLERANSI_REKON_PERSEDIAAN = 1;

const sen = (n: number): number => Math.round(Number(((Number.isFinite(n) ? n : 0) * 100).toFixed(4)));

export function susunRekonPersediaan(input: {
  pemetaan: ReadonlyMap<PeranRekonPersediaan, AkunPeta>;
  saldoAkun: ReadonlyMap<string, number>;
  sistem: Readonly<Record<PeranRekonPersediaan, number>>;
}): BarisRekonPersediaan[] {
  const perAkun = new Map<string, { akun: AkunPeta; peran: PeranRekonPersediaan[] }>();
  const baris: BarisRekonPersediaan[] = [];
  for (const peran of PERAN_REKON_PERSEDIAAN) {
    const akun = input.pemetaan.get(peran);
    if (!akun) {
      baris.push({ akun: null, peran: [peran], bukuBesar: null, sistem: input.sistem[peran], selisih: null, cocok: false });
      continue;
    }
    const ada = perAkun.get(akun.id);
    if (ada) ada.peran.push(peran);
    else perAkun.set(akun.id, { akun, peran: [peran] });
  }
  const terpetakan: BarisRekonPersediaan[] = [];
  for (const { akun, peran } of perAkun.values()) {
    const sistemSen = peran.reduce((s, p) => s + sen(input.sistem[p]), 0);
    const bukuSen = sen(input.saldoAkun.get(akun.id) ?? 0);
    const selisihSen = bukuSen - sistemSen;
    terpetakan.push({
      akun,
      peran,
      bukuBesar: bukuSen / 100,
      sistem: sistemSen / 100,
      selisih: selisihSen / 100,
      cocok: Math.abs(selisihSen) < TOLERANSI_REKON_PERSEDIAAN * 100,
    });
  }
  return [...terpetakan, ...baris];
}

export type RingkasRekonPersediaan = { bukuBesar: number; sistem: number; selisih: number; semuaCocok: boolean; adaBelumDipetakan: boolean };

export function ringkasRekonPersediaan(baris: readonly BarisRekonPersediaan[]): RingkasRekonPersediaan {
  let buku = 0;
  let sistem = 0;
  for (const b of baris) {
    sistem += sen(b.sistem);
    if (b.bukuBesar !== null) buku += sen(b.bukuBesar);
  }
  return {
    bukuBesar: buku / 100,
    sistem: sistem / 100,
    selisih: (buku - sistem) / 100,
    semuaCocok: baris.every((b) => b.cocok),
    adaBelumDipetakan: baris.some((b) => b.akun === null),
  };
}

/**
 * Sumber gerakan kartu stok (`StockAdjustment.source`) yang TIDAK menghasilkan
 * jurnal — setiap gerakannya sejak tanggal mulai adalah penyebab selisih yang
 * sudah diketahui. Sumber lain dijurnal oleh dokumennya (penjualan, nota,
 * retur, kanvas, opname, tukar barang, sampel KOL, konsinyasi, stok manual)
 * atau tidak menyentuh buku besar (bahan kembali dari produksi — bahan di
 * produksi dihitung terpisah).
 */
export const SUMBER_STOK_TANPA_JURNAL = ["JUBELIO_WEBHOOK", "JUBELIO_RECONCILE"] as const;
