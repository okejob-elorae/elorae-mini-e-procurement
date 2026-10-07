// Bukan aksi server: aturan murni "kembalikan bahan" dari CMT ke gudang.
// Penulisnya `kembali-bahan-writer.ts`; pemagarnya `app/actions/production.ts`.

import { Decimal } from "decimal.js";

/**
 * Bahan yang sudah keluar ke CMT bisa kembali ke gudang (sisa potong, WO batal).
 * Setiap barang yang kembali dicatat sebagai SATU `StockAdjustment` POSITIVE
 * bersumber ini, `externalRef` = id WO — buku itulah yang dijumlah sebagai
 * "sudah kembali". Tanpa tabel baru: nomor ADJ dan kunci idempotensi unik
 * sudah ada di tabel penyesuaian.
 */
export const SUMBER_KEMBALI_BAHAN = "WO_MATERIAL_RETURN";

/** Nama tindakan `AuditLog` (entitas WorkOrder) untuk satu pengembalian. */
export const AKSI_KEMBALI_BAHAN = "WO_MATERIAL_RETURNED";

/** Selisih qty yang dianggap nol (kolom qty berskala 2 desimal). */
export const TOLERANSI_QTY = new Decimal("0.005");

const NOL = new Decimal(0);

export type KodeTolakKembaliBahan =
  | "TANPA_AKSES"
  | "WO_TIDAK_DITEMUKAN"
  | "WO_SUDAH_DIBATALKAN"
  | "TANPA_BARIS"
  | "QTY_TIDAK_VALID"
  | "BARANG_GANDA"
  | "BUKAN_BAHAN_WO"
  | "MELEBIHI_SISA"
  | "CATATAN_TERLALU_PANJANG"
  | "GAGAL";

/** Batas catatan pengembalian (kolom `reason` VARCHAR(191) di MariaDB, sudah termasuk awalan). */
export const BATAS_CATATAN_KEMBALI = 120;

/** Alasan pembatalan WO disimpan di `WorkOrder.canceledReason` (VARCHAR(191) di MariaDB). */
export const BATAS_ALASAN_BATAL_WO = 190;

function angka(v: unknown): Decimal {
  const n = typeof v === "string" ? Number(v.trim()) : Number(v);
  return Number.isFinite(n) ? new Decimal(n) : NOL;
}

