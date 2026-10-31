/**
 * "Yang perlu ditawarkan di toko ini" — aturan murni, tanpa AI dan tanpa basis
 * data, supaya setiap saran bisa dijelaskan dengan satu kalimat dan angkanya.
 * Kuerinya di `saran-tawar-queries.ts`.
 *
 * Tiga alasan, dari yang paling kuat:
 *   ANDALAN_TOKO  — barang yang biasa dibeli toko INI, tapi sudah lebih lama
 *                   dari kebiasaannya tidak dipesan lagi. Kebiasaan toko sendiri
 *                   adalah petunjuk terkuat, jadi alasan ini menang kalau satu
 *                   barang lolos lebih dari satu aturan.
 *   LARIS_DI_AREA — laris di toko sejenis (se-area) dalam 90 hari terakhir,
 *                   tapi toko ini belum pernah memesannya atau sudah lama tidak.
 *   BARU          — barang baru yang belum pernah dikirim ke toko ini.
 *
 * Barang yang stok gudangnya habis TIDAK PERNAH disarankan: menawarkan barang
 * yang tidak bisa dikirim hanya membuat salesman menjanjikan sesuatu yang
 * nanti ditolak gudang.
 *
 * Semua "hari" di sini hari kalender WIB, sama dengan dasbor salesman.
 */

import { kunciHariWib } from "@/lib/dashboard/tren";
import { polaPesanan } from "./dasbor";

const HARI_MS = 86_400_000;

// ─── Ambang (sengaja konstanta bernama, supaya mudah dicari dan diubah) ───────

/** Jendela penjualan toko sejenis untuk alasan LARIS_DI_AREA. */
export const HARI_AREA = 90;
/** LARIS_DI_AREA hanya untuk barang yang tidak dipesan toko ini selama ini. */
export const HARI_TIDAK_DIPESAN = 120;
/**
 * Minimal potongan terjual di toko sejenis supaya disebut "laris". Enam kira-kira
 * satu pak ukuran — di bawah itu satu pembeli iseng sudah cukup membuat barang
 * tampak laris.
 */
export const MIN_PCS_LARIS = 6;
/** Riwayat pesanan toko sendiri untuk menilai barang andalannya. */
export const HARI_RIWAYAT = 365;
/** Barang andalan = sekian barang teratas toko ini menurut jumlah potongan. */
export const BATAS_ANDALAN_TERATAS = 10;
/** Andalan butuh kebiasaan: minimal dua pesanan di hari yang berbeda. */
export const MIN_PESANAN_ANDALAN = 2;
/**
 * Andalan dianggap terlambat bila sudah lebih dari 1,2× jeda biasanya tidak
 * dipesan. Kelonggaran 20% menyerap kunjungan yang mundur beberapa hari — tanpa
 * itu toko yang biasa pesan tiap 30 hari sudah "terlambat" di hari ke-31.
 */
export const FAKTOR_LEWAT_JEDA = 1.2;
/** Barang yang dipesan kurang dari dua minggu lalu tidak ditawarkan ulang, berapa pun jedanya. */
export const MIN_HARI_SEJAK_ANDALAN = 14;
/** Bawaan `SystemSetting["konsi.newItemDays"]`: kira-kira satu musim pakaian. */
export const HARI_BARU_BAWAAN = 90;
/** Batas atas pengaturan hari barang baru, supaya jendela kueri tidak liar. */
export const HARI_BARU_MAKS = 3650;
/** Jumlah saran paling banyak. */
export const BATAS_SARAN = 10;

// ─── Bentuk data ──────────────────────────────────────────────────────────────

export type AlasanSaran = "ANDALAN_TOKO" | "LARIS_DI_AREA" | "BARU";

/** Satu pesanan satu barang di toko ini: tanggal pesanannya dan potongannya. */
export type BeliToko = { itemId: string; tanggal: Date; pcs: number };

/** Penjualan barang di toko sejenis dalam jendela `HARI_AREA`; `toko` = berapa toko yang menjualnya. */
export type JualSejenis = { itemId: string; pcs: number; toko: number };

/** Barang yang boleh ditawarkan: stok tersedia gudang (on hand − dipesan) dan tanggal dibuatnya. */
export type BarangTersedia = { itemId: string; tersedia: number; dibuat: Date };

export type BahanSaranTawar = {
  beliToko: BeliToko[];
  jualSejenis: JualSejenis[];
  barang: BarangTersedia[];
  /** Umur maksimal barang "baru" dalam hari. */
  hariBaru: number;
};

type Dasar = { itemId: string; tersedia: number };

