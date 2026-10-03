/**
 * Promo konter — aturan murni untuk layar KANTOR (daftar, formulir, pemakaian).
 * Tanpa Prisma, supaya formulir di peramban memakai hitungan yang sama dengan
 * server. Mesinnya sendiri ada di `promo-konter.ts` (fondasi, jangan diubah).
 */
import { parseDateOnly, parseDateOnlyEnd, formatDateOnlyJakarta } from "@/lib/date-only";
import {
  bagiSisaTerbesar,
  hitungPromoKonter,
  JENIS_PROMO_KONTER,
  periksaPromoKonter,
  promoNota,
  type JenisPromoKonter,
  type MasalahPromoKonter,
  type PromoKonter,
} from "./promo-konter";
import { bacaDiskonManual, type AturanDiskonManualSpg } from "./pengaturan";

/** Nama tindakan jejak (`AuditLog.action`) promo konter dan pengaturan diskon manual. */
export const JEJAK_PROMO_KONTER = {
  DIBUAT: "COUNTER_PROMO_CREATED",
  DIUBAH: "COUNTER_PROMO_UPDATED",
  DINYALAKAN: "COUNTER_PROMO_ACTIVATED",
  DIMATIKAN: "COUNTER_PROMO_DEACTIVATED",
  DIHAPUS: "COUNTER_PROMO_DELETED",
  DISKON_MANUAL_DIATUR: "SPG_MANUAL_DISCOUNT_SETTINGS_UPDATED",
} as const;

export const ENTITAS_PROMO_KONTER = "CounterPromo";

// ---------------------------------------------------------------------------
// Status — DITURUNKAN dari tanggal, tidak pernah disimpan
// ---------------------------------------------------------------------------

export const STATUS_PROMO_KONTER = ["BERLAKU", "TERJADWAL", "BERAKHIR", "NONAKTIF"] as const;
export type StatusPromoKonter = (typeof STATUS_PROMO_KONTER)[number];

/**
 * Nonaktif menang atas tanggal: promo yang dimatikan tidak berlaku walau
 * tanggalnya masih jalan. Selebihnya sama dengan `promoBerlaku` di mesin —
 * mulai sesudah `sekarang` = terjadwal, berakhir sebelum `sekarang` = berakhir.
 */
export function statusPromoKonter(
  p: { isActive: boolean; startsAt: Date | string | null; endsAt: Date | string | null },
  sekarang: Date,
): StatusPromoKonter {
  if (!p.isActive) return "NONAKTIF";
  const t = sekarang.getTime();
  if (p.startsAt && new Date(p.startsAt).getTime() > t) return "TERJADWAL";
  if (p.endsAt && new Date(p.endsAt).getTime() < t) return "BERAKHIR";
  return "BERLAKU";
}

export function bacaStatusPromoKonter(raw: string | string[] | undefined): StatusPromoKonter | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v && (STATUS_PROMO_KONTER as readonly string[]).includes(v) ? (v as StatusPromoKonter) : null;
}

// ---------------------------------------------------------------------------
// Rentang tanggal — hari kalender WIB
// ---------------------------------------------------------------------------

const POLA_HARI = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** "2026-10-03" yang sungguh ada di kalender (bukan 31 Februari). */
export function hariSah(teks: string): boolean {
  if (!POLA_HARI.test(teks)) return false;
  const d = parseDateOnly(teks);
  return d !== undefined && formatDateOnlyJakarta(d) === teks;
}

/**
 * Hari mulai/akhir dari formulir → instan yang disimpan: mulai = 00:00 WIB hari
 * mulai, akhir = 23:59:59.999 WIB hari akhir. Kosong = tanpa batas. Teks yang
 * bukan hari kalender ditolak (null), tidak pernah ditebak.
 */
export function keRentangWib(
  dari: string | null | undefined,
  sampai: string | null | undefined,
): { startsAt: Date | null; endsAt: Date | null } | null {
  const a = (dari ?? "").trim();
  const b = (sampai ?? "").trim();
  if (a && !hariSah(a)) return null;
  if (b && !hariSah(b)) return null;
  return { startsAt: a ? parseDateOnly(a)! : null, endsAt: b ? parseDateOnlyEnd(b)! : null };
}

/** Kebalikan `keRentangWib` untuk formulir ubah: instan tersimpan → hari WIB. */
export function keHariWib(startsAt: Date | null, endsAt: Date | null): { dari: string; sampai: string } {
  return {
    dari: startsAt ? formatDateOnlyJakarta(startsAt) : "",
    sampai: endsAt ? formatDateOnlyJakarta(endsAt) : "",
  };
}

