import { bacaVarian, HARI_MINIMAL_DI_TOKO } from "./analisa-toko";

/**
 * Penyerapan barang di satu toko, per artikel dan per varian — aturan murni,
 * tanpa basis data. Kuerinya di `penyerapan-queries.ts`.
 *
 * Pertanyaan pemilik: "artikel mana yang terserap di toko ini?" — barang yang
 * MASUK ke toko dibanding yang benar-benar LAKU ke pembeli, dan yang masih ada
 * di rak. Hanya bisa dijawab bila toko melaporkan penjualannya:
 *   BUKU_TOKO     — toko ber-SPG: buku stok toko mencatat setiap terima, jual,
 *                   dan barang kembali dari pembeli. Angkanya harian dan per
 *                   ukuran, jadi paling dipercaya.
 *   TITIPAN       — toko konsinyasi tanpa buku: titipan (dikirim − terjual −
 *                   diretur) dan laporan laku bulanan. Laku dilaporkan per
 *                   BARANG, jadi angka per ukuran dibagi sebanding dan ditandai
 *                   `perkiraan`.
 *   TANPA_LAPORAN — toko putus tanpa buku: yang kita tahu hanya yang DIBELI
 *                   toko. Laku tidak pernah dikarang; daftarnya kosong.
 *
 * Tidak ada rupiah di sini sama sekali — hanya potong barang.
 */

export type SumberPenyerapan = "BUKU_TOKO" | "TITIPAN" | "TANPA_LAPORAN";
export type StatusSerap = "CEPAT" | "NORMAL" | "LAMBAT" | "BELUM_ADA_DATA";
export type SaranSerap = "ISI_ULANG" | "JANGAN_KIRIM";

/** Terserap (laku ÷ tersedia) setinggi ini = cepat. */
export const AMBANG_CEPAT = 50;
/** Terserap di bawah ini = lambat (bila sudah cukup lama di toko). */
export const AMBANG_LAMBAT = 20;
/** Stok yang tinggal untuk sekian hari pada laju lakunya = hampir habis; juga target isi ulang. */
export const HARI_TUTUP_STOK = 30;
/** Laju laku dihitung atas paling sedikit sekian hari, supaya satu hari ramai tidak terbaca sebagai laju bulanan. */
export const HARI_LAJU_MINIMAL = 14;
/** Batas artikel yang dikirim ke HP. */
export const BATAS_ARTIKEL_SERAP = 200;

const HARI_MS = 86_400_000;

/**
 * Bahan satu barang × varian dalam periode.
 *   awal       — stok di toko di awal periode; null = diturunkan dari
 *                sisa + laku − masuk (titipan tidak menyimpan saldo harian);
 *   masuk      — barang yang masuk ke toko DALAM periode (diterima/dikirim);
 *   tambahLain — tambahan lain dalam periode (selisih lebih opname);
 *   laku       — laku bersih dalam periode (jual dikurangi kembali dari pembeli);
 *   sisa       — stok di toko sekarang (boleh negatif — dipertahankan apa adanya).
 */
export type BahanSerap = {
  itemId: string;
  variantSku: string;
  awal: number | null;
  masuk: number;
  tambahLain: number;
  laku: number;
  sisa: number;
  pertamaMasuk: Date | null;
  perkiraan: boolean;
};

export type AngkaSerap = {
  masuk: number;
  /** Stok yang terbawa dari sebelum periode (tidak pernah negatif). */
  awal: number;
  laku: number;
  sisa: number;
  /** Laku ÷ (awal + masuk), 0–100; null bila tidak ada barang sama sekali. */
  persen: number | null;
  /** Hari sejak barang ini pertama masuk ke toko. */
  umurHari: number | null;
  status: StatusSerap;
  hampirHabis: boolean;
  saran: SaranSerap | null;
  /** Untuk ISI_ULANG: potong yang disarankan supaya stok cukup ±30 hari. */
  saranQty: number;
  perkiraan: boolean;
};

export type VarianSerap = AngkaSerap & { variantSku: string; label: string | null };
export type ArtikelSerap = AngkaSerap & { itemId: string; nama: string; sku: string; varian: VarianSerap[] };

export type RingkasSerap = {
  masuk: number;
  laku: number;
  sisa: number;
  persen: number | null;
  isiUlang: number;
  janganKirim: number;
  cepat: number;
  normal: number;
  lambat: number;
  belum: number;
};

export type Penyerapan = {
  sumber: SumberPenyerapan;
  /** Toko punya laporan laku untuk periode ini. */
  adaDataLaku: boolean;
  artikel: ArtikelSerap[];
  /** Semua artikel, termasuk yang tidak muat di `artikel`. */
  jumlahArtikel: number;
  ringkas: RingkasSerap;
};