/** Baris `MaterialIssue.items` (TEKS JSON atau array) → daftar {itemId, qty}. */
export function barisPengeluaran(raw: unknown): Array<{ itemId: string; qty: Decimal }> {
  let isi: unknown = raw;
  if (typeof isi === "string") {
    try {
      isi = JSON.parse(isi);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(isi)) return [];
  const hasil: Array<{ itemId: string; qty: Decimal }> = [];
  for (const b of isi as Array<Record<string, unknown> | null>) {
    const itemId = b?.itemId ?? b?.item_id;
    if (itemId == null || itemId === "") continue;
    hasil.push({ itemId: String(itemId), qty: angka(b?.qty ?? b?.quantity) });
  }
  return hasil;
}

/** Jumlah qty per barang. */
export function jumlahPerBarang(baris: Iterable<{ itemId: string; qty: Decimal.Value }>): Map<string, Decimal> {
  const peta = new Map<string, Decimal>();
  for (const b of baris) peta.set(b.itemId, (peta.get(b.itemId) ?? NOL).plus(b.qty));
  return peta;
}

export type SisaBahan = { itemId: string; keluar: Decimal; kembali: Decimal; sisa: Decimal };

/**
 * Bahan yang masih di tangan CMT per barang = keluar − sudah kembali (tidak
 * pernah negatif). Urutan mengikuti `keluar`.
 */
export function sisaBahanDiCmt(keluar: Map<string, Decimal>, kembali: Map<string, Decimal>): SisaBahan[] {
  return [...keluar.entries()].map(([itemId, qtyKeluar]) => {
    const qtyKembali = kembali.get(itemId) ?? NOL;
    return { itemId, keluar: qtyKeluar, kembali: qtyKembali, sisa: Decimal.max(NOL, qtyKeluar.minus(qtyKembali)) };
  });
}

/** Barang yang sisanya belum nol — penghalang pembatalan WO. */
export function bahanMasihDiCmt(sisa: SisaBahan[]): SisaBahan[] {
  return sisa.filter((s) => s.sisa.gt(TOLERANSI_QTY));
}

export type HasilPeriksaKembali =
  | { ok: true; baris: Array<{ itemId: string; qty: Decimal }> }
  | { ok: false; code: KodeTolakKembaliBahan; itemId?: string; sisa?: number };

/**
 * Isian layar → baris yang sah. Qty dibulatkan ke 2 desimal; baris qty 0
 * dibuang (layar mengirim semua baris). Tolak: qty negatif/bukan angka,
 * barang dua kali, barang yang tidak pernah keluar ke WO ini, qty melebihi
 * sisa di CMT.
 */
export function periksaBarisKembali(
  isian: Array<{ itemId: string; qty: unknown }>,
  sisa: SisaBahan[],
): HasilPeriksaKembali {
  const sisaPer = new Map(sisa.map((s) => [s.itemId, s]));
  const dilihat = new Set<string>();
  const baris: Array<{ itemId: string; qty: Decimal }> = [];
  for (const b of isian) {
    const mentah = typeof b.qty === "string" ? Number(b.qty.trim().replace(",", ".")) : Number(b.qty);
    if (!Number.isFinite(mentah) || mentah < 0) return { ok: false, code: "QTY_TIDAK_VALID", itemId: b.itemId };
    const qty = new Decimal(mentah).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    if (qty.lte(0)) continue;
    if (dilihat.has(b.itemId)) return { ok: false, code: "BARANG_GANDA", itemId: b.itemId };
    dilihat.add(b.itemId);
    const s = sisaPer.get(b.itemId);
    if (!s || s.keluar.lte(TOLERANSI_QTY)) return { ok: false, code: "BUKAN_BAHAN_WO", itemId: b.itemId };
    if (qty.minus(s.sisa).gt(TOLERANSI_QTY)) {
      return { ok: false, code: "MELEBIHI_SISA", itemId: b.itemId, sisa: s.sisa.toNumber() };
    }
    baris.push({ itemId: b.itemId, qty });
  }
  if (baris.length === 0) return { ok: false, code: "TANPA_BARIS" };
  return { ok: true, baris };
}

/**
 * Harga satuan saat bahan keluar ke WO ini: rata-rata tertimbang gerakan
 * `WO_ISSUE` barang itu (Σ |qty| × harga ÷ Σ |qty|). Bahan kembali dinilai pada
 * harga ini — bukan harga rata-rata gudang hari ini — supaya nilai yang kembali
 * sama dengan nilai yang dulu keluar.
 */
export function hargaKeluar(gerakan: Array<{ qty: Decimal.Value; unitCost: Decimal.Value | null }>): Decimal {
  let qty = NOL;
  let nilai = NOL;
  for (const g of gerakan) {
    const q = new Decimal(g.qty).abs();
    if (q.lte(0)) continue;
    qty = qty.plus(q);
    nilai = nilai.plus(q.mul(g.unitCost ?? 0));
  }
  return qty.gt(0) ? nilai.div(qty) : NOL;
}

/**
 * KEPUTUSAN SEMENTARA (2026-10-07, menunggu pemilik): bahan yang kembali
 * SESUDAH ada penerimaan barang jadi dinilai paling banyak sebesar biaya bahan
 * WO yang BELUM dibebankan ke penerimaan barang jadi:
 * Σ biaya pengeluaran − nilai yang sudah kembali − Σ biaya penerimaan.
 * Biaya yang sudah masuk HPP barang jadi tidak boleh tercatat lagi di stok
 * bahan — tanpa batas ini, sisa kain yang kembali sesudah penerimaan penutup
 * membuat nilai persediaan terhitung dua kali (di barang jadi dan di kain).
 * Sebelum ada penerimaan tidak dibatasi (null): bahan kembali pada harga
 * keluarnya. Pilihan lain untuk pemilik (tolak pengembalian, atau koreksi HPP
 * barang jadi) diubah di sini saja.
 */
export function batasNilaiKembali(m: {
  adaPenerimaan: boolean;
  biayaBahanWo: Decimal.Value;
  sudahKembali: Decimal.Value;
  sudahDibebankan: Decimal.Value;
}): Decimal | null {
  if (!m.adaPenerimaan) return null;
  return Decimal.max(NOL, new Decimal(m.biayaBahanWo).minus(m.sudahKembali).minus(m.sudahDibebankan)).toDecimalPlaces(
    2,
    Decimal.ROUND_DOWN,
  );
}

/**
 * Harga satuan per baris sesudah batas nilai: bila Σ qty × harga melebihi
 * batas, semua harga diperkecil dengan faktor yang sama (dibulatkan ke bawah
 * ke sen, jadi Σ nilai tidak pernah melewati batas). Batas null = harga tetap.
 */
export function hargaDalamBatas(
  baris: Array<{ qty: Decimal.Value; harga: Decimal.Value }>,
  batas: Decimal | null,
): { harga: Decimal[]; dibatasi: boolean } {
  const harga = baris.map((b) => new Decimal(b.harga));
  if (batas == null) return { harga, dibatasi: false };
  const total = baris.reduce((s, b, i) => s.plus(new Decimal(b.qty).mul(harga[i])), NOL);
  if (total.lte(batas)) return { harga, dibatasi: false };
  const faktor = batas.lte(0) ? NOL : batas.div(total);
  return { harga: harga.map((h) => h.mul(faktor).toDecimalPlaces(2, Decimal.ROUND_DOWN)), dibatasi: true };
}

/**
 * Harga rata-rata gudang sesudah bahan kembali. Stok sebelumnya nol atau
 * negatif → harga bahan yang kembali (aturan yang sama dengan penerimaan
 * sesudah stok negatif); selain itu rata-rata tertimbang.
 */
export function rataRataSesudahKembali(
  stokSebelum: Decimal.Value,
  rataSebelum: Decimal.Value,
  qtyKembali: Decimal.Value,
  hargaKembali: Decimal.Value,
): Decimal {
  const qtyLama = new Decimal(stokSebelum);
  const tambah = new Decimal(qtyKembali);
  if (qtyLama.lte(0)) return new Decimal(hargaKembali);
  const total = qtyLama.plus(tambah);
  return qtyLama.mul(rataSebelum).plus(tambah.mul(hargaKembali)).div(total);
}

/** Kunci idempotensi satu baris: kunci formulir berlaku per WO, satu barang sekali. */
export function kunciBarisKembali(woId: string, kunci: string, itemId: string): string {
  return `${awalanKunciKembali(woId, kunci)}${itemId}`;
}

export function awalanKunciKembali(woId: string, kunci: string): string {
  return `woret:${woId}:${kunci}:`;
}
