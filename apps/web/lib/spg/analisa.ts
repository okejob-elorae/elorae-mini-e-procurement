import { kunciHariWib } from "@/lib/dashboard/tren";
import {
  arahPerubahan,
  bacaVarian,
  HARI_MINIMAL_DI_TOKO,
  susunAnalisa,
  susunLaku,
  type Arah,
  type ArtikelAnalisa,
  type BagianLabel,
  type BarangLambat,
  type BarisAnalisa,
  type InfoBarangAnalisa,
  type KategoriAnalisa,
  type StokSekarang,
} from "@/lib/salesman/analisa-toko";
import { kunciBaris } from "./stok";

/**
 * Analisa penjualan SPG di tokonya sendiri — aturan murni, tanpa basis data.
 * Kuerinya di `analisa-queries.ts`.
 *
 * Pertanyaan pemilik: SPG memindai setiap penjualan, jadi ia bisa tahu barang
 * apa yang laku, apa yang diam di rak, dan apa yang perlu diminta sebelum habis.
 *
 * Semua angka dalam POTONG (pcs). Rupiah sengaja tidak dibawa sama sekali,
 * juga untuk toko putus: layar ini menjawab "barang apa", bukan "berapa
 * rupiah", dan satu aturan untuk semua toko lebih aman daripada cabang
 * putus/konsinyasi yang suatu hari terbalik.
 *
 * "Laku" = baris nota SPG dikurangi yang dikembalikan pembeli (`qty −
 * returnedQty`), pada tanggal notanya. Bukan dari buku stok: buku baru ada
 * sejak 2026-09-29 (penjualan sebelum itu tidak punya baris JUAL), dan barang
 * RUSAK yang dikembalikan pembeli tidak menulis baris buku — padahal tidak laku.
 * "Sisa di rak" tetap dari buku stok toko (Σ gerakan).
 *
 * Fungsi umumnya dipakai ulang dari analisa toko salesman (`analisa-toko.ts`):
 * porsi kategori/ukuran/warna (`susunAnalisa`), barang lambat (`susunLaku`),
 * ukuran & warna varian (`bacaVarian`), arah naik/turun (`arahPerubahan`).
 */

const HARI_MS = 86_400_000;

// ─── Periode ──────────────────────────────────────────────────────────────────

export const PERIODE_SPG = ["7h", "30h", "bulan-ini", "bulan-lalu"] as const;
export type PeriodeSpg = (typeof PERIODE_SPG)[number];
export const PERIODE_SPG_BAWAAN: PeriodeSpg = "30h";

export function pilihPeriodeSpg(param: unknown): PeriodeSpg {
  const v = Array.isArray(param) ? param[0] : param;
  return (PERIODE_SPG as readonly unknown[]).includes(v) ? (v as PeriodeSpg) : PERIODE_SPG_BAWAAN;
}

export type RentangSpg = {
  periode: PeriodeSpg;
  /** Periode ini: [awal, akhir). */
  awal: Date;
  akhir: Date;
  /** Pembanding: [awalLalu, akhirLalu) — tidak selalu bersambung dengan `awal`. */
  awalLalu: Date;
  akhirLalu: Date;
  /** Jumlah hari kalender di periode ini (pembagi rata-rata per hari). */
  hari: number;
  hariLalu: number;
  /** Tanggal WIB "YYYY-MM-DD": hari pertama dan hari TERAKHIR (inklusif), untuk label. */
  dari: string;
  sampai: string;
  dariLalu: string;
  sampaiLalu: string;
};

const awalHari = (kunci: string) => new Date(`${kunci}T00:00:00+07:00`);

/** Tanggal WIB "YYYY-MM-DD" digeser `n` hari kalender. */
function geserHari(kunci: string, n: number): string {
  const [th, bl, tg] = kunci.split("-").map(Number);
  return new Date(Date.UTC(th, bl - 1, tg + n)).toISOString().slice(0, 10);
}

/** Tanggal 1 bulan WIB `mundur` bulan sebelum bulan `kunci`. */
function awalBulan(kunci: string, mundur: number): string {
  const [th, bl] = kunci.split("-").map(Number);
  return new Date(Date.UTC(th, bl - 1 - mundur, 1)).toISOString().slice(0, 10);
}