export type SaranTawar =
  | (Dasar & {
      alasan: "ANDALAN_TOKO";
      /** Median jeda antarpesanan barang ini di toko ini (hari). */
      jedaBiasa: number;
      hariSejakPesan: number;
      /** Potongan barang ini yang dibeli toko dalam riwayat. */
      pcsRiwayat: number;
    })
  | (Dasar & {
      alasan: "LARIS_DI_AREA";
      pcs: number;
      toko: number;
      /** null = tidak dipesan toko ini selama riwayat yang dibaca. */
      hariSejakPesan: number | null;
    })
  | (Dasar & { alasan: "BARU"; umurHari: number });

// ─── Aturan ───────────────────────────────────────────────────────────────────

/** `SystemSetting["konsi.newItemDays"]` → hari. Kosong atau rusak → bawaan. */
export function bacaHariBaru(nilai: string | null | undefined): number {
  const s = (nilai ?? "").trim();
  if (!/^\d+$/.test(s)) return HARI_BARU_BAWAAN;
  const n = Number(s);
  if (n < 1) return HARI_BARU_BAWAAN;
  return Math.min(n, HARI_BARU_MAKS);
}

/** Selisih hari kalender WIB; tanggal di masa depan (jam meleset) dihitung 0. */
function hariSejak(tanggal: Date, hariIni: Date): number {
  const a = Date.parse(`${kunciHariWib(tanggal)}T00:00:00Z`);
  const b = Date.parse(`${kunciHariWib(hariIni)}T00:00:00Z`);
  return Math.max(0, Math.round((b - a) / HARI_MS));
}

type Riwayat = { pcs: number; hari: Map<string, Date> };

function kumpulkanRiwayat(beli: readonly BeliToko[]): Map<string, Riwayat> {
  const per = new Map<string, Riwayat>();
  for (const b of beli) {
    let r = per.get(b.itemId);
    if (!r) {
      r = { pcs: 0, hari: new Map() };
      per.set(b.itemId, r);
    }
    r.pcs += b.pcs;
    // Satu hari satu peristiwa: dua pesanan di hari yang sama bukan dua kebiasaan,
    // dan jeda 0 hari hanya menyeret median ke bawah.
    const k = kunciHariWib(b.tanggal);
    if (!r.hari.has(k)) r.hari.set(k, b.tanggal);
  }
  return per;
}

/**
 * Bulan-bulan yang bersinggungan dengan jendela `hari` hari terakhir (hari
 * kalender WIB), masing-masing dengan porsi hari bulan itu yang masuk jendela.
 *
 * Dipakai untuk laporan penjualan konsinyasi, yang hanya ada per bulan: bulan
 * di tepi jendela ikut sebanding porsinya, bukan utuh — kalau utuh, toko
 * konsinyasi tampak menjual sampai sepertiga lebih banyak dari toko lain di
 * jendela yang sama.
 */
export function porsiBulan(hariIni: Date, hari: number): { tahun: number; bulan: number; porsi: number }[] {
  const akhir = kunciHariWib(hariIni);
  const awal = kunciHariWib(new Date(hariIni.getTime() - hari * HARI_MS));
  const dua = (n: number) => String(n).padStart(2, "0");
  const [thAkhir, blAkhir] = akhir.split("-").map(Number);
  let [th, bl] = awal.split("-").map(Number);
  const hasil: { tahun: number; bulan: number; porsi: number }[] = [];
  while (th < thAkhir || (th === thAkhir && bl <= blAkhir)) {
    const hariBulan = new Date(Date.UTC(th, bl, 0)).getUTCDate();
    const mulai = `${th}-${dua(bl)}-01`;
    const selesai = `${th}-${dua(bl)}-${dua(hariBulan)}`;
    // Tanggal ISO (YYYY-MM-DD) bisa dibandingkan sebagai teks.
    const a = mulai > awal ? mulai : awal;
    const b = selesai < akhir ? selesai : akhir;
    const masuk = Math.round((Date.parse(b) - Date.parse(a)) / HARI_MS) + 1;
    hasil.push({ tahun: th, bulan: bl, porsi: masuk / hariBulan });
    bl += 1;
    if (bl > 12) {
      bl = 1;
      th += 1;
    }
  }
  return hasil;
}

/** Barang baru yang ada stoknya, terbaru dulu — dipakai juga untuk pilihan awal "Kirim katalog". */
export function barangBaru(
  barang: readonly BarangTersedia[],
  hariIni: Date,
  hariBaru: number,
): { itemId: string; umurHari: number }[] {
  return barang
    .filter((b) => b.tersedia > 0)
    .map((b) => ({ itemId: b.itemId, umurHari: hariSejak(b.dibuat, hariIni) }))
    .filter((b) => b.umurHari <= hariBaru)
    .sort((a, b) => a.umurHari - b.umurHari || a.itemId.localeCompare(b.itemId));
}

