/**
 * "Toko mulai jarang pesan" — murni, supaya aturannya dites tanpa basis data.
 * Kuerinya (`tokoMenurun`) di `lib/salesman/queries.ts`.
 *
 * Dua tanda sebuah toko sedang menjauh, dinilai dari kebiasaan TOKO ITU
 * SENDIRI, bukan dari angka rata-rata semua toko: toko yang biasa pesan
 * sebulan sekali tidak "jarang" setelah tiga minggu, toko yang biasa pesan
 * seminggu sekali sudah.
 *
 * Semua "hari" di sini hari kalender WIB, sama dengan dasbor salesman.
 */

import { kunciHariWib } from "@/lib/dashboard/tren";
import { haversineMeters } from "@/lib/geo/haversine";
import { susunRencanaKunjungan, type BarisRencana, type TokoRencana } from "./dasbor";

const HARI_MS = 86_400_000;

// ─── Ambang ──────────────────────────────────────────────────────────────────

/**
 * Minimal hari-pesan sebelum toko dinilai. Dua hari pesan hanya memberi satu
 * jarak — itu kebetulan, belum kebiasaan.
 */
export const MIN_HARI_PESAN = 3;
/** JARANG: diam lebih dari 1,5 × jarak biasanya. */
export const KALI_JARAK_BIASA = 1.5;
/**
 * JARANG juga butuh paling sedikit dua minggu diam — toko yang biasa pesan
 * tiap 5 hari tidak perlu dikejar setelah 8 hari.
 */
export const MIN_HARI_JARANG = 14;
/** Panjang tiap jendela nilai: 90 hari terakhir dibanding 90 hari sebelumnya. */
export const HARI_JENDELA_NILAI = 90;
/** NILAI_TURUN: nilai 90 hari terakhir di bawah separuh 90 hari sebelumnya. */
export const RASIO_NILAI_TURUN = 0.5;

// ─── Penilaian satu toko ─────────────────────────────────────────────────────

/** Satu pesanan toko. `nilai` null = belum diketahui (mis. konsi belum disetujui) — hanya dihitung frekuensinya. */
export type PesananToko = { tanggal: Date; nilai: number | null };

export type AlasanMenurun = "JARANG" | "NILAI_TURUN";

export type HasilMenurun = {
  alasan: AlasanMenurun;
  hariSejakTerakhir: number;
  /** Median jarak antarhari-pesan, dibulatkan ke hari. */
  jarakBiasa: number;
  /** Jumlah nilai yang diketahui di 90 hari terakhir; null bila tidak ada satu pun. */
  nilai90: number | null;
  /** Sama, untuk 90 hari sebelumnya. */
  nilai90Sebelumnya: number | null;
};

/** Toko yang ditandai, siap dikirim ke klien (tanpa Date — aman jadi JSON). */
export type TokoMenurun = HasilMenurun & { storeId: string; nama: string };

/** Hari kalender WIB sebagai angka hari sejak epoch — selisihnya selisih hari kalender, bukan 24 jam. */
function nomorHari(d: Date): number {
  return Math.round(Date.parse(`${kunciHariWib(d)}T00:00:00Z`) / HARI_MS);
}

function median(angka: number[]): number {
  const urut = [...angka].sort((a, b) => a - b);
  const tengah = Math.floor(urut.length / 2);
  // Dibulatkan, sama dengan `polaPesanan`: angka yang dilihat salesman
  // ("tiap 16 hari") adalah angka yang dipakai aturan, jadi hitungannya bisa ia ulang sendiri.
  return urut.length % 2 ? urut[tengah] : Math.round((urut[tengah - 1] + urut[tengah]) / 2);
}

/**
 * Apakah toko ini mulai menjauh, dan kenapa. null = tidak (atau riwayatnya
 * belum cukup untuk menilai).
 *
 * - Beberapa pesanan di hari WIB yang sama dihitung SATU hari pesan: dua
 *   kiriman sehari bukan dua kebiasaan.
 * - JARANG dinilai dengan MEDIAN jarak, bukan rata-rata: satu jeda panjang
 *   (toko tutup lebaran) tidak menggeser kebiasaannya.
 * - NILAI_TURUN hanya bila kedua jendela berisi pesanan bernilai, pembandingnya
 *   di atas nol, dan TIDAK ada pesanan 90 hari terakhir yang nilainya belum
 *   diketahui — pesanan konsi yang belum disetujui bisa saja menutup
 *   selisihnya. Nilai yang belum diketahui di jendela LAMA cukup dilewati:
 *   pembandingnya mengecil, jadi toko hanya makin sulit ditandai, tidak
 *   pernah makin mudah.
 * - Kalau keduanya berlaku, JARANG yang dipakai: toko yang berhenti pesan
 *   lebih mendesak daripada toko yang pesannya mengecil.
 */
