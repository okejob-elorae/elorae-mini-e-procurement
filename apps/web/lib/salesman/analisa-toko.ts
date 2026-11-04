import { kunciHariWib } from "@/lib/dashboard/tren";
import { daftarBulan, persenPerubahan } from "./riwayat-penjualan";

/**
 * Analisa satu toko di HP salesman — aturan murni, tanpa basis data. Kuerinya
 * di `analisa-toko-queries.ts`.
 *
 * Pertanyaan pemilik: "barang jenis apa yang laku di toko ini?". Jawabannya
 * dihitung dari satu DASAR per toko:
 *   BELI — toko putus: barang yang toko beli dari kita (kiriman putus + van ke
 *          toko itu). Untuk toko putus, terbeli = terjual dari sisi kita.
 *   LAKU — toko konsinyasi: barang yang benar-benar terjual ke pembeli (buku
 *          stok toko, atau laporan laku konsinyasi). Barang titipan yang
 *          dikirim belum tentu laku, jadi kiriman tidak dipakai bila ada data
 *          laku.
 *   KIRIM — toko konsinyasi yang belum punya data laku sama sekali: terpaksa
 *          dari kiriman, dan layarnya MENYEBUT itu.
 *
 * Nilai rupiah hanya untuk toko putus. Toko konsinyasi tidak pernah membawa
 * rupiah ke HP (aturan "KONSI prices and totals never reach the salesman app").
 */

export const PERIODE_ANALISA = [3, 6, 12] as const;
export type PeriodeAnalisa = (typeof PERIODE_ANALISA)[number];
export const PERIODE_BAWAAN: PeriodeAnalisa = 3;

export const BATAS_ARTIKEL = 10;
export const BATAS_VARIAN_ARTIKEL = 3;
export const BATAS_LAKU = 5;
/** Barang yang baru tiba belum adil dicap "tidak laku". */
export const HARI_MINIMAL_DI_TOKO = 30;
/** Perubahan pcs di bawah ini dianggap "tetap". */
export const AMBANG_ARAH = 10;
/** Kenaikan porsi (poin persen) yang cukup untuk disebut di wawasan. */
export const AMBANG_NAIK_PORSI = 5;

const HARI_MS = 86_400_000;

export type DasarAnalisa = "BELI" | "LAKU" | "KIRIM";

export function pilihPeriode(param: unknown): PeriodeAnalisa {
  const n = typeof param === "string" ? Number(param) : NaN;
  return (PERIODE_ANALISA as readonly number[]).includes(n) ? (n as PeriodeAnalisa) : PERIODE_BAWAAN;
}

// ─── Periode ──────────────────────────────────────────────────────────────────

/** Tanggal WIB "YYYY-MM-DD" mundur `n` bulan; tanggalnya dijepit ke akhir bulan tujuan. */
function mundurBulanTanggal(kunci: string, n: number): string {
  const [th, bl, tg] = kunci.split("-").map(Number);
  const awal = new Date(Date.UTC(th, bl - 1 - n, 1));
  const hari = Math.min(tg, new Date(Date.UTC(awal.getUTCFullYear(), awal.getUTCMonth() + 1, 0)).getUTCDate());
  return `${awal.getUTCFullYear()}-${String(awal.getUTCMonth() + 1).padStart(2, "0")}-${String(hari).padStart(2, "0")}`;
}

export type RentangAnalisa = {
  /** Awal periode (inklusif). */
  awal: Date;
  /** Awal besok WIB (eksklusif) — hari ini ikut dihitung. */
  akhir: Date;
  /** Awal periode pembanding; pembanding = [awalSebelumnya, awal). */
  awalSebelumnya: Date;
  /** Bulan kalender WIB untuk grafik tren, dari yang terlama. */
  bulanTren: string[];
};

/**
 * Periode bergulir: `bulan` bulan terakhir sampai hari ini, dibandingkan dengan
 * `bulan` bulan sebelumnya yang sama panjangnya. Bukan bulan kalender: bulan
 * berjalan yang baru beberapa hari akan membuat setiap kategori tampak turun.
 */
