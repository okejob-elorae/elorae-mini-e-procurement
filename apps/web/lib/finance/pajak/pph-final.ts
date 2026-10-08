import type { BentukUsaha } from "./profil";
import type { BarisJurnalPpn } from "./jurnal-ppn";

/**
 * PPh final UMKM 0,5% (PP 20/2026, berlaku sejak 22 April 2026, menggantikan
 * PP 55/2022) — murni. Hanya dihitung bila profil pajak `rezimPph` =
 * `FINAL_UMKM` (`pakaiPphFinalUmkm`, `./profil.ts`).
 *
 * - Dasar = omzet bruto bulanan dari buku besar (pendapatan penjualan bersih
 *   retur & potongan, tanpa PPN).
 * - Orang pribadi: Rp500 juta pertama omzet SETAHUN tidak dikenai pajak — ambang
 *   dihitung kumulatif sejak Januari, jadi bulan yang melewatinya hanya dikenai
 *   atas bagian di atas ambang.
 * - Pajak dibulatkan ke BAWAH ke rupiah penuh.
 * - PPh 22 yang dipungut marketplace di masa itu (`PPH22_PREPAID`, PMK 37/2025)
 *   melunasi PPh final atas penjualan itu: dikreditkan sampai sebesar pajaknya,
 *   sisanya tetap pajak dibayar dimuka.
 *
 * Jurnal: DR beban PPh final / CR PPh 22 dibayar dimuka (kredit) / CR hutang
 * PPh final (sisa terutang, disetor tanggal 15 bulan berikutnya).
 *
 * [Perlu dicek konsultan] aturan pelaksana PP 20/2026 belum lengkap; batas
 * Rp4,8 M/tahun (sesudahnya keluar dari rezim ini) tidak dihitung otomatis —
 * layar memperingatkan bila omzet setahun melewatinya.
 */

export const TARIF_PPH_FINAL_UMKM_PERSEN = 0.5;
export const AMBANG_BEBAS_ORANG_PRIBADI = 500_000_000;
export const BATAS_OMZET_UMKM = 4_800_000_000;

const keSen = (n: number): number => Math.sign(n) * Math.round(Number((Math.abs(n) * 100).toFixed(4)));

export type HasilPphFinal = {
  omzet: number;
  /** Omzet yang dikenai pajak masa ini. */
  dasar: number;
  pajak: number;
  kreditPph22: number;
  terutang: number;
  /** Omzet setahun (termasuk masa ini) melewati Rp4,8 M. */
  lewatBatas: boolean;
};

export function hitungPphFinal(input: {
  omzetMasa: number;
  /** Omzet Januari s.d. bulan sebelum masa ini, tahun yang sama. */
  omzetSebelumnyaTahunIni: number;
  bentukUsaha: BentukUsaha;
  pph22Masa: number;
}): HasilPphFinal {
  const masaSen = keSen(input.omzetMasa);
  const sebelumSen = keSen(input.omzetSebelumnyaTahunIni);
  let dasarSen = Math.max(0, masaSen);
  if (input.bentukUsaha === "ORANG_PRIBADI") {
    const ambang = AMBANG_BEBAS_ORANG_PRIBADI * 100;
    dasarSen = Math.max(0, Math.max(0, sebelumSen + masaSen - ambang) - Math.max(0, sebelumSen - ambang));
  }
  // 0,5% = 5/1000; dasar dalam sen → rupiah = /100.
  const pajak = Math.floor((dasarSen * 5) / 100_000);
  const kredit = Math.max(0, Math.min(pajak, Math.floor(Math.max(0, keSen(input.pph22Masa)) / 100)));
  return {
    omzet: masaSen / 100,
    dasar: dasarSen / 100,
    pajak,
    kreditPph22: kredit,
    terutang: pajak - kredit,
    lewatBatas: (sebelumSen + masaSen) / 100 > BATAS_OMZET_UMKM,
  };
}

/** Baris jurnal PPh final masa; kosong bila pajaknya nol. */
export function barisPphFinal(h: HasilPphFinal): BarisJurnalPpn[] {
  if (h.pajak <= 0) return [];
  return [
    { role: "PPH_FINAL_EXPENSE", debit: h.pajak, credit: 0, memo: `PPh final 0,5% × ${h.dasar.toFixed(2)}` },
    ...(h.kreditPph22 > 0 ? [{ role: "PPH22_PREPAID" as const, debit: 0, credit: h.kreditPph22, memo: "Kredit PPh 22 marketplace" }] : []),
    ...(h.terutang > 0 ? [{ role: "PPH_FINAL_PAYABLE" as const, debit: 0, credit: h.terutang }] : []),
  ];
}