const selisihHari = (dari: string, sampai: string) =>
  Math.round((Date.parse(`${sampai}T00:00:00Z`) - Date.parse(`${dari}T00:00:00Z`)) / HARI_MS);

/**
 * Periode dan pembandingnya, dalam hari kalender WIB (hari ini ikut dihitung):
 *   7h / 30h   — n hari terakhir vs n hari tepat sebelumnya;
 *   bulan-ini  — tanggal 1 sampai hari ini vs tanggal yang SAMA bulan lalu
 *                (bulan berjalan yang baru beberapa hari dibandingkan dengan
 *                bulan lalu penuh selalu tampak turun);
 *   bulan-lalu — bulan kalender lalu vs bulan sebelumnya.
 */
export function rentangSpg(hariIni: Date, periode: PeriodeSpg): RentangSpg {
  const kini = kunciHariWib(hariIni);
  const besok = geserHari(kini, 1);
  let dari: string;
  let akhir: string;
  let dariLalu: string;
  let akhirLalu: string;
  if (periode === "7h" || periode === "30h") {
    const n = periode === "7h" ? 7 : 30;
    akhir = besok;
    dari = geserHari(besok, -n);
    akhirLalu = dari;
    dariLalu = geserHari(dari, -n);
  } else if (periode === "bulan-ini") {
    dari = awalBulan(kini, 0);
    akhir = besok;
    dariLalu = awalBulan(kini, 1);
    const ujung = geserHari(dariLalu, selisihHari(dari, akhir));
    // Bulan lalu yang lebih pendek (31 Maret vs Februari) berhenti di akhir bulannya.
    akhirLalu = ujung < dari ? ujung : dari;
  } else {
    dari = awalBulan(kini, 1);
    akhir = awalBulan(kini, 0);
    dariLalu = awalBulan(kini, 2);
    akhirLalu = dari;
  }
  return {
    periode,
    awal: awalHari(dari),
    akhir: awalHari(akhir),
    awalLalu: awalHari(dariLalu),
    akhirLalu: awalHari(akhirLalu),
    hari: selisihHari(dari, akhir),
    hariLalu: selisihHari(dariLalu, akhirLalu),
    dari,
    sampai: geserHari(akhir, -1),
    dariLalu,
    sampaiLalu: geserHari(akhirLalu, -1),
  };
}

// ─── Bahan ────────────────────────────────────────────────────────────────────

/** Satu baris nota SPG, BERSIH dari barang yang dikembalikan pembeli. */
export type JualSpg = { tanggal: Date; itemId: string; variantSku: string; pcs: number };

const keBaris = (j: JualSpg, geser = 0): BarisAnalisa => ({
  tanggal: geser ? new Date(j.tanggal.getTime() + geser) : j.tanggal,
  itemId: j.itemId,
  variantSku: j.variantSku,
  pcs: j.pcs,
  nilai: null,
});

/** "M · Hitam" dari varian; SKU varian bila ukuran/warnanya tidak terbaca. */
export function labelVarian(info: InfoBarangAnalisa | undefined, variantSku: string): string | null {
  if (!variantSku) return null;
  const v = bacaVarian(info?.variants, variantSku, info?.sku ?? "");
  const label = [v.ukuran, v.warna].filter(Boolean).join(" · ");
  return label || variantSku;
}

// ─── Laku per periode ─────────────────────────────────────────────────────────

export const BATAS_VARIAN = 10;

export type ArtikelSpg = ArtikelAnalisa & { pcsLalu: number; arah: Arah };
export type VarianSpg = {
  itemId: string;
  variantSku: string;
  nama: string;
  sku: string;
  label: string | null;
  pcs: number;
  pcsLalu: number;
  arah: Arah;
};

export type AnalisaSpg = {
  totalPcs: number;
  totalPcsLalu: number;
  /** Persen perubahan; null bila pembandingnya nol. */
  perubahanPcs: number | null;
  arah: Arah;
  /** Laku rata-rata per hari kalender di periode ini, satu desimal. */
  rataHarian: number;
  kategori: KategoriAnalisa[];
  ukuran: BagianLabel[];
  warna: BagianLabel[];
  artikel: ArtikelSpg[];
  varian: VarianSpg[];
};