export function rentangAnalisa(hariIni: Date, bulan: PeriodeAnalisa): RentangAnalisa {
  const besok = new Date(Date.parse(`${kunciHariWib(hariIni)}T00:00:00+07:00`) + HARI_MS);
  const kunciBesok = kunciHariWib(besok);
  const awal = new Date(`${mundurBulanTanggal(kunciBesok, bulan)}T00:00:00+07:00`);
  const awalSebelumnya = new Date(`${mundurBulanTanggal(kunciBesok, bulan * 2)}T00:00:00+07:00`);
  return { awal, akhir: besok, awalSebelumnya, bulanTren: daftarBulan(hariIni, bulan) };
}

// ─── Varian: ukuran dan warna ─────────────────────────────────────────────────

const KUNCI_UKURAN = new Set(["size", "ukuran"]);
const KUNCI_WARNA = new Set(["color", "colour", "warna"]);

function barisVarian(variants: unknown): Record<string, unknown>[] {
  let v = variants;
  // Sebagian data lama menyimpan varian sebagai TEKS JSON, bukan larik.
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return [];
    }
  }
  return Array.isArray(v) ? v.filter((o): o is Record<string, unknown> => !!o && typeof o === "object" && !Array.isArray(o)) : [];
}

function ambilNilai(baris: Record<string, unknown>, kunci: ReadonlySet<string>): string | null {
  for (const [k, v] of Object.entries(baris)) {
    if (!kunci.has(k.toLowerCase())) continue;
    const s = v == null ? "" : String(v).trim();
    if (s) return s;
  }
  return null;
}

export type Varian = { ukuran: string | null; warna: string | null };

/**
 * Ukuran dan warna satu SKU varian. Dibaca dari `Item.variants` (kunci tanpa
 * peduli huruf besar: Size/size/ukuran, Color/color/warna). Bila barisnya tidak
 * ada, ditebak dari akhiran SKU varian di belakang SKU induk:
 * `INDUK-HTM-XL` → warna HTM, ukuran XL; `INDUK-32` → ukuran 32.
 */
export function bacaVarian(variants: unknown, variantSku: string | null | undefined, skuInduk: string): Varian {
  const sku = (variantSku ?? "").trim();
  if (!sku) return { ukuran: null, warna: null };
  const baris = barisVarian(variants).find((r) => {
    const s = ambilNilai(r, new Set(["sku"]));
    return s !== null && s.toLowerCase() === sku.toLowerCase();
  });
  if (baris) {
    const ukuran = ambilNilai(baris, KUNCI_UKURAN);
    const warna = ambilNilai(baris, KUNCI_WARNA);
    if (ukuran || warna) return { ukuran, warna };
  }
  const induk = skuInduk.trim();
  if (induk && sku.toLowerCase().startsWith(`${induk.toLowerCase()}-`)) {
    const sisa = sku.slice(induk.length + 1).split("-").filter(Boolean);
    if (sisa.length === 1) return { ukuran: sisa[0], warna: null };
    if (sisa.length >= 2) return { ukuran: sisa[sisa.length - 1], warna: sisa.slice(0, -1).join("-") };
  }
  return { ukuran: null, warna: null };
}

// ─── Analisa ──────────────────────────────────────────────────────────────────

/** Satu potongan bahan analisa: barang × varian × tanggal. `nilai` null = tanpa rupiah (konsinyasi). */
export type BarisAnalisa = { tanggal: Date; itemId: string; variantSku: string; pcs: number; nilai: number | null };

export type InfoBarangAnalisa = { nama: string; sku: string; kategoriId: string | null; variants: unknown };

export type Arah = "naik" | "turun" | "tetap" | "baru";

export type BagianLabel = { label: string; pcs: number; persen: number };

export type KategoriAnalisa = {
  /** null = barang tanpa kategori. */
  kategoriId: string | null;
  nama: string | null;
  pcs: number;
  pcsSebelumnya: number;
  /** Porsi pcs dalam periode ini. */
  persen: number;
  /** Porsi pcs di periode pembanding; null bila pembandingnya kosong. */
  persenSebelumnya: number | null;
  nilai: number | null;
  arah: Arah;
};

export type ArtikelAnalisa = {
  itemId: string;
  nama: string;
  sku: string;
  pcs: number;
  nilai: number | null;
  ukuran: BagianLabel[];
  warna: BagianLabel[];
};

