/**
 * Laporan tutup hari SPG — bagian murni (aman di klien, tanpa Prisma).
 *
 * Satu laporan per toko per hari WIB (`SpgDailyClose`, unik `storeId + day`).
 * Angka penjualan DIHITUNG SISTEM dari nota semua SPG toko itu, bukan diketik:
 * SPG hanya menambah jumlah pengunjung, total kasir toko untuk merek kita,
 * catatan kendala, dan foto. Yang menutup terakhir menimpa laporan, dan setiap
 * kiriman meninggalkan jejak sebelum/sesudah.
 *
 * Definisi angka (dikunci tes):
 * - nota/potong/nilai kotor/potongan = nota yang DIBUAT pada hari itu (waktu jual,
 *   termasuk nota dari antrean HP yang bertanggal waktu jualnya);
 * - potong & nilai retur = barang yang DIKEMBALIKAN pembeli pada hari itu (dari
 *   nota kapan pun), dinilai dengan harga BERSIH per potong baris notanya
 *   (`lineTotal / qty`) — sama dengan dasbor (`nilaiBersihSpg`);
 * - nilai bersih = Σ total nota hari itu − nilai retur hari itu. Bisa negatif
 *   pada hari tanpa penjualan tapi ada pengembalian — itu memang uang yang
 *   keluar di kasir hari itu, jadi tidak dijepit ke nol.
 */

import { bacaTanggal, geserHari, hariIniWib, labelTanggal } from "@/lib/tanggal-isian";
import { formatRupiah } from "@/lib/format/rupiah";
import type { AturanTutupHari } from "./pengaturan";

export const ENTITAS_TUTUP_HARI = "SpgDailyClose";

/** Nama tindakan jejak (`AuditLog.action`) modul ini — jangan menulisnya sebagai teks bebas. */
export const JEJAK_TUTUP_HARI = {
  DIKIRIM: "SPG_DAILY_CLOSE_SUBMITTED",
  DIPERBARUI: "SPG_DAILY_CLOSE_UPDATED",
  /** Penanda cron 21:30: toko ini sudah diingatkan pada hari itu. Entitasnya `Store`. */
  DIINGATKAN: "SPG_DAILY_CLOSE_REMINDED",
  PENGATURAN: "SPG_DAILY_CLOSE_SETTINGS_UPDATED",
} as const;

export const MAKS_FOTO_TUTUP = 3;
export const MAKS_CATATAN_TUTUP = 1000;
export const MAKS_PENGUNJUNG = 100_000;
export const MAKS_TOTAL_KASIR = 10_000_000_000;
export const JUMLAH_TERLARIS = 5;
/** Rekap rentang di kantor paling panjang sekian hari (awal dan akhir ikut dihitung). */
export const MAKS_HARI_REKAP = 62;

const bulat2 = (n: number) => {
  const r = Math.round(n * 100) / 100;
  return r === 0 ? 0 : r;
};

// ---------------------------------------------------------------------------
// Hari
// ---------------------------------------------------------------------------

const POLA_HARI = /^\d{4}-\d{2}-\d{2}$/;

/** Hari yang boleh ditutup SPG: hari ini dan kemarin (lupa menutup semalam). */
export function hariTutupYangBoleh(sekarang: Date): { hariIni: string; kemarin: string } {
  const hariIni = hariIniWib(sekarang);
  return { hariIni, kemarin: geserHari(hariIni, -1) };
}

export function hariTutupSah(day: unknown, sekarang: Date): day is string {
  if (typeof day !== "string" || !POLA_HARI.test(day)) return false;
  const { hariIni, kemarin } = hariTutupYangBoleh(sekarang);
  return day === hariIni || day === kemarin;
}

/** "YYYY-MM-DD" yang benar-benar ada di kalender. */
export function hariSah(day: unknown): day is string {
  return typeof day === "string" && POLA_HARI.test(day) && bacaTanggal(day) !== null;
}

/** Awal (inklusif) dan akhir (eksklusif) hari kalender WIB sebagai instan UTC. */
export function batasHariWib(day: string): { awal: Date; akhir: Date } {
  const awal = new Date(`${day}T00:00:00+07:00`);
  return { awal, akhir: new Date(awal.getTime() + 86_400_000) };
}