export function susunAnalisaSpg(input: {
  rentang: RentangSpg;
  jual: readonly JualSpg[];
  barang: ReadonlyMap<string, InfoBarangAnalisa>;
  kategori: ReadonlyMap<string, string>;
}): AnalisaSpg {
  const r = input.rentang;
  const di = (j: JualSpg, a: Date, b: Date) => j.tanggal.getTime() >= a.getTime() && j.tanggal.getTime() < b.getTime();
  const kini = input.jual.filter((j) => di(j, r.awal, r.akhir));
  const lalu = input.jual.filter((j) => di(j, r.awalLalu, r.akhirLalu));

  // `susunAnalisa` membandingkan dengan periode TEPAT sebelum `awal`. Pembanding
  // "bulan ini" (tanggal yang sama bulan lalu) tidak bersambung, jadi tanggalnya
  // digeser supaya jatuh tepat sebelum `awal` — isinya tidak berubah.
  const geser = r.awal.getTime() - r.akhirLalu.getTime();
  const panjangLalu = r.akhirLalu.getTime() - r.awalLalu.getTime();
  const a = susunAnalisa({
    baris: [...kini.map((j) => keBaris(j)), ...lalu.map((j) => keBaris(j, geser))],
    barang: input.barang,
    kategori: input.kategori,
    rentang: { awal: r.awal, akhir: r.akhir, awalSebelumnya: new Date(r.awal.getTime() - panjangLalu), bulanTren: [] },
    tampilNilai: false,
  });

  const laluPerBarang = new Map<string, number>();
  for (const j of lalu) laluPerBarang.set(j.itemId, (laluPerBarang.get(j.itemId) ?? 0) + j.pcs);

  const perVarian = new Map<string, { itemId: string; variantSku: string; pcs: number; pcsLalu: number }>();
  const ambil = (j: JualSpg) => {
    const k = kunciBaris(j.itemId, j.variantSku);
    let v = perVarian.get(k);
    if (!v) perVarian.set(k, (v = { itemId: j.itemId, variantSku: j.variantSku ?? "", pcs: 0, pcsLalu: 0 }));
    return v;
  };
  for (const j of kini) ambil(j).pcs += j.pcs;
  for (const j of lalu) ambil(j).pcsLalu += j.pcs;

  const varian: VarianSpg[] = [...perVarian.values()]
    .filter((v) => v.pcs > 0)
    .map((v) => {
      const info = input.barang.get(v.itemId);
      return {
        itemId: v.itemId,
        variantSku: v.variantSku,
        nama: info?.nama ?? "—",
        sku: v.variantSku || info?.sku || "",
        label: labelVarian(info, v.variantSku),
        pcs: v.pcs,
        pcsLalu: v.pcsLalu,
        arah: arahPerubahan(v.pcs, v.pcsLalu),
      };
    })
    .sort((x, y) => y.pcs - x.pcs || x.nama.localeCompare(y.nama) || x.sku.localeCompare(y.sku))
    .slice(0, BATAS_VARIAN);

  return {
    totalPcs: a.totalPcs,
    totalPcsLalu: a.totalPcsSebelumnya,
    perubahanPcs: a.perubahanPcs,
    arah: arahPerubahan(a.totalPcs, a.totalPcsSebelumnya),
    rataHarian: r.hari > 0 ? Math.round((a.totalPcs / r.hari) * 10) / 10 : 0,
    kategori: a.kategori,
    ukuran: a.ukuran,
    warna: a.warna,
    artikel: a.artikel.map((x) => {
      const pcsLalu = laluPerBarang.get(x.itemId) ?? 0;
      return { ...x, pcsLalu, arah: arahPerubahan(x.pcs, pcsLalu) };
    }),
    varian,
  };
}

// ─── Cukup untuk berapa hari ──────────────────────────────────────────────────

