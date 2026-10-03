/**
 * Pre-order (inden) — aturan murni.
 *
 * Kantor membuka "jendela" pre-order (`PreorderWindow`): barang yang belum ada
 * di gudang (biasanya masih diproduksi) boleh dipesan toko PUTUS antara tanggal
 * buka dan tanggal tutup, dengan rentang kirim yang dijanjikan. Pesanannya
 * pesanan lapangan biasa yang bertanda `preorderWindowId`: harga, promo,
 * minimum, dan kredit berlaku sama persis. Bedanya satu: stoknya TIDAK
 * dicadangkan saat dibuat — barangnya memang belum ada. Begitu barang datang,
 * kantor "merilis" jendela itu: pesanan yang sudah disetujui dicadangkan saat
 * itu juga, yang disetujui sesudahnya dicadangkan saat disetujui, dan baru
 * sejak itu pesanannya boleh dikirim.
 *
 * Keadaan jendela tidak pernah disimpan — dihitung dari tanggal dan dua kolom
 * (`isActive`, `releasedAt`) setiap kali dibaca, jadi tidak ada cron yang bisa
 * lupa menutupnya.
 *
 * Murni dan aman untuk klien (hanya mengimpor helper tanggal dan rencana kirim).
 */
import { formatDateOnlyJakarta, formatDisplayDate, parseDateOnly, parseDateOnlyEnd } from "@/lib/date-only";
import { outstandingQty } from "./delivery/plan";

// ── Keadaan ───────────────────────────────────────────────────────────────

export const KEADAAN_INDEN = ["BELUM_BUKA", "BUKA", "TUTUP", "DIRILIS", "NONAKTIF"] as const;
export type KeadaanInden = (typeof KEADAAN_INDEN)[number];

export type BentukJendela = { opensAt: Date; closesAt: Date; isActive: boolean; releasedAt: Date | null };

/**
 * Urutan penting:
 * - DIRILIS paling dulu: rilis adalah fakta yang tidak bisa dibatalkan (stok
 *   sudah dicadangkan), jadi menonaktifkan jendela sesudahnya tidak mengubah
 *   ceritanya.
 * - NONAKTIF sebelum tanggal: kantor yang mematikan jendela berarti "berhenti
 *   menerima", apa pun kata tanggalnya.
 * - `closesAt` eksklusif. Isian tanggal tutup disimpan sebagai 23.59.59,999 WIB
 *   hari itu, jadi seluruh hari tutup masih menerima pesanan.
 */
export function keadaanJendela(j: BentukJendela, now: Date): KeadaanInden {
  if (j.releasedAt) return "DIRILIS";
  if (!j.isActive) return "NONAKTIF";
  if (now.getTime() < j.opensAt.getTime()) return "BELUM_BUKA";
  if (now.getTime() < j.closesAt.getTime()) return "BUKA";
  return "TUTUP";
}

/** Rilis dan ubah hanya sebelum dirilis: sesudahnya stok sudah dicadangkan atas dasar isi jendela itu. */
export function bolehRilis(k: KeadaanInden): boolean {
  return k !== "DIRILIS";
}
export function bolehDiubah(k: KeadaanInden): boolean {
  return k !== "DIRILIS";
}

// ── Pesanan ───────────────────────────────────────────────────────────────

/** Alasan pesanan pre-order ditolak. Keadaan jendela selain BUKA dipakai apa adanya. */
export type AlasanIndenDitolak = Exclude<KeadaanInden, "BUKA"> | "TIDAK_ADA" | "BARANG_LUAR" | "KONSI";

/**
 * null = boleh. Dipakai penulis pesanan (di dalam transaksi, dengan jam server)
 * dan halaman katalog (untuk memberi tahu salesman sebelum mengisi keranjang).
 *
 * Konsinyasi ditolak paling dulu: toko konsinyasi tidak punya pre-order sama
 * sekali (barang titipan, bukan pesanan yang ditunggu), jadi alasannya tidak
 * boleh tertutup alasan lain seperti "jendela sudah tutup".
 */
export function periksaPesananInden(input: {
  jendela: BentukJendela | null;
  termsType: "PUTUS" | "KONSI";
  barangJendela: ReadonlySet<string>;
  barangPesanan: readonly string[];
  now: Date;
}): AlasanIndenDitolak | null {
  if (input.termsType === "KONSI") return "KONSI";
  if (!input.jendela) return "TIDAK_ADA";
  const k = keadaanJendela(input.jendela, input.now);
  if (k !== "BUKA") return k;
  if (input.barangPesanan.length === 0) return "BARANG_LUAR";
  if (input.barangPesanan.some((id) => !input.barangJendela.has(id))) return "BARANG_LUAR";
  return null;
}

