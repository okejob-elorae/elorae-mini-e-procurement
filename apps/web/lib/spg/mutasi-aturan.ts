/**
 * Mutasi antar toko (`StoreTransfer`) — aturan murni, satu tempat.
 *
 * Dipakai penulis (server), layar HP SPG (memilih tujuan yang boleh), layar
 * kantor, dan kartu pengaturan. Modul ini sengaja tanpa basis data dan tanpa
 * `@elorae/db`, supaya aman diimpor komponen klien.
 *
 * Kebijakan pemilik di `SystemSetting["spg.mutasi"]` (JSON), dengan bawaan di
 * kode:
 * - `aktif` — boleh tidaknya mutasi sama sekali.
 * - `aturan` — per arah jenis toko (asal_tujuan): `TOLAK`, `SETUJU` (kantor
 *   menyetujui dulu), atau `LANGSUNG` (tanpa persetujuan). Barang toko PUTUS
 *   milik toko itu, jadi arah yang melibatkan PUTUS tidak pernah `LANGSUNG` —
 *   nilai itu dibaca sebagai `SETUJU`.
 * - `saldo` — `PERINGATAN` (bawaan: kirim tetap jalan, SPG diberi tahu) atau
 *   `TOLAK` bila jumlah melebihi saldo buku toko asal. Buku toko boleh salah
 *   (opname belum dilakukan), itu sebabnya bawaannya hanya memperingatkan.
 * - `tujuanTanpaSpg` — boleh mengirim ke toko tanpa SPG; kantor yang menerima.
 * - `hariPengingat` — kiriman yang belum diterima sesudah sekian hari dianggap
 *   macet: kantor diberi tahu dan boleh menerimanya atas nama toko.
 */

export type JenisToko = "PUTUS" | "KONSI";

export const KEPUTUSAN_ARAH = ["TOLAK", "SETUJU", "LANGSUNG"] as const;
export type KeputusanArah = (typeof KEPUTUSAN_ARAH)[number];

export const ARAH_MUTASI = ["KONSI_KONSI", "KONSI_PUTUS", "PUTUS_KONSI", "PUTUS_PUTUS"] as const;
export type ArahMutasi = (typeof ARAH_MUTASI)[number];

export const MODE_SALDO_MUTASI = ["PERINGATAN", "TOLAK"] as const;
export type ModeSaldoMutasi = (typeof MODE_SALDO_MUTASI)[number];

export type AturanMutasi = {
  aktif: boolean;
  aturan: Record<ArahMutasi, KeputusanArah>;
  saldo: ModeSaldoMutasi;
  tujuanTanpaSpg: boolean;
  hariPengingat: number;
};

export const KUNCI_ATURAN_MUTASI = "spg.mutasi";
export const HARI_PENGINGAT_MAKS = 60;

export const ATURAN_MUTASI_BAWAAN: AturanMutasi = {
  aktif: true,
  aturan: { KONSI_KONSI: "SETUJU", KONSI_PUTUS: "TOLAK", PUTUS_KONSI: "TOLAK", PUTUS_PUTUS: "TOLAK" },
  saldo: "PERINGATAN",
  tujuanTanpaSpg: true,
  hariPengingat: 3,
};

export function arahMutasi(asal: JenisToko, tujuan: JenisToko): ArahMutasi {
  return `${asal}_${tujuan}` as ArahMutasi;
}

/** Arah yang menyentuh toko PUTUS: barangnya milik toko, jadi butuh persetujuan kantor. */
export function melibatkanPutus(arah: ArahMutasi): boolean {
  return arah !== "KONSI_KONSI";
}

/** Keputusan untuk satu pasangan toko. `LANGSUNG` tidak pernah lolos untuk arah PUTUS. */
export function keputusanArah(aturan: AturanMutasi, asal: JenisToko, tujuan: JenisToko): KeputusanArah {
  const arah = arahMutasi(asal, tujuan);
  const k = aturan.aturan[arah] ?? "TOLAK";
  return k === "LANGSUNG" && melibatkanPutus(arah) ? "SETUJU" : k;
}

