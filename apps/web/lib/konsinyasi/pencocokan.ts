import { stokTitipan } from "./aturan";

/**
 * Pencocokan buku stok toko dengan laporan laku konsinyasi — murni, tanpa
 * basis data. Keputusan pemilik 2026-10-03: "Pencocokan buku stok toko dan
 * laporan laku konsinyasi — saya butuh."
 *
 * Satu siklus (toko × bulan WIB), PER BARANG. Varian selalu digabung: laporan
 * SPG, laporan toko, dan angka resmi hanya sampai barang, jadi data varian
 * tidak pernah tersedia di semua sumber.
 *
 * Dua bagian:
 *
 * 1. TERJUAL bulan itu, dari sumber yang ada:
 *    - buku stok toko: laku bersih bulan itu (`gerakLakuBersih`: JUAL dikurangi
 *      barang yang dikembalikan pembeli, layak maupun rusak) — toko yang punya buku;
 *    - nota SPG bersih (qty − returnedQty, menurut tanggal nota) — PEMBANDING
 *      saja, tidak ikut menentukan selisih: nota bisa sah berbeda dari buku
 *      (penjualan luring yang tertinggal di belakang opname tidak mendapat
 *      baris JUAL; retur dibaca menurut tanggal nota, bukan tanggal retur);
 *    - laporan SPG, laporan toko (sumber laporan konsinyasi);
 *    - laku resmi, hanya kalau siklusnya sudah dikunci.
 *    Barang berselisih kalau sumber yang ADA (buku, laporan SPG, laporan toko,
 *    resmi) tidak semuanya sama. Sumber yang ada tapi tidak menyebut barang itu
 *    = 0; sumber yang tidak ada sama sekali = null dan tidak ikut dibandingkan.
 *
 * 2. STOK di akhir bulan (hanya toko yang punya buku): saldo buku vs stok
 *    titipan (dikirim − terjual − diretur, dihitung lewat `stokTitipan`).
 *    Barang yang menurut dokumen sedang DALAM PROSES tidak dianggap hilang:
 *    kiriman yang belum diterima SPG, retur yang sudah dikirim SPG tapi belum
 *    dihitung gudang, barang rusak saat diterima yang belum masuk buku, dan
 *    barang rusak dari pembeli yang belum kembali ke gudang.
 *    Barang yang SUDAH dicatat hilang juga tidak dihitung lagi: catatan dari
 *    opname dan dari kekurangan penerimaan (`StockLoss` OPNAME/PENERIMAAN yang
 *    tidak dibatalkan sebelum akhir bulan), dan catatan MANUAL sebesar gerakan
 *    HILANG-nya di buku — semuanya sudah memotong buku tapi tidak titipan.
 *    Seharusnya di toko = titipan − dalam proses − tercatat hilang. Buku lebih
 *    kecil dari itu = "kemungkinan hilang" — hanya angka; pencatatannya
 *    dikerjakan di modul barang hilang.
 */

export type JumlahBarang = { kunci: string; qty: number };

/** Dasar angka terjual satu bulan untuk stok titipan. */
export type DasarTerjual = "RESMI" | "LAPORAN_TOKO" | "LAPORAN_SPG" | "BUKU";

export type BahanBulan = {
  resmi: JumlahBarang[] | null;
  laporanToko: JumlahBarang[] | null;
  laporanSpg: JumlahBarang[] | null;
  buku: JumlahBarang[] | null;
};

/**
 * Terjual satu bulan untuk stok titipan. Angka RESMI kalau bulannya sudah
 * dikunci — itu definisi stok titipan. Bulan yang belum dikunci memakai angka
 * terbaik berikutnya (laporan toko, laporan SPG, lalu buku): kalau tidak,
 * setiap barang yang laku bulan ini terbaca "masih di toko" dan langsung
 * ditandai hilang pada buku yang sudah memotongnya.
 */
export function pilihTerjualBulan(b: BahanBulan): { dasar: DasarTerjual | null; baris: JumlahBarang[] } {
  if (b.resmi) return { dasar: "RESMI", baris: b.resmi };
  if (b.laporanToko) return { dasar: "LAPORAN_TOKO", baris: b.laporanToko };
  if (b.laporanSpg) return { dasar: "LAPORAN_SPG", baris: b.laporanSpg };
  if (b.buku) return { dasar: "BUKU", baris: b.buku };
  return { dasar: null, baris: [] };
}

/** Stok titipan per barang: masuk − terjual − diretur (lewat `stokTitipan`). */
export function titipanPerBarang(input: {
  masuk: JumlahBarang[];
  terjual: JumlahBarang[];
  retur: JumlahBarang[];
}): JumlahBarang[] {
  return stokTitipan(
    input.masuk.map((m) => ({ itemName: m.kunci, qty: m.qty })),
    [...input.terjual, ...input.retur].map((t) => ({ itemName: t.kunci, qty: t.qty })),
  ).map((s) => ({ kunci: s.itemName, qty: s.sisa }));
}

