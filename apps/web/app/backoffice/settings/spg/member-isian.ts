import type { AturanMember, TingkatMember } from "@/lib/spg/member";

/**
 * Isian kartu "Member & pelanggan" (Pengaturan → SPG) — murni, dipakai kartu
 * dan dites tanpa peramban. Angka diketik sebagai teks supaya "1.500.000" dan
 * "2,5" terbaca; hasilnya disahkan `sahkanAturanMember` (pembaca yang sama
 * dengan penulis nota) sebelum dikirim.
 *
 * Kode tingkat tidak diketik pemilik: tingkat lama memakai kodenya, tingkat
 * baru mendapat kode dari namanya (huruf besar, unik). Nota menyimpan NAMA
 * tingkat, bukan kodenya.
 */

export type BarisTingkatIsian = {
  /** Kunci baris React — tidak disimpan. */
  kunci: string;
  /** Kode tingkat yang sudah tersimpan; null untuk tingkat yang baru ditambah. */
  kode: string | null;
  nama: string;
  minBelanja: string;
  diskonPersen: string;
};

export type IsianMember = {
  aktif: boolean;
  tingkat: BarisTingkatIsian[];
  periodeBulan: string;
  diskonAktif: boolean;
  gabungPromo: boolean;
  bagianTokoPersen: string;
  minBelanjaDaftar: string;
  hariTidur: string;
};

export function isianDariAturan(a: AturanMember): IsianMember {
  return {
    aktif: a.aktif,
    tingkat: a.tingkat.map((t) => ({ kunci: t.kode, kode: t.kode, nama: t.nama, minBelanja: String(t.minBelanja), diskonPersen: String(t.diskonPersen) })),
    periodeBulan: String(a.periodeBulan),
    diskonAktif: a.diskonAktif,
    gabungPromo: a.gabungPromo,
    bagianTokoPersen: String(a.bagianTokoPersen),
    minBelanjaDaftar: String(a.minBelanjaDaftar),
    hariTidur: String(a.hariTidur),
  };
}

/** Rupiah utuh: titik, koma ribuan, dan spasi diabaikan ("1.500.000" → 1500000). Selain angka = NaN. */
export function bacaRupiah(s: string): number {
  const t = s.replace(/[\s.,]/g, "");
  return /^\d+$/.test(t) ? Number(t) : Number.NaN;
}

/** Bilangan dengan desimal koma atau titik ("2,5" → 2.5). Kosong = NaN. */
export function bacaAngka(s: string): number {
  const t = s.trim().replace(",", ".");
  return t === "" || !/^\d+(\.\d+)?$/.test(t) ? Number.NaN : Number(t);
}

/** Kode tingkat dari nama: huruf besar, selain huruf/angka jadi "_", paling panjang 20, unik terhadap `dipakai`. */
export function kodeTingkatDariNama(nama: string, dipakai: ReadonlySet<string>): string {
  const dasar =
    nama
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 20) || "TINGKAT";
  if (!dipakai.has(dasar)) return dasar;
  for (let i = 2; ; i++) {
    const akhiran = `_${i}`;
    const k = `${dasar.slice(0, 20 - akhiran.length)}${akhiran}`;
    if (!dipakai.has(k)) return k;
  }
}

/** Daftar tingkat dari isian. Tingkat pertama selalu mulai dari Rp0. */
export function tingkatDariIsian(baris: readonly BarisTingkatIsian[]): TingkatMember[] {
  const dipakai = new Set(baris.map((b) => b.kode).filter((k): k is string => !!k));
  return baris.map((b, i) => {
    const nama = b.nama.replace(/\s+/g, " ").trim();
    let kode = b.kode;
    if (!kode) {
      kode = kodeTingkatDariNama(nama, dipakai);
      dipakai.add(kode);
    }
    return { kode, nama, minBelanja: i === 0 ? 0 : bacaRupiah(b.minBelanja), diskonPersen: bacaAngka(b.diskonPersen) };
  });
}

/** Isian → bentuk aturan (angka tidak sah jadi NaN, ditolak `sahkanAturanMember`). */
export function aturanDariIsian(i: IsianMember): AturanMember {
  return {
    aktif: i.aktif,
    tingkat: tingkatDariIsian(i.tingkat),
    periodeBulan: bacaAngka(i.periodeBulan),
    diskonAktif: i.diskonAktif,
    gabungPromo: i.gabungPromo,
    bagianTokoPersen: bacaAngka(i.bagianTokoPersen),
    minBelanjaDaftar: bacaRupiah(i.minBelanjaDaftar),
    hariTidur: bacaAngka(i.hariTidur),
  };
}

const bulatDalam = (v: number, min: number, maks: number) => Number.isInteger(v) && v >= min && v <= maks;
const persenSah = (v: number) => Number.isFinite(v) && v >= 0 && v <= 100 && Math.abs(Math.round(v * 100) - v * 100) < 1e-6;

/** Kolom yang salah, untuk tanda merah per isian. Sama dengan syarat `bacaAturanMember`. */
export function salahIsian(a: AturanMember): { tingkat: Set<number>; periodeBulan: boolean; bagianTokoPersen: boolean; minBelanjaDaftar: boolean; hariTidur: boolean } {
  const tingkat = new Set<number>();
  let sebelum = -1;
  a.tingkat.forEach((t, i) => {
    const min = t.minBelanja;
    const minSah = Number.isInteger(min) && min >= 0 && min <= 1_000_000_000_000 && min > sebelum;
    if (!t.nama || t.nama.length > 30 || !minSah || !persenSah(t.diskonPersen)) tingkat.add(i);
    if (Number.isFinite(min)) sebelum = Math.max(sebelum, min);
  });
  return {
    tingkat,
    periodeBulan: !bulatDalam(a.periodeBulan, 1, 36),
    bagianTokoPersen: !persenSah(a.bagianTokoPersen),
    minBelanjaDaftar: !(Number.isInteger(a.minBelanjaDaftar) && a.minBelanjaDaftar >= 0),
    hariTidur: !bulatDalam(a.hariTidur, 7, 730),
  };
}