export function nilaiTokoMenurun(pesanan: readonly PesananToko[], hariIni: Date): HasilMenurun | null {
  const hariIniNo = nomorHari(hariIni);

  // Satu entri per hari pesan. Pesanan bertanggal sesudah hari ini diabaikan —
  // tanggal yang salah ketik tidak boleh membuat "diam" bernilai negatif.
  const perHari = new Map<number, { nilai: number; adaNilai: boolean; adaTakDiketahui: boolean }>();
  for (const p of pesanan) {
    const no = nomorHari(p.tanggal);
    if (no > hariIniNo) continue;
    const h = perHari.get(no) ?? { nilai: 0, adaNilai: false, adaTakDiketahui: false };
    if (p.nilai === null) h.adaTakDiketahui = true;
    else {
      h.nilai += p.nilai;
      h.adaNilai = true;
    }
    perHari.set(no, h);
  }

  const hari = [...perHari.keys()].sort((a, b) => a - b);
  if (hari.length < MIN_HARI_PESAN) return null;

  const jarakBiasa = median(hari.slice(1).map((h, i) => h - hari[i]));
  const hariSejakTerakhir = hariIniNo - hari[hari.length - 1];

  // Jendela: 0–89 hari lalu = "90 hari terakhir", 90–179 = sebelumnya.
  const jendela = (dari: number, sampai: number) => {
    let nilai = 0;
    let adaNilai = false;
    let adaTakDiketahui = false;
    for (const [no, h] of perHari) {
      const lalu = hariIniNo - no;
      if (lalu < dari || lalu >= sampai) continue;
      nilai += h.nilai;
      adaNilai ||= h.adaNilai;
      adaTakDiketahui ||= h.adaTakDiketahui;
    }
    return { nilai: adaNilai ? nilai : null, adaTakDiketahui };
  };
  const baru = jendela(0, HARI_JENDELA_NILAI);
  const lama = jendela(HARI_JENDELA_NILAI, 2 * HARI_JENDELA_NILAI);

  const jarang = hariSejakTerakhir > KALI_JARAK_BIASA * jarakBiasa && hariSejakTerakhir >= MIN_HARI_JARANG;
  const turun =
    !baru.adaTakDiketahui &&
    baru.nilai !== null &&
    lama.nilai !== null &&
    lama.nilai > 0 &&
    baru.nilai < RASIO_NILAI_TURUN * lama.nilai;

  if (!jarang && !turun) return null;
  return {
    alasan: jarang ? "JARANG" : "NILAI_TURUN",
    hariSejakTerakhir,
    jarakBiasa,
    nilai90: baru.nilai,
    nilai90Sebelumnya: lama.nilai,
  };
}

/** Berapa persen nilai 90 hari terakhir turun dari 90 hari sebelumnya; null bila tidak bisa dibandingkan. */
export function persenTurun(h: Pick<HasilMenurun, "nilai90" | "nilai90Sebelumnya">): number | null {
  if (h.nilai90 === null || h.nilai90Sebelumnya === null || h.nilai90Sebelumnya <= 0) return null;
  return Math.round((1 - h.nilai90 / h.nilai90Sebelumnya) * 100);
}

// ─── Urutan ──────────────────────────────────────────────────────────────────

/** Seberapa terlambat: lama diam dibagi jarak biasanya (2 = sudah dua kali jarak biasanya). */
function kaliTerlambat(h: HasilMenurun): number {
  return h.hariSejakTerakhir / Math.max(1, h.jarakBiasa);
}

/**
 * Yang paling terlambat dulu. JARANG di depan (tokonya berhenti pesan),
 * diurutkan menurut kelipatan jarak biasanya — 30 hari diam pada toko
 * mingguan lebih genting daripada 60 hari pada toko bulanan. Lalu NILAI_TURUN,
 * yang turunnya paling tajam dulu.
 */
