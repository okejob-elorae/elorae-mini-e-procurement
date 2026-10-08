import { hitungPph, TARIF_PAJAK_BAWAAN, type TarifPajakKreatif } from "@/lib/creative/pph";
import type { PostingRole } from "@/lib/constants/journal-roles";

/**
 * Potongan PPh atas pembayaran ke PEMASOK (`Supplier.taxWithholding`) — murni,
 * aman untuk komponen klien. Nilai kolom: null (tidak dipotong) atau salah satu
 * `JenisPotongPemasok`. Riset 2026-10-08 (bukan nasihat pajak — konfirmasi ke
 * konsultan):
 *
 * - `PPH23` — jasa maklon/CMT oleh BADAN (PT/CV penjahit) masuk daftar "jasa
 *   lain" PMK 141/2015: 2% × bruto (tanpa PPN; tanpa bahan bila bahannya
 *   ditagih terpisah). Tanpa NPWP 2× (4%) — `Supplier.hasNpwp`.
 * - `PPH21` — penjahit ORANG PRIBADI: PPh 21 bukan pegawai (PMK 168/2023),
 *   50% × bruto × tarif progresif Pasal 17, tanpa PTKP; tanpa NPWP +20%.
 * - `PPH4_2` — sewa tanah/bangunan (toko, gudang): PPh 4(2) final 10% × bruto
 *   sewa termasuk service charge (PP 34/2017).
 *
 * Satu rumus untuk ketiganya: `hitungPotongPemasok`. PPh 21/23 memakai mesin
 * yang sama dengan fee KOL (`lib/creative/pph.ts`), dibulatkan ke BAWAH ke
 * rupiah penuh. Bukti potong (BPPU / BP21) dibuat di Coretax e-Bupot; setor
 * tanggal 15 bulan berikutnya, lapor SPT Masa tanggal 20.
 */

export type JenisPotongPemasok = "PPH23" | "PPH21" | "PPH4_2";
export const SEMUA_JENIS_POTONG_PEMASOK: readonly JenisPotongPemasok[] = ["PPH23", "PPH21", "PPH4_2"];

export const TARIF_PPH4_2_SEWA_PERSEN = 10;

export const INFO_POTONG_PEMASOK: Readonly<
  Record<JenisPotongPemasok, { label: string; keterangan: string; peranHutang: Extract<PostingRole, "PPH23_PAYABLE" | "PPH21_PAYABLE" | "PPH4_2_PAYABLE"> }>
> = {
  PPH23: {
    label: "PPh 23 (jasa, badan)",
    keterangan: "2% dari bruto tanpa PPN; 4% bila pemasok tidak ber-NPWP.",
    peranHutang: "PPH23_PAYABLE",
  },
  PPH21: {
    label: "PPh 21 (jasa, orang pribadi)",
    keterangan: "50% bruto × tarif Pasal 17, tanpa PTKP; +20% bila tidak ber-NPWP.",
    peranHutang: "PPH21_PAYABLE",
  },
  PPH4_2: {
    label: "PPh 4(2) (sewa)",
    keterangan: "10% dari bruto sewa termasuk service charge, final.",
    peranHutang: "PPH4_2_PAYABLE",
  },
};

export function bacaJenisPotongPemasok(nilai: unknown): JenisPotongPemasok | null {
  return SEMUA_JENIS_POTONG_PEMASOK.includes(nilai as JenisPotongPemasok) ? (nilai as JenisPotongPemasok) : null;
}

export type HasilPotongPemasok = {
  jenis: JenisPotongPemasok | null;
  bruto: number;
  pph: number;
  neto: number;
  tarifEfektifPersen: number;
};

/**
 * PPh yang dipotong dari pembayaran bruto ke pemasok. `jenis` null = tidak
 * dipotong. `tarif` = tarif PPh 21/23 yang berlaku (bawaan sama dengan fee KOL;
 * teruskan `bacaTarifPajak(SystemSetting["kreatif.pajak"])` bila tim sudah
 * mengubahnya).
 */
export function hitungPotongPemasok(
  bruto: number,
  jenis: JenisPotongPemasok | null,
  opsi: { adaNpwp: boolean },
  tarif: TarifPajakKreatif = TARIF_PAJAK_BAWAAN,
): HasilPotongPemasok {
  if (!Number.isFinite(bruto) || bruto <= 0 || !jenis) {
    const b = Number.isFinite(bruto) && bruto > 0 ? bruto : 0;
    return { jenis, bruto: b, pph: 0, neto: b, tarifEfektifPersen: 0 };
  }
  if (jenis === "PPH4_2") {
    const brutoSen = Math.round(Number((bruto * 100).toFixed(4)));
    const pph = Math.floor((brutoSen * TARIF_PPH4_2_SEWA_PERSEN) / 100 / 100);
    return {
      jenis,
      bruto: brutoSen / 100,
      pph,
      neto: (brutoSen - pph * 100) / 100,
      tarifEfektifPersen: Math.round(((pph * 100) / brutoSen) * 100 * 100) / 100,
    };
  }
  const r = hitungPph(bruto, { jenis: jenis === "PPH23" ? "BADAN" : "ORANG_PRIBADI", adaNpwp: opsi.adaNpwp }, tarif);
  return { jenis, bruto: r.bruto, pph: r.pph, neto: r.neto, tarifEfektifPersen: r.tarifEfektifPersen };
}
