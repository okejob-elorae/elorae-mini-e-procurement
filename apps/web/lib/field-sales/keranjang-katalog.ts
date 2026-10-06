/**
 * Keranjang katalog salesman — aturan murni (tanpa React, tanpa server), supaya
 * bisa dites di Node: jumlah yang diketik, isi per pack, dan simpanan keranjang
 * di `sessionStorage`.
 *
 * Kunci kirim (`idempotencyKey`) dibuat SEKALI per keranjang dan disimpan
 * bersama isinya sampai pesanan tercatat atau masuk antrean HP. Kirim ulang
 * sesudah galat atau sesudah halaman dimuat ulang memakai kunci yang sama,
 * sehingga `createFieldSalesOrder` mengembalikan pesanan yang sudah tercatat
 * alih-alih membuat pesanan kedua.
 *
 * KONSI: simpanan tidak pernah membawa harga — keranjang HP hanya memuat
 * barang, varian, dan jumlah (harga konsinyasi tidak pernah sampai ke HP).
 */
import type { PackRatioRow } from "@elorae/db/pack-ratio";
import type { CartLine } from "@/lib/field-sales/cart";
import { susunIsiUlang } from "@/lib/salesman/ulang";

// ─── Jumlah yang diketik ───────────────────────────────────────────────────

/**
 * Jumlah dari isian angka. Selain angka dibuang; kosong/nol = keluar dari
 * keranjang. Di atas batas (stok tersedia, atau batas langkah pre-order) dijepit
 * ke batas — sama dengan tombol + yang mati di batas itu.
 */
export function jepitJumlah(teks: string, maks: number): { qty: number; dijepit: boolean } {
  const angka = teks.replace(/\D/g, "");
  const batas = Math.max(0, Math.floor(Number.isFinite(maks) ? maks : 0));
  if (!angka) return { qty: 0, dijepit: false };
  const n = Number.parseInt(angka, 10);
  if (n > batas) return { qty: batas, dijepit: true };
  return { qty: n, dijepit: false };
}

/** Isian jumlah menerima paling banyak 6 angka (batas pre-order 9999). */
const MAKS_ANGKA_JUMLAH = 6;

/**
 * Satu ketikan di isian jumlah (`QtyStepper`): teks yang tampil, jumlah baru
 * untuk keranjang (`null` = keranjang tidak diubah), dan apakah dijepit.
 * Angka > 0 langsung masuk keranjang; kosong/0 menunggu isian ditinggalkan
 * (`selesaiJumlah`) supaya baris di layar tinjau tidak hilang di tengah mengetik.
 */
export function ketikJumlah(teks: string, max: number, value: number): { draf: string; qty: number | null; dijepit: boolean } {
  const angka = teks.replace(/\D/g, "").slice(0, MAKS_ANGKA_JUMLAH);
  const h = jepitJumlah(angka, max);
  return {
    draf: h.dijepit ? String(h.qty) : angka,
    qty: h.qty > 0 && h.qty !== value ? h.qty : null,
    dijepit: h.dijepit,
  };
}

/** Isian ditinggalkan: kosong/0 = keluar dari keranjang. `null` = keranjang tidak diubah. */
export function selesaiJumlah(draf: string | null, max: number, value: number): number | null {
  if (draf === null) return null;
  const { qty } = jepitJumlah(draf, max);
  return qty !== value ? qty : null;
}

/**
 * Tombol −/+ dihitung dari angka yang TAMPIL — ketikan yang belum ditinggalkan
 * ikut (di HP tombol bisa disentuh tanpa isian kehilangan fokus). + tidak pernah
 * melewati batas; − berhenti di 0 (keluar dari keranjang).
 */
export function langkahJumlah(arah: 1 | -1, draf: string | null, max: number, value: number): number {
  const tampil = draf === null ? value : jepitJumlah(draf, Math.max(max, value)).qty;
  if (arah < 0) return Math.max(0, tampil - 1);
  return Math.min(tampil + 1, Math.max(tampil, Math.floor(max)));
}

// ─── Isi per pack ──────────────────────────────────────────────────────────

