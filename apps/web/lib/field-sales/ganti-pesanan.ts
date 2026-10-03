/**
 * Batal dan ubah pesanan oleh salesman sendiri — bagian yang murni.
 *
 * Hanya pesanan yang MASIH menunggu persetujuan yang boleh dibatalkan atau
 * diubah, dan hanya oleh salesman pemiliknya. Pesanan yang dibatalkan statusnya
 * tetap `REJECTED`: setiap kueri "pesanan hidup" di kode ini memakai
 * `status <> REJECTED`, jadi membuat status baru berarti menyisir semuanya.
 * Yang membedakan "dibatalkan salesman" dari "ditolak kantor" adalah
 * `cancelledById`/`cancelledAt`.
 *
 * Mengubah = mengganti: pesanan BARU dibuat oleh penulis pesanan yang sama
 * (harga, promo, minimum, kredit, inden, jarak jauh dinilai ulang), dengan
 * `replacesOrderId` menunjuk pesanan lama, dan pesanan lama dibatalkan DI
 * TRANSAKSI YANG SAMA. Tidak ada saat di mana keduanya hidup, atau keduanya mati.
 */

/** Kode tindakan jejak (`AuditLog.action`) saat salesman membatalkan pesanannya. */
export const AKSI_PESANAN_DIBATALKAN = "FIELD_SALES_ORDER_CANCELLED";
/** `AuditLog.entityType` untuk pesanan lapangan. */
export const ENTITAS_PESANAN = "FieldSalesOrder";
export const PANJANG_ALASAN_BATAL_MAKS = 500;

export type KodeAlasanBatal = "ALASAN_WAJIB" | "ALASAN_TERLALU_PANJANG";

/** Alasan wajib (dipangkas), paling panjang 500 karakter. */
export function periksaAlasanBatal(alasan: unknown): { ok: true; alasan: string } | { ok: false; kode: KodeAlasanBatal } {
  const bersih = typeof alasan === "string" ? alasan.trim() : "";
  if (bersih === "") return { ok: false, kode: "ALASAN_WAJIB" };
  if (bersih.length > PANJANG_ALASAN_BATAL_MAKS) return { ok: false, kode: "ALASAN_TERLALU_PANJANG" };
  return { ok: true, alasan: bersih };
}

/** Alasan yang ditulis pada pesanan lama saat diganti. Selalu Indonesia — kantor membacanya apa adanya. */
export function alasanDiganti(orderNoBaru: string): string {
  return `Diganti dengan ${orderNoBaru}`;
}

export type KodeBatalPesanan = KodeAlasanBatal | "TIDAK_DITEMUKAN" | "SUDAH_DIPUTUSKAN";

/**
 * Penolakan pembatalan. Pesanan salesman lain = TIDAK_DITEMUKAN, sama dengan
 * pesanan yang tidak ada — tidak membocorkan bahwa nomor itu ada.
 */
export class BatalPesananError extends Error {
  constructor(readonly kode: KodeBatalPesanan) {
    super(kode);
    this.name = "BatalPesananError";
  }
}

export const KODE_GANTI_DITOLAK = "PESANAN_LAMA_TIDAK_BISA_DIGANTI" as const;

/**
 * Pesanan lama tidak bisa diganti: bukan milik salesman ini, toko lain, tidak
 * ada, atau sudah diputuskan kantor (atau sudah dibatalkan/diganti). Satu kode
 * untuk semuanya — penyebab yang mana tidak mengubah apa yang harus dilakukan
 * salesman, dan tidak membocorkan pesanan orang lain.
 */
export class PesananLamaTidakBisaDigantiError extends Error {
  readonly code = KODE_GANTI_DITOLAK;
  constructor() {
    super(KODE_GANTI_DITOLAK);
    this.name = "PesananLamaTidakBisaDigantiError";
  }
}

/** Id pesanan dari alamat (`?ganti=`). Bentuk id cuid/uuid; selain itu diabaikan. */
export function bacaIdGanti(nilai: string | string[] | undefined): string | null {
  const v = Array.isArray(nilai) ? nilai[0] : nilai;
  if (typeof v !== "string") return null;
  const bersih = v.trim();
  return /^[A-Za-z0-9_-]{1,64}$/.test(bersih) ? bersih : null;
}

/** Alamat katalog untuk mengubah pesanan. Saluran dan jendela pre-order dibaca server dari pesanan lamanya. */
export function alamatUbahPesanan(storeId: string, orderId: string): string {
  return `/pwa/stores/${encodeURIComponent(storeId)}/catalog?ganti=${encodeURIComponent(orderId)}`;
}

/** Pesanan ini dibatalkan salesman (bukan ditolak kantor). */
export function dibatalkanSalesman(o: { status: string; cancelledById: string | null | undefined }): boolean {
  return o.status === "REJECTED" && typeof o.cancelledById === "string" && o.cancelledById !== "";
}

/**
 * Catatan pesanan lama tanpa baris yang ditulis SISTEM (kekurangan stok bonus,
 * lihat `catatanKurangBonus`). Penulis menulisnya ulang untuk pesanan baru;
 * membawanya dari pesanan lama akan menggandakannya, dan angkanya sudah basi.
 */
export function catatanUntukDiubah(catatan: string | null | undefined): string {
  if (!catatan) return "";
  return catatan
    .split("\n")
    .filter((baris) => !baris.startsWith("[Bonus] Kurang "))
    .join("\n")
    .trim();
}

export const kunciBaris = (itemId: string, variantSku: string | null | undefined) => `${itemId}::${variantSku ?? ""}`;

type BarangKatalog = {
  itemId: string;
  available: number;
  variants: Array<{ variantSku: string; available: number }>;
};

/**
 * Saat mengubah pesanan, stok yang dipegang pesanan lama akan dilepas oleh
 * penulis sebelum baris baru dicadangkan. Katalog harus menghitungnya sebagai
 * tersedia — kalau tidak, pesanan yang mengambil stok terakhir tidak bisa
 * diubah tanpa menyusut sendiri. `cadangan` per `itemId::variantSku`.
 */
export function tambahCadanganLama<T extends BarangKatalog>(items: readonly T[], cadangan: Readonly<Record<string, number>>): T[] {
  if (Object.keys(cadangan).length === 0) return [...items];
  return items.map((it) => {
    const lepasBarang = cadangan[kunciBaris(it.itemId, "")] ?? 0;
    let lepasVarian = 0;
    const variants = it.variants.map((v) => {
      const tambah = cadangan[kunciBaris(it.itemId, v.variantSku)] ?? 0;
      lepasVarian += tambah;
      return tambah > 0 ? { ...v, available: v.available + tambah } : v;
    });
    const tambahTotal = lepasBarang + lepasVarian;
    return tambahTotal > 0 ? { ...it, available: it.available + tambahTotal, variants } : it;
  });
}