/** "Sabtu, 3 Okt 2026" — selalu Bahasa Indonesia (dipakai juga di pesan WhatsApp). */
export function labelHariTutup(day: string): string {
  const [t, b, h] = day.split("-").map(Number);
  const hari = new Intl.DateTimeFormat("id-ID", { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(t, b - 1, h, 12)));
  return `${hari}, ${labelTanggal(day, "id")}`;
}

// ---------------------------------------------------------------------------
// Angka penjualan
// ---------------------------------------------------------------------------

export type BarisNotaTutup = { itemId: string; variantSku: string; productName: string; qty: number };
export type NotaTutup = {
  salesmanId: string;
  subtotal: number;
  discountTotal: number;
  /** BERSIH sesudah promo & diskon manual. */
  total: number;
  baris: BarisNotaTutup[];
};
/** Satu baris barang yang dikembalikan pembeli, dengan baris nota asalnya. */
export type ReturTutup = { qty: number; saleLine: { qty: number; lineTotal: number | null; unitPrice: number } };

export type AngkaPenjualan = {
  nota: number;
  potong: number;
  potongKembali: number;
  nilaiKotor: number;
  potongan: number;
  /** Σ total nota hari itu (sesudah potongan, sebelum retur). */
  nilaiNota: number;
  nilaiRetur: number;
  nilaiBersih: number;
};

/** Harga bersih satu potong pada baris nota: `lineTotal / qty`; baris lama tanpa keduanya memakai harga daftar. */
export function hargaBersihPotong(l: { qty: number; lineTotal: number | null; unitPrice: number }): number {
  if (l.qty > 0 && l.lineTotal !== null && Number.isFinite(l.lineTotal)) return l.lineTotal / l.qty;
  return Number.isFinite(l.unitPrice) ? l.unitPrice : 0;
}

export function hitungAngkaPenjualan(
  nota: readonly { subtotal: number; discountTotal: number; total: number; potong: number }[],
  retur: readonly ReturTutup[],
): AngkaPenjualan {
  const nilaiNota = nota.reduce((s, n) => s + n.total, 0);
  const nilaiRetur = retur.reduce((s, r) => s + r.qty * hargaBersihPotong(r.saleLine), 0);
  return {
    nota: nota.length,
    potong: nota.reduce((s, n) => s + n.potong, 0),
    potongKembali: retur.reduce((s, r) => s + r.qty, 0),
    nilaiKotor: bulat2(nota.reduce((s, n) => s + n.subtotal, 0)),
    potongan: bulat2(nota.reduce((s, n) => s + n.discountTotal, 0)),
    nilaiNota: bulat2(nilaiNota),
    nilaiRetur: bulat2(nilaiRetur),
    nilaiBersih: bulat2(nilaiNota - nilaiRetur),
  };
}

export const potongNota = (n: { baris: readonly { qty: number }[] }) => n.baris.reduce((s, b) => s + b.qty, 0);

// ---------------------------------------------------------------------------
// Ringkasan satu toko satu hari
// ---------------------------------------------------------------------------

export type KirimanTutup = {
  docNo: string;
  sourceType: string;
  /** ISO. */
  waktu: string;
  diterima: number;
  rusak: number;
  penerima: string | null;
};
export type DicariTutup = { description: string; qty: number };
export type TerlarisTutup = { itemId: string; variantSku: string; nama: string; qty: number };
export type PerSpgTutup = { userId: string; nama: string; nota: number; potong: number; nilai: number };

export type BahanTutupHari = {
  storeId: string;
  namaToko: string;
  day: string;
  nota: NotaTutup[];
  retur: ReturTutup[];
  kiriman: KirimanTutup[];
  dicari: DicariTutup[];
  /** SPG yang ditugaskan di toko ini sekarang — tampil walau belum menjual. */
  spg: { id: string; nama: string }[];
  /** Nama penjual lain (SPG yang sudah dipindah toko, dsb.). */
  namaPengguna: Record<string, string>;
};

export type RingkasanTutupHari = AngkaPenjualan & {
  storeId: string;
  namaToko: string;
  day: string;
  terlaris: TerlarisTutup[];
  kiriman: KirimanTutup[];
  dicari: DicariTutup[];
  perSpg: PerSpgTutup[];
};

/**
 * Terlaris hari itu: potong TERJUAL di nota hari itu per varian (bukan dikurangi
 * retur — retur hari itu bisa dari nota bulan lalu). Nama tampilan bisa berbeda
 * antar nota untuk varian yang sama; dipakai nama terakhir.
 */