/** Laju laku dihitung dari sekian hari terakhir, apa pun periode yang dipilih. */
export const HARI_LAJU = 30;
/** Stok yang cukup untuk sekian hari atau kurang disebut "hampir habis". */
export const HARI_HAMPIR_HABIS = 7;
/** Jumlah yang disarankan untuk diminta: cukup untuk sekian hari ke depan. */
export const HARI_SASARAN_MINTA = 14;
export const BATAS_CUKUP = 10;
/** Batas baris "minta semua yang hampir habis" — sama dengan batas tambahan di alamat formulir. */
export const BATAS_MINTA_SEKALIGUS = 50;

export type BarisMinta = { itemId: string; variantSku: string; qty: number };

export type CukupHari = {
  itemId: string;
  nama: string;
  sku: string;
  /** Sisa di rak (hanya varian yang positif). */
  sisa: number;
  /** Laku bersih `HARI_LAJU` hari terakhir. */
  laku: number;
  /** Laku rata-rata per hari, satu desimal. */
  lajuHarian: number;
  /** Sisa ÷ laju harian, dibulatkan ke bawah. 0 = sudah habis. */
  hariCukup: number;
  hampirHabis: boolean;
  /** Saran baris permintaan: varian yang laku, sebanyak yang kurang untuk `HARI_SASARAN_MINTA` hari. */
  minta: BarisMinta[];
};

const awalJendela = (hariIni: Date, hari: number) => awalHari(geserHari(kunciHariWib(hariIni), 1 - hari));

/**
 * Per artikel yang laku `HARI_LAJU` hari terakhir: sisa di rak ÷ laku per hari.
 * Barang yang tidak laku sama sekali tidak muncul di sini (lihat barang lambat).
 */
export function susunCukupHari(input: {
  stok: readonly StokSekarang[];
  jual: readonly JualSpg[];
  barang: ReadonlyMap<string, InfoBarangAnalisa>;
  hariIni: Date;
}): { baris: CukupHari[]; jumlahHampirHabis: number; mintaHampirHabis: BarisMinta[] } {
  const sejak = awalJendela(input.hariIni, HARI_LAJU).getTime();
  const akhir = awalHari(geserHari(kunciHariWib(input.hariIni), 1)).getTime();

  type Varian = { variantSku: string; laku: number; saldo: number };
  const perBarang = new Map<string, Map<string, Varian>>();
  const ambil = (itemId: string, variantSku: string) => {
    let m = perBarang.get(itemId);
    if (!m) perBarang.set(itemId, (m = new Map()));
    let v = m.get(variantSku);
    if (!v) m.set(variantSku, (v = { variantSku, laku: 0, saldo: 0 }));
    return v;
  };
  for (const j of input.jual) {
    const t = j.tanggal.getTime();
    if (t >= sejak && t < akhir) ambil(j.itemId, j.variantSku ?? "").laku += j.pcs;
  }
  for (const s of input.stok) ambil(s.itemId, s.variantSku ?? "").saldo += s.qty;

  const semua: CukupHari[] = [];
  for (const [itemId, varian] of perBarang) {
    const v = [...varian.values()];
    const laku = v.reduce((n, x) => n + x.laku, 0);
    if (laku <= 0) continue;
    const sisa = v.reduce((n, x) => n + Math.max(0, x.saldo), 0);
    const laju = laku / HARI_LAJU;
    const hariCukup = Math.floor(sisa / laju);
    const minta = v
      .filter((x) => x.laku > 0)
      .map((x) => ({ itemId, variantSku: x.variantSku, qty: Math.ceil((x.laku / HARI_LAJU) * HARI_SASARAN_MINTA) - Math.max(0, x.saldo) }))
      .filter((x) => x.qty > 0)
      .sort((p, q) => q.qty - p.qty || p.variantSku.localeCompare(q.variantSku));
    const info = input.barang.get(itemId);
    semua.push({
      itemId,
      nama: info?.nama ?? "—",
      sku: info?.sku ?? "",
      sisa,
      laku,
      lajuHarian: Math.round(laju * 10) / 10,
      hariCukup,
      hampirHabis: hariCukup <= HARI_HAMPIR_HABIS,
      minta,
    });
  }
  semua.sort((a, b) => a.hariCukup - b.hariCukup || b.laku - a.laku || a.nama.localeCompare(b.nama));
  const hampir = semua.filter((c) => c.hampirHabis);
  return {
    baris: semua.slice(0, BATAS_CUKUP),
    jumlahHampirHabis: hampir.length,
    mintaHampirHabis: hampir.flatMap((c) => c.minta).slice(0, BATAS_MINTA_SEKALIGUS),
  };
}