/** `SystemSetting` → aturan. Kolom yang hilang atau rusak jatuh ke bawaannya masing-masing. */
export function bacaAturanMutasi(raw: string | null | undefined): AturanMutasi {
  const bawaan = (): AturanMutasi => ({ ...ATURAN_MUTASI_BAWAAN, aturan: { ...ATURAN_MUTASI_BAWAAN.aturan } });
  if (!raw) return bawaan();
  let x: unknown;
  try {
    x = JSON.parse(raw);
  } catch {
    return bawaan();
  }
  if (!x || typeof x !== "object" || Array.isArray(x)) return bawaan();
  const o = x as Record<string, unknown>;
  const b = bawaan();
  const aturanMentah = o.aturan && typeof o.aturan === "object" && !Array.isArray(o.aturan) ? (o.aturan as Record<string, unknown>) : {};
  const aturan = { ...b.aturan };
  for (const arah of ARAH_MUTASI) {
    const v = aturanMentah[arah];
    if (typeof v === "string" && (KEPUTUSAN_ARAH as readonly string[]).includes(v)) {
      aturan[arah] = v === "LANGSUNG" && melibatkanPutus(arah) ? "SETUJU" : (v as KeputusanArah);
    }
  }
  const hari = o.hariPengingat;
  return {
    aktif: typeof o.aktif === "boolean" ? o.aktif : b.aktif,
    aturan,
    saldo: typeof o.saldo === "string" && (MODE_SALDO_MUTASI as readonly string[]).includes(o.saldo) ? (o.saldo as ModeSaldoMutasi) : b.saldo,
    tujuanTanpaSpg: typeof o.tujuanTanpaSpg === "boolean" ? o.tujuanTanpaSpg : b.tujuanTanpaSpg,
    hariPengingat:
      typeof hari === "number" && Number.isInteger(hari) && hari >= 1 && hari <= HARI_PENGINGAT_MAKS ? hari : b.hariPengingat,
  };
}

// ─── Status ──────────────────────────────────────────────────────────────────

export const STATUS_MUTASI = ["DIAJUKAN", "DISETUJUI", "DIKIRIM", "DITERIMA", "DITOLAK", "DIBATALKAN", "DIKEMBALIKAN"] as const;
export type StatusMutasi = (typeof STATUS_MUTASI)[number];

export const SELISIH_MUTASI = ["TERBUKA", "HILANG", "KEMBALI"] as const;
export type SelisihMutasi = (typeof SELISIH_MUTASI)[number];

/** Belum dikirim: stok toko asal belum bergerak, dan masih bisa dibatalkan pengirim. */
export const STATUS_BELUM_DIKIRIM: readonly StatusMutasi[] = ["DIAJUKAN", "DISETUJUI"];

export function bacaStatusMutasi(x: unknown): StatusMutasi | null {
  const v = Array.isArray(x) ? x[0] : x;
  return typeof v === "string" && (STATUS_MUTASI as readonly string[]).includes(v) ? (v as StatusMutasi) : null;
}

// ─── Nomor dokumen ───────────────────────────────────────────────────────────

/** Tahun kalender Jakarta — mutasi 31 Des 23.30 WIB adalah tahun itu, bukan tahun UTC. */
export function tahunWib(d: Date): number {
  return Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric" }).format(d));
}

/** Tahun dan bulan kalender Jakarta, untuk siklus konsinyasi yang tersentuh. */
export function bulanWib(d: Date): { tahun: number; bulan: number } {
  const [tahun, bulan] = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit" })
    .format(d)
    .split("-")
    .map(Number);
  return { tahun, bulan };
}

export function awalanNomorMutasi(tahun: number): string {
  return `MTS/${tahun}/`;
}

/** Nomor berikutnya setelah `terakhir` (urut teks di tahun yang sama). Lima digit. */
export function nomorMutasiBerikut(terakhir: string | null, tahun: number): string {
  const awalan = awalanNomorMutasi(tahun);
  const n = terakhir && terakhir.startsWith(awalan) ? Number.parseInt(terakhir.slice(awalan.length), 10) : 0;
  return `${awalan}${String((Number.isFinite(n) ? n : 0) + 1).padStart(5, "0")}`;
}

// ─── Isian ───────────────────────────────────────────────────────────────────

export const BATAS_TEKS_MUTASI = 500;
export const BATAS_BARIS_MUTASI = 200;
export const QTY_MAKS_MUTASI = 10_000;

export type BarisMutasi = { itemId: string; variantSku: string; qty: number };

export type TolakBaris = "TANPA_BARIS" | "TERLALU_BANYAK_BARIS" | "JUMLAH_TIDAK_VALID";

const kunci = (itemId: string, variantSku: string) => `${itemId}::${variantSku}`;

/**
 * Baris dari HP → baris bersih. Barang+varian yang sama dijumlahkan; jumlah
 * harus bilangan bulat 1..10.000. Yang dipercaya dari HP hanya barang, varian,
 * dan jumlah — nama dan saldo disusun server.
 */