// ---------------------------------------------------------------------------
// Kunci barang
// ---------------------------------------------------------------------------

export function normalNama(nama: string): string {
  return nama.trim().replace(/\s+/g, " ").toLowerCase();
}

export function kunciNama(nama: string): string {
  return `nama:${normalNama(nama)}`;
}

/**
 * Kunci barang untuk baris yang mungkin tanpa `itemId` (laporan dan angka
 * resmi yang diketik nama saja). Nama dicocokkan ke master barang lewat
 * `nameId`: lebih dulu di antara barang yang SUDAH terlibat di toko ini, lalu
 * di seluruh barang bernama itu — dan hanya kalau tepat SATU barang yang cocok.
 * Nama yang ganda atau tidak dikenal tetap menjadi barisnya sendiri; menebak
 * akan menggabungkan dua barang berbeda diam-diam.
 */
export function buatPenyelesaiKunci(input: {
  terlibat: { id: string; nameId: string }[];
  semua: { id: string; nameId: string }[];
}): (itemId: string | null | undefined, nama: string) => string {
  const indeks = (daftar: { id: string; nameId: string }[]) => {
    const peta = new Map<string, Set<string>>();
    for (const b of daftar) {
      const n = normalNama(b.nameId);
      const s = peta.get(n) ?? new Set<string>();
      s.add(b.id);
      peta.set(n, s);
    }
    return peta;
  };
  const terlibat = indeks(input.terlibat);
  const semua = indeks(input.semua);
  return (itemId, nama) => {
    if (itemId) return itemId;
    const n = normalNama(nama);
    for (const peta of [terlibat, semua]) {
      const cocok = peta.get(n);
      if (cocok && cocok.size === 1) return [...cocok][0];
      if (cocok && cocok.size > 1) break;
    }
    return kunciNama(nama);
  };
}

// ---------------------------------------------------------------------------
// Pencocokan
// ---------------------------------------------------------------------------

export type SumberTerjual = {
  buku: JumlahBarang[] | null;
  nota: JumlahBarang[] | null;
  laporanSpg: JumlahBarang[] | null;
  laporanToko: JumlahBarang[] | null;
  resmi: JumlahBarang[] | null;
};

export type BahanStok = {
  buku: JumlahBarang[];
  titipan: JumlahBarang[];
  kirimanBelumDiterima: JumlahBarang[];
  returBelumDihitung: JumlahBarang[];
  rusakBelumMasukBuku: JumlahBarang[];
  /**
   * Barang hilang yang sudah dicatat dari opname / kekurangan penerimaan, dan
   * catatan MANUAL sebesar gerakan HILANG yang ditulisnya di buku. Hilang di
   * MUTASI tidak ikut (buku dan titipan toko asal sama-sama sudah melepasnya
   * saat dikirim).
   */
  hilangTercatat?: JumlahBarang[];
};

export type StokBaris = {
  buku: number;
  titipan: number;
  /** Kiriman belum diterima + retur belum dihitung + rusak belum masuk buku. */
  dalamProses: number;
  /** Sudah dicatat sebagai barang hilang (opname / kekurangan penerimaan). */
  hilangTercatat: number;
  /** titipan − dalamProses − hilangTercatat. */
  seharusnya: number;
  /** buku − seharusnya. Negatif = buku kurang. */
  selisih: number;
  kemungkinanHilang: number;
};

export type BarisPencocokan = {
  kunci: string;
  itemId: string | null;
  nama: string;
  sku: string | null;
  terjual: { buku: number | null; nota: number | null; laporanSpg: number | null; laporanToko: number | null; resmi: number | null };
  terjualBerselisih: boolean;
  stok: StokBaris | null;
  stokBerselisih: boolean;
  berselisih: boolean;
};

export type RingkasPencocokan = {
  /** Banyak sumber terjual yang ada di antara buku, laporan SPG, laporan toko, resmi. */
  sumberTerjual: number;
  barangTerjualBerselisih: number;
  adaStok: boolean;
  barangStokBerselisih: number;
  barangKemungkinanHilang: number;
  pcsKemungkinanHilang: number;
  barangBerselisih: number;
  /** null = belum ada yang bisa dibandingkan (kurang dari dua sumber terjual dan tanpa buku). */
  cocok: boolean | null;
};

export type HasilPencocokan = { baris: BarisPencocokan[]; ringkas: RingkasPencocokan };

function jumlahkan(daftar: JumlahBarang[] | null): Map<string, number> | null {
  if (!daftar) return null;
  const peta = new Map<string, number>();
  for (const d of daftar) peta.set(d.kunci, (peta.get(d.kunci) ?? 0) + d.qty);
  return peta;
}

const nilai = (peta: Map<string, number> | null, kunci: string): number | null => (peta ? (peta.get(kunci) ?? 0) : null);