export function terlarisHari(nota: readonly NotaTutup[], batas = JUMLAH_TERLARIS): TerlarisTutup[] {
  const peta = new Map<string, TerlarisTutup>();
  for (const n of nota) {
    for (const b of n.baris) {
      const k = `${b.itemId}::${b.variantSku}`;
      const ada = peta.get(k);
      if (ada) {
        ada.qty += b.qty;
        ada.nama = b.productName;
      } else peta.set(k, { itemId: b.itemId, variantSku: b.variantSku, nama: b.productName, qty: b.qty });
    }
  }
  return [...peta.values()]
    .filter((x) => x.qty > 0)
    .sort((a, b) => b.qty - a.qty || a.nama.localeCompare(b.nama))
    .slice(0, batas);
}

export function susunRingkasanTutupHari(b: BahanTutupHari): RingkasanTutupHari {
  const angka = hitungAngkaPenjualan(
    b.nota.map((n) => ({ ...n, potong: potongNota(n) })),
    b.retur,
  );

  const per = new Map<string, PerSpgTutup>();
  for (const s of b.spg) per.set(s.id, { userId: s.id, nama: s.nama, nota: 0, potong: 0, nilai: 0 });
  for (const n of b.nota) {
    let x = per.get(n.salesmanId);
    if (!x) {
      x = { userId: n.salesmanId, nama: b.namaPengguna[n.salesmanId] ?? "—", nota: 0, potong: 0, nilai: 0 };
      per.set(n.salesmanId, x);
    }
    x.nota += 1;
    x.potong += potongNota(n);
    x.nilai += n.total;
  }
  const perSpg = [...per.values()]
    .map((x) => ({ ...x, nilai: bulat2(x.nilai) }))
    .sort((a, c) => c.nilai - a.nilai || c.nota - a.nota || a.nama.localeCompare(c.nama));

  return {
    storeId: b.storeId,
    namaToko: b.namaToko,
    day: b.day,
    ...angka,
    terlaris: terlarisHari(b.nota),
    kiriman: b.kiriman,
    dicari: b.dicari,
    perSpg,
  };
}

/**
 * Bentuk untuk HP SPG. Rupiah REKAN tidak pernah sampai ke HP (sama dengan
 * peringkat SPG): baris rekan hanya membawa jumlah nota dan potong. Angka toko
 * (milik toko SPG sendiri, yang ia laporkan) tetap ada — itulah yang dicocokkan
 * dengan kasir.
 */
export type PerSpgHp = { userId: string; nama: string; nota: number; potong: number; nilai: number | null; saya: boolean };
export type RingkasanTutupHp = Omit<RingkasanTutupHari, "perSpg"> & { perSpg: PerSpgHp[] };

export function ringkasanUntukHp(r: RingkasanTutupHari, userId: string): RingkasanTutupHp {
  return {
    ...r,
    perSpg: r.perSpg.map((x) => ({
      userId: x.userId,
      nama: x.nama,
      nota: x.nota,
      potong: x.potong,
      nilai: x.userId === userId ? x.nilai : null,
      saya: x.userId === userId,
    })),
  };
}

// ---------------------------------------------------------------------------
// Isian SPG
// ---------------------------------------------------------------------------

export type IsianTutupHari = { pengunjung: number | null; totalKasir: number | null; catatan: string | null; foto: string[] };
export type KodeTolakTutup =
  | "PENGUNJUNG_TIDAK_SAH"
  | "KASIR_TIDAK_SAH"
  | "CATATAN_TERLALU_PANJANG"
  | "FOTO_TIDAK_SAH"
  | "FOTO_TERLALU_BANYAK"
  | "FOTO_WAJIB";

const POLA_FOTO = /^\/api\/foto\/([A-Za-z0-9_-]{1,64})$/;

/** Id foto dari jalur foto milik aplikasi ini (`/api/foto/<id>`), atau null. */
export function idFotoTutup(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const m = POLA_FOTO.exec(url);
  return m ? m[1] : null;
}

/**
 * Periksa isian SPG terhadap pengaturan. Isian yang TIDAK ditanyakan pengaturan
 * dibuang (null), bukan ditolak — HP yang membuka formulir sebelum pengaturan
 * diubah tetap bisa mengirim. Isian yang ditanyakan boleh kosong (null).
 */
