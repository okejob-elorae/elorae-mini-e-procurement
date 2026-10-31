import { KANAL_MARKETPLACE, type KanalJurnal } from "@/lib/finance/journals/kanal";
import type { EntriAkun, EntriHutang, EntriPersediaan, EntriPiutangMarketplace, EntriSaldoAwal, JenisSaldoAwal } from "./jenis";

/*
 * Pemeriksaan isian yang dikirim layar — murni. Penulis tidak pernah percaya
 * isian klien: angka harus berhingga, tidak negatif, paling banyak dua desimal;
 * kunci (akun, barang, kanal, pemasok) tidak boleh ganda. Piutang toko tidak
 * menerima isian sama sekali — selalu dihitung dari modul piutang.
 */

export const BATAS_BARIS: Record<JenisSaldoAwal, number> = {
  ACCOUNTS: 500,
  INVENTORY: 50_000,
  AR_STORE: 0,
  AR_MARKETPLACE: 20,
  AP: 5_000,
};

export const BATAS_RUPIAH = 1e13;
export const BATAS_CATATAN = 1000;

export type KodeGalatIsian =
  | "ISIAN_TIDAK_SAH"
  | "ANGKA_TIDAK_SAH"
  | "TERLALU_BANYAK"
  | "AKUN_GANDA"
  | "BARANG_GANDA"
  | "KANAL_GANDA"
  | "PEMASOK_GANDA"
  | "KANAL_TIDAK_SAH";

export type HasilPeriksa<J extends JenisSaldoAwal> =
  | { ok: true; baris: EntriSaldoAwal[J][] }
  | { ok: false; kode: KodeGalatIsian; baris?: number };

/** Rupiah sah: berhingga, ≥ 0, ≤ dua desimal, di bawah batas. */
export function rupiahSah(n: unknown): n is number {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > BATAS_RUPIAH) return false;
  return Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;
}

