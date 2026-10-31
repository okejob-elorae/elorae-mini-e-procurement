import { hasPermission, PERMISSIONS } from "@/lib/rbac";

/**
 * Tukar barang di toko PUTUS — aturan murni (tanpa basis data).
 *
 * Tukar barang BUKAN retur. Retur adalah dokumen uang: ia mengurangi piutang
 * dan diakui sebesar fisik (lihat `lib/receivables`). Tukar barang sengaja
 * NETRAL NILAI — toko mengembalikan barang dan menerima barang lain senilai
 * yang sama (biasanya ukuran/warna lain dari artikel yang sama), jadi tidak ada
 * satu rupiah pun yang boleh bergeser di piutang. Karena itu nilainya dijaga
 * di sini: kalau kedua sisi tidak setara, penukaran ditolak dan selisihnya
 * harus lewat jalur uang yang semestinya (pesanan biasa atau retur).
 *
 * Toko KONSINYASI ditolak: barang di sana masih milik kita, jadi "menukar"
 * sebenarnya adalah kirim konsinyasi + retur konsinyasi — dua dokumen yang
 * sudah punya jalurnya sendiri.
 */

export const ARAH_TUKAR = ["MASUK", "KELUAR"] as const;
/** MASUK = toko mengembalikan ke kita; KELUAR = kita memberikan ke toko. */
export type ArahTukar = (typeof ARAH_TUKAR)[number];

export const STATUS_TUKAR = ["DIAJUKAN", "DISETUJUI", "DITOLAK", "SELESAI", "DIBATALKAN"] as const;
export type StatusTukar = (typeof STATUS_TUKAR)[number];

/** Batas wajar satu dokumen — mencegah kiriman raksasa, bukan aturan bisnis. */
export const BATAS_BARIS_TUKAR = 60;
export const BATAS_QTY_TUKAR = 9_999;
export const BATAS_TEKS_TUKAR = 500;
/**
 * Selisih yang masih dianggap setara. Harga tersimpan sampai sen, jadi dua
 * barang "seharga" bisa berbeda beberapa puluh sen setelah dikali qty; lebih
 * dari Rp 1 berarti memang beda harga.
 */
export const TOLERANSI_SELISIH_TUKAR = 1;

/** Sumber `StockAdjustment` — dua arah dibedakan supaya kartu stok terbaca. */
export const SUMBER_STOK_TUKAR = { MASUK: "STORE_EXCHANGE_IN", KELUAR: "STORE_EXCHANGE_OUT" } as const;

/** Nama tindakan di `AuditLog`. Terkumpul di satu tempat supaya jejaknya bisa dicari. */
export const JEJAK_TUKAR = {
  DIAJUKAN: "STORE_EXCHANGE_PROPOSED",
  DISETUJUI: "STORE_EXCHANGE_APPROVED",
  DITOLAK: "STORE_EXCHANGE_REJECTED",
  SELESAI: "STORE_EXCHANGE_COMPLETED",
  DIBATALKAN: "STORE_EXCHANGE_CANCELLED",
} as const satisfies Record<StatusTukar, string>;
export const ENTITAS_TUKAR = "StoreExchange";

/**
 * Kategori catatan kantor (`AdminNotification`). Penerimanya di
 * `lib/notifications/admin-fanout.ts`: ajuan → penyetuju (`bolehMenyetujuiTukar`),
 * disetujui → gudang yang menyelesaikan (`bolehMenyelesaikanTukar`).
 */
export const KATEGORI_NOTIF_TUKAR = {
  DIAJUKAN: "STORE_EXCHANGE_PROPOSED",
  PERLU_DISELESAIKAN: "STORE_EXCHANGE_TO_COMPLETE",
} as const;

export type BarisTukar = { direction: ArahTukar; itemId: string; variantSku: string; qty: number };

export const kunciBarisTukar = (itemId: string, variantSku: string): string => `${itemId}::${variantSku}`;

const pembulatan = (n: number): number => Math.round(n * 100) / 100;

// ─── Baris ───────────────────────────────────────────────────────────────────

export type KodeTolakBaris =
  | "BARIS_TIDAK_SAH"
  | "TERLALU_BANYAK_BARIS"
  | "QTY_TIDAK_SAH"
  | "BARIS_GANDA"
  | "TANPA_MASUK"
  | "TANPA_KELUAR";