// ---------------------------------------------------------------------------
// Contoh di formulir: "Kemeja Rp 199.000 → Rp 159.200"
// ---------------------------------------------------------------------------

export const HARGA_CONTOH = 199_000;

export type ContohPromo =
  | { jenis: "SATUAN"; harga: number; sesudah: number }
  | { jenis: "PAKET"; qty: number; harga: number; kotor: number; bayar: number; gratis: number }
  | { jenis: "NOTA"; belanja: number; sesudah: number };

/**
 * Contoh hitungan untuk formulir, memakai MESIN YANG SAMA dengan nota
 * (`hitungPromoKonter`) — jadi contohnya tidak pernah menjanjikan potongan
 * yang tidak akan diberikan konter. Null bila isian belum cukup untuk dihitung.
 */
export function contohPromo(p: {
  type: JenisPromoKonter;
  value: number | null;
  buyQty: number | null;
  freeQty: number | null;
  minSubtotal: number | null;
}): ContohPromo | null {
  const promo: PromoKonter = {
    id: "contoh",
    name: "contoh",
    type: p.type,
    value: p.value,
    buyQty: p.buyQty,
    freeQty: p.freeQty,
    minSubtotal: p.minSubtotal,
    allItems: true,
    itemIds: [],
    categoryIds: [],
    allStores: true,
    storeIds: [],
    startsAt: null,
    endsAt: null,
    priority: 0,
    isActive: true,
  };
  const hitung = (qty: number, unitPrice: number) => {
    const h = hitungPromoKonter({
      baris: [{ key: "k", itemId: "contoh", categoryId: null, qty, unitPrice }],
      promos: [promo],
      storeId: "contoh",
      waktu: new Date(0),
    });
    return h.ok ? h : null;
  };

  if (p.type === "BELI_GRATIS") {
    const beli = p.buyQty ?? 0;
    const gratis = p.freeQty ?? 0;
    if (!Number.isInteger(beli) || !Number.isInteger(gratis) || beli < 1 || gratis < 1 || beli + gratis > 50) return null;
    const h = hitung(beli + gratis, HARGA_CONTOH);
    if (!h) return null;
    return { jenis: "PAKET", qty: beli + gratis, harga: HARGA_CONTOH, kotor: h.subtotal, bayar: h.total, gratis: h.baris[0]?.gratis ?? 0 };
  }
  if (p.value === null || !Number.isFinite(p.value) || p.value <= 0) return null;
  if (promoNota(p.type)) {
    const min = p.minSubtotal ?? 0;
    if (!Number.isFinite(min) || min < 0) return null;
    const belanja = Math.max(min, HARGA_CONTOH);
    const h = hitung(1, belanja);
    return h ? { jenis: "NOTA", belanja, sesudah: h.total } : null;
  }
  const h = hitung(1, HARGA_CONTOH);
  return h ? { jenis: "SATUAN", harga: HARGA_CONTOH, sesudah: h.total } : null;
}

// ---------------------------------------------------------------------------
// Pemakaian per promo — bagian promo BARANG dari potongan baris
// ---------------------------------------------------------------------------

export type NotaPemakaian = {
  id: string;
  total: number;
  discountTotal: number;
  orderDiscount: number;
  manualDiscount: number;
  orderPromoId: string | null;
  baris: { counterPromoId: string | null; qty: number; unitPrice: number; lineTotal: number; discount: number }[];
};

export type PemakaianPromo = { nota: number; potongan: number };

const keSen = (rupiah: number) => Math.round(rupiah * 100);

/**
 * Jumlah nota dan total potongan per promo.
 *
 * Promo belanja: `orderDiscount` nota itu, persis. Promo barang: nota hanya
 * menyimpan potongan baris SELURUHNYA (promo barang + bagian promo belanja +
 * bagian diskon manual), jadi bagian promo barang dihitung kembali:
 *   - jumlahnya per nota PERSIS: `discountTotal − orderDiscount − manualDiscount`;
 *   - pembagiannya ke baris memakai perkiraan nilai bersih sebelum potongan
 *     nota (`lineTotal × (total + potonganNota) / total`), tepat bila potongan
 *     nota terbagi rata menurut nilai bersih (selalu begitu untuk diskon
 *     manual, dan untuk promo belanja yang berlaku ke semua barang).
 * Baris yang kena dua promo barang dicatat atas promo yang potongannya terbesar
 * (`counterPromoId`) — sama dengan yang tertulis di nota.
 */