export function rapikanBarisMutasi(baris: unknown): { ok: true; baris: BarisMutasi[] } | { ok: false; kode: TolakBaris } {
  if (!Array.isArray(baris) || baris.length === 0) return { ok: false, kode: "TANPA_BARIS" };
  if (baris.length > BATAS_BARIS_MUTASI) return { ok: false, kode: "TERLALU_BANYAK_BARIS" };
  const gabung = new Map<string, BarisMutasi>();
  for (const b of baris) {
    if (!b || typeof b !== "object") return { ok: false, kode: "JUMLAH_TIDAK_VALID" };
    const r = b as Record<string, unknown>;
    const itemId = typeof r.itemId === "string" ? r.itemId.trim() : "";
    const variantSku = typeof r.variantSku === "string" ? r.variantSku.trim() : "";
    const qty = r.qty;
    if (!itemId || typeof qty !== "number" || !Number.isInteger(qty) || qty < 1 || qty > QTY_MAKS_MUTASI) {
      return { ok: false, kode: "JUMLAH_TIDAK_VALID" };
    }
    const k = kunci(itemId, variantSku);
    const ada = gabung.get(k);
    if (ada) {
      ada.qty += qty;
      if (ada.qty > QTY_MAKS_MUTASI) return { ok: false, kode: "JUMLAH_TIDAK_VALID" };
    } else gabung.set(k, { itemId, variantSku, qty });
  }
  return { ok: true, baris: [...gabung.values()] };
}

/** Alasan/catatan: dirapikan; `wajib` menolak yang kosong. */
export function rapikanTeksMutasi(
  x: unknown,
  wajib: boolean,
): { ok: true; teks: string | null } | { ok: false; kode: "ALASAN_WAJIB" | "TEKS_TERLALU_PANJANG" } {
  const teks = typeof x === "string" ? x.trim() : "";
  if (teks.length > BATAS_TEKS_MUTASI) return { ok: false, kode: "TEKS_TERLALU_PANJANG" };
  if (wajib && !teks) return { ok: false, kode: "ALASAN_WAJIB" };
  return { ok: true, teks: teks || null };
}

export type KurangSaldo = { itemId: string; variantSku: string; qty: number; tersedia: number };

/**
 * Baris yang melebihi saldo toko asal. `tersedia` = saldo buku dikurangi barang
 * yang sudah dijanjikan ke mutasi lain yang belum dikirim — dua ajuan kecil
 * tidak boleh bersama-sama melewati satu saldo tanpa ada yang tahu.
 */
export function kekuranganSaldo(baris: BarisMutasi[], tersedia: (itemId: string, variantSku: string) => number): KurangSaldo[] {
  return baris
    .map((b) => ({ ...b, tersedia: tersedia(b.itemId, b.variantSku) }))
    .filter((b) => b.qty > b.tersedia);
}

/** Jumlah yang kurang diterima, per baris dan total. Lebih dari dikirim ditolak lebih dulu oleh penulis. */
export function selisihPenerimaan(baris: { qtySent: number; qtyReceived: number }[]): { kurang: number; barisKurang: number } {
  let kurang = 0;
  let barisKurang = 0;
  for (const b of baris) {
    const k = Math.max(0, b.qtySent - b.qtyReceived);
    if (k > 0) {
      kurang += k;
      barisKurang += 1;
    }
  }
  return { kurang, barisKurang };
}

const HARI_MS = 86_400_000;

/** Kiriman yang belum diterima sesudah `hariPengingat` hari dianggap macet. */
export function sudahMacet(shippedAt: Date | null, hariPengingat: number, sekarang: Date): boolean {
  return shippedAt !== null && sekarang.getTime() - shippedAt.getTime() >= hariPengingat * HARI_MS;
}

// ─── Jejak & notifikasi ──────────────────────────────────────────────────────

export const ENTITAS_MUTASI = "StoreTransfer";

/** Nama tindakan di `AuditLog`. Jangan menulis nama tindakan mutasi sebagai string bebas. */
export const JEJAK_MUTASI = {
  DIAJUKAN: "STORE_TRANSFER_PROPOSED",
  DISETUJUI: "STORE_TRANSFER_APPROVED",
  DITOLAK: "STORE_TRANSFER_REJECTED",
  DIKIRIM: "STORE_TRANSFER_SHIPPED",
  DIBATALKAN: "STORE_TRANSFER_CANCELLED",
  DIKEMBALIKAN: "STORE_TRANSFER_RETURNED",
  DIALIHKAN: "STORE_TRANSFER_REDIRECTED",
  DITERIMA: "STORE_TRANSFER_RECEIVED",
  DITERIMA_KEMBALI: "STORE_TRANSFER_RECEIVED_BACK",
  SELISIH_DIPUTUSKAN: "STORE_TRANSFER_SHORTFALL_RESOLVED",
  MACET_DIKABARKAN: "STORE_TRANSFER_STALE_NOTIFIED",
  /** Penanda cron: kiriman menunggu sudah dikabarkan ke SPG toko itu hari ini. */
  KIRIMAN_MENUNGGU_DIKABARKAN: "STORE_DELIVERY_WAITING_NOTIFIED",
} as const;

export const KATEGORI_NOTIF_MUTASI = {
  DIAJUKAN: "STORE_TRANSFER_PROPOSED",
  SELISIH: "STORE_TRANSFER_DISCREPANCY",
  PERLU_DITERIMA: "STORE_TRANSFER_TO_RECEIVE",
  MACET: "STORE_TRANSFER_STALE",
} as const;
