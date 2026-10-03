/**
 * Angka untuk grafik beranda — murni, supaya bisa diuji tanpa basis data.
 *
 * Semua "hari" di sini hari kalender WIB. Penjualan jam 00.30 WIB tercatat
 * sebagai tanggal kemarin dalam UTC; mengelompokkannya per hari UTC akan
 * menaruh penjualan tengah malam di hari yang salah.
 */

const WIB_MS = 7 * 3_600_000;
const HARI_MS = 86_400_000;

export type BarisNilai = { tanggal: Date; nilai: number };

/**
 * Saluran penjualan yang bisa dilihat terpisah di grafik beranda. Marketplace
 * dipecah per `SalesOrder.channel` (Jubelio); `mpLain` menampung OTHER/OFFLINE
 * dari Jubelio. Lapangan dipecah per dokumennya: pengiriman putus, penjualan
 * van, nota SPG. Konsinyasi tidak pernah ada di sini — transfer bukan penjualan.
 */
export const SALURAN_MARKETPLACE = ["shopee", "tiktok", "tokopedia", "mpLain"] as const;
export const SALURAN_LAPANGAN = ["putus", "van", "spg"] as const;
export type SaluranMarketplace = (typeof SALURAN_MARKETPLACE)[number];
export type SaluranLapangan = (typeof SALURAN_LAPANGAN)[number];
export type Saluran = SaluranMarketplace | SaluranLapangan;
export const SALURAN: readonly Saluran[] = [...SALURAN_MARKETPLACE, ...SALURAN_LAPANGAN];

export type BarisSaluran = BarisNilai & { saluran: Saluran };

/**
 * Satu hari di grafik. `marketplace` dan `lapangan` adalah jumlah salurannya
 * masing-masing — selalu, karena dihitung dari rincian yang sama.
 */
export type TitikTren = {
  /** YYYY-MM-DD, hari WIB. */
  tanggal: string;
  marketplace: number;
  lapangan: number;
} & Record<Saluran, number>;

/**
 * Bentuk minimum yang bisa dibandingkan — pemanggil lain (kartu HP, alat
 * analisa) cukup membawa dua jumlahnya; rincian saluran boleh tidak ada.
 */
export type NilaiSaluran = { marketplace: number; lapangan: number } & Partial<Record<Saluran, number>>;
export type TitikDasar = NilaiSaluran & { tanggal: string };

/** `SalesOrder.channel` Jubelio → saluran grafik. Yang tidak dikenal masuk `mpLain`, tidak pernah hilang. */
export function saluranMarketplace(channel: string | null | undefined): SaluranMarketplace {
  switch (channel) {
    case "SHOPEE":
      return "shopee";
    case "TIKTOK":
      return "tiktok";
    case "TOKOPEDIA":
      return "tokopedia";
    default:
      return "mpLain";
  }
}

const LAPANGAN_SET: ReadonlySet<Saluran> = new Set(SALURAN_LAPANGAN);

/**
 * Pilihan "lihat terpisah" di grafik: semua (dua garis, marketplace vs
 * lapangan), satu kelompok (garis per salurannya), atau satu saluran.
 */
export type FilterSaluran = "semua" | "marketplace" | "lapangan" | Saluran;
export const FILTER_SALURAN: readonly FilterSaluran[] = [
  "semua",
  "marketplace",
  ...SALURAN_MARKETPLACE,
  "lapangan",
  ...SALURAN_LAPANGAN,
];

/** Nilai dari URL / isian — apa pun yang tidak dikenal menjadi "semua". */
export function bacaFilterSaluran(x: unknown): FilterSaluran {
  return typeof x === "string" && (FILTER_SALURAN as readonly string[]).includes(x) ? (x as FilterSaluran) : "semua";
}

export type KunciSeri = "marketplace" | "lapangan" | Saluran;