export function hitungPemakaianPromo(nota: readonly NotaPemakaian[]): Map<string, PemakaianPromo> {
  const hasil = new Map<string, { nota: Set<string>; sen: number }>();
  const tambah = (promoId: string, notaId: string, sen: number) => {
    const ada = hasil.get(promoId) ?? { nota: new Set<string>(), sen: 0 };
    ada.nota.add(notaId);
    ada.sen += sen;
    hasil.set(promoId, ada);
  };

  for (const n of nota) {
    if (n.orderPromoId) tambah(n.orderPromoId, n.id, keSen(n.orderDiscount));

    const barisPromo = n.baris.filter((b) => b.counterPromoId);
    if (barisPromo.length === 0) continue;
    const potonganNotaSen = keSen(n.orderDiscount) + keSen(n.manualDiscount);
    const promoBarangSen = Math.max(0, keSen(n.discountTotal) - potonganNotaSen);
    const totalSen = keSen(n.total);
    let bobot = barisPromo.map((b) => {
      const kotor = keSen(b.unitPrice) * b.qty;
      if (totalSen <= 0) return keSen(b.discount);
      const bersihSebelumNota = (keSen(b.lineTotal) * (totalSen + potonganNotaSen)) / totalSen;
      return kotor - bersihSebelumNota;
    });
    if (bobot.every((x) => x <= 0)) bobot = barisPromo.map((b) => keSen(b.discount));
    if (bobot.every((x) => x <= 0)) bobot = barisPromo.map(() => 1);
    const bagian = bagiSisaTerbesar(promoBarangSen, bobot);
    barisPromo.forEach((b, i) => tambah(b.counterPromoId!, n.id, bagian[i]));
  }

  return new Map([...hasil].map(([id, v]) => [id, { nota: v.nota.size, potongan: v.sen / 100 }]));
}

// ---------------------------------------------------------------------------
// Isian formulir kantor
// ---------------------------------------------------------------------------

/** Isian formulir promo konter. Tanggal = hari kalender WIB ("" = tanpa batas). */
export type IsianPromoKonter = {
  name: string;
  type: string;
  value: number | null;
  buyQty: number | null;
  freeQty: number | null;
  minSubtotal: number | null;
  allItems: boolean;
  itemIds: string[];
  categoryIds: string[];
  allStores: boolean;
  storeIds: string[];
  dari: string;
  sampai: string;
  priority: number;
  note: string;
  /**
   * Bagian TOKO dari potongan promo ini di toko konsinyasi, 0–100 (2 desimal).
   * 0 = ditanggung penuh Elorae. Di toko putus barangnya milik toko, jadi
   * angka ini tidak berarti apa-apa di sana.
   */
  storeSharePercent: number;
};

export type MasalahIsianPromoKonter =
  | MasalahPromoKonter
  | "NAMA_TERLALU_PANJANG"
  | "CATATAN_TERLALU_PANJANG"
  | "TANGGAL_TIDAK_VALID"
  | "PRIORITAS_TIDAK_VALID"
  | "BAGIAN_TOKO_TIDAK_VALID"
  | "BARANG_TIDAK_DIKENAL"
  | "KATEGORI_TIDAK_DIKENAL"
  | "TOKO_TIDAK_DIKENAL";

export const PANJANG_NAMA_MAKS = 120;
export const PANJANG_CATATAN_MAKS = 1000;
export const PRIORITAS_MAKS = 1000;
/** Persen 0–100 dengan paling banyak dua desimal (`Decimal(5,2)`). */
export function persenSah(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100 && Math.abs(Math.round(v * 100) - v * 100) < 1e-6;
}

/** Batas `Decimal(15,2)` dengan ruang aman. */
const NILAI_MAKS = 1_000_000_000_000;

const unik = (xs: readonly string[]) => [...new Set(xs.filter((x) => typeof x === "string" && x.length > 0))];
const angkaAtauNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * Rapikan isian sebelum diperiksa dan disimpan: kolom yang tidak dipakai jenis
 * promo itu dikosongkan (jadi isian lama yang tertinggal di formulir tidak
 * pernah ikut tersimpan), dan sasaran "semua" membuang daftar pilihannya.
 */