export type InfoBarangSerap = { nama: string; sku: string; variants: unknown };

/** Label varian untuk layar: "Hitam · M". null untuk barang tanpa varian. */
export function labelVarianSerap(variants: unknown, variantSku: string, skuInduk: string): string | null {
  if (!variantSku) return null;
  const v = bacaVarian(variants, variantSku, skuInduk);
  const label = [v.warna, v.ukuran].filter(Boolean).join(" · ");
  return label || variantSku;
}

/** Hari aktif untuk laju laku: sepanjang periode, atau sejak barang masuk bila lebih pendek. */
function hariAktif(hariPeriode: number, umurHari: number | null): number {
  const hari = umurHari === null ? hariPeriode : Math.min(hariPeriode, umurHari);
  return Math.max(Math.min(HARI_LAJU_MINIMAL, hariPeriode), hari, 1);
}

/**
 * Nilai satu barang (atau satu varian). Aturannya:
 *   - tanpa laporan laku sama sekali → BELUM_ADA_DATA;
 *   - tidak ada barang dan tidak ada laku → BELUM_ADA_DATA;
 *   - belum laku dan baru < 30 hari di toko → BELUM_ADA_DATA (terlalu dini);
 *   - terserap ≥ 50% → CEPAT; < 20% → LAMBAT (atau NORMAL bila baru < 30 hari);
 *     selebihnya NORMAL.
 * Penyebut terserap tidak pernah lebih kecil dari laku: barang yang laku tanpa
 * pernah tercatat masuk (buku dimulai dari penjualan) tidak menghasilkan
 * persen di atas 100.
 */
export function nilaiSerap(
  a: { awal: number | null; masuk: number; tambahLain: number; laku: number; sisa: number; umurHari: number | null; perkiraan: boolean },
  hariPeriode: number,
  adaDataLaku: boolean,
): AngkaSerap {
  const awal = Math.max(0, a.awal ?? a.sisa + a.laku - a.masuk);
  const tersedia = awal + Math.max(0, a.masuk) + Math.max(0, a.tambahLain);
  const penyebut = Math.max(tersedia, a.laku);
  const persen = penyebut > 0 ? Math.round((Math.max(0, a.laku) / penyebut) * 100) : null;
  const baru = a.umurHari !== null && a.umurHari < HARI_MINIMAL_DI_TOKO;

  let status: StatusSerap;
  if (!adaDataLaku || persen === null) status = "BELUM_ADA_DATA";
  else if (a.laku <= 0 && baru) status = "BELUM_ADA_DATA";
  else if (persen >= AMBANG_CEPAT) status = "CEPAT";
  else if (persen < AMBANG_LAMBAT) status = baru ? "NORMAL" : "LAMBAT";
  else status = "NORMAL";

  const laju = a.laku > 0 ? (a.laku / hariAktif(hariPeriode, a.umurHari)) * HARI_TUTUP_STOK : 0;
  const hampirHabis = adaDataLaku && a.laku > 0 && (a.sisa <= 0 || a.sisa <= laju);
  const isiUlang = status === "CEPAT" && hampirHabis;
  const saran: SaranSerap | null = isiUlang ? "ISI_ULANG" : status === "LAMBAT" && a.sisa > 0 ? "JANGAN_KIRIM" : null;

  return {
    masuk: a.masuk,
    awal,
    laku: a.laku,
    sisa: a.sisa,
    persen,
    umurHari: a.umurHari,
    status,
    hampirHabis,
    saran,
    saranQty: isiUlang ? Math.max(1, Math.ceil(laju) - Math.max(0, a.sisa)) : 0,
    perkiraan: a.perkiraan,
  };
}

/** Urutan tindakan: isi ulang dulu, lalu jangan kirim, lalu cepat, normal, lambat, belum ada data. */
function peringkat(a: AngkaSerap): number {
  if (a.saran === "ISI_ULANG") return 0;
  if (a.saran === "JANGAN_KIRIM") return 1;
  return { CEPAT: 2, NORMAL: 3, LAMBAT: 4, BELUM_ADA_DATA: 5 }[a.status];
}

function bandingkan(a: AngkaSerap & { nama: string }, b: AngkaSerap & { nama: string }): number {
  const p = peringkat(a) - peringkat(b);
  if (p !== 0) return p;
  if (a.saran === "JANGAN_KIRIM") return b.sisa - a.sisa || (b.umurHari ?? 0) - (a.umurHari ?? 0) || a.nama.localeCompare(b.nama);
  return (b.persen ?? -1) - (a.persen ?? -1) || b.laku - a.laku || a.nama.localeCompare(b.nama);
}