/** variantSku → [ukuran, grup warna ("" bila varian tidak bertanda warna)]. */
export type PetaUkuranPack = Record<string, [string, string]>;

const norm = (s: string) => s.trim().toLowerCase();
const KUNCI_UKURAN = new Set(["size", "ukuran"]);
const KUNCI_WARNA = new Set(["color", "colour", "warna"]);

/**
 * Varian bertanda ukuran dari `Item.variants`, dengan warnanya sebagai grup
 * pack. Sama toleransinya dengan rencana kirim (`bacaUkuranVarian`): teks JSON
 * dan kunci berhuruf besar (`SKU`, `Size`, `Ukuran`). Tanpa SKU atau tanpa
 * ukuran dilewati — tidak bisa masuk pack.
 */
export function bacaVarianPack(raw: unknown): Array<{ variantSku: string; ukuran: string; grup: string }> {
  let v = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(v)) return [];
  const hasil: Array<{ variantSku: string; ukuran: string; grup: string }> = [];
  for (const o of v) {
    if (!o || typeof o !== "object" || Array.isArray(o)) continue;
    let sku = "";
    let ukuran = "";
    let grup = "";
    for (const [k, val] of Object.entries(o as Record<string, unknown>)) {
      const kunci = k.toLowerCase();
      const s = val == null ? "" : String(val).trim();
      if (kunci === "sku" && !sku) sku = s;
      else if (KUNCI_UKURAN.has(kunci) && !ukuran) ukuran = s;
      else if (KUNCI_WARNA.has(kunci) && !grup) grup = s;
    }
    if (sku && ukuran) hasil.push({ variantSku: sku, ukuran, grup });
  }
  return hasil;
}

/**
 * Peta ukuran untuk katalog: hanya varian yang ukurannya disebut rasio pack —
 * selebihnya tidak pernah dipakai, dan peta ini ikut muatan halaman.
 */
export function petaUkuranPack(daftarVariants: readonly unknown[], rasio: readonly PackRatioRow[]): PetaUkuranPack {
  const ukuranRasio = new Set(rasio.map((r) => norm(r.size)));
  const peta: PetaUkuranPack = {};
  if (ukuranRasio.size === 0) return peta;
  for (const raw of daftarVariants) {
    for (const v of bacaVarianPack(raw)) {
      if (ukuranRasio.has(norm(v.ukuran)) && !(v.variantSku in peta)) peta[v.variantSku] = [v.ukuran, v.grup];
    }
  }
  return peta;
}

/** Grup (warna) barang ini yang bisa diisi per pack, urut seperti daftar varian. Kosong = tanpa tombol pack. */
export function grupPack(varian: readonly { variantSku: string }[], peta: PetaUkuranPack): string[] {
  const grup: string[] = [];
  for (const v of varian) {
    const u = peta[v.variantSku];
    if (u && !grup.includes(u[1])) grup.push(u[1]);
  }
  return grup;
}

export type KurangPack = { ukuran: string; butuh: number; dapat: number; tidakAda: boolean };

/**
 * "+1 pack": setiap ukuran di rasio menambah jumlahnya di varian ukuran itu
 * (dalam grup warna yang dipilih). Ukuran yang stoknya kurang diisi sampai
 * stok — tidak pernah melewati batas tombol + — dan dilaporkan di `kurang`;
 * ukuran yang tidak dimiliki barang ini dilaporkan `tidakAda`.
 */
export function tambahSatuPack(input: {
  rasio: readonly PackRatioRow[];
  varian: readonly { variantSku: string; available: number }[];
  peta: PetaUkuranPack;
  grup: string;
  /** variantSku → jumlah di keranjang sekarang. */
  jumlah: Readonly<Record<string, number>>;
}): { baris: { variantSku: string; qty: number }[]; kurang: KurangPack[] } {
  const baris: { variantSku: string; qty: number }[] = [];
  const kurang: KurangPack[] = [];
  for (const r of input.rasio) {
    if (!(r.qty > 0)) continue;
    const v = input.varian.find((x) => {
      const u = input.peta[x.variantSku];
      return u !== undefined && u[1] === input.grup && norm(u[0]) === norm(r.size);
    });
    if (!v) {
      kurang.push({ ukuran: r.size, butuh: r.qty, dapat: 0, tidakAda: true });
      continue;
    }
    const sekarang = input.jumlah[v.variantSku] ?? 0;
    const batas = Math.max(0, v.available);
    const baru = Math.max(sekarang, Math.min(sekarang + r.qty, batas));
    const dapat = baru - sekarang;
    if (baru !== sekarang) baris.push({ variantSku: v.variantSku, qty: baru });
    if (dapat < r.qty) kurang.push({ ukuran: r.size, butuh: r.qty, dapat, tidakAda: false });
  }
  return { baris, kurang };
}