export type Analisa = {
  totalPcs: number;
  totalPcsSebelumnya: number;
  /** Perubahan pcs dibanding periode sebelumnya; null bila pembandingnya nol. */
  perubahanPcs: number | null;
  /** null bila nilai tidak ditampilkan (toko konsinyasi). */
  totalNilai: number | null;
  kategori: KategoriAnalisa[];
  artikel: ArtikelAnalisa[];
  ukuran: BagianLabel[];
  warna: BagianLabel[];
  tren: { bulan: string; pcs: number }[];
};

export function arahPerubahan(sekarang: number, dulu: number): Arah {
  if (dulu <= 0) return sekarang > 0 ? "baru" : "tetap";
  const persen = ((sekarang - dulu) / dulu) * 100;
  if (persen >= AMBANG_ARAH) return "naik";
  if (persen <= -AMBANG_ARAH) return "turun";
  return "tetap";
}

const persenDari = (bagian: number, total: number) => (total > 0 ? Math.round((bagian / total) * 100) : 0);

/** Kelompokkan label (ukuran/warna) tanpa peduli huruf besar; bentuk tampilan = yang pertama muncul. */
function susunLabel(pasangan: readonly { label: string | null; pcs: number }[], batas?: number): BagianLabel[] {
  // Dijumlah dulu, baru disaring: barang yang dikembalikan pembeli (pcs
  // negatif) mengurangi ukurannya, bukan dibuang.
  const per = new Map<string, { label: string; pcs: number }>();
  for (const p of pasangan) {
    if (!p.label) continue;
    const k = p.label.toLowerCase();
    const ada = per.get(k);
    if (ada) ada.pcs += p.pcs;
    else per.set(k, { label: p.label, pcs: p.pcs });
  }
  const positif = [...per.values()].filter((x) => x.pcs > 0);
  const total = positif.reduce((n, x) => n + x.pcs, 0);
  const hasil = positif
    .map((x) => ({ label: x.label, pcs: x.pcs, persen: persenDari(x.pcs, total) }))
    .sort((a, b) => b.pcs - a.pcs || a.label.localeCompare(b.label));
  return batas === undefined ? hasil : hasil.slice(0, batas);
}