/** Id jendela dari alamat (`?inden=`). Bentuk id cuid; apa pun yang lain dianggap tidak ada. */
export function bacaIdInden(x: unknown): string | null {
  const v = Array.isArray(x) ? x[0] : x;
  if (typeof v !== "string") return null;
  return /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : null;
}

/**
 * Langkah stepper pre-order. Stok tidak membatasi (barangnya belum ada), tapi
 * jempol yang terpeleset tetap perlu batas: 9.999 pcs per baris.
 */
export const BATAS_QTY_INDEN = 9999;

// ── Penolakan (dilempar penulis) ──────────────────────────────────────────

export class IndenDitolakError extends Error {
  constructor(readonly alasan: AlasanIndenDitolak) {
    super(`INDEN_DITOLAK:${alasan}`);
    this.name = "IndenDitolakError";
  }
}

/** Pengiriman pesanan pre-order sebelum jendelanya dirilis: stoknya belum dicadangkan. */
export class IndenBelumRilisError extends Error {
  constructor(readonly orderId: string) {
    super("INDEN_BELUM_RILIS");
    this.name = "IndenBelumRilisError";
  }
}

export type BarisBelumTercatat = { itemId: string; variantSku: string; productName: string };

/**
 * Rilis ditolak: ada barang pesanan yang belum punya baris persediaan di gudang
 * (penerimaannya belum dicatat, atau dicatat tanpa varian). Tanpa baris itu
 * stoknya tidak bisa dicadangkan, dan pesanannya tidak akan pernah bisa dikirim.
 */
export class BarangIndenBelumTercatatError extends Error {
  constructor(readonly baris: BarisBelumTercatat[]) {
    super("BARANG_BELUM_TERCATAT");
    this.name = "BarangIndenBelumTercatatError";
  }
}

/**
 * Penolakan simpan jendela yang hanya bisa diketahui dari basis data:
 * jendela hilang, sudah dirilis, barang bukan barang jadi aktif, atau barang
 * yang mau dihapus dari jendela sudah dipesan toko.
 */
export type GalatSimpanJendela = "TIDAK_ADA" | "SUDAH_DIRILIS" | "BARANG_TIDAK_SAH" | "BARANG_SUDAH_DIPESAN";

// ── Validasi isian jendela ────────────────────────────────────────────────

export type GalatJendela =
  | "NAMA_KOSONG"
  | "NAMA_PANJANG"
  | "CATATAN_PANJANG"
  | "TANGGAL_BUKA"
  | "TANGGAL_TUTUP"
  | "TUTUP_SEBELUM_BUKA"
  | "TANGGAL_KIRIM"
  | "KIRIM_TERBALIK"
  | "BARANG_KOSONG"
  | "BARANG_GANDA"
  | "RENCANA_TIDAK_SAH";

export type JendelaSah = {
  name: string;
  note: string | null;
  opensAt: Date;
  closesAt: Date;
  shipFrom: Date | null;
  shipTo: Date | null;
  isActive: boolean;
  items: Array<{ itemId: string; plannedQty: number | null }>;
};

/** Isian formulir apa adanya — aksi server adalah titik akhir jaringan, jadi bentuknya tidak dipercaya. */
export type IsianJendela = {
  name?: unknown;
  note?: unknown;
  opensOn?: unknown;
  closesOn?: unknown;
  shipFrom?: unknown;
  shipTo?: unknown;
  isActive?: unknown;
  items?: unknown;
};

const PANJANG_NAMA = 120;
const PANJANG_CATATAN = 1000;

/**
 * `YYYY-MM-DD` → hari kalender itu, atau null. Pulang-pergi lewat
 * `formatDateOnlyJakarta` menolak tanggal yang digulirkan `new Date`
 * ("2026-02-30" → 2 Maret) dan tahun di luar jangkauan.
 */
function hariKalender(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = parseDateOnly(s);
  if (!d) return null;
  return formatDateOnlyJakarta(d) === s ? s : null;
}

const kosong = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");

