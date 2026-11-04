import { formatDateOnlyJakarta } from "@/lib/date-only";

/**
 * Aturan "titip pesan" — pembeli minta dikabari saat barang yang dicarinya
 * datang ke toko. Murni, aman dipakai di layar HP.
 *
 * Alur (`CustomerRequest.status`):
 *   MENUNGGU → TERSEDIA (otomatis saat saldo buku stok toko > 0, `kabariTitipanTersedia`)
 *            → DIKABARI (SPG menekan "Kabari lewat WhatsApp"; disimpankan sampai `holdUntil`)
 *            → SELESAI (terjual ke pembeli itu — otomatis di nota — atau "sudah diambil")
 *              atau BATAL (alasan wajib).
 *
 * "Sudah datang" juga dihitung saat layar dibuka: permintaan MENUNGGU yang
 * barangnya kini bersaldo > 0 tampil di kelompok itu walau pemicu otomatisnya
 * belum berjalan (atau gagal) — kabar yang terlambat tidak boleh membuat
 * pembeli tidak dikabari.
 */

export const STATUS_TITIP = ["MENUNGGU", "TERSEDIA", "DIKABARI", "SELESAI", "BATAL"] as const;
export type StatusTitip = (typeof STATUS_TITIP)[number];
export const STATUS_TITIP_TERBUKA: readonly StatusTitip[] = ["MENUNGGU", "TERSEDIA", "DIKABARI"];

export function bacaStatusTitip(s: string | null | undefined): StatusTitip | null {
  return (STATUS_TITIP as readonly string[]).includes(s ?? "") ? (s as StatusTitip) : null;
}

/** Nama tindakan jejak titip pesan (`AuditLog.action`). */
export const JEJAK_TITIP = {
  DIBUAT: "CUSTOMER_REQUEST_CREATED",
  DIKABARI: "CUSTOMER_REQUEST_NOTIFIED",
  SELESAI: "CUSTOMER_REQUEST_CLOSED",
  DIBATALKAN: "CUSTOMER_REQUEST_CANCELLED",
  /** Pengaturan `spg.titipPesan` diubah kantor. */
  PENGATURAN: "CUSTOMER_REQUEST_SETTINGS_UPDATED",
} as const;

export const ENTITAS_TITIP = "CustomerRequest";

export const BATAS_KETERANGAN_TITIP = 200;
export const BATAS_ALASAN_TITIP = 500;
export const MAKS_QTY_TITIP = 999;
/** Kabar ke satu SPG per panggilan `kabariTitipanTersedia`. */
export const MAKS_KABAR_TERSEDIA = 10;

// ─── Hari kalender WIB ───────────────────────────────────────────────────────

/** Hari kalender WIB `YYYY-MM-DD` dari satu waktu. */
export function hariWib(d: Date): string {
  return formatDateOnlyJakarta(d);
}