function teks(v: unknown, maks: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 && t.length <= maks ? t : null;
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function periksaAkun(input: unknown[]): HasilPeriksa<"ACCOUNTS"> {
  const hasil: EntriAkun[] = [];
  const dilihat = new Set<string>();
  for (let i = 0; i < input.length; i++) {
    const o = obj(input[i]);
    const akunId = o ? teks(o.akunId, 64) : null;
    if (!o || !akunId) return { ok: false, kode: "ISIAN_TIDAK_SAH", baris: i + 1 };
    const debit = o.debit ?? 0;
    const kredit = o.kredit ?? 0;
    if (!rupiahSah(debit) || !rupiahSah(kredit)) return { ok: false, kode: "ANGKA_TIDAK_SAH", baris: i + 1 };
    if (debit > 0 && kredit > 0) return { ok: false, kode: "ISIAN_TIDAK_SAH", baris: i + 1 };
    if (debit === 0 && kredit === 0) continue;
    if (dilihat.has(akunId)) return { ok: false, kode: "AKUN_GANDA", baris: i + 1 };
    dilihat.add(akunId);
    const catatan = o.catatan === undefined || o.catatan === null || o.catatan === "" ? undefined : teks(o.catatan, 200);
    if (catatan === null) return { ok: false, kode: "ISIAN_TIDAK_SAH", baris: i + 1 };
    hasil.push({ akunId, debit, kredit, ...(catatan ? { catatan } : {}) });
  }
  return { ok: true, baris: hasil };
}

function periksaPersediaan(input: unknown[]): HasilPeriksa<"INVENTORY"> {
  const hasil: EntriPersediaan[] = [];
  const dilihat = new Set<string>();
  for (let i = 0; i < input.length; i++) {
    const o = obj(input[i]);
    const itemId = o ? teks(o.itemId, 64) : null;
    if (!o || !itemId) return { ok: false, kode: "ISIAN_TIDAK_SAH", baris: i + 1 };
    const varian = o.variantSku === undefined || o.variantSku === null || o.variantSku === "" ? null : teks(o.variantSku, 191);
    if (o.variantSku !== undefined && o.variantSku !== null && o.variantSku !== "" && varian === null) {
      return { ok: false, kode: "ISIAN_TIDAK_SAH", baris: i + 1 };
    }
    if (!rupiahSah(o.hpp)) return { ok: false, kode: "ANGKA_TIDAK_SAH", baris: i + 1 };
    const kunci = `${itemId}\u0000${varian ?? ""}`;
    if (dilihat.has(kunci)) return { ok: false, kode: "BARANG_GANDA", baris: i + 1 };
    dilihat.add(kunci);
    hasil.push({ itemId, variantSku: varian, hpp: o.hpp });
  }
  return { ok: true, baris: hasil };
}

function periksaMarketplace(input: unknown[]): HasilPeriksa<"AR_MARKETPLACE"> {
  const hasil: EntriPiutangMarketplace[] = [];
  const dilihat = new Set<string>();
  for (let i = 0; i < input.length; i++) {
    const o = obj(input[i]);
    if (!o) return { ok: false, kode: "ISIAN_TIDAK_SAH", baris: i + 1 };
    if (typeof o.kanal !== "string" || !(KANAL_MARKETPLACE as readonly string[]).includes(o.kanal)) {
      return { ok: false, kode: "KANAL_TIDAK_SAH", baris: i + 1 };
    }
    if (!rupiahSah(o.jumlah)) return { ok: false, kode: "ANGKA_TIDAK_SAH", baris: i + 1 };
    if (dilihat.has(o.kanal)) return { ok: false, kode: "KANAL_GANDA", baris: i + 1 };
    dilihat.add(o.kanal);
    hasil.push({ kanal: o.kanal as KanalJurnal, jumlah: o.jumlah });
  }
  return { ok: true, baris: hasil };
}

function periksaHutang(input: unknown[]): HasilPeriksa<"AP"> {
  const hasil: EntriHutang[] = [];
  const dilihat = new Set<string>();
  for (let i = 0; i < input.length; i++) {
    const o = obj(input[i]);
    const supplierId = o ? teks(o.supplierId, 64) : null;
    if (!o || !supplierId) return { ok: false, kode: "ISIAN_TIDAK_SAH", baris: i + 1 };
    if (!rupiahSah(o.jumlah)) return { ok: false, kode: "ANGKA_TIDAK_SAH", baris: i + 1 };
    if (dilihat.has(supplierId)) return { ok: false, kode: "PEMASOK_GANDA", baris: i + 1 };
    dilihat.add(supplierId);
    hasil.push({ supplierId, jumlah: o.jumlah });
  }
  return { ok: true, baris: hasil };
}

export function periksaIsian<J extends JenisSaldoAwal>(jenis: J, input: unknown): HasilPeriksa<J> {
  if (jenis === "AR_STORE") return { ok: true, baris: [] } as HasilPeriksa<J>;
  if (!Array.isArray(input)) return { ok: false, kode: "ISIAN_TIDAK_SAH" };
  if (input.length > BATAS_BARIS[jenis]) return { ok: false, kode: "TERLALU_BANYAK" };
  switch (jenis) {
    case "ACCOUNTS":
      return periksaAkun(input) as HasilPeriksa<J>;
    case "INVENTORY":
      return periksaPersediaan(input) as HasilPeriksa<J>;
    case "AR_MARKETPLACE":
      return periksaMarketplace(input) as HasilPeriksa<J>;
    case "AP":
      return periksaHutang(input) as HasilPeriksa<J>;
    default:
      return { ok: false, kode: "ISIAN_TIDAK_SAH" };
  }
}

/**
 * Gabungkan baris yang dihitung sistem dengan isian layar (piutang marketplace,
 * hutang): isian layar menang per kunci; baris terhitung yang tidak dikirim
 * layar (halaman basi) tetap ikut dengan nilai hitungannya, supaya tidak ada
 * yang hilang diam-diam. Baris isian tanpa padanan hitungan = tambahan manual.
 */
export function gabungDenganHitungan<T extends { jumlah: number; dihitung?: number }>(
  hitungan: readonly T[],
  isian: readonly T[],
  kunci: (b: T) => string,
): T[] {
  const perKunci = new Map(isian.map((b) => [kunci(b), b]));
  const hasil: T[] = [];
  for (const h of hitungan) {
    const k = kunci(h);
    const isi = perKunci.get(k);
    hasil.push({ ...h, dihitung: h.jumlah, jumlah: isi ? isi.jumlah : h.jumlah });
    perKunci.delete(k);
  }
  for (const isi of perKunci.values()) hasil.push({ ...isi, dihitung: 0 });
  return hasil;
}

/** Ada baris yang jumlahnya tidak sama dengan hitungan sistem → alasan koreksi wajib. */
export function adaKoreksi(baris: readonly { jumlah: number; dihitung?: number }[]): boolean {
  return baris.some((b) => Math.round(b.jumlah * 100) !== Math.round((b.dihitung ?? 0) * 100));
}
