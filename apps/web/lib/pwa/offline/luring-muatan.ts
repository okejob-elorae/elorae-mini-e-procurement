// Bentuk antrean "tanpa sinyal" untuk kunjungan dan pekerjaan stok SPG, dan
// muatan kirimnya ke aksi server — murni, tanpa Dexie dan tanpa aksi server
// (impor TIPE saja, plus satu konstanta murni), supaya bisa dites di Node dan
// dipakai layar maupun penyinkron.
import { BATAS_STOK_LURING_MS } from "@/lib/pwa/waktu-luring";
import type {
  PendingCheckin,
  PendingCheckout,
  PendingMutasiAjuan,
  PendingMutasiKirim,
  PendingSpgReturn,
  PendingStoreOpname,
  PendingStoreReceipt,
} from "./db";

type Baru<T> = Omit<T, "capturedAt" | "syncState" | "attempts" | "error">;

export type CheckinBaru = Baru<PendingCheckin>;
export type CheckoutBaru = Baru<PendingCheckout>;
export type TerimaBaru = Baru<PendingStoreReceipt>;
export type OpnameBaru = Baru<PendingStoreOpname>;
export type ReturPembeliBaru = Baru<PendingSpgReturn>;
export type MutasiAjuanBaru = Baru<PendingMutasiAjuan>;
export type MutasiKirimBaru = Baru<PendingMutasiKirim>;

const koordinatSah = (lat: number, lng: number) =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

/** Satu check-in tanpa sinyal; `null` bila koordinat atau waktunya tidak terbaca. */
export function susunCheckin(isi: {
  clientId: string;
  storeId: string;
  storeName: string | null;
  waktu: number;
  lat: number;
  lng: number;
  akurasi: number | null | undefined;
}): CheckinBaru | null {
  if (!isi.clientId || !isi.storeId || !Number.isFinite(isi.waktu) || !koordinatSah(isi.lat, isi.lng)) return null;
  const akurasi = typeof isi.akurasi === "number" && Number.isFinite(isi.akurasi) && isi.akurasi >= 0 ? Math.round(isi.akurasi) : null;
  return {
    localId: isi.clientId,
    storeId: isi.storeId,
    storeName: isi.storeName,
    waktu: isi.waktu,
    lat: isi.lat,
    lng: isi.lng,
    akurasi,
  };
}

/** Muatan `checkInLuringAction`. */
export function muatanCheckin(c: Pick<PendingCheckin, "localId" | "storeId" | "waktu" | "lat" | "lng" | "akurasi">) {
  return {
    clientId: c.localId,
    storeId: c.storeId,
    lat: c.lat,
    lng: c.lng,
    accuracy: c.akurasi,
    waktu: new Date(c.waktu).toISOString(),
  };
}

/** Muatan `checkOutLuringAction`. Kunjungan dari antrean (`visitClientId`) didahulukan. */
export function muatanCheckout(c: Pick<
  PendingCheckout,
  "visitId" | "visitClientId" | "waktu" | "lat" | "lng" | "outcome" | "outcomeNote" | "transaksiTertunda"
>) {
  return {
    ...(c.visitClientId ? { visitClientId: c.visitClientId } : { visitId: c.visitId }),
    waktu: new Date(c.waktu).toISOString(),
    lat: c.lat,
    lng: c.lng,
    outcome: c.outcome,
    outcomeNote: c.outcomeNote,
    transaksiTertunda: c.transaksiTertunda,
  };
}

/** Ikatan kunjungan di muatan: id buatan HP didahulukan (server mencarinya lebih dulu). */
function ikatan(r: { visitId: string | null; visitClientId: string | null }) {
  return r.visitClientId ? { visitClientId: r.visitClientId } : { visitId: r.visitId };
}

/**
 * Muatan `terimaKirimanAction` dari antrean. `urlFoto(i)` = URL foto rusak baris
 * ke-i yang sudah terunggah (atau `null`). Baris tanpa barang rusak tidak
 * membawa kolom rusak sama sekali.
 */
