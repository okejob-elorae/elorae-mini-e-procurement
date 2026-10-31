/**
 * Keranjang layar jual van — aturan murni (tanpa React), supaya bisa dites di
 * Node: bentuk simpanan `sessionStorage`, pemulihan setelah muat ulang, umur
 * kunci kirim, dan satu kali kirim yang membedakan "ditolak" dari "terputus".
 *
 * Kunci kirim (`idempotencyKey`) dibuat SEKALI per keranjang dan disimpan
 * bersama isinya sampai penjualan tercatat. Kirim ulang setelah sinyal putus
 * atau setelah halaman dimuat ulang memakai kunci yang sama, sehingga
 * `recordVanSale` mengembalikan penjualan yang sudah tercatat alih-alih
 * mencatat yang kedua (dan memotong stok van dua kali).
 *
 * Nama dan HP pembeli langsung sengaja TIDAK disimpan: itu data orang, dan
 * pembersih saat keluar akun (`lib/pwa/offline/bersihkan.ts`) tidak mengenal
 * simpanan ini.
 */
import type { RecordVanSaleActionResult } from "@/app/actions/van-sale";
import type { VanStockRow } from "./VanVariantSheet";

export type BarisKeranjangVan = {
  itemId: string;
  variantSku: string | null;
  sku: string;
  productName: string;
  unitPrice: number;
  qty: number;
  qtyOnVan: number;
};

export type ModePembeli = "store" | "adhoc";

export type SimpananKeranjangVan = {
  idempotencyKey: string;
  baris: { itemId: string; variantSku: string | null; qty: number }[];
  mode: ModePembeli;
  storeId: string;
  uangDiterima: string;
};

export type Penyimpanan = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const AWALAN_SIMPANAN_KERANJANG_VAN = "elorae.van.keranjang.";

/** Per pengguna: salesman berikutnya di tab yang sama tidak mewarisi keranjang. */
export const kunciSimpananKeranjangVan = (userId: string) => `${AWALAN_SIMPANAN_KERANJANG_VAN}${userId}`;

export function kunciBaris(itemId: string, variantSku: string | null): string {
  return `${itemId}::${variantSku ?? ""}`;
}

/** Bentuk simpanan dari keadaan layar. Keranjang kosong → null: tidak disimpan, kuncinya ikut hilang. */
export function susunSimpananKeranjangVan(input: {
  idempotencyKey: string;
  baris: Iterable<BarisKeranjangVan>;
  mode: ModePembeli;
  storeId: string;
  uangDiterima: string;
}): SimpananKeranjangVan | null {
  const baris = Array.from(input.baris, (b) => ({ itemId: b.itemId, variantSku: b.variantSku, qty: b.qty })).filter((b) => b.qty > 0);
  if (baris.length === 0 || !input.idempotencyKey) return null;
  return { idempotencyKey: input.idempotencyKey, baris, mode: input.mode, storeId: input.storeId, uangDiterima: input.uangDiterima };
}

const teks = (v: unknown, maks: number): string | null => (typeof v === "string" && v.length <= maks ? v : null);

