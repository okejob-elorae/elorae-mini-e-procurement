/**
 * Isi ulang stok di toko konsinyasi / toko ber-SPG. Murni — tidak menyentuh
 * basis data. Pemuatnya ada di `stok-di-toko.ts`.
 *
 * Tiga hal dinilai per barang/ukuran:
 *   1. Saran isi ulang dari target min/maks (`StoreStockTarget`) — kalau stok
 *      sudah menyentuh atau di bawah MIN, pesan sampai MAKS, dibatasi stok gudang.
 *   2. Tanda: MINUS, HAMPIR_HABIS, TIDAK_LAKU.
 *   3. Saran pindah barang tidak laku ke toko lain se-area yang menjualnya.
 */

/** Tanpa penjualan selama ini (hari), barang yang masih ada di rak dianggap tidak laku. */
export const HARI_TIDAK_LAKU = 60;
/** Batas "hampir habis" untuk barang tanpa target — sama dengan layar SPG. */
export const BATAS_HAMPIR_HABIS_TANPA_TARGET = 2;
/** Batas atas masuk akal untuk target — mencegah salah ketik 10000 jadi pesanan raksasa. */
export const MAKS_TARGET = 9999;

const HARI_MS = 86_400_000;

export type TandaStok = "MINUS" | "HAMPIR_HABIS" | "TIDAK_LAKU";

/** Urutan tampil: yang paling mendesak dulu. */
const PRIORITAS: TandaStok[] = ["MINUS", "HAMPIR_HABIS", "TIDAK_LAKU"];

/** Kunci satu baris stok. Varian kosong dan null adalah hal yang sama. */
export function kunciStok(itemId: string, variantSku: string | null | undefined): string {
  return `${itemId}::${variantSku ?? ""}`;
}

export type BarisStokNilai = {
  itemId: string;
  variantSku: string;
  qty: number;
  lastSaleAt: Date | null;
  /** Kapan barang ini pertama kali masuk ke toko; null kalau tidak diketahui. */
  firstInAt: Date | null;
};

export type TargetStok = { itemId: string; variantSku: string; minQty: number; maxQty: number };

export type BarisDinilai<T extends BarisStokNilai> = {
  /** Baris stok aslinya; null kalau barang ini hanya punya target (belum pernah ada di toko). */
  stok: T | null;
  itemId: string;
  variantSku: string;
  qty: number;
  target: { minQty: number; maxQty: number } | null;
  /** Sedang dalam perjalanan / menunggu disetujui — ikut dihitung supaya tidak dipesan dua kali. */
  dalamProses: number;
  tersediaGudang: number;
  tanda: TandaStok[];
  /** Jumlah yang disarankan dipesan; 0 berarti tidak perlu. */
  saranQty: number;
  /** Kebutuhan sampai MAKS lebih besar dari stok gudang — saran sudah dipotong. */
  kurangGudang: boolean;
};

export type BarisPesananIsiUlang = { itemId: string; variantSku: string; qty: number };