// ─── Simpanan keranjang ────────────────────────────────────────────────────

export type Penyimpanan = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type BarisSimpananKatalog = {
  itemId: string;
  variantSku: string;
  qty: number;
  /** Ajuan harga PUTUS (ketikan salesman). KONSI tidak pernah punya. */
  requestedUnitPrice?: number;
  appealReason?: string;
};

export type SimpananKeranjangKatalog = {
  idempotencyKey: string;
  /** Jam tulis terakhir (ms). Simpanan yang lebih tua dari sehari dibuang. */
  disimpanPada: number;
  baris: BarisSimpananKatalog[];
  catatan: string;
};

export const AWALAN_SIMPANAN_KERANJANG_KATALOG = "elorae.katalog.keranjang.";
export const UMUR_SIMPANAN_KATALOG_MS = 24 * 60 * 60 * 1000;

/**
 * Per pengguna + toko: salesman berikutnya di tab yang sama tidak mewarisi
 * keranjang. Keranjang pre-order punya kunci sendiri per jendela — keranjang
 * stok siap tidak boleh terbawa menjadi pesanan pre-order (dan sebaliknya).
 */
export function kunciSimpananKatalog(userId: string, storeId: string, indenId?: string | null): string {
  return `${AWALAN_SIMPANAN_KERANJANG_KATALOG}${userId}.${storeId}${indenId ? `.inden.${indenId}` : ""}`;
}

/** Bentuk simpanan dari keadaan layar. Keranjang kosong → null (simpanan dihapus). */
export function susunSimpananKatalog(input: {
  idempotencyKey: string;
  baris: Iterable<CartLine>;
  catatan: string;
  konsi: boolean;
  sekarang: number;
}): SimpananKeranjangKatalog | null {
  if (!input.idempotencyKey) return null;
  const baris: BarisSimpananKatalog[] = [];
  for (const l of input.baris) {
    if (!(l.qty > 0)) continue;
    const b: BarisSimpananKatalog = { itemId: l.itemId, variantSku: l.variantSku, qty: l.qty };
    if (!input.konsi && l.requestedUnitPrice != null) {
      b.requestedUnitPrice = l.requestedUnitPrice;
      if (l.appealReason) b.appealReason = l.appealReason;
    }
    baris.push(b);
  }
  if (baris.length === 0) return null;
  return { idempotencyKey: input.idempotencyKey, disimpanPada: input.sekarang, baris, catatan: input.catatan };
}

const teks = (v: unknown, maks: number): string | null => (typeof v === "string" && v.length <= maks ? v : null);