export function validasiJendela(m: IsianJendela): { ok: true; data: JendelaSah } | { ok: false; galat: GalatJendela[] } {
  const galat: GalatJendela[] = [];

  const name = typeof m.name === "string" ? m.name.trim() : "";
  if (name === "") galat.push("NAMA_KOSONG");
  else if (name.length > PANJANG_NAMA) galat.push("NAMA_PANJANG");

  const noteRaw = typeof m.note === "string" ? m.note.trim() : "";
  if (noteRaw.length > PANJANG_CATATAN) galat.push("CATATAN_PANJANG");

  const buka = hariKalender(m.opensOn);
  const tutup = hariKalender(m.closesOn);
  if (!buka) galat.push("TANGGAL_BUKA");
  if (!tutup) galat.push("TANGGAL_TUTUP");
  // String YYYY-MM-DD terurut sama dengan urutan harinya.
  if (buka && tutup && tutup < buka) galat.push("TUTUP_SEBELUM_BUKA");

  const kirimDari = kosong(m.shipFrom) ? null : hariKalender(m.shipFrom);
  const kirimSampai = kosong(m.shipTo) ? null : hariKalender(m.shipTo);
  if ((!kosong(m.shipFrom) && !kirimDari) || (!kosong(m.shipTo) && !kirimSampai)) galat.push("TANGGAL_KIRIM");
  else if (kirimDari && kirimSampai && kirimSampai < kirimDari) galat.push("KIRIM_TERBALIK");

  const items: JendelaSah["items"] = [];
  if (!Array.isArray(m.items) || m.items.length === 0) {
    galat.push("BARANG_KOSONG");
  } else {
    const terlihat = new Set<string>();
    let ganda = false;
    let rencanaSalah = false;
    let idSalah = false;
    for (const raw of m.items as unknown[]) {
      const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
      const itemId = typeof o.itemId === "string" ? o.itemId.trim() : "";
      if (itemId === "" || itemId.length > 64) {
        idSalah = true;
        continue;
      }
      if (terlihat.has(itemId)) ganda = true;
      terlihat.add(itemId);
      const p = o.plannedQty;
      if (p === null || p === undefined) {
        items.push({ itemId, plannedQty: null });
      } else if (typeof p === "number" && Number.isInteger(p) && p >= 0) {
        items.push({ itemId, plannedQty: p });
      } else {
        rencanaSalah = true;
      }
    }
    if (idSalah) galat.push("BARANG_KOSONG");
    if (ganda) galat.push("BARANG_GANDA");
    if (rencanaSalah) galat.push("RENCANA_TIDAK_SAH");
  }

  if (galat.length > 0) return { ok: false, galat };
  return {
    ok: true,
    data: {
      name,
      note: noteRaw === "" ? null : noteRaw,
      opensAt: parseDateOnly(buka!)!,
      // Inklusif: seluruh hari tutup (WIB) masih menerima pesanan.
      closesAt: parseDateOnlyEnd(tutup!)!,
      shipFrom: kirimDari ? parseDateOnly(kirimDari)! : null,
      shipTo: kirimSampai ? parseDateOnly(kirimSampai)! : null,
      isActive: typeof m.isActive === "boolean" ? m.isActive : true,
      items,
    },
  };
}

/** Instan tersimpan → nilai `<input type="date">` (hari WIB-nya). */
export function isianTanggal(d: Date | null | undefined): string {
  return d ? formatDateOnlyJakarta(d) : "";
}

// ── Tampilan tanggal ──────────────────────────────────────────────────────

const lokal = (locale: string) => (locale.toLowerCase().startsWith("en") ? "en-GB" : "id-ID");

/**
 * Rentang tanggal ringkas, dibaca di WIB: "10–20 Nov 2026", "28 Nov – 5 Des 2026",
 * "28 Des 2026 – 5 Jan 2027". Dipakai untuk rentang kirim ("kirim 10–20 Nov").
 */
export function rentangTanggal(dari: Date, sampai: Date, locale: string = "id-ID"): string {
  const a = formatDateOnlyJakarta(dari);
  const b = formatDateOnlyJakarta(sampai);
  if (a === b) return formatDisplayDate(dari, locale);
  const fmt = (opsi: Intl.DateTimeFormatOptions, d: Date) =>
    new Intl.DateTimeFormat(lokal(locale), { timeZone: "Asia/Jakarta", ...opsi }).format(d);
  if (a.slice(0, 7) === b.slice(0, 7)) return `${fmt({ day: "numeric" }, dari)}–${formatDisplayDate(sampai, locale)}`;
  if (a.slice(0, 4) === b.slice(0, 4)) return `${fmt({ day: "numeric", month: "short" }, dari)} – ${formatDisplayDate(sampai, locale)}`;
  return `${formatDisplayDate(dari, locale)} – ${formatDisplayDate(sampai, locale)}`;
}

/**
 * Rentang kirim untuk ditampilkan, atau null kalau kantor belum mengisinya.
 * `jenis` memilih kalimatnya di layar ("kirim {rentang}", "kirim mulai …",
 * "kirim paling lambat …") — kata-katanya urusan i18n, bukan modul ini.
 */