export function periksaIsianTutupHari(
  isi: { pengunjung?: unknown; totalKasir?: unknown; catatan?: unknown; foto?: unknown },
  aturan: AturanTutupHari,
): { ok: true; nilai: IsianTutupHari } | { ok: false; kode: KodeTolakTutup } {
  let pengunjung: number | null = null;
  if (aturan.tanyaPengunjung && isi.pengunjung !== null && isi.pengunjung !== undefined) {
    const n = isi.pengunjung;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > MAKS_PENGUNJUNG) return { ok: false, kode: "PENGUNJUNG_TIDAK_SAH" };
    pengunjung = n;
  }

  let totalKasir: number | null = null;
  if (aturan.tanyaTotalKasir && isi.totalKasir !== null && isi.totalKasir !== undefined) {
    const n = isi.totalKasir;
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > MAKS_TOTAL_KASIR) return { ok: false, kode: "KASIR_TIDAK_SAH" };
    totalKasir = bulat2(n);
  }

  let catatan: string | null = null;
  if (isi.catatan !== null && isi.catatan !== undefined) {
    if (typeof isi.catatan !== "string") return { ok: false, kode: "CATATAN_TERLALU_PANJANG" };
    const rapi = isi.catatan.trim();
    if (rapi.length > MAKS_CATATAN_TUTUP) return { ok: false, kode: "CATATAN_TERLALU_PANJANG" };
    catatan = rapi === "" ? null : rapi;
  }

  const mentah = isi.foto === null || isi.foto === undefined ? [] : isi.foto;
  if (!Array.isArray(mentah)) return { ok: false, kode: "FOTO_TIDAK_SAH" };
  if (mentah.some((u) => idFotoTutup(u) === null)) return { ok: false, kode: "FOTO_TIDAK_SAH" };
  const foto = [...new Set(mentah as string[])];
  if (foto.length > MAKS_FOTO_TUTUP) return { ok: false, kode: "FOTO_TERLALU_BANYAK" };
  if (aturan.wajibFoto && foto.length === 0) return { ok: false, kode: "FOTO_WAJIB" };

  return { ok: true, nilai: { pengunjung, totalKasir, catatan, foto } };
}

/** Total kasir − nilai bersih sistem; null kalau total kasir tidak diisi. */
export function selisihKasir(totalKasir: number | null | undefined, nilaiBersih: number): number | null {
  if (totalKasir === null || totalKasir === undefined) return null;
  return bulat2(totalKasir - nilaiBersih);
}

/** Selisih yang perlu ditandai: beda paling sedikit Rp 1 (pembulatan sen tidak dihitung). */
export function adaSelisih(selisih: number | null): boolean {
  return selisih !== null && Math.round(Math.abs(selisih)) >= 1;
}

/** Nota ÷ pengunjung dalam persen, satu desimal; null tanpa pengunjung. */
export function konversiPersen(nota: number, pengunjung: number | null | undefined): number | null {
  if (!pengunjung || pengunjung <= 0) return null;
  return Math.round((nota / pengunjung) * 1000) / 10;
}

/** Isi laporan yang disimpan — juga bentuk `before`/`after` di jejaknya. */
export type NilaiLaporanTutup = {
  closedById: string;
  notaCount: number;
  pcs: number;
  returnPcs: number;
  grossTotal: number;
  discountTotal: number;
  netTotal: number;
  visitorCount: number | null;
  cashierTotal: number | null;
  note: string | null;
  photoUrls: string[];
};

export function nilaiLaporan(closedById: string, r: AngkaPenjualan, isi: IsianTutupHari): NilaiLaporanTutup {
  return {
    closedById,
    notaCount: r.nota,
    pcs: r.potong,
    returnPcs: r.potongKembali,
    grossTotal: r.nilaiKotor,
    discountTotal: r.potongan,
    netTotal: r.nilaiBersih,
    visitorCount: isi.pengunjung,
    cashierTotal: isi.totalKasir,
    note: isi.catatan,
    photoUrls: isi.foto,
  };
}