/** Garis yang digambar untuk satu pilihan. */
export function seriFilter(f: FilterSaluran): readonly KunciSeri[] {
  if (f === "semua") return ["marketplace", "lapangan"];
  if (f === "marketplace") return SALURAN_MARKETPLACE;
  if (f === "lapangan") return SALURAN_LAPANGAN;
  return [f];
}

/** Penjualan satu hari menurut pilihan — jumlah garis-garisnya. */
export function nilaiTitik(t: NilaiSaluran, f: FilterSaluran = "semua"): number {
  return seriFilter(f).reduce((s, k) => s + (t[k] ?? 0), 0);
}

function titikKosong(tanggal: string): TitikTren {
  const t = { tanggal, marketplace: 0, lapangan: 0 } as TitikTren;
  for (const k of SALURAN) t[k] = 0;
  return t;
}

export function kunciHariWib(d: Date): string {
  return new Date(d.getTime() + WIB_MS).toISOString().slice(0, 10);
}

/**
 * `n` titik harian yang berakhir hari ini, dari yang terlama, masing-masing
 * diisi nol dulu — hari tanpa penjualan harus tampil sebagai lembah di grafik,
 * bukan dilompati. Setiap baris masuk ke salurannya DAN ke jumlah kelompoknya.
 */
export function susunTren(baris: readonly BarisSaluran[], hariIni: Date, n: number): TitikTren[] {
  const akhir = Date.parse(`${kunciHariWib(hariIni)}T00:00:00Z`);
  const titik: TitikTren[] = [];
  const indeks = new Map<string, TitikTren>();
  for (let i = n - 1; i >= 0; i--) {
    const t = titikKosong(new Date(akhir - i * HARI_MS).toISOString().slice(0, 10));
    titik.push(t);
    indeks.set(t.tanggal, t);
  }
  for (const b of baris) {
    const t = indeks.get(kunciHariWib(b.tanggal));
    if (!t) continue;
    t[b.saluran] += b.nilai;
    if (LAPANGAN_SET.has(b.saluran)) t.lapangan += b.nilai;
    else t.marketplace += b.nilai;
  }
  return titik;
}

/**
 * Nilai bersih satu nota SPG: totalnya dikurangi barang yang sudah dikembalikan
 * pembeli. Harga potong yang dikembalikan = nilai BERSIH baris ÷ jumlahnya
 * (`lineTotal / qty`), karena sejak promo konter `lineTotal` sudah sesudah
 * potongan; baris lama tanpa keduanya memakai `unitPrice`. Tidak pernah di bawah nol.
 */
export function nilaiBersihSpg(
  total: unknown,
  baris: readonly { unitPrice: unknown; returnedQty: unknown; qty?: unknown; lineTotal?: unknown }[],
): number {
  const kembali = baris.reduce((s, b) => {
    const qty = Number(b.qty) || 0;
    const harga = qty > 0 && b.lineTotal !== undefined && b.lineTotal !== null ? (Number(b.lineTotal) || 0) / qty : Number(b.unitPrice) || 0;
    return s + (Number(b.returnedQty) || 0) * harga;
  }, 0);
  return Math.max(0, Math.round(((Number(total) || 0) - kembali) * 100) / 100);
}

/** `h` hari terakhir dibanding `h` hari sebelumnya, untuk saluran pilihan. */
export function bandingkanPeriode(
  tren: readonly NilaiSaluran[],
  h: number,
  f: FilterSaluran = "semua",
): { sekarang: number; sebelumnya: number; persen: number | null } {
  const jumlah = (xs: readonly NilaiSaluran[]) => xs.reduce((s, t) => s + nilaiTitik(t, f), 0);
  const sekarang = jumlah(tren.slice(-h));
  const sebelumnya = jumlah(tren.slice(-2 * h, -h));
  return {
    sekarang,
    sebelumnya,
    persen: sebelumnya > 0 ? Math.round(((sekarang - sebelumnya) / sebelumnya) * 100) : null,
  };
}