/**
 * Rapikan baris kiriman HP. Masukannya `unknown` karena ia datang dari aksi
 * server yang bisa dipanggil siapa saja, bukan hanya dari formulir kita.
 *
 * Barang+varian yang sama di DUA arah sah: itu menukar barang cacat dengan
 * barang yang sama. Yang ditolak hanya ganda pada satu arah — dua baris yang
 * seharusnya satu, yang membuat jumlahnya membingungkan di surat tukar.
 */
export function rapikanBarisTukar(masukan: unknown): { ok: true; baris: BarisTukar[] } | { ok: false; kode: KodeTolakBaris } {
  if (!Array.isArray(masukan)) return { ok: false, kode: "BARIS_TIDAK_SAH" };
  if (masukan.length > BATAS_BARIS_TUKAR) return { ok: false, kode: "TERLALU_BANYAK_BARIS" };

  const baris: BarisTukar[] = [];
  for (const b of masukan) {
    if (!b || typeof b !== "object") return { ok: false, kode: "BARIS_TIDAK_SAH" };
    const { direction, itemId, variantSku, qty } = b as Record<string, unknown>;
    if (!ARAH_TUKAR.includes(direction as ArahTukar)) return { ok: false, kode: "BARIS_TIDAK_SAH" };
    if (typeof itemId !== "string" || !itemId.trim()) return { ok: false, kode: "BARIS_TIDAK_SAH" };
    if (variantSku != null && typeof variantSku !== "string") return { ok: false, kode: "BARIS_TIDAK_SAH" };
    if (typeof qty !== "number" || !Number.isInteger(qty) || qty < 1 || qty > BATAS_QTY_TUKAR) {
      return { ok: false, kode: "QTY_TIDAK_SAH" };
    }
    baris.push({ direction: direction as ArahTukar, itemId: itemId.trim(), variantSku: (variantSku ?? "").trim(), qty });
  }

  const dilihat = new Set<string>();
  for (const b of baris) {
    const k = `${b.direction}|${kunciBarisTukar(b.itemId, b.variantSku)}`;
    if (dilihat.has(k)) return { ok: false, kode: "BARIS_GANDA" };
    dilihat.add(k);
  }
  if (!baris.some((b) => b.direction === "MASUK")) return { ok: false, kode: "TANPA_MASUK" };
  if (!baris.some((b) => b.direction === "KELUAR")) return { ok: false, kode: "TANPA_KELUAR" };
  return { ok: true, baris };
}

// ─── Nilai ───────────────────────────────────────────────────────────────────

/** `selisih = keluar − masuk`: positif berarti toko menerima barang lebih mahal. */
export type NilaiTukar = { masuk: number; keluar: number; selisih: number };

/**
 * Nilai kedua sisi dengan harga toko yang DIHITUNG SERVER (harga PUTUS, sama
 * dengan pesanan). Harga dipegang per barang, jadi tukar ukuran dari artikel
 * yang sama selalu setara.
 *
 * Barang tanpa harga (atau berharga nol) menolak seluruh penukaran: dua sisi
 * bernilai nol lolos pemeriksaan setara tanpa membuktikan apa pun, dan itu
 * jalan belakang untuk menukar barang mahal dengan barang murah.
 */
export function hitungNilaiTukar(
  baris: readonly BarisTukar[],
  harga: ReadonlyMap<string, number | null>,
): { ok: true; nilai: NilaiTukar } | { ok: false; kode: "HARGA_BELUM_DISET"; itemIds: string[] } {
  const tanpaHarga: string[] = [];
  let masuk = 0;
  let keluar = 0;
  for (const b of baris) {
    const h = harga.get(b.itemId);
    if (h == null || !(h > 0)) {
      if (!tanpaHarga.includes(b.itemId)) tanpaHarga.push(b.itemId);
      continue;
    }
    if (b.direction === "MASUK") masuk += b.qty * h;
    else keluar += b.qty * h;
  }
  if (tanpaHarga.length > 0) return { ok: false, kode: "HARGA_BELUM_DISET", itemIds: tanpaHarga };
  masuk = pembulatan(masuk);
  keluar = pembulatan(keluar);
  return { ok: true, nilai: { masuk, keluar, selisih: pembulatan(keluar - masuk) } };
}

export type TolakSelisih = { ok: false; kode: "SELISIH_NILAI"; masuk: number; keluar: number; selisih: number };