export function nilaiIsiUlang<T extends BarisStokNilai>(input: {
  stok: T[];
  target: TargetStok[];
  tersediaGudang: Map<string, number>;
  dalamProses?: Map<string, number>;
  sekarang: Date;
}): { baris: BarisDinilai<T>[]; pesanan: BarisPesananIsiUlang[] } {
  const batasLaku = input.sekarang.getTime() - HARI_TIDAK_LAKU * HARI_MS;
  const targetPer = new Map(input.target.map((t) => [kunciStok(t.itemId, t.variantSku), t]));

  // Barang yang punya target tapi belum pernah bergerak di toko tetap dinilai:
  // target baru untuk barang baru justru kasus isi ulang yang paling jelas.
  const semua: { stok: T | null; itemId: string; variantSku: string }[] = input.stok.map((s) => ({
    stok: s,
    itemId: s.itemId,
    variantSku: s.variantSku ?? "",
  }));
  const sudah = new Set(semua.map((s) => kunciStok(s.itemId, s.variantSku)));
  for (const t of input.target) {
    const k = kunciStok(t.itemId, t.variantSku);
    if (!sudah.has(k)) {
      semua.push({ stok: null, itemId: t.itemId, variantSku: t.variantSku ?? "" });
      sudah.add(k);
    }
  }

  const baris = semua.map(({ stok, itemId, variantSku }) => {
    const k = kunciStok(itemId, variantSku);
    const qty = stok?.qty ?? 0;
    const t = targetPer.get(k);
    const target = t ? { minQty: t.minQty, maxQty: t.maxQty } : null;
    const dalamProses = Math.max(0, input.dalamProses?.get(k) ?? 0);
    const tersediaGudang = input.tersediaGudang.get(k) ?? 0;
    const lakuBaruBaru = !!stok?.lastSaleAt && stok.lastSaleAt.getTime() >= batasLaku;

    const tanda: TandaStok[] = [];
    // Saldo minus bukan galat: penjualan tidak pernah ditolak karena buku nol.
    // Artinya buku dan rak berbeda — tokonya perlu dihitung (opname).
    if (qty < 0) tanda.push("MINUS");
    const hampirHabis = target
      ? target.maxQty > 0 && qty <= target.minQty
      : // Tanpa target, barang yang sudah lama habis dan tidak pernah laku lagi
        // bukan "hampir habis" — ia sejarah. Yang ditandai hanya yang masih
        // ada di rak atau masih laku belakangan ini.
        qty <= BATAS_HAMPIR_HABIS_TANPA_TARGET && (qty > 0 || lakuBaruBaru);
    if (hampirHabis) tanda.push("HAMPIR_HABIS");
    // Barang yang baru tiba belum sempat laku — bukan "tidak laku". Hanya barang
    // yang sudah di toko setidaknya 60 hari yang dinilai.
    const sudahLama = !stok?.firstInAt || stok.firstInAt.getTime() <= batasLaku;
    if (qty > 0 && !lakuBaruBaru && sudahLama) tanda.push("TIDAK_LAKU");

    let saranQty = 0;
    let kurangGudang = false;
    if (target && target.maxQty > 0) {
      // Stok minus diperlakukan sebagai nol: barang fisik tidak bisa kurang dari
      // nol. Tandanya (MINUS) tetap ada supaya tokonya dihitung.
      const efektif = Math.max(qty, 0) + dalamProses;
      if (efektif <= target.minQty) {
        const butuh = target.maxQty - efektif;
        saranQty = Math.max(0, Math.min(butuh, Math.max(tersediaGudang, 0)));
        kurangGudang = butuh > Math.max(tersediaGudang, 0);
      }
    }

    return { stok, itemId, variantSku, qty, target, dalamProses, tersediaGudang, tanda, saranQty, kurangGudang };
  });

  return {
    baris,
    pesanan: baris
      .filter((b) => b.saranQty > 0)
      .map((b) => ({ itemId: b.itemId, variantSku: b.variantSku, qty: b.saranQty })),
  };
}

/** Peringkat tanda paling mendesak sebuah baris; baris tanpa tanda paling akhir. */
function peringkat(tanda: TandaStok[]): number {
  const i = PRIORITAS.findIndex((p) => tanda.includes(p));
  return i === -1 ? PRIORITAS.length : i;
}

/**
 * Baris bertanda dulu (MINUS → HAMPIR_HABIS → TIDAK_LAKU), baris yang perlu
 * diisi ulang ikut naik. Urutan masukan dipertahankan di dalam kelompok —
 * pemanggil mengurutkan menurut nama lebih dulu.
 */
export function urutkanPenilaian<T extends { tanda: TandaStok[]; saranQty: number }>(baris: T[]): T[] {
  return baris
    .map((b, i) => ({ b, i }))
    .sort((x, y) => {
      const px = Math.min(peringkat(x.b.tanda), x.b.saranQty > 0 ? 1 : PRIORITAS.length);
      const py = Math.min(peringkat(y.b.tanda), y.b.saranQty > 0 ? 1 : PRIORITAS.length);
      return px - py || x.i - y.i;
    })
    .map(({ b }) => b);
}