/**
 * Cara menyebut perbandingan di kartu tren.
 *
 * - `persen`: ada pembanding — panah, persen, DAN nilai pembandingnya, supaya
 *   "▼ 100%" tidak dibaca tanpa tahu dari berapa ia turun.
 * - `dariNol`: periode sebelumnya nol tapi sekarang ada penjualan. Persen di
 *   atas alas nol tidak berarti apa-apa (∞), jadi tidak ditulis.
 * - `kosong`: dua-duanya nol — tidak ada yang dibandingkan.
 *
 * Arah dari selisih nilainya, bukan dari persen yang sudah dibulatkan: turun
 * 0,4% dibulatkan jadi 0, dan "▲ 0%" untuk penurunan terbaca keliru.
 */
export type KalimatBanding =
  | { jenis: "persen"; arah: "naik" | "turun" | "sama"; persen: number; sebelumnya: number }
  | { jenis: "dariNol" }
  | { jenis: "kosong" };

export function kalimatBanding(b: { sekarang: number; sebelumnya: number }): KalimatBanding {
  if (!(b.sebelumnya > 0)) return b.sekarang > 0 ? { jenis: "dariNol" } : { jenis: "kosong" };
  const selisih = b.sekarang - b.sebelumnya;
  return {
    jenis: "persen",
    arah: selisih > 0 ? "naik" : selisih < 0 ? "turun" : "sama",
    persen: Math.abs(Math.round((selisih / b.sebelumnya) * 100)),
    sebelumnya: b.sebelumnya,
  };
}

export type KelompokUmur = { kunci: "belum" | "h1_30" | "h31_60" | "lebih60"; nilai: number; jumlah: number };

/**
 * Umur piutang dari tanggal jatuh temponya. Sisa (`outstanding`) HARUS yang
 * sudah dihitung ulang oleh `daftarPiutang` — kolom cache tidak pernah dibaca
 * untuk uang. Jatuh tempo hari ini belum terlambat.
 */
export function umurPiutang(
  baris: readonly { dueDate: string; outstanding: number }[],
  hariIni: Date,
): KelompokUmur[] {
  const hasil: KelompokUmur[] = [
    { kunci: "belum", nilai: 0, jumlah: 0 },
    { kunci: "h1_30", nilai: 0, jumlah: 0 },
    { kunci: "h31_60", nilai: 0, jumlah: 0 },
    { kunci: "lebih60", nilai: 0, jumlah: 0 },
  ];
  const hari = Date.parse(`${kunciHariWib(hariIni)}T00:00:00Z`);
  for (const b of baris) {
    if (!(b.outstanding > 0)) continue;
    const jatuhTempo = Date.parse(`${kunciHariWib(new Date(b.dueDate))}T00:00:00Z`);
    const telat = Math.round((hari - jatuhTempo) / HARI_MS);
    const k = telat <= 0 ? 0 : telat <= 30 ? 1 : telat <= 60 ? 2 : 3;
    hasil[k].nilai += b.outstanding;
    hasil[k].jumlah += 1;
  }
  return hasil;
}

/** Rentang bebas terpanjang — setahun. Lebih dari itu grafik hariannya tak terbaca. */
export const MAKS_HARI_RENTANG = 366;

/**
 * Rentang tanggal pilihan pengguna, beserta awal periode pembandingnya: periode
 * sama panjang tepat sebelum rentang itu. `null` untuk rentang yang tidak sah —
 * tanggal yang tidak ada (30 Februari), akhir sebelum awal, atau melebihi
 * `MAKS_HARI_RENTANG`.
 */
export function rentangTren(mulai: string, akhir: string): { panjang: number; mulaiPembanding: string } | null {
  const sah = (s: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    const ms = Date.parse(`${s}T00:00:00Z`);
    return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === s ? ms : null;
  };
  const a = sah(mulai);
  const b = sah(akhir);
  if (a == null || b == null || b < a) return null;
  const panjang = Math.round((b - a) / HARI_MS) + 1;
  if (panjang > MAKS_HARI_RENTANG) return null;
  return { panjang, mulaiPembanding: new Date(a - panjang * HARI_MS).toISOString().slice(0, 10) };
}