/** Baca simpanan; rusak, tanpa kunci kirim, atau tanpa baris sah dianggap tidak ada. */
export function uraiSimpananKeranjangVan(mentah: string | null): SimpananKeranjangVan | null {
  if (!mentah) return null;
  let data: unknown;
  try {
    data = JSON.parse(mentah);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  const kunci = teks(o.idempotencyKey, 200);
  if (!kunci || !Array.isArray(o.baris)) return null;
  const baris: SimpananKeranjangVan["baris"] = [];
  for (const b of o.baris as unknown[]) {
    if (!b || typeof b !== "object") continue;
    const r = b as Record<string, unknown>;
    const itemId = teks(r.itemId, 64);
    // null = barang tanpa varian (bentuk lama); selain itu harus teks.
    const variantSku = r.variantSku === null ? null : teks(r.variantSku, 191);
    if (!itemId || (variantSku === null && r.variantSku !== null)) continue;
    const qty = r.qty;
    if (typeof qty !== "number" || !Number.isInteger(qty) || qty <= 0 || qty > 100_000) continue;
    baris.push({ itemId, variantSku, qty });
  }
  if (baris.length === 0) return null;
  const uang = teks(o.uangDiterima, 15);
  return {
    idempotencyKey: kunci,
    baris,
    mode: o.mode === "store" ? "store" : "adhoc",
    storeId: teks(o.storeId, 64) ?? "",
    uangDiterima: uang !== null && /^\d*$/.test(uang) ? uang : "",
  };
}

/**
 * Keranjang setelah halaman dimuat ulang. Harga dan sisa van diambil dari
 * stok SEKARANG; jumlah tetap seperti yang dikirim — kalau kiriman pertama
 * ternyata sudah tercatat, kirim ulang dengan kunci yang sama mengembalikan
 * penjualan itu (writer memeriksa kunci sebelum stok). Barang yang sudah tidak
 * ada di van atau belum berharga dibuang. Bila tidak ada baris yang selamat →
 * null: keranjang baru dengan kunci baru.
 */
export function pulihkanKeranjangVan(
  simpanan: SimpananKeranjangVan | null,
  stok: readonly VanStockRow[],
  toko: readonly { id: string }[],
): { baris: Map<string, BarisKeranjangVan>; idempotencyKey: string; mode: ModePembeli; storeId: string; uangDiterima: string } | null {
  if (!simpanan) return null;
  const barisStok = new Map(stok.map((r) => [kunciBaris(r.itemId, r.variantSku), r]));
  const baris = new Map<string, BarisKeranjangVan>();
  for (const b of simpanan.baris) {
    const k = kunciBaris(b.itemId, b.variantSku);
    const row = barisStok.get(k);
    if (!row || row.price === null) continue;
    baris.set(k, {
      itemId: row.itemId,
      variantSku: row.variantSku,
      sku: row.sku,
      productName: row.productName,
      unitPrice: row.price,
      qty: (baris.get(k)?.qty ?? 0) + b.qty,
      qtyOnVan: row.qtyOnVan,
    });
  }
  if (baris.size === 0) return null;
  const tokoSah = simpanan.storeId !== "" && toko.some((t) => t.id === simpanan.storeId);
  return { baris, idempotencyKey: simpanan.idempotencyKey, mode: simpanan.mode, storeId: tokoSah ? simpanan.storeId : "", uangDiterima: simpanan.uangDiterima };
}

/**
 * Kunci kirim sesudah isi keranjang berubah. Tetap selama keranjang berisi;
 * keranjang yang DIKOSONGKAN berarti penjualan itu ditinggalkan, jadi keranjang
 * berikutnya mendapat kunci baru — kalau tidak, penjualan baru untuk pembeli
 * lain akan dijawab server dengan penjualan lama dan tidak pernah tercatat.
 */
export function kunciSesudahUbah(jumlahSebelum: number, jumlahSesudah: number, kunci: string, buatKunci: () => string): string {
  return jumlahSebelum > 0 && jumlahSesudah === 0 ? buatKunci() : kunci;
}

export function bacaSimpananKeranjangVan(p: Penyimpanan | null, userId: string): SimpananKeranjangVan | null {
  if (!p) return null;
  try {
    return uraiSimpananKeranjangVan(p.getItem(kunciSimpananKeranjangVan(userId)));
  } catch {
    return null;
  }
}

/** Simpanan null → dihapus. Penyimpanan penuh atau dilarang: diam, keranjang tetap hidup di layar. */
export function tulisSimpananKeranjangVan(p: Penyimpanan | null, userId: string, s: SimpananKeranjangVan | null): void {
  if (!p) return;
  try {
    if (s) p.setItem(kunciSimpananKeranjangVan(userId), JSON.stringify(s));
    else p.removeItem(kunciSimpananKeranjangVan(userId));
  } catch {
    // Mode privat atau penyimpanan penuh.
  }
}

/** Sama dengan layar jual SPG: lebih dari ini dianggap sinyal putus. */
export const BATAS_TUNGGU_KIRIM_MS = 20_000;

export type HasilKirimVan =
  | { jenis: "tercatat"; saleId: string; docNo: string }
  | { jenis: "ditolak"; hasil: Extract<RecordVanSaleActionResult, { ok: false }> }
  | { jenis: "terputus" };

/**
 * Satu kiriman ke server. "Ditolak" = server menjawab dan TIDAK mencatat
 * (stok, harga, uang). "Terputus" = jawaban hilang atau terlambat: penjualan
 * mungkin sudah tercatat, jadi kuncinya wajib dipertahankan. Tidak pernah
 * melempar — sinyal putus tidak boleh berakhir di layar galat.
 */
export async function kirimSekali(kirim: () => Promise<RecordVanSaleActionResult>, batasMs: number = BATAS_TUNGGU_KIRIM_MS): Promise<HasilKirimVan> {
  let jam: ReturnType<typeof setTimeout> | undefined;
  try {
    const res = await Promise.race([
      kirim(),
      new Promise<never>((_, tolak) => {
        jam = setTimeout(() => tolak(new Error("BATAS_WAKTU")), batasMs);
      }),
    ]);
    return res.ok ? { jenis: "tercatat", saleId: res.saleId, docNo: res.docNo } : { jenis: "ditolak", hasil: res };
  } catch {
    return { jenis: "terputus" };
  } finally {
    clearTimeout(jam);
  }
}

/**
 * Satu kali tekan "Catat Penjualan": simpanan (dengan kuncinya) ditulis DULU,
 * supaya muat ulang di tengah kiriman tidak kehilangan kunci; dihapus HANYA
 * setelah penjualan tercatat. Ditolak atau terputus → simpanan dan kunci
 * tetap, kirim berikutnya memakai kunci yang sama.
 */
export async function kirimPenjualanVan(input: {
  penyimpanan: Penyimpanan | null;
  userId: string;
  simpanan: SimpananKeranjangVan;
  kirim: (idempotencyKey: string) => Promise<RecordVanSaleActionResult>;
  batasMs?: number;
}): Promise<HasilKirimVan> {
  tulisSimpananKeranjangVan(input.penyimpanan, input.userId, input.simpanan);
  const hasil = await kirimSekali(() => input.kirim(input.simpanan.idempotencyKey), input.batasMs);
  if (hasil.jenis === "tercatat") tulisSimpananKeranjangVan(input.penyimpanan, input.userId, null);
  return hasil;
}