const umurDari = (pertama: Date | null, hariIni: Date) =>
  pertama ? Math.max(0, Math.floor((hariIni.getTime() - pertama.getTime()) / HARI_MS)) : null;

/** Varian yang punya cerita di periode ini: ada yang masuk, laku, atau masih di rak. */
const relevan = (b: BahanSerap) => b.masuk > 0 || b.tambahLain > 0 || b.laku !== 0 || b.sisa !== 0;

export function susunPenyerapan(input: {
  sumber: SumberPenyerapan;
  adaDataLaku: boolean;
  bahan: readonly BahanSerap[];
  barang: ReadonlyMap<string, InfoBarangSerap>;
  hariPeriode: number;
  hariIni: Date;
}): Penyerapan {
  const ada = input.sumber !== "TANPA_LAPORAN" && input.adaDataLaku;
  const bahan = input.sumber === "TANPA_LAPORAN" ? [] : input.bahan.filter(relevan);

  const perBarang = new Map<string, BahanSerap[]>();
  for (const b of bahan) {
    const d = perBarang.get(b.itemId);
    if (d) d.push(b);
    else perBarang.set(b.itemId, [b]);
  }

  const semua: ArtikelSerap[] = [...perBarang].map(([itemId, daftar]) => {
    const info = input.barang.get(itemId);
    const nama = info?.nama ?? "—";
    const sku = info?.sku ?? "";
    const varian: VarianSerap[] = daftar
      .map((b) => ({
        ...nilaiSerap({ ...b, umurHari: umurDari(b.pertamaMasuk, input.hariIni) }, input.hariPeriode, ada),
        variantSku: b.variantSku,
        label: labelVarianSerap(info?.variants, b.variantSku, sku),
      }))
      .sort((a, b) => bandingkan({ ...a, nama: a.label ?? "" }, { ...b, nama: b.label ?? "" }));

    // Artikel = jumlah semua variannya; awal tiap varian sudah diturunkan di nilaiSerap.
    const pertama = daftar.reduce<Date | null>((m, b) => (b.pertamaMasuk && (!m || b.pertamaMasuk < m) ? b.pertamaMasuk : m), null);
    const jumlah = nilaiSerap(
      {
        awal: varian.reduce((n, v) => n + v.awal, 0),
        masuk: daftar.reduce((n, b) => n + b.masuk, 0),
        tambahLain: daftar.reduce((n, b) => n + b.tambahLain, 0),
        laku: daftar.reduce((n, b) => n + b.laku, 0),
        sisa: daftar.reduce((n, b) => n + b.sisa, 0),
        umurHari: umurDari(pertama, input.hariIni),
        perkiraan: daftar.some((b) => b.perkiraan),
      },
      input.hariPeriode,
      ada,
    );
    // Satu ukuran yang hampir habis sudah cukup untuk menyarankan isi ulang —
    // artikel yang "normal" secara rata-rata bisa saja kehabisan ukuran larisnya.
    const isiVarian = varian.filter((v) => v.saran === "ISI_ULANG");
    const saran: SaranSerap | null = isiVarian.length > 0 ? "ISI_ULANG" : jumlah.saran === "JANGAN_KIRIM" ? "JANGAN_KIRIM" : null;
    return {
      ...jumlah,
      saran,
      saranQty: isiVarian.reduce((n, v) => n + v.saranQty, 0),
      itemId,
      nama,
      sku,
      varian,
    };
  });
  semua.sort(bandingkan);

  const total = (k: "masuk" | "laku" | "sisa") => semua.reduce((n, a) => n + a[k], 0);
  const tersedia = semua.reduce((n, a) => n + a.awal + Math.max(0, a.masuk), 0);
  const laku = total("laku");
  const penyebut = Math.max(tersedia, laku);
  const hitung = (f: (a: ArtikelSerap) => boolean) => semua.filter(f).length;

  return {
    sumber: input.sumber,
    adaDataLaku: ada,
    artikel: semua.slice(0, BATAS_ARTIKEL_SERAP),
    jumlahArtikel: semua.length,
    ringkas: {
      masuk: total("masuk"),
      laku,
      sisa: total("sisa"),
      persen: ada && penyebut > 0 ? Math.round((Math.max(0, laku) / penyebut) * 100) : null,
      isiUlang: hitung((a) => a.saran === "ISI_ULANG"),
      janganKirim: hitung((a) => a.saran === "JANGAN_KIRIM"),
      cepat: hitung((a) => a.status === "CEPAT"),
      normal: hitung((a) => a.status === "NORMAL"),
      lambat: hitung((a) => a.status === "LAMBAT"),
      belum: hitung((a) => a.status === "BELUM_ADA_DATA"),
    },
  };
}