/** `YYYY-MM-DD` + `n` hari (kalender, tanpa zona — WIB tidak punya musim panas). */
export function tambahHari(hari: string, n: number): string {
  const [y, m, d] = hari.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/** Barang disimpankan sampai (inklusif) hari WIB ini sesudah pembeli dikabari. */
export function batasSimpanDari(sekarang: Date, hariSimpan: number): string {
  return tambahHari(hariWib(sekarang), hariSimpan);
}

/** Sudah lewat masa simpan = hari ini SESUDAH tanggal terakhir disimpankan. */
export function lewatMasaSimpan(holdUntil: string | null | undefined, hariIni: string): boolean {
  return Boolean(holdUntil) && (holdUntil as string) < hariIni;
}

/** "Selasa, 6 Oktober 2026" — tanggal panjang bahasa Indonesia, untuk pesan ke pembeli. */
export function tanggalPanjang(hari: string): string {
  const d = new Date(`${hari}T12:00:00+07:00`);
  if (Number.isNaN(d.getTime())) return hari;
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(d);
}

// ─── Ketersediaan di toko ────────────────────────────────────────────────────

/**
 * Berapa potong barang permintaan ini yang ADA di toko menurut buku stok.
 *
 * Varian tertentu = saldo varian itu. Varian kosong ("") = varian mana pun:
 * jumlah saldo positif semua varian barang itu (untuk barang tanpa varian,
 * satu-satunya barisnya). Saldo negatif tidak mengurangi varian lain — rak
 * yang minus di satu ukuran tidak menghapus ukuran lain yang ada.
 *
 * `saldo` dikunci `${itemId}::${variantSku}` seperti `kunciBaris`.
 */
export function stokUntukPermintaan(itemId: string | null, variantSku: string | null | undefined, saldo: ReadonlyMap<string, number>): number {
  if (!itemId) return 0;
  const varian = (variantSku ?? "").trim();
  if (varian) return Math.max(0, saldo.get(`${itemId}::${varian}`) ?? 0);
  const awalan = `${itemId}::`;
  let n = 0;
  for (const [k, v] of saldo) if (k.startsWith(awalan) && v > 0) n += v;
  return n;
}

export type KelompokTitip = "datang" | "dikabari" | "menunggu" | "tutup";

/** Kelompok tampilan satu permintaan, dengan stok toko SAAT layar dibuka. */
export function kelompokTitip(status: string, stokSekarang: number): KelompokTitip {
  if (status === "TERSEDIA") return "datang";
  if (status === "DIKABARI") return "dikabari";
  if (status === "MENUNGGU") return stokSekarang > 0 ? "datang" : "menunggu";
  return "tutup";
}

/**
 * Bisakah SPG menekan "Kabari lewat WhatsApp"? TERSEDIA, MENUNGGU yang
 * barangnya kini ada, atau DIKABARI (kirim ulang — masa simpannya TIDAK
 * diperpanjang). Permintaan berupa keterangan bebas (tanpa barang katalog)
 * tidak bisa dicocokkan dengan buku stok, jadi SPG yang menilai sendiri
 * kapan barangnya ada.
 */
export function bolehDikabari(status: string, stokSekarang: number, adaBarang: boolean): boolean {
  if (status === "TERSEDIA" || status === "DIKABARI") return true;
  return status === "MENUNGGU" && (!adaBarang || stokSekarang > 0);
}

// ─── Pesan WhatsApp ──────────────────────────────────────────────────────────

export type IsiPesanTitip = {
  namaPembeli: string;
  namaToko: string;
  /** Nama barang, atau keterangan bebas yang diketik SPG. */
  barang: string;
  /** Ukuran/warna varian; null = varian mana pun / barang tanpa varian. */
  varian: string | null;
  qty: number;
  /** Disimpankan sampai hari WIB ini (`YYYY-MM-DD`). */
  sampai: string;
};

/**
 * Pesan "barang sudah datang" ke pembeli. SELALU bahasa Indonesia — yang
 * membaca pembeli, bukan bahasa layar SPG. Tanpa harga sama sekali: harga di
 * konter bisa berubah oleh promo, dan pesan yang menyebut harga menjadi janji.
 * Hanya MEMBUKA WhatsApp; SPG sendiri yang membaca, mengubah, dan menekan kirim.
 */
export function pesanTitipTersedia(isi: IsiPesanTitip): string {
  const sapaan = isi.namaPembeli.trim() ? `Halo Kak ${isi.namaPembeli.trim()},` : "Halo Kak,";
  const barang = [isi.barang.trim(), isi.varian?.trim() ? `(${isi.varian.trim()})` : null].filter(Boolean).join(" ");
  const jumlah = isi.qty > 1 ? ` sebanyak ${isi.qty} pcs` : "";
  return [
    `${sapaan} kami dari ${isi.namaToko.trim()}.`,
    `${barang}${jumlah} yang Kakak minta dikabari sudah datang di toko kami.`,
    `Barangnya kami simpankan sampai ${tanggalPanjang(isi.sampai)}. Silakan mampir ke toko ya.`,
    "Terima kasih!",
  ].join("\n\n");
}

/** Ukuran dan warna varian menjadi satu label pendek: "Hitam, XL". */
export function labelVarian(v: { ukuran: string | null; warna: string | null } | null, cadangan: string | null): string | null {
  const bagian = [v?.warna, v?.ukuran].filter((x): x is string => Boolean(x && x.trim()));
  if (bagian.length > 0) return bagian.join(", ");
  return cadangan?.trim() || null;
}