export function susunAnalisa(input: {
  baris: readonly BarisAnalisa[];
  barang: ReadonlyMap<string, InfoBarangAnalisa>;
  kategori: ReadonlyMap<string, string>;
  rentang: RentangAnalisa;
  tampilNilai: boolean;
}): Analisa {
  const { rentang } = input;
  const awal = rentang.awal.getTime();
  const awalLalu = rentang.awalSebelumnya.getTime();
  const akhir = rentang.akhir.getTime();
  const kini = input.baris.filter((b) => b.tanggal.getTime() >= awal && b.tanggal.getTime() < akhir);
  const lalu = input.baris.filter((b) => b.tanggal.getTime() >= awalLalu && b.tanggal.getTime() < awal);

  const kategoriDari = (itemId: string) => input.barang.get(itemId)?.kategoriId ?? null;
  const kunciKat = (id: string | null) => id ?? "";

  // Kategori
  const kat = new Map<string, { id: string | null; pcs: number; pcsLalu: number; sen: number }>();
  const ambilKat = (id: string | null) => {
    let k = kat.get(kunciKat(id));
    if (!k) kat.set(kunciKat(id), (k = { id, pcs: 0, pcsLalu: 0, sen: 0 }));
    return k;
  };
  let totalSen = 0;
  for (const b of kini) {
    const k = ambilKat(kategoriDari(b.itemId));
    k.pcs += b.pcs;
    if (b.nilai !== null) {
      const s = Math.round(b.nilai * 100);
      k.sen += s;
      totalSen += s;
    }
  }
  for (const b of lalu) ambilKat(kategoriDari(b.itemId)).pcsLalu += b.pcs;

  const totalPcs = kini.reduce((n, b) => n + b.pcs, 0);
  const totalPcsSebelumnya = lalu.reduce((n, b) => n + b.pcs, 0);

  const kategori: KategoriAnalisa[] = [...kat.values()]
    .filter((k) => k.pcs > 0 || k.pcsLalu > 0)
    .map((k) => ({
      kategoriId: k.id,
      nama: k.id === null ? null : (input.kategori.get(k.id) ?? null),
      pcs: k.pcs,
      pcsSebelumnya: k.pcsLalu,
      persen: persenDari(k.pcs, totalPcs),
      persenSebelumnya: totalPcsSebelumnya > 0 ? persenDari(k.pcsLalu, totalPcsSebelumnya) : null,
      nilai: input.tampilNilai ? k.sen / 100 : null,
      arah: arahPerubahan(k.pcs, k.pcsLalu),
    }))
    .sort((a, b) => b.pcs - a.pcs || b.pcsSebelumnya - a.pcsSebelumnya || (a.nama ?? "").localeCompare(b.nama ?? ""));

  // Artikel (barang) dengan ukuran dan warna terlarisnya
  const art = new Map<string, { pcs: number; sen: number; varian: { label: Varian; pcs: number }[] }>();
  const semuaVarian: { label: Varian; pcs: number }[] = [];
  for (const b of kini) {
    let a = art.get(b.itemId);
    if (!a) art.set(b.itemId, (a = { pcs: 0, sen: 0, varian: [] }));
    a.pcs += b.pcs;
    if (b.nilai !== null) a.sen += Math.round(b.nilai * 100);
    const info = input.barang.get(b.itemId);
    const v = bacaVarian(info?.variants, b.variantSku, info?.sku ?? "");
    a.varian.push({ label: v, pcs: b.pcs });
    semuaVarian.push({ label: v, pcs: b.pcs });
  }
  const artikel: ArtikelAnalisa[] = [...art]
    .filter(([, a]) => a.pcs > 0)
    .map(([itemId, a]) => ({
      itemId,
      nama: input.barang.get(itemId)?.nama ?? "—",
      sku: input.barang.get(itemId)?.sku ?? "",
      pcs: a.pcs,
      nilai: input.tampilNilai ? a.sen / 100 : null,
      ukuran: susunLabel(a.varian.map((v) => ({ label: v.label.ukuran, pcs: v.pcs })), BATAS_VARIAN_ARTIKEL),
      warna: susunLabel(a.varian.map((v) => ({ label: v.label.warna, pcs: v.pcs })), BATAS_VARIAN_ARTIKEL),
    }))
    .sort((a, b) => b.pcs - a.pcs || (b.nilai ?? 0) - (a.nilai ?? 0) || a.nama.localeCompare(b.nama))
    .slice(0, BATAS_ARTIKEL);

  // Tren per bulan kalender WIB
  const tren = new Map(rentang.bulanTren.map((b) => [b, 0]));
  for (const b of input.baris) {
    if (b.tanggal.getTime() >= akhir) continue;
    const k = kunciHariWib(b.tanggal).slice(0, 7);
    if (tren.has(k)) tren.set(k, (tren.get(k) ?? 0) + b.pcs);
  }

  return {
    totalPcs,
    totalPcsSebelumnya,
    perubahanPcs: persenPerubahan(totalPcs, totalPcsSebelumnya),
    totalNilai: input.tampilNilai ? totalSen / 100 : null,
    kategori,
    artikel,
    ukuran: susunLabel(semuaVarian.map((v) => ({ label: v.label.ukuran, pcs: v.pcs }))),
    warna: susunLabel(semuaVarian.map((v) => ({ label: v.label.warna, pcs: v.pcs }))),
    tren: [...tren].map(([bulan, pcs]) => ({ bulan, pcs })),
  };
}

// ─── Laku di toko konsinyasi ──────────────────────────────────────────────────

export type SumberLaku = "BUKU_TOKO" | "TITIPAN";
export type StokSekarang = { itemId: string; variantSku: string; qty: number; firstInAt: Date | null };

export type BarangLaku = { itemId: string; nama: string; sku: string; laku: number; sisa: number; persen: number };
export type BarangLambat = { itemId: string; nama: string; sku: string; sisa: number; hariDiToko: number | null };

