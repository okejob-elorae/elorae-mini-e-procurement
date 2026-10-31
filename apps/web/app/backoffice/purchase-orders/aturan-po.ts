/*
 * Aturan tombol PO di layar (rincian dan daftar). Murni, tanpa Prisma.
 * Penjaga sebenarnya tetap di server: `batalkanPurchaseOrder` dan `createGRN`.
 */

/** PO yang boleh menerima barang (GRN): sudah dikirim ke pemasok dan belum lengkap. */
export const STATUS_TERIMA_BARANG = ["SUBMITTED", "PARTIAL"] as const;

/** PO tanpa tagihan: draf (belum dikirim) dan dibatalkan. */
export const STATUS_TANPA_TAGIHAN = ["DRAFT", "CANCELLED"] as const;

/** Status yang masih bisa dibatalkan selama belum ada barang diterima. */
const STATUS_BISA_BATAL = ["DRAFT", "SUBMITTED", "PARTIAL", "OVER"];

export function bolehTerimaBarang(status: string): boolean {
  return (STATUS_TERIMA_BARANG as readonly string[]).includes(status);
}

export function tampilStatusBayar(status: string): boolean {
  return !(STATUS_TANPA_TAGIHAN as readonly string[]).includes(status);
}

type Angka = number | string | { toString(): string } | null | undefined;

function angka(v: Angka): number {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : Number(v.toString());
  return Number.isFinite(n) ? n : 0;
}

/**
 * - `boleh`: tombol Batalkan PO aktif.
 * - `mati`: sudah ada penerimaan (GRN tertaut atau qty diterima) — tampil mati
 *   dengan alasan "gunakan Tutup PO"; server menolak dengan SUDAH_ADA_PENERIMAAN.
 * - `sembunyi`: PO sudah ditutup atau dibatalkan.
 */
export function keadaanBatalPo(po: {
  status: string;
  items: ReadonlyArray<{ receivedQty: Angka }>;
  grns?: ReadonlyArray<unknown>;
  jumlahGrn?: number;
}): "boleh" | "mati" | "sembunyi" {
  if (!STATUS_BISA_BATAL.includes(po.status)) return "sembunyi";
  const adaGrn = (po.grns?.length ?? 0) > 0 || (po.jumlahGrn ?? 0) > 0;
  const adaDiterima = po.items.some((l) => angka(l.receivedQty) > 0);
  return adaGrn || adaDiterima ? "mati" : "boleh";
}