/**
 * Susun saran, satu barang satu kali, paling banyak `batas`.
 *
 * Urutannya bergiliran antaralasan (andalan, laris, baru, andalan, …), bukan
 * satu skor gabungan: skor gabungan dari tiga ukuran yang berbeda sifatnya
 * tidak bisa dijelaskan ke salesman, dan tanpa giliran sepuluh barang laris
 * bisa menutupi satu-satunya barang andalan toko yang terlupa.
 */
export function susunSaranTawar(
  bahan: BahanSaranTawar,
  hariIni: Date,
  opsi: { batas?: number } = {},
): SaranTawar[] {
  const batas = opsi.batas ?? BATAS_SARAN;
  const stok = new Map<string, number>();
  for (const b of bahan.barang) if (b.tersedia > 0) stok.set(b.itemId, b.tersedia);

  const riwayat = kumpulkanRiwayat(bahan.beliToko);
  const terakhirSejak = (itemId: string): number | null => {
    const r = riwayat.get(itemId);
    if (!r) return null;
    const tanggal = [...r.hari.values()];
    return polaPesanan(tanggal, hariIni).hariSejak;
  };

  // ANDALAN_TOKO — barang teratas toko ini (terlepas dari stoknya: "andalan"
  // adalah sifat riwayat toko), lalu yang terlambat dan masih ada stoknya.
  const teratas = [...riwayat]
    .sort(([ia, a], [ib, b]) => b.pcs - a.pcs || ia.localeCompare(ib))
    .slice(0, BATAS_ANDALAN_TERATAS);
  const andalan: Extract<SaranTawar, { alasan: "ANDALAN_TOKO" }>[] = [];
  for (const [itemId, r] of teratas) {
    const tersedia = stok.get(itemId);
    if (tersedia === undefined || r.hari.size < MIN_PESANAN_ANDALAN) continue;
    const pola = polaPesanan([...r.hari.values()], hariIni);
    if (pola.jedaMedian === null || pola.hariSejak === null || pola.jedaMedian < 1) continue;
    if (pola.hariSejak < MIN_HARI_SEJAK_ANDALAN) continue;
    if (pola.hariSejak <= pola.jedaMedian * FAKTOR_LEWAT_JEDA) continue;
    andalan.push({
      itemId,
      alasan: "ANDALAN_TOKO",
      tersedia,
      jedaBiasa: pola.jedaMedian,
      hariSejakPesan: pola.hariSejak,
      pcsRiwayat: r.pcs,
    });
  }
  // Yang paling terlambat dibanding kebiasaannya sendiri paling depan.
  const rasio = (a: (typeof andalan)[number]) => a.hariSejakPesan / a.jedaBiasa;
  andalan.sort((a, b) => rasio(b) - rasio(a) || b.pcsRiwayat - a.pcsRiwayat || a.itemId.localeCompare(b.itemId));
  const sudah = new Set(andalan.map((a) => a.itemId));

  // LARIS_DI_AREA
  const laris: Extract<SaranTawar, { alasan: "LARIS_DI_AREA" }>[] = [];
  for (const j of bahan.jualSejenis) {
    const tersedia = stok.get(j.itemId);
    if (tersedia === undefined || sudah.has(j.itemId) || j.pcs < MIN_PCS_LARIS) continue;
    const sejak = terakhirSejak(j.itemId);
    if (sejak !== null && sejak <= HARI_TIDAK_DIPESAN) continue;
    laris.push({ itemId: j.itemId, alasan: "LARIS_DI_AREA", tersedia, pcs: j.pcs, toko: j.toko, hariSejakPesan: sejak });
  }
  laris.sort((a, b) => b.pcs - a.pcs || b.toko - a.toko || a.itemId.localeCompare(b.itemId));
  for (const l of laris) sudah.add(l.itemId);

  // BARU — hanya yang belum pernah dikirim ke toko ini.
  const baru: Extract<SaranTawar, { alasan: "BARU" }>[] = barangBaru(bahan.barang, hariIni, bahan.hariBaru)
    .filter((b) => !sudah.has(b.itemId) && !riwayat.has(b.itemId))
    .map((b) => ({ itemId: b.itemId, alasan: "BARU", tersedia: stok.get(b.itemId) as number, umurHari: b.umurHari }));

  const daftar: SaranTawar[][] = [andalan, laris, baru];
  const hasil: SaranTawar[] = [];
  for (let i = 0; hasil.length < batas && daftar.some((d) => i < d.length); i++) {
    for (const d of daftar) {
      if (i < d.length && hasil.length < batas) hasil.push(d[i]);
    }
  }
  return hasil;
}