export function rentangKirim(
  shipFrom: Date | null,
  shipTo: Date | null,
  locale: string = "id-ID",
): { jenis: "RENTANG" | "MULAI" | "SAMPAI"; teks: string } | null {
  if (shipFrom && shipTo) return { jenis: "RENTANG", teks: rentangTanggal(shipFrom, shipTo, locale) };
  if (shipFrom) return { jenis: "MULAI", teks: formatDisplayDate(shipFrom, locale) };
  if (shipTo) return { jenis: "SAMPAI", teks: formatDisplayDate(shipTo, locale) };
  return null;
}

// ── Ringkasan pesanan per jendela ─────────────────────────────────────────

export type BarisPesananInden = {
  status: "PENDING_APPROVAL" | "APPROVED" | "REJECTED";
  itemId: string;
  variantSku: string;
  qty: number;
  cancelledQty: number;
};

export type RingkasVarian = { variantSku: string; menunggu: number; disetujui: number; dipesan: number };
export type RingkasBarang = {
  itemId: string;
  rencana: number | null;
  menunggu: number;
  disetujui: number;
  dipesan: number;
  /** rencana − dipesan; negatif = pesanan melebihi rencana produksi. null bila tanpa rencana. */
  sisa: number | null;
  perVarian: RingkasVarian[];
};

/**
 * Dipesan vs rencana per barang (dan per varian) untuk satu jendela.
 *
 * - Pesanan DITOLAK tidak dihitung; pcs yang dibatalkan (sisa pesanan ditutup)
 *   juga tidak — keduanya tidak akan dikirim, jadi tidak perlu diproduksi.
 * - Hanya baris barang jendela yang dihitung. Baris bonus untuk barang lain
 *   (promo "beli X gratis Y" dengan Y barang siap) bukan urusan rencana produksi.
 * - Urutan mengikuti urutan barang jendela; varian diurutkan menurut SKU-nya.
 */
export function ringkasPesananJendela(
  barang: ReadonlyArray<{ itemId: string; plannedQty: number | null }>,
  baris: ReadonlyArray<BarisPesananInden>,
): { perBarang: RingkasBarang[]; total: { rencana: number | null; dipesan: number } } {
  const perItem = new Map<string, Map<string, RingkasVarian>>();
  for (const b of barang) perItem.set(b.itemId, new Map());
  for (const l of baris) {
    if (l.status === "REJECTED") continue;
    const varian = perItem.get(l.itemId);
    if (!varian) continue;
    const jumlah = Math.max(0, l.qty - l.cancelledQty);
    if (jumlah === 0) continue;
    const v = varian.get(l.variantSku) ?? { variantSku: l.variantSku, menunggu: 0, disetujui: 0, dipesan: 0 };
    if (l.status === "APPROVED") v.disetujui += jumlah;
    else v.menunggu += jumlah;
    v.dipesan += jumlah;
    varian.set(l.variantSku, v);
  }

  let rencanaTotal: number | null = null;
  let dipesanTotal = 0;
  const perBarang = barang.map((b) => {
    const perVarian = Array.from(perItem.get(b.itemId)!.values()).sort((x, y) => x.variantSku.localeCompare(y.variantSku));
    const menunggu = perVarian.reduce((s, v) => s + v.menunggu, 0);
    const disetujui = perVarian.reduce((s, v) => s + v.disetujui, 0);
    const dipesan = menunggu + disetujui;
    if (b.plannedQty !== null) rencanaTotal = (rencanaTotal ?? 0) + b.plannedQty;
    dipesanTotal += dipesan;
    return {
      itemId: b.itemId,
      rencana: b.plannedQty,
      menunggu,
      disetujui,
      dipesan,
      sisa: b.plannedQty === null ? null : b.plannedQty - dipesan,
      perVarian,
    };
  });
  return { perBarang, total: { rencana: rencanaTotal, dipesan: dipesanTotal } };
}

/**
 * Baris pesanan yang harus dicadangkan saat rilis (atau saat disetujui sesudah
 * rilis): hanya yang masih terbuka, sebesar sisanya. Pesanan yang sisanya
 * sudah ditutup kantor tidak menyisakan apa pun.
 */
export function barisPerluDicadangkan(
  lines: ReadonlyArray<{ id: string; itemId: string; variantSku: string; qty: number; deliveredQty: number; cancelledQty: number }>,
): Array<{ fieldSalesLineId: string; itemId: string; variantSku: string; qty: number }> {
  return lines
    .map((l) => ({ fieldSalesLineId: l.id, itemId: l.itemId, variantSku: l.variantSku, qty: outstandingQty(l) }))
    .filter((l) => l.qty > 0);
}
