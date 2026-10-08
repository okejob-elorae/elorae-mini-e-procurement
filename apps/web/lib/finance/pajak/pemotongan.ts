import { hitungPph, TARIF_PAJAK_BAWAAN, type TarifPajakKreatif } from "@/lib/creative/pph";
import type { PostingRole } from "@/lib/constants/journal-roles";
import { formatDateOnlyJakarta } from "@/lib/date-only";

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

// ── SKB (Surat Keterangan Bebas) ────────────────────────────────────────────

/**
 * SKB pemasok: penjahit yang BUKAN badan usaha diminta SKB (pemilik,
 * 2026-10-08). Punya SKB yang masih berlaku pada hari bayar → tidak dipotong;
 * tidak punya / sudah habis → dipotong normal sesuai jenisnya (PPh 21 bukan
 * pegawai = 50% × 5% = 2,5% di lapisan pertama).
 *
 * `berlakuSampai` = hari WIB "YYYY-MM-DD", INKLUSIF.
 */
export type SkbPemasok = { nomor: string | null; berlakuSampai: string | null };
export type SkbTercatat = { nomor: string; berlakuSampai: string };
export type PembebasanSkb = SkbTercatat & { jenis: JenisPotongPemasok; keterangan: string };

export type KeputusanPotongPemasok = {
  /** Jenis yang benar-benar dipotong; null = tidak dipotong. */
  jenis: JenisPotongPemasok | null;
  /** Potongan `jenis` asal yang dibebaskan SKB (dicatat di jejak pembayaran). */
  dibebaskanSkb: PembebasanSkb | null;
  /** SKB ada tetapi sudah habis sebelum hari bayar — potongan normal, layar memperingatkan. */
  skbHabis: SkbTercatat | null;
};

const POLA_HARI = /^\d{4}-\d{2}-\d{2}$/;

function skbLengkap(skb: SkbPemasok | null | undefined): SkbTercatat | null {
  const nomor = skb?.nomor?.trim();
  const sampai = skb?.berlakuSampai?.trim();
  if (!nomor || !sampai || !POLA_HARI.test(sampai)) return null;
  return { nomor, berlakuSampai: sampai };
}

export function teksDibebaskanSkb(nomor: string): string {
  return `Dibebaskan SKB ${nomor}`;
}

/** SKB berlaku pada hari bayar `tanggal` ("YYYY-MM-DD" WIB)? */
export function skbBerlaku(skb: SkbPemasok | null | undefined, tanggal: string): boolean {
  const s = skbLengkap(skb);
  return s !== null && POLA_HARI.test(tanggal) && s.berlakuSampai >= tanggal;
}

/**
 * SATU penentu potongan PPh pemasok untuk semua jalur (pratinjau formulir
 * pembayaran, penulis pembayaran, penerapan uang muka, voucher kas keluar ke
 * pemasok): `jenis` = jenis yang diminta/bawaan pemasok, `tanggal` = hari bayar.
 * SKB berlaku → tidak dipotong apa pun jenisnya.
 */
export function tentukanPotongPemasok(p: {
  jenis: JenisPotongPemasok | null;
  skb: SkbPemasok | null | undefined;
  tanggal: string;
}): KeputusanPotongPemasok {
  const s = skbLengkap(p.skb);
  if (!p.jenis || !s) return { jenis: p.jenis, dibebaskanSkb: null, skbHabis: null };
  if (skbBerlaku(s, p.tanggal)) {
    return { jenis: null, dibebaskanSkb: { ...s, jenis: p.jenis, keterangan: teksDibebaskanSkb(s.nomor) }, skbHabis: null };
  }
  return { jenis: p.jenis, dibebaskanSkb: null, skbHabis: POLA_HARI.test(p.tanggal) ? s : null };
}

/** Kolom `Supplier.skbNumber`/`skbValidUntil` → SKB (tanggal sebagai hari WIB). null = tanpa SKB. */
export function bacaSkbPemasok(p: { skbNumber: string | null; skbValidUntil: Date | null }): SkbPemasok | null {
  const nomor = p.skbNumber?.trim();
  if (!nomor) return null;
  return { nomor, berlakuSampai: p.skbValidUntil ? formatDateOnlyJakarta(p.skbValidUntil) : null };
}

/** SKB untuk label daftar master: "SKB s/d <tgl>" atau "SKB habis <tgl>" menurut hari ini (WIB). null = tanpa SKB lengkap. */
export function keadaanSkb(skb: SkbPemasok | null | undefined, hariIni: string): (SkbTercatat & { habis: boolean }) | null {
  const s = skbLengkap(skb);
  return s ? { ...s, habis: s.berlakuSampai < hariIni } : null;
}
