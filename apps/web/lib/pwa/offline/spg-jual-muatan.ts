// Bentuk nota SPG di antrean HP dan muatan kirimnya — murni, tanpa Dexie dan
// tanpa aksi server (impor TIPE saja), supaya bisa dites di Node dan dipakai
// layar jual maupun penyinkron.
import type { PembeliTertahan, PendingSpgSale } from "./db";

export type BarisNotaTertahan = PendingSpgSale["lines"][number];
export type DiskonTertahan = NonNullable<PendingSpgSale["diskonManual"]>;

/** Baris antrean sebelum diberi keadaan (`capturedAt`, `syncState`, `attempts`). */
export type NotaSpgBaru = Omit<PendingSpgSale, "capturedAt" | "syncState" | "attempts" | "error">;

/** Muatan `recordSpgSaleAction` — bentuk yang sama untuk konter dan antrean. */
export type MuatanJualSpg = {
  idempotencyKey: string;
  lines: { itemId: string; variantSku: string | null; qty: number }[];
  pembeli: { id: string } | { nama: string; hp: string; setuju: boolean } | null;
  diskonManual: { jenis: "PERSEN" | "RUPIAH"; nilai: number; alasan: string | null } | null;
  saleLat: number | null;
  saleLng: number | null;
  luring?: true;
  waktuJual?: string;
  visitId?: string | null;
  /** Check-in yang juga dicatat tanpa sinyal (id buatan HP) — pengganti `visitId`. */
  visitClientId?: string | null;
};

/** Nama untuk ditampilkan tidak ikut terkirim: pelanggan lama cukup id-nya. */
export function muatanPembeli(p: PembeliTertahan | null): MuatanJualSpg["pembeli"] {
  if (!p) return null;
  if ("id" in p) return { id: p.id };
  return { nama: p.nama.trim(), hp: p.hp.trim(), setuju: p.setuju };
}

/** Diskon bernilai nol (atau isian rusak) berarti tanpa diskon — bukan diskon nol yang ikut diperiksa. */
export function muatanDiskon(d: DiskonTertahan | null): MuatanJualSpg["diskonManual"] {
  if (!d || !Number.isFinite(d.nilai) || d.nilai <= 0) return null;
  const alasan = d.alasan?.trim() || null;
  return { jenis: d.jenis, nilai: d.nilai, alasan };
}

/**
 * Susun satu nota untuk antrean dari keranjang di layar. Baris berjumlah nol
 * (atau bukan bilangan bulat positif) dibuang; keranjang yang tidak menyisakan
 * apa pun tidak diantrekan sama sekali (`null`).
 */
export function susunNotaTertahan(isi: {
  idempotencyKey: string;
  storeId: string;
  storeName: string;
  visitId: string | null;
  /** Kunjungan dari check-in tanpa sinyal (`kunjunganAktifLokal`); kosong = `visitId` yang berlaku. */
  visitClientId?: string | null;
  waktuJual: Date;
  baris: readonly BarisNotaTertahan[];
  pembeli: PembeliTertahan | null;
  diskonManual: DiskonTertahan | null;
  totalPratinjau: number;
  potonganPratinjau: number;
  posisi?: { lat: number; lng: number } | null;
}): NotaSpgBaru | null {
  const lines = isi.baris
    .filter((b) => Number.isInteger(b.qty) && b.qty > 0)
    .map((b) => ({ itemId: b.itemId, variantSku: b.variantSku ?? null, qty: b.qty, productName: b.productName, unitPrice: b.unitPrice }));
  if (lines.length === 0 || !isi.idempotencyKey) return null;
  const waktu = isi.waktuJual.getTime();
  if (!Number.isFinite(waktu)) return null;
  const diskon = muatanDiskon(isi.diskonManual);
  return {
    localId: isi.idempotencyKey,
    storeId: isi.storeId,
    storeName: isi.storeName,
    visitId: isi.visitId,
    ...(isi.visitClientId ? { visitClientId: isi.visitClientId } : {}),
    waktuJual: isi.waktuJual.toISOString(),
    lines,
    pembeli: isi.pembeli,
    diskonManual: diskon,
    totalPratinjau: isi.totalPratinjau,
    potonganPratinjau: isi.potonganPratinjau,
    saleLat: isi.posisi?.lat ?? null,
    saleLng: isi.posisi?.lng ?? null,
  };
}

/**
 * Muatan kiriman dari antrean: `luring` + waktu jual + kunjungan saat dijual,
 * dengan kunci idempotensi = `localId` — kunci yang SAMA dengan percobaan di
 * konter, jadi nota yang ternyata sudah sampai tidak tercatat dua kali.
 */
export function muatanKirimNotaSpg(n: NotaSpgBaru): MuatanJualSpg {
  return {
    idempotencyKey: n.localId,
    luring: true,
    waktuJual: n.waktuJual,
    visitId: n.visitId ?? null,
    // Kunjungan dari check-in tanpa sinyal: server mencarinya lewat id buatan HP.
    ...(n.visitClientId ? { visitClientId: n.visitClientId } : {}),
    lines: n.lines.map((l) => ({ itemId: l.itemId, variantSku: l.variantSku, qty: l.qty })),
    pembeli: muatanPembeli(n.pembeli),
    diskonManual: muatanDiskon(n.diskonManual),
    saleLat: n.saleLat ?? null,
    saleLng: n.saleLng ?? null,
  };
}

/** Perubahan baris antrean untuk mengirim ulang tanpa diskon SPG atau tanpa data pembeli. */
export function ubahanTanpaBagian(bagian: "diskon" | "pembeli"): Partial<PendingSpgSale> {
  return bagian === "diskon"
    ? { diskonManual: null, syncState: "pending", error: undefined }
    : { pembeli: null, syncState: "pending", error: undefined };
}

export function jumlahPotongTertahan(n: Pick<PendingSpgSale, "lines">): number {
  return n.lines.reduce((s, l) => s + l.qty, 0);
}

/** Nama pembeli untuk ditampilkan, apa pun bentuknya. */
export function namaPembeliTertahan(p: PembeliTertahan | null): string | null {
  return p ? p.nama.trim() || null : null;
}