/** Baca simpanan; rusak, kedaluwarsa, tanpa kunci kirim, atau tanpa baris sah dianggap tidak ada. */
export function uraiSimpananKatalog(mentah: string | null, sekarang: number): SimpananKeranjangKatalog | null {
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
  const pada = o.disimpanPada;
  if (!kunci || typeof pada !== "number" || !Number.isFinite(pada) || !Array.isArray(o.baris)) return null;
  // Jam HP bisa dimundurkan: selisih ke arah mana pun lebih dari sehari = kedaluwarsa.
  if (Math.abs(sekarang - pada) > UMUR_SIMPANAN_KATALOG_MS) return null;
  const baris: BarisSimpananKatalog[] = [];
  const terlihat = new Set<string>();
  for (const b of o.baris as unknown[]) {
    if (!b || typeof b !== "object") continue;
    const r = b as Record<string, unknown>;
    const itemId = teks(r.itemId, 64);
    const variantSku = teks(r.variantSku, 191);
    const qty = r.qty;
    if (!itemId || variantSku === null) continue;
    if (typeof qty !== "number" || !Number.isInteger(qty) || qty <= 0 || qty > 100_000) continue;
    const k = `${itemId}::${variantSku}`;
    if (terlihat.has(k)) continue;
    terlihat.add(k);
    const hasil: BarisSimpananKatalog = { itemId, variantSku, qty };
    const harga = r.requestedUnitPrice;
    if (typeof harga === "number" && Number.isFinite(harga) && harga >= 0) {
      hasil.requestedUnitPrice = harga;
      const alasan = teks(r.appealReason, 500);
      if (alasan) hasil.appealReason = alasan;
    }
    baris.push(hasil);
  }
  if (baris.length === 0) return null;
  return { idempotencyKey: kunci, disimpanPada: pada, baris, catatan: teks(o.catatan, 2000) ?? "" };
}

/** Simpanan yang kedaluwarsa atau rusak sekalian dihapus. Penyimpanan dilarang → null. */
export function bacaSimpananKatalog(p: Penyimpanan | null, kunci: string, sekarang: number): SimpananKeranjangKatalog | null {
  if (!p) return null;
  try {
    const mentah = p.getItem(kunci);
    const s = uraiSimpananKatalog(mentah, sekarang);
    if (mentah !== null && s === null) p.removeItem(kunci);
    return s;
  } catch {
    return null;
  }
}

/**
 * Isinya sama (kunci kirim, catatan, baris)? Menulis ulang isi yang sama —
 * mis. sesaat sesudah dipulihkan — tidak boleh memperbarui `disimpanPada`:
 * "kedaluwarsa sesudah 1 hari" dihitung dari perubahan terakhir salesman,
 * bukan dari kapan katalog terakhir dibuka.
 */
export function isiSimpananSama(a: SimpananKeranjangKatalog | null, b: SimpananKeranjangKatalog | null): boolean {
  if (!a || !b) return a === b;
  return a.idempotencyKey === b.idempotencyKey && a.catatan === b.catatan && JSON.stringify(a.baris) === JSON.stringify(b.baris);
}

/** Simpanan null → dihapus. Penyimpanan penuh atau dilarang: diam, keranjang tetap hidup di layar. */
export function tulisSimpananKatalog(p: Penyimpanan | null, kunci: string, s: SimpananKeranjangKatalog | null): void {
  if (!p) return;
  try {
    if (s) p.setItem(kunci, JSON.stringify(s));
    else p.removeItem(kunci);
  } catch {
    // Mode privat atau penyimpanan penuh.
  }
}

type BarangPulih = {
  itemId: string;
  sku: string;
  nameId: string;
  price: number | null;
  available: number;
  variants: { variantSku: string; variantLabel: string; available: number }[];
};

/**
 * Keranjang tersimpan → baris keranjang dari katalog SEKARANG, dengan aturan
 * yang sama dengan "Ulangi pesanan": dijepit stok tersedia, barang yang hilang
 * atau habis dilewati (dihitung), barang PUTUS tanpa harga tidak dimasukkan
 * (disebut namanya). Ajuan harga PUTUS ikut kembali; KONSI tidak punya.
 */
export function pulihkanKeranjangKatalog(
  simpanan: SimpananKeranjangKatalog,
  katalog: readonly BarangPulih[],
  konsi: boolean,
): { baris: CartLine[]; dilewati: number; tanpaHarga: string[] } {
  const hasil = susunIsiUlang(katalog, simpanan.baris, konsi);
  if (konsi) return hasil;
  const ajuan = new Map(
    simpanan.baris
      .filter((b) => b.requestedUnitPrice !== undefined)
      .map((b) => [`${b.itemId}::${b.variantSku}`, { requestedUnitPrice: b.requestedUnitPrice!, appealReason: b.appealReason ?? null }]),
  );
  return {
    ...hasil,
    baris: hasil.baris.map((l) => {
      const a = ajuan.get(`${l.itemId}::${l.variantSku}`);
      return a ? { ...l, ...a } : l;
    }),
  };
}