export function periksaNilaiTukar(nilai: NilaiTukar, toleransi = TOLERANSI_SELISIH_TUKAR): { ok: true } | TolakSelisih {
  if (Math.abs(pembulatan(nilai.selisih)) <= toleransi) return { ok: true };
  return { ok: false, kode: "SELISIH_NILAI", masuk: nilai.masuk, keluar: nilai.keluar, selisih: nilai.selisih };
}

/**
 * Ke mana selisihnya harus dibawa: barang yang diterima toko lebih mahal →
 * tagih lewat pesanan biasa; barang yang dikembalikan toko lebih mahal →
 * akui lewat retur (yang diakui sebesar fisik oleh gudang).
 */
export function arahSelisih(selisih: number, toleransi = TOLERANSI_SELISIH_TUKAR): "LEWAT_PESANAN" | "LEWAT_RETUR" | "PAS" {
  if (Math.abs(selisih) <= toleransi) return "PAS";
  return selisih > 0 ? "LEWAT_PESANAN" : "LEWAT_RETUR";
}

export function periksaJenisToko(termsType: string): "BUKAN_TOKO_PUTUS" | null {
  return termsType === "PUTUS" ? null : "BUKAN_TOKO_PUTUS";
}

/**
 * Seluruh pemeriksaan pengajuan dalam satu urutan tetap: jenis toko → baris →
 * harga → nilai. Urutannya penting untuk pesan yang dilihat salesman — toko
 * konsinyasi harus diberi tahu "bukan jalurnya", bukan "baris kurang".
 */
export function periksaTukar(input: {
  termsType: string;
  baris: unknown;
  harga: ReadonlyMap<string, number | null>;
}):
  | { ok: true; baris: BarisTukar[]; nilai: NilaiTukar }
  | { ok: false; kode: "BUKAN_TOKO_PUTUS" | KodeTolakBaris }
  | { ok: false; kode: "HARGA_BELUM_DISET"; itemIds: string[] }
  | TolakSelisih {
  const jenis = periksaJenisToko(input.termsType);
  if (jenis) return { ok: false, kode: jenis };
  const rapi = rapikanBarisTukar(input.baris);
  if (!rapi.ok) return rapi;
  const n = hitungNilaiTukar(rapi.baris, input.harga);
  if (!n.ok) return n;
  const cek = periksaNilaiTukar(n.nilai);
  if (!cek.ok) return cek;
  return { ok: true, baris: rapi.baris, nilai: n.nilai };
}

// ─── Status ──────────────────────────────────────────────────────────────────

/**
 * Perpindahan yang sah. Yang sudah SELESAI tidak bisa dibatalkan: stoknya sudah
 * bergerak, dan membatalkan dokumennya akan meninggalkan gerakan stok tanpa
 * dokumen. Barang yang salah tukar dikoreksi dengan penukaran baru.
 */
export const PINDAH_TUKAR: Record<StatusTukar, readonly StatusTukar[]> = {
  DIAJUKAN: ["DISETUJUI", "DITOLAK", "DIBATALKAN"],
  DISETUJUI: ["SELESAI", "DIBATALKAN"],
  DITOLAK: [],
  SELESAI: [],
  DIBATALKAN: [],
};

export function bacaStatusTukar(s: unknown): StatusTukar | null {
  return STATUS_TUKAR.includes(s as StatusTukar) ? (s as StatusTukar) : null;
}

export function bolehPindahTukar(dari: string, ke: StatusTukar): boolean {
  const d = bacaStatusTukar(dari);
  return d !== null && PINDAH_TUKAR[d].includes(ke);
}

/** Masih bisa berubah: belum selesai, belum ditolak, belum dibatalkan. */
export function statusTukarTerbuka(s: string): boolean {
  return s === "DIAJUKAN" || s === "DISETUJUI";
}

// ─── Stok ────────────────────────────────────────────────────────────────────

export type KurangStok = { itemId: string; variantSku: string; butuh: number; tersedia: number };

/**
 * Baris KELUAR yang stoknya tidak cukup, dijumlah per barang+varian. Yang
 * MASUK tidak dihitung sebagai penambah: barang yang dikembalikan toko bisa
 * cacat, jadi ia tidak boleh dianggap siap diberikan lagi dalam penukaran
 * yang sama.
 */