// ─── Barang lambat ────────────────────────────────────────────────────────────

/** Barang di rak yang tidak laku sekian hari (dan sudah sekian hari di toko). */
export const HARI_LAMBAT = HARI_MINIMAL_DI_TOKO;

/**
 * Masih ada di rak, sudah lebih dari `HARI_LAMBAT` hari di toko, dan tidak laku
 * satu pun dalam `HARI_LAMBAT` hari terakhir — aturan `susunLaku` yang sama
 * dengan analisa toko salesman, dengan jendela tetap (bukan periode yang
 * dipilih: "tidak laku 7 hari" terlalu cepat untuk mencap barang lambat).
 */
export function barangLambatSpg(input: {
  stok: readonly StokSekarang[];
  jual: readonly JualSpg[];
  barang: ReadonlyMap<string, InfoBarangAnalisa>;
  hariIni: Date;
}): { baris: BarangLambat[]; jumlah: number } {
  const akhir = awalHari(geserHari(kunciHariWib(input.hariIni), 1));
  const awal = new Date(akhir.getTime() - HARI_LAMBAT * HARI_MS);
  const laku = susunLaku({
    sumber: "BUKU_TOKO",
    rentang: { awal, akhir, awalSebelumnya: new Date(awal.getTime() - HARI_LAMBAT * HARI_MS), bulanTren: [] },
    terkirim: [],
    terjual: input.jual.map((j) => keBaris(j)),
    stok: input.stok,
    barang: input.barang,
    hariIni: input.hariIni,
  });
  return { baris: laku.lambat, jumlah: laku.jumlahLambat };
}

// ─── Dicari pembeli ───────────────────────────────────────────────────────────

export const BATAS_DICARI = 5;

export type DicariMentah = { itemId: string | null; variantSku: string; description: string; qty: number; tanggal: Date };
export type DicariSpg = {
  kunci: string;
  /** null = hanya keterangan yang diketik, tidak ditautkan ke barang. */
  itemId: string | null;
  variantSku: string;
  /** Nama barang (+ varian) bila ditautkan; keterangan terbaru bila tidak. */
  keterangan: string;
  qty: number;
  kali: number;
};

const rapikan = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Barang yang dicari pembeli tapi tidak ada, di periode ini. Yang ditautkan ke
 * barang dikelompokkan per barang × varian; yang hanya diketik, per keterangan
 * (tanpa beda huruf besar/spasi) — sama dengan rekap kantor.
 */
export function susunDicari(input: {
  baris: readonly DicariMentah[];
  rentang: { awal: Date; akhir: Date };
  barang: ReadonlyMap<string, InfoBarangAnalisa>;
}): DicariSpg[] {
  const awal = input.rentang.awal.getTime();
  const akhir = input.rentang.akhir.getTime();
  const urut = [...input.baris]
    .filter((b) => b.tanggal.getTime() >= awal && b.tanggal.getTime() < akhir && b.qty > 0)
    .sort((a, b) => b.tanggal.getTime() - a.tanggal.getTime());
  const per = new Map<string, DicariSpg>();
  for (const b of urut) {
    const kunci = b.itemId ? `i:${kunciBaris(b.itemId, b.variantSku)}` : `t:${rapikan(b.description)}`;
    const ada = per.get(kunci);
    if (ada) {
      ada.qty += b.qty;
      ada.kali += 1;
      continue;
    }
    let keterangan = b.description.trim();
    if (b.itemId) {
      const info = input.barang.get(b.itemId);
      if (info) {
        const label = labelVarian(info, b.variantSku ?? "");
        keterangan = label ? `${info.nama} — ${label}` : info.nama;
      }
    }
    per.set(kunci, { kunci, itemId: b.itemId, variantSku: b.variantSku ?? "", keterangan, qty: b.qty, kali: 1 });
  }
  return [...per.values()]
    .sort((a, b) => b.qty - a.qty || b.kali - a.kali || a.keterangan.localeCompare(b.keterangan))
    .slice(0, BATAS_DICARI);
}