export type Laku = {
  sumber: SumberLaku;
  /** Ada data laku sama sekali di periode ini atau pembandingnya. */
  adaDataLaku: boolean;
  terkirimPcs: number;
  lakuPcs: number;
  /** Stok di toko sekarang (hanya yang positif). */
  sisaPcs: number;
  /** Laku ÷ terkirim dalam periode ini; null bila tidak ada kiriman. */
  persenLakuDariKirim: number | null;
  cepat: BarangLaku[];
  lambat: BarangLambat[];
  /** Semua barang lambat, termasuk yang tidak muat di daftar. */
  jumlahLambat: number;
};

/**
 * Barang yang benar-benar laku vs yang dikirim, per BARANG (ukuran digabung):
 *   cepat  = paling banyak laku di periode ini; persen = laku ÷ (laku + sisa
 *            di toko) — dari barang yang sempat ada di toko, berapa yang laku;
 *   lambat = masih ada di toko, sudah lebih dari 30 hari, dan TIDAK laku satu
 *            pun di periode ini — "dikirim tapi tidak jalan".
 */
export function susunLaku(input: {
  sumber: SumberLaku;
  rentang: RentangAnalisa;
  terkirim: readonly BarisAnalisa[];
  terjual: readonly BarisAnalisa[];
  stok: readonly StokSekarang[];
  barang: ReadonlyMap<string, InfoBarangAnalisa>;
  hariIni: Date;
}): Laku {
  const awal = input.rentang.awal.getTime();
  const awalLalu = input.rentang.awalSebelumnya.getTime();
  const akhir = input.rentang.akhir.getTime();
  const diPeriode = (b: BarisAnalisa) => b.tanggal.getTime() >= awal && b.tanggal.getTime() < akhir;

  const lakuPer = new Map<string, number>();
  for (const b of input.terjual) if (diPeriode(b)) lakuPer.set(b.itemId, (lakuPer.get(b.itemId) ?? 0) + b.pcs);
  const sisaPer = new Map<string, { qty: number; pertama: Date | null }>();
  for (const s of input.stok) {
    const ada = sisaPer.get(s.itemId);
    if (!ada) sisaPer.set(s.itemId, { qty: s.qty, pertama: s.firstInAt });
    else {
      ada.qty += s.qty;
      if (s.firstInAt && (!ada.pertama || s.firstInAt < ada.pertama)) ada.pertama = s.firstInAt;
    }
  }

  const nama = (id: string) => input.barang.get(id)?.nama ?? "—";
  const sku = (id: string) => input.barang.get(id)?.sku ?? "";

  const terkirimPcs = input.terkirim.filter(diPeriode).reduce((n, b) => n + b.pcs, 0);
  const lakuPcs = [...lakuPer.values()].reduce((n, x) => n + x, 0);
  const sisaPcs = [...sisaPer.values()].reduce((n, x) => n + Math.max(0, x.qty), 0);

  const cepat: BarangLaku[] = [...lakuPer]
    .filter(([, laku]) => laku > 0)
    .map(([itemId, laku]) => {
      const sisa = Math.max(0, sisaPer.get(itemId)?.qty ?? 0);
      return { itemId, nama: nama(itemId), sku: sku(itemId), laku, sisa, persen: persenDari(laku, laku + sisa) };
    })
    .sort((a, b) => b.laku - a.laku || b.persen - a.persen || a.nama.localeCompare(b.nama))
    .slice(0, BATAS_LAKU);

  const batasLama = input.hariIni.getTime() - HARI_MINIMAL_DI_TOKO * HARI_MS;
  const semuaLambat: BarangLambat[] = [...sisaPer]
    .filter(([itemId, s]) => s.qty > 0 && (lakuPer.get(itemId) ?? 0) <= 0 && (!s.pertama || s.pertama.getTime() <= batasLama))
    .map(([itemId, s]) => ({
      itemId,
      nama: nama(itemId),
      sku: sku(itemId),
      sisa: s.qty,
      hariDiToko: s.pertama ? Math.floor((input.hariIni.getTime() - s.pertama.getTime()) / HARI_MS) : null,
    }))
    .sort((a, b) => b.sisa - a.sisa || (b.hariDiToko ?? 0) - (a.hariDiToko ?? 0) || a.nama.localeCompare(b.nama));

  return {
    sumber: input.sumber,
    adaDataLaku: input.terjual.some((b) => b.pcs !== 0 && b.tanggal.getTime() >= awalLalu && b.tanggal.getTime() < akhir),
    terkirimPcs,
    lakuPcs,
    sisaPcs,
    persenLakuDariKirim: terkirimPcs > 0 ? persenDari(lakuPcs, terkirimPcs) : null,
    cepat,
    lambat: semuaLambat.slice(0, BATAS_LAKU),
    jumlahLambat: semuaLambat.length,
  };
}

