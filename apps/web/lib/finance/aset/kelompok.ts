/*
 * Kelompok aset tetap dan metode penyusutannya (rancangan akuntansi & pajak
 * lengkap, bagian D3). Murni — aman untuk komponen klien.
 *
 * Kelompok fiskal menurut UU PPh Pasal 11 jo. PMK 72/2023: masa manfaat
 * tetap, tarif garis lurus 25 / 12,5 / 6,25 / 5 % setahun dan saldo menurun
 * dua kalinya (50 / 25 / 12,5 / 10 %). Bangunan HANYA garis lurus: permanen
 * 20 tahun (5 %), tidak permanen 10 tahun (10 %). Tanah tidak disusutkan.
 * Aset fiskal tidak punya nilai sisa — seluruh harga perolehan disusutkan.
 *
 * Aset "komersial" bebas umur dan tarifnya (mis. kebijakan akuntansi yang
 * berbeda dari fiskal); nilai sisa hanya boleh diisi di sini.
 */

export const KATEGORI_ASET = [
  "KELOMPOK_1",
  "KELOMPOK_2",
  "KELOMPOK_3",
  "KELOMPOK_4",
  "BANGUNAN_PERMANEN",
  "BANGUNAN_TIDAK_PERMANEN",
  "TANAH",
  "KOMERSIAL",
] as const;

export type KategoriAset = (typeof KATEGORI_ASET)[number];

export const METODE_PENYUSUTAN = {
  GARIS_LURUS: "STRAIGHT_LINE",
  SALDO_MENURUN: "DECLINING_BALANCE",
} as const;

export type MetodePenyusutan = (typeof METODE_PENYUSUTAN)[keyof typeof METODE_PENYUSUTAN];

export const SEMUA_METODE: readonly MetodePenyusutan[] = [METODE_PENYUSUTAN.GARIS_LURUS, METODE_PENYUSUTAN.SALDO_MENURUN];

export type AturanKategori = {
  label: string;
  /** Contoh harta, untuk pilihan di formulir. */
  contoh: string;
  /** Masa manfaat tetap (bulan); null = bebas diisi (komersial); 0 = tidak disusutkan (tanah). */
  umurBulan: number | null;
  metodeBoleh: readonly MetodePenyusutan[];
  /** Tarif saldo menurun setahun (%) untuk kelompok fiskal; null = bebas / tidak berlaku. */
  tarifSaldoMenurun: number | null;
  /** Kelompok fiskal: nilai sisa wajib nol. */
  fiskal: boolean;
};

export const ATURAN_KATEGORI: Readonly<Record<KategoriAset, AturanKategori>> = {
  KELOMPOK_1: {
    label: "Kelompok 1 (4 tahun)",
    contoh: "komputer, printer, peralatan kantor, mebel kayu, sepeda motor",
    umurBulan: 48,
    metodeBoleh: SEMUA_METODE,
    tarifSaldoMenurun: 50,
    fiskal: true,
  },
  KELOMPOK_2: {
    label: "Kelompok 2 (8 tahun)",
    contoh: "mobil, AC, mebel logam",
    umurBulan: 96,
    metodeBoleh: SEMUA_METODE,
    tarifSaldoMenurun: 25,
    fiskal: true,
  },
  KELOMPOK_3: {
    label: "Kelompok 3 (16 tahun)",
    contoh: "mesin industri berat",
    umurBulan: 192,
    metodeBoleh: SEMUA_METODE,
    tarifSaldoMenurun: 12.5,
    fiskal: true,
  },
  KELOMPOK_4: {
    label: "Kelompok 4 (20 tahun)",
    contoh: "mesin dan alat berat",
    umurBulan: 240,
    metodeBoleh: SEMUA_METODE,
    tarifSaldoMenurun: 10,
    fiskal: true,
  },
  BANGUNAN_PERMANEN: {
    label: "Bangunan permanen (20 tahun)",
    contoh: "gedung kantor, gudang, toko",
    umurBulan: 240,
    metodeBoleh: [METODE_PENYUSUTAN.GARIS_LURUS],
    tarifSaldoMenurun: null,
    fiskal: true,
  },
  BANGUNAN_TIDAK_PERMANEN: {
    label: "Bangunan tidak permanen (10 tahun)",
    contoh: "bangunan semi permanen, kios",
    umurBulan: 120,
    metodeBoleh: [METODE_PENYUSUTAN.GARIS_LURUS],
    tarifSaldoMenurun: null,
    fiskal: true,
  },
  TANAH: {
    label: "Tanah (tidak disusutkan)",
    contoh: "tanah",
    umurBulan: 0,
    metodeBoleh: [METODE_PENYUSUTAN.GARIS_LURUS],
    tarifSaldoMenurun: null,
    fiskal: true,
  },
  KOMERSIAL: {
    label: "Komersial (umur bebas)",
    contoh: "aset dengan kebijakan umur sendiri",
    umurBulan: null,
    metodeBoleh: SEMUA_METODE,
    tarifSaldoMenurun: null,
    fiskal: false,
  },
};

export const LABEL_METODE: Readonly<Record<MetodePenyusutan, string>> = {
  STRAIGHT_LINE: "Garis lurus",
  DECLINING_BALANCE: "Saldo menurun",
};

export function bacaKategoriAset(v: unknown): KategoriAset | null {
  return typeof v === "string" && (KATEGORI_ASET as readonly string[]).includes(v) ? (v as KategoriAset) : null;
}

export function bacaMetode(v: unknown): MetodePenyusutan | null {
  return typeof v === "string" && (SEMUA_METODE as readonly string[]).includes(v) ? (v as MetodePenyusutan) : null;
}

export function labelKategori(v: string): string {
  const k = bacaKategoriAset(v);
  return k ? ATURAN_KATEGORI[k].label : v;
}

export function labelMetode(v: string): string {
  const m = bacaMetode(v);
  return m ? LABEL_METODE[m] : v;
}

/** Batas umur aset komersial: 50 tahun. */
export const UMUR_KOMERSIAL_MAKS = 600;

/**
 * Tarif saldo menurun bawaan aset komersial: dua kali tarif garis lurusnya
 * (sama dengan aturan fiskal), dibulatkan dua desimal.
 */
export function tarifSaldoMenurunBawaan(umurBulan: number): number {
  if (!(umurBulan > 0)) return 0;
  return Math.round((2 * 12 * 100 * 100) / umurBulan) / 100;
}

/** Umur, tarif, dan metode yang BERLAKU untuk kategori + isian (fiskal menimpa isian). */
export function aturanBerlaku(
  kategori: KategoriAset,
  isian: { umurBulan?: number | null; metode?: MetodePenyusutan | null; tarifSaldoMenurun?: number | null },
): { umurBulan: number; metode: MetodePenyusutan; tarifSaldoMenurun: number | null } {
  const a = ATURAN_KATEGORI[kategori];
  const umurBulan = a.umurBulan ?? Math.trunc(Number(isian.umurBulan) || 0);
  const metode = isian.metode && a.metodeBoleh.includes(isian.metode) ? isian.metode : a.metodeBoleh[0];
  const tarifSaldoMenurun =
    metode === METODE_PENYUSUTAN.SALDO_MENURUN
      ? (a.tarifSaldoMenurun ?? (isian.tarifSaldoMenurun != null && isian.tarifSaldoMenurun > 0 ? Number(isian.tarifSaldoMenurun) : tarifSaldoMenurunBawaan(umurBulan)))
      : null;
  return { umurBulan, metode, tarifSaldoMenurun };
}