export function susunPencocokan(input: {
  nama: Map<string, { nama: string; sku: string | null; itemId: string | null }>;
  terjual: SumberTerjual;
  stok: BahanStok | null;
}): HasilPencocokan {
  const t = {
    buku: jumlahkan(input.terjual.buku),
    nota: jumlahkan(input.terjual.nota),
    laporanSpg: jumlahkan(input.terjual.laporanSpg),
    laporanToko: jumlahkan(input.terjual.laporanToko),
    resmi: jumlahkan(input.terjual.resmi),
  };
  const s = input.stok
    ? {
        buku: jumlahkan(input.stok.buku) as Map<string, number>,
        titipan: jumlahkan(input.stok.titipan) as Map<string, number>,
        kiriman: jumlahkan(input.stok.kirimanBelumDiterima) as Map<string, number>,
        retur: jumlahkan(input.stok.returBelumDihitung) as Map<string, number>,
        rusak: jumlahkan(input.stok.rusakBelumMasukBuku) as Map<string, number>,
        hilang: jumlahkan(input.stok.hilangTercatat ?? []) as Map<string, number>,
      }
    : null;

  const kunci = new Set<string>();
  for (const peta of [...Object.values(t), ...(s ? Object.values(s) : [])]) {
    if (peta) for (const k of peta.keys()) kunci.add(k);
  }

  const dibandingkan = [t.buku, t.laporanSpg, t.laporanToko, t.resmi];
  const baris: BarisPencocokan[] = [];
  for (const k of kunci) {
    const terjual = {
      buku: nilai(t.buku, k),
      nota: nilai(t.nota, k),
      laporanSpg: nilai(t.laporanSpg, k),
      laporanToko: nilai(t.laporanToko, k),
      resmi: nilai(t.resmi, k),
    };
    const ada = dibandingkan.map((p) => nilai(p, k)).filter((v): v is number => v !== null);
    const terjualBerselisih = ada.length >= 2 && ada.some((v) => v !== ada[0]);

    let stok: StokBaris | null = null;
    if (s) {
      const buku = s.buku.get(k) ?? 0;
      const titipan = s.titipan.get(k) ?? 0;
      const dalamProses = (s.kiriman.get(k) ?? 0) + (s.retur.get(k) ?? 0) + (s.rusak.get(k) ?? 0);
      const hilangTercatat = s.hilang.get(k) ?? 0;
      const seharusnya = titipan - dalamProses - hilangTercatat;
      const selisih = buku - seharusnya;
      stok = { buku, titipan, dalamProses, hilangTercatat, seharusnya, selisih, kemungkinanHilang: Math.max(0, -selisih) };
    }

    // Barang yang semuanya nol adalah sejarah — tidak ada yang perlu dicocokkan.
    const adaTerjual = Object.values(terjual).some((v) => v !== null && v !== 0);
    const adaStok = stok !== null && (stok.buku !== 0 || stok.titipan !== 0 || stok.dalamProses !== 0 || stok.hilangTercatat !== 0);
    if (!adaTerjual && !adaStok) continue;

    const info = input.nama.get(k);
    const stokBerselisih = stok !== null && stok.selisih !== 0;
    baris.push({
      kunci: k,
      itemId: info?.itemId ?? (k.startsWith("nama:") ? null : k),
      nama: info?.nama ?? k.replace(/^nama:/, ""),
      sku: info?.sku ?? null,
      terjual,
      terjualBerselisih,
      stok,
      stokBerselisih,
      berselisih: terjualBerselisih || stokBerselisih,
    });
  }

  baris.sort(
    (a, b) =>
      Number(b.berselisih) - Number(a.berselisih) ||
      (b.stok?.kemungkinanHilang ?? 0) - (a.stok?.kemungkinanHilang ?? 0) ||
      a.nama.localeCompare(b.nama),
  );

  const sumberTerjual = dibandingkan.filter((p) => p !== null).length;
  const barangBerselisih = baris.filter((b) => b.berselisih).length;
  const hilang = baris.filter((b) => (b.stok?.kemungkinanHilang ?? 0) > 0);
  return {
    baris,
    ringkas: {
      sumberTerjual,
      barangTerjualBerselisih: baris.filter((b) => b.terjualBerselisih).length,
      adaStok: s !== null,
      barangStokBerselisih: baris.filter((b) => b.stokBerselisih).length,
      barangKemungkinanHilang: hilang.length,
      pcsKemungkinanHilang: hilang.reduce((n, b) => n + (b.stok?.kemungkinanHilang ?? 0), 0),
      barangBerselisih,
      cocok: sumberTerjual < 2 && s === null ? null : barangBerselisih === 0,
    },
  };
}

/** Penanda ringkas di daftar siklus: hanya bagian terjual (murah dihitung). */
export type PenandaCocok = { berselisih: number };

export function penandaDariTerjual(terjual: Omit<SumberTerjual, "nota" | "resmi">): PenandaCocok | null {
  const h = susunPencocokan({ nama: new Map(), terjual: { ...terjual, nota: null, resmi: null }, stok: null });
  return h.ringkas.sumberTerjual >= 2 ? { berselisih: h.ringkas.barangTerjualBerselisih } : null;
}