export type RingkasanStok = {
  /** Barang/ukuran yang ada di rak (qty > 0). */
  sku: number;
  pcs: number;
  minus: number;
  hampirHabis: number;
  tidakLaku: number;
  barisIsiUlang: number;
  pcsIsiUlang: number;
  adaTarget: boolean;
};

export function ringkasPenilaian(baris: { qty: number; tanda: TandaStok[]; saranQty: number; target: unknown }[]): RingkasanStok {
  const r: RingkasanStok = { sku: 0, pcs: 0, minus: 0, hampirHabis: 0, tidakLaku: 0, barisIsiUlang: 0, pcsIsiUlang: 0, adaTarget: false };
  for (const b of baris) {
    if (b.qty > 0) {
      r.sku += 1;
      r.pcs += b.qty;
    }
    if (b.tanda.includes("MINUS")) r.minus += 1;
    if (b.tanda.includes("HAMPIR_HABIS")) r.hampirHabis += 1;
    if (b.tanda.includes("TIDAK_LAKU")) r.tidakLaku += 1;
    if (b.saranQty > 0) {
      r.barisIsiUlang += 1;
      r.pcsIsiUlang += b.saranQty;
    }
    if (b.target) r.adaTarget = true;
  }
  return r;
}

export type KodeTarget = "SEBAGIAN" | "MIN_TIDAK_VALID" | "MAKS_TIDAK_VALID" | "MAKS_KURANG_DARI_MIN";

/**
 * Periksa satu baris isian target. Dua-duanya kosong = hapus target (sah).
 * Satu terisi satu kosong ditolak: "min 3, maks kosong" tidak punya arti yang
 * bisa ditebak dengan aman.
 */
export function periksaTarget(b: { minQty: number | null; maxQty: number | null }): KodeTarget | null {
  if (b.minQty === null && b.maxQty === null) return null;
  if (b.minQty === null || b.maxQty === null) return "SEBAGIAN";
  if (!Number.isInteger(b.minQty) || b.minQty < 0 || b.minQty > MAKS_TARGET) return "MIN_TIDAK_VALID";
  if (!Number.isInteger(b.maxQty) || b.maxQty < 0 || b.maxQty > MAKS_TARGET) return "MAKS_TIDAK_VALID";
  if (b.maxQty < b.minQty) return "MAKS_KURANG_DARI_MIN";
  return null;
}

export type LakuDiToko = { storeId: string; groupId: string | null; itemId: string; terjual60: number };

/** Indeks: area × barang → toko yang menjualnya 60 hari terakhir, paling laku dulu. */
export function indeksLakuPerArea(laku: LakuDiToko[]): Map<string, LakuDiToko[]> {
  const peta = new Map<string, LakuDiToko[]>();
  for (const l of laku) {
    if (!l.groupId || l.terjual60 <= 0) continue;
    const k = `${l.groupId}::${l.itemId}`;
    const ada = peta.get(k);
    if (ada) ada.push(l);
    else peta.set(k, [l]);
  }
  for (const daftar of peta.values()) daftar.sort((a, b) => b.terjual60 - a.terjual60 || a.storeId.localeCompare(b.storeId));
  return peta;
}

/**
 * Toko lain se-area tempat barang ini laku — tujuan pindah barang tidak laku.
 *
 * Dicocokkan per BARANG, bukan per ukuran: laporan terjual konsinyasi hanya
 * sampai barang, dan pemindahan dikerjakan per kiriman, bukan per ukuran.
 * Toko tanpa area tidak diberi saran — "se-area" tidak bisa dinilai.
 */
export function saranPindah(
  indeks: Map<string, LakuDiToko[]>,
  asal: { storeId: string; groupId: string | null },
  itemId: string,
): LakuDiToko | null {
  if (!asal.groupId) return null;
  return indeks.get(`${asal.groupId}::${itemId}`)?.find((l) => l.storeId !== asal.storeId) ?? null;
}