/** Kolom laporan yang ditampilkan di riwayat kantor ("Pengunjung: 40 → 45"). */
export const KOLOM_PERUBAHAN = ["notaCount", "pcs", "netTotal", "visitorCount", "cashierTotal", "note", "photoUrls"] as const;
export type KolomPerubahan = (typeof KOLOM_PERUBAHAN)[number];
export type PerubahanLaporan = { kolom: KolomPerubahan; sebelum: string | number | null; sesudah: string | number | null };

/**
 * Apa yang berubah dari satu kiriman ke kiriman berikutnya. Foto dibandingkan
 * sebagai daftar tapi ditampilkan sebagai jumlah. Kiriman pertama (`before`
 * null) tidak punya perubahan — seluruh isinya adalah laporannya.
 */
export function perubahanLaporan(
  before: Partial<NilaiLaporanTutup> | null,
  after: Partial<NilaiLaporanTutup> | null,
): PerubahanLaporan[] {
  if (!before || !after) return [];
  const hasil: PerubahanLaporan[] = [];
  for (const k of KOLOM_PERUBAHAN) {
    if (k === "photoUrls") {
      const a = bacaFotoLaporan(before.photoUrls);
      const b = bacaFotoLaporan(after.photoUrls);
      if (a.length !== b.length || a.some((u, i) => u !== b[i])) hasil.push({ kolom: k, sebelum: a.length, sesudah: b.length });
      continue;
    }
    const a = before[k] ?? null;
    const b = after[k] ?? null;
    if (a !== b) hasil.push({ kolom: k, sebelum: a, sesudah: b });
  }
  return hasil;
}

/** Baca kolom `photoUrls` (JSON) yang tersimpan: hanya jalur foto yang sah. */
export function bacaFotoLaporan(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((u): u is string => idFotoTutup(u) !== null) : [];
}

// ---------------------------------------------------------------------------
// Pesan WhatsApp
// ---------------------------------------------------------------------------

export type BahanPesanTutup = {
  namaToko: string;
  day: string;
  nota: number;
  potong: number;
  potongKembali: number;
  nilaiBersih: number;
  potongan: number;
  terlaris: readonly { nama: string; qty: number }[];
  pengunjung: number | null;
  totalKasir: number | null;
  catatan: string | null;
};

/**
 * Laporan tutup hari untuk dibagikan lewat WhatsApp (ke grup toko / atasan).
 * SELALU Bahasa Indonesia — pembacanya bukan pengguna aplikasi. Hanya angka
 * toko; tidak pernah data pembeli (bahannya memang tidak membawanya) dan tidak
 * pernah rupiah per SPG.
 */
export function pesanTutupHariWa(b: BahanPesanTutup): string {
  const baris: string[] = [`*Laporan tutup hari — ${b.namaToko}*`, labelHariTutup(b.day), ""];
  baris.push(`Nota: ${b.nota}`);
  baris.push(`Terjual: ${b.potong} pcs`);
  if (b.potongKembali > 0) baris.push(`Dikembalikan pembeli: ${b.potongKembali} pcs`);
  baris.push(`Penjualan bersih: ${formatRupiah(b.nilaiBersih)}`);
  baris.push(`Potongan & diskon: ${formatRupiah(b.potongan)}`);

  if (b.terlaris.length > 0) {
    baris.push("", "Terlaris:");
    b.terlaris.forEach((x, i) => baris.push(`${i + 1}. ${x.nama} (${x.qty} pcs)`));
  }

  if (b.pengunjung !== null || b.totalKasir !== null) baris.push("");
  if (b.pengunjung !== null) {
    const k = konversiPersen(b.nota, b.pengunjung);
    baris.push(`Pengunjung: ${b.pengunjung}${k !== null ? ` (konversi ${String(k).replace(".", ",")}%)` : ""}`);
  }
  if (b.totalKasir !== null) {
    baris.push(`Total kasir toko: ${formatRupiah(b.totalKasir)}`);
    const s = selisihKasir(b.totalKasir, b.nilaiBersih);
    baris.push(adaSelisih(s) ? `Selisih dengan sistem: ${s! > 0 ? "+" : ""}${formatRupiah(s)}` : "Sesuai dengan sistem");
  }

  if (b.catatan) baris.push("", `Kendala hari ini: ${b.catatan}`);
  return baris.join("\n");
}

/** Tautan WhatsApp tanpa nomor: WhatsApp membuka pemilih kontak/grup. */
export function tautanWaTutup(teks: string): string {
  return `https://wa.me/?text=${encodeURIComponent(teks)}`;
}