export function kekuranganStok(
  baris: readonly BarisTukar[],
  tersedia: (itemId: string, variantSku: string) => number,
): KurangStok[] {
  const butuh = new Map<string, { itemId: string; variantSku: string; qty: number }>();
  for (const b of baris) {
    if (b.direction !== "KELUAR") continue;
    const k = kunciBarisTukar(b.itemId, b.variantSku);
    const ada = butuh.get(k);
    if (ada) ada.qty += b.qty;
    else butuh.set(k, { itemId: b.itemId, variantSku: b.variantSku, qty: b.qty });
  }
  const kurang: KurangStok[] = [];
  for (const b of butuh.values()) {
    const s = tersedia(b.itemId, b.variantSku);
    if (s < b.qty) kurang.push({ itemId: b.itemId, variantSku: b.variantSku, butuh: b.qty, tersedia: s });
  }
  return kurang;
}

// ─── Nomor ───────────────────────────────────────────────────────────────────

/**
 * Nomor `TKR/2026/0001`, urut per tahun. Disusun "yang terakhir + 1" seperti
 * nomor dokumen modul piutang (bukan `DocType`, yang menuntut dua peta lain
 * ikut diubah); kolom `docNo @unique` adalah penjaga sebenarnya, dan
 * penulisnya mengulang saat bentrok.
 */
export const awalanNomorTukar = (tahun: number): string => `TKR/${tahun}/`;

export function nomorTukarBerikut(terakhir: string | null, tahun: number): string {
  const awalan = awalanNomorTukar(tahun);
  const urut = terakhir?.startsWith(awalan) ? Number(terakhir.slice(awalan.length)) : 0;
  const berikut = Number.isInteger(urut) && urut > 0 ? urut + 1 : 1;
  return `${awalan}${String(berikut).padStart(4, "0")}`;
}

/** Tahun kalender WIB — dokumen 1 Januari pukul 00.30 WIB (masih 31 Desember di UTC) milik tahun baru. */
export function tahunWib(d: Date): number {
  return Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric" }).format(d));
}

// ─── Teks ────────────────────────────────────────────────────────────────────

export function rapikanAlasanTukar(
  alasan: unknown,
  wajib: boolean,
): { ok: true; alasan: string | null } | { ok: false; kode: "ALASAN_WAJIB" | "TEKS_TERLALU_PANJANG" } {
  const teks = typeof alasan === "string" ? alasan.trim() : "";
  if (!teks) return wajib ? { ok: false, kode: "ALASAN_WAJIB" } : { ok: true, alasan: null };
  if (teks.length > BATAS_TEKS_TUKAR) return { ok: false, kode: "TEKS_TERLALU_PANJANG" };
  return { ok: true, alasan: teks };
}

export function rapikanCatatanTukar(catatan: unknown): { ok: true; catatan: string | null } | { ok: false; kode: "TEKS_TERLALU_PANJANG" } {
  const r = rapikanAlasanTukar(catatan, false);
  return r.ok ? { ok: true, catatan: r.alasan } : { ok: false, kode: "TEKS_TERLALU_PANJANG" };
}

// ─── Izin ────────────────────────────────────────────────────────────────────

/**
 * Pemisahan tugas: salesman MENGAJUKAN (ia yang ada di toko), kantor penjualan
 * MENYETUJUI (izin yang sama dengan menyetujui pesanan lapangan — keputusan
 * dagang), gudang MENYELESAIKAN (izin yang sama dengan penerimaan barang/GRN
 * dan penyesuaian stok — satu-satunya langkah yang menggerakkan stok).
 */
export function bolehMengajukanTukar(izin: string[] | undefined): boolean {
  return (izin ?? []).includes("pwa:access");
}

export function bolehMenyetujuiTukar(izin: string[] | undefined): boolean {
  return hasPermission(izin ?? [], PERMISSIONS.FIELD_SALES_ORDERS_APPROVE);
}

export function bolehMenyelesaikanTukar(izin: string[] | undefined): boolean {
  return hasPermission(izin ?? [], PERMISSIONS.INVENTORY_MANAGE);
}

/** Gudang perlu melihat daftarnya untuk menyelesaikan, walau tidak memegang izin penjualan. */
export function bolehMelihatTukar(izin: string[] | undefined): boolean {
  const p = izin ?? [];
  return (
    hasPermission(p, PERMISSIONS.FIELD_SALES_ORDERS_VIEW) || bolehMenyetujuiTukar(p) || bolehMenyelesaikanTukar(p)
  );
}