function bandingkanMenurun(a: HasilMenurun, b: HasilMenurun): number {
  if (a.alasan !== b.alasan) return a.alasan === "JARANG" ? -1 : 1;
  if (a.alasan === "JARANG") {
    const beda = kaliTerlambat(b) - kaliTerlambat(a);
    return beda !== 0 ? beda : b.hariSejakTerakhir - a.hariSejakTerakhir;
  }
  const rasio = (h: HasilMenurun) => (h.nilai90 ?? 0) / Math.max(1, h.nilai90Sebelumnya ?? 1);
  return rasio(a) - rasio(b);
}

export function urutkanTokoMenurun<T extends HasilMenurun>(daftar: readonly T[]): T[] {
  return [...daftar].sort(bandingkanMenurun);
}

// ─── Rencana kunjungan ───────────────────────────────────────────────────────

export type BarisRencanaMenurun = BarisRencana & { menurun: TokoMenurun | null };

/**
 * Rencana kunjungan (`susunRencanaKunjungan`) ditambah toko yang mulai jarang
 * pesan.
 *
 * Urutan: tagihan lewat janji dulu (uang yang terlambat makin sulit ditagih),
 * lalu toko yang menurun — yang belum masuk rencana karena baru saja
 * dikunjungi pun ikut, karena "baru dikunjungi" tidak sama dengan "masih
 * pesan" — lalu kunjungan yang sekadar lewat batas hari. Di dalam kelompok
 * menurun: yang terdekat dulu kalau HP tahu posisinya, kalau tidak yang paling
 * terlambat. Toko yang menurun tapi bukan toko salesman ini diabaikan.
 */
export function susunRencanaDenganMenurun(
  toko: readonly TokoRencana[],
  menurun: readonly TokoMenurun[],
  opsi: { batasHari: number; hariIni: Date; posisi?: { lat: number; lng: number } | null },
): BarisRencanaMenurun[] {
  const tanda = new Map(menurun.map((m) => [m.storeId, m]));
  const dasar = susunRencanaKunjungan(toko, opsi);
  const sudahAda = new Set(dasar.map((b) => b.storeId));

  const baris: BarisRencanaMenurun[] = dasar.map((b) => ({ ...b, menurun: tanda.get(b.storeId) ?? null }));
  for (const t of toko) {
    const m = tanda.get(t.storeId);
    if (!m || sudahAda.has(t.storeId)) continue;
    baris.push({
      ...t,
      // Bukan tagihan dan belum lewat batas kunjungan — hanya menurun.
      alasan: [],
      hariSejak: t.kunjunganTerakhir ? nomorHari(opsi.hariIni) - nomorHari(t.kunjunganTerakhir) : null,
      jarakMeter:
        opsi.posisi && t.lat !== null && t.lng !== null
          ? Math.round(haversineMeters(opsi.posisi, { lat: t.lat, lng: t.lng }))
          : null,
      menurun: m,
    });
  }

  const kelompok = (b: BarisRencanaMenurun) => (b.alasan.includes("tagih") ? 0 : b.menurun ? 1 : 2);
  const urutanMenurun = new Map(urutkanTokoMenurun(menurun).map((m, i) => [m.storeId, i]));

  return baris.sort((a, b) => {
    const k = kelompok(a) - kelompok(b);
    if (k !== 0) return k;
    if (kelompok(a) === 1) {
      if (opsi.posisi && (a.jarakMeter !== null || b.jarakMeter !== null)) {
        if (a.jarakMeter === null) return 1;
        if (b.jarakMeter === null) return -1;
        if (a.jarakMeter !== b.jarakMeter) return a.jarakMeter - b.jarakMeter;
      }
      return (urutanMenurun.get(a.storeId) ?? 0) - (urutanMenurun.get(b.storeId) ?? 0);
    }
    // Tagihan dan kunjungan biasa tetap dalam urutan `susunRencanaKunjungan`
    // (aturannya sendiri, dites) — `sort` stabil, jadi 0 mempertahankannya.
    return 0;
  });
}

/**
 * Angka untuk daftar tugas beranda: setiap toko dihitung SEKALI, di baris
 * paling mendesaknya. Toko bertagihan sudah dihitung di baris "lewat janji
 * bayar"; toko menurun tidak dihitung lagi sebagai "perlu dikunjungi".
 */
export function hitungTugasRencana(baris: readonly BarisRencanaMenurun[]): { menurun: number; kunjungan: number } {
  let menurun = 0;
  let kunjungan = 0;
  for (const b of baris) {
    if (b.alasan.includes("tagih")) continue;
    if (b.menurun) menurun += 1;
    else kunjungan += 1;
  }
  return { menurun, kunjungan };
}