export function muatanTerima(r: TerimaBaru, urlFoto: (i: number) => string | null) {
  return {
    sourceType: r.sourceType,
    sourceId: r.sourceId,
    diterima: r.diterima.map((d, i) => ({
      lineId: d.lineId,
      qtyReceived: d.qtyReceived,
      ...(d.qtyDamaged && d.qtyDamaged > 0
        ? { qtyDamaged: d.qtyDamaged, damageNote: (d.damageNote ?? "").trim(), damagePhotoUrl: urlFoto(i) }
        : {}),
    })),
    ...(r.note ? { note: r.note } : {}),
    idempotencyKey: r.localId,
    luring: true as const,
    waktuTangkap: new Date(r.waktu).toISOString(),
    ...ikatan(r),
  };
}

/**
 * Umur hitungan yang sah (bulat, ≥ 0); selain itu tidak dikirim — server menolak
 * SELURUH opname karenanya. Dibatasi ke batas yang sama dengan server
 * (`BATAS_UMUR_HITUNG_MS` = batas pekerjaan stok luring): server memotongnya ke
 * batas itu juga, dan angka di atas bilangan bulat aman ditolak skema aksi.
 */
function umurSah(umur: number | undefined): number | undefined {
  return typeof umur === "number" && Number.isFinite(umur) && umur >= 0 ? Math.min(BATAS_STOK_LURING_MS, Math.round(umur)) : undefined;
}

/**
 * Muatan `catatOpnameAction` dari antrean. Saldo sistem tidak dikirim — server
 * yang menilainya. Umur hitungan per baris IKUT: tanpanya opname tanpa sinyal
 * dibandingkan dengan saldo saat tangkap, dan penjualan di antara saat rak
 * dihitung dan saat disimpan menjadi selisih palsu (lihat `lib/spg/opname-acuan.ts`).
 */
export function muatanOpname(r: OpnameBaru) {
  return {
    baris: r.baris.map((b) => {
      const umur = umurSah(b.umurHitungMs);
      return {
        itemId: b.itemId,
        variantSku: b.variantSku,
        qtyCounted: b.qtyCounted,
        ...(umur === undefined ? {} : { umurHitungMs: umur }),
      };
    }),
    ...(r.note ? { note: r.note } : {}),
    idempotencyKey: r.localId,
    luring: true as const,
    waktuTangkap: new Date(r.waktu).toISOString(),
    ...ikatan(r),
  };
}

/** Muatan `catatReturPembeliAction` — sama dengan kiriman di konter, kunci yang sama. */
export function muatanReturPembeli(r: ReturPembeliBaru) {
  return {
    spgSaleId: r.spgSaleId,
    alasan: r.alasan,
    idempotencyKey: r.localId,
    baris: r.baris.map((b) => ({ saleLineId: b.saleLineId, qty: b.qty, condition: b.condition })),
    // Dicatat pada jam pembeli mengembalikannya, bukan saat sinyal kembali —
    // opname tanpa sinyal sesudahnya sudah menghitung barang itu di rak.
    luring: true as const,
    waktuTangkap: new Date(r.waktu).toISOString(),
  };
}

/** Muatan `ajukanMutasiAction` dari antrean — kunci yang sama dengan kiriman langsungnya. */
export function muatanAjuanMutasi(r: MutasiAjuanBaru) {
  return {
    toStoreId: r.toStoreId,
    alasan: r.alasan,
    baris: r.baris.map((b) => ({ itemId: b.itemId, variantSku: b.variantSku, qty: b.qty })),
    idempotencyKey: r.localId,
    luring: true as const,
    waktuTangkap: new Date(r.waktu).toISOString(),
    ...ikatan(r),
  };
}

/**
 * Muatan `kirimMutasiAction` dari antrean, atau `null` selama mutasinya belum
 * punya id server (ajuannya masih di HP) — penyinkron tidak mengirimnya.
 */
export function muatanKirimMutasi(r: MutasiKirimBaru) {
  if (!r.transferId) return null;
  return {
    transferId: r.transferId,
    idempotencyKey: r.localId,
    luring: true as const,
    waktuTangkap: new Date(r.waktu).toISOString(),
    ...ikatan(r),
  };
}

/** Jumlah potong di satu antrean stok — untuk ringkasan di layar. */
export function jumlahPotong(baris: readonly { qty?: number; qtyReceived?: number; qtyCounted?: number }[]): number {
  return baris.reduce((n, b) => n + (b.qty ?? b.qtyReceived ?? b.qtyCounted ?? 0), 0);
}