// ─── Wawasan ──────────────────────────────────────────────────────────────────

/**
 * Kalimat ringkas di atas halaman. Bentuknya data, bukan teks: layar yang
 * menerjemahkan, supaya satu aturan berlaku untuk kedua bahasa.
 */
export type Wawasan =
  | { kode: "TANPA_DATA_LAKU" }
  | { kode: "LAKU_DARI_KIRIM"; persen: number; laku: number; terkirim: number }
  | { kode: "BELUM_LAKU"; jumlah: number }
  | { kode: "KATEGORI_UTAMA"; kategori: string; persen: number; persenSebelumnya: number | null }
  | { kode: "KATEGORI_NAIK"; kategori: string; dari: number; ke: number }
  | { kode: "UKURAN"; ukuran: string; persen: number }
  | { kode: "WARNA"; warna: string; persen: number }
  | { kode: "TOTAL"; pcs: number; persen: number | null };

export const BATAS_WAWASAN = 5;

export function susunWawasan(analisa: Analisa, laku: Laku | null): Wawasan[] {
  const hasil: Wawasan[] = [];

  if (laku) {
    if (!laku.adaDataLaku) hasil.push({ kode: "TANPA_DATA_LAKU" });
    else if (laku.persenLakuDariKirim !== null)
      hasil.push({ kode: "LAKU_DARI_KIRIM", persen: laku.persenLakuDariKirim, laku: laku.lakuPcs, terkirim: laku.terkirimPcs });
    if (laku.jumlahLambat > 0) hasil.push({ kode: "BELUM_LAKU", jumlah: laku.jumlahLambat });
  }

  if (analisa.totalPcs > 0) {
    // Porsi baru bermakna kalau ada lebih dari satu kelompok untuk dibandingkan.
    const bernama = analisa.kategori.filter((k) => k.nama !== null && k.pcs > 0);
    const utama = analisa.kategori.length > 1 ? bernama[0] : undefined;
    if (utama?.nama) {
      hasil.push({ kode: "KATEGORI_UTAMA", kategori: utama.nama, persen: utama.persen, persenSebelumnya: utama.persenSebelumnya });
    }
    const naik = bernama
      .filter((k) => k !== utama && k.persenSebelumnya !== null && k.persen - k.persenSebelumnya >= AMBANG_NAIK_PORSI)
      .sort((a, b) => b.persen - (b.persenSebelumnya ?? 0) - (a.persen - (a.persenSebelumnya ?? 0)))[0];
    if (naik?.nama && naik.persenSebelumnya !== null) {
      hasil.push({ kode: "KATEGORI_NAIK", kategori: naik.nama, dari: naik.persenSebelumnya, ke: naik.persen });
    }
    if (analisa.ukuran.length > 1) hasil.push({ kode: "UKURAN", ukuran: analisa.ukuran[0].label, persen: analisa.ukuran[0].persen });
    if (analisa.warna.length > 1) hasil.push({ kode: "WARNA", warna: analisa.warna[0].label, persen: analisa.warna[0].persen });
    hasil.push({ kode: "TOTAL", pcs: analisa.totalPcs, persen: analisa.perubahanPcs });
  }

  return hasil.slice(0, BATAS_WAWASAN);
}

/** Arah porsi untuk kalimat "naik dari 30%" — selisih di bawah satu poin = sama. */
export function arahPorsi(persen: number, persenSebelumnya: number | null): "naik" | "turun" | "sama" | null {
  if (persenSebelumnya === null) return null;
  if (persen > persenSebelumnya) return "naik";
  if (persen < persenSebelumnya) return "turun";
  return "sama";
}