export function rapikanIsianPromoKonter(i: IsianPromoKonter): IsianPromoKonter {
  const type = String(i.type ?? "");
  const paket = type === "BELI_GRATIS";
  const nota = (JENIS_PROMO_KONTER as readonly string[]).includes(type) && promoNota(type as JenisPromoKonter);
  const allItems = i.allItems === true;
  const allStores = i.allStores === true;
  return {
    name: String(i.name ?? "").trim(),
    type,
    value: paket ? null : angkaAtauNull(i.value),
    buyQty: paket ? angkaAtauNull(i.buyQty) : null,
    freeQty: paket ? angkaAtauNull(i.freeQty) : null,
    minSubtotal: nota ? angkaAtauNull(i.minSubtotal) : null,
    allItems,
    itemIds: allItems || !Array.isArray(i.itemIds) ? [] : unik(i.itemIds),
    categoryIds: allItems || !Array.isArray(i.categoryIds) ? [] : unik(i.categoryIds),
    allStores,
    storeIds: allStores || !Array.isArray(i.storeIds) ? [] : unik(i.storeIds),
    dari: String(i.dari ?? "").trim(),
    sampai: String(i.sampai ?? "").trim(),
    priority: typeof i.priority === "number" ? i.priority : Number.NaN,
    note: String(i.note ?? "").trim(),
    storeSharePercent: typeof i.storeSharePercent === "number" ? i.storeSharePercent : Number.NaN,
  };
}

/**
 * Periksa isian yang sudah dirapikan (tanpa basis data). Kosong = sah. Aturan
 * promo itu sendiri dari `periksaPromoKonter` di mesin; di sini ditambah yang
 * khas formulir kantor: tanggal, prioritas, panjang teks, batas angka.
 */
export function periksaIsianPromoKonter(i: IsianPromoKonter): MasalahIsianPromoKonter[] {
  const rentang = keRentangWib(i.dari, i.sampai);
  const masalah: MasalahIsianPromoKonter[] = periksaPromoKonter({
    ...i,
    startsAt: rentang?.startsAt ?? null,
    endsAt: rentang?.endsAt ?? null,
  });
  if (i.name.length > PANJANG_NAMA_MAKS) masalah.push("NAMA_TERLALU_PANJANG");
  if (i.note.length > PANJANG_CATATAN_MAKS) masalah.push("CATATAN_TERLALU_PANJANG");
  if (!rentang) masalah.push("TANGGAL_TIDAK_VALID");
  if (!Number.isInteger(i.priority) || Math.abs(i.priority) > PRIORITAS_MAKS) masalah.push("PRIORITAS_TIDAK_VALID");
  if (!persenSah(i.storeSharePercent)) masalah.push("BAGIAN_TOKO_TIDAK_VALID");
  if (i.value !== null && i.value > NILAI_MAKS && !masalah.includes("NILAI_TIDAK_VALID")) masalah.push("NILAI_TIDAK_VALID");
  if (i.minSubtotal !== null && i.minSubtotal > NILAI_MAKS && !masalah.includes("MIN_BELANJA_TIDAK_VALID")) {
    masalah.push("MIN_BELANJA_TIDAK_VALID");
  }
  return masalah;
}

// ---------------------------------------------------------------------------
// Pengaturan diskon manual (Pengaturan → SPG)
// ---------------------------------------------------------------------------

/**
 * Sahkan isian kartu "Diskon manual": nilai yang disimpan harus terbaca
 * kembali PERSIS sama oleh `bacaDiskonManual` (pembaca di penulis nota), supaya
 * kartu tidak pernah menampilkan aturan yang berbeda dari yang dipakai konter.
 * Batas persen bilangan bulat 0–100; bagian toko konsinyasi 0–100 (dua
 * desimal), 0 = ditanggung penuh Elorae.
 */
export function sahkanDiskonManual(isi: unknown): AturanDiskonManualSpg | null {
  if (!isi || typeof isi !== "object") return null;
  const o = isi as Record<string, unknown>;
  if (typeof o.aktif !== "boolean" || typeof o.alasanWajib !== "boolean") return null;
  if (typeof o.maksPersen !== "number" || !Number.isInteger(o.maksPersen) || o.maksPersen < 0 || o.maksPersen > 100) return null;
  if (!persenSah(o.bagianTokoPersen)) return null;
  const aturan: AturanDiskonManualSpg = {
    aktif: o.aktif,
    maksPersen: o.maksPersen,
    alasanWajib: o.alasanWajib,
    bagianTokoPersen: o.bagianTokoPersen,
  };
  const baca = bacaDiskonManual(JSON.stringify(aturan));
  return JSON.stringify(baca) === JSON.stringify(aturan) ? aturan : null;
}
