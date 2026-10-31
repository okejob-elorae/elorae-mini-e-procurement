/**
 * Kinerja SPG (kantor, `/backoffice/kinerja-spg`) — aturan murni, tanpa basis
 * data, supaya bisa dites.
 *
 * Satu baris tabel = satu SPG × satu toko × satu bulan WIB. Biasanya satu
 * baris per SPG; SPG yang dipindah toko di tengah bulan mendapat satu baris per
 * toko, dan setiap baris hanya memuat kejadian di toko itu.
 *
 * Kehadiran membaca kenyataan dengan aturan yang SAMA dengan layar Jadwal SPG
 * (`nilaiKenyataan` di `shift.ts`): terlambat = check-in pertama hari itu
 * LEBIH dari mulai shift + toleransi, menitnya dihitung dari jam mulai; KERJA
 * di hari lalu tanpa check-in dan tanpa izin = tidak masuk. Tanpa jadwal yang
 * disusun, kolom jadwal tidak bisa dihitung — tampil "—", bukan 0.
 *
 * Penjualan bersih dari barang yang dikembalikan pembeli dengan aturan yang
 * SAMA dengan target dan beranda SPG (`dokumenSpg`): retur mengurangi bulan
 * NOTANYA.
 */

import { hariKerja } from "@/lib/salesman/izin";
import { nilaiKenyataan, type Kenyataan } from "./shift";

const JENIS_IZIN = new Set(["IZIN", "SAKIT", "CUTI"]);

// ─── Satu hari ───────────────────────────────────────────────────────────────

export type MasukanHari = {
  day: string;
  /** Baris `SpgShift` hari itu DI TOKO INI (KERJA/LIBUR), atau null. */
  sel: { kind: string; startTime: string | null } | null;
  /** Check-in pertama hari itu di toko ini. */
  checkin: Date | null;
  /** Jenis izin yang DISETUJUI pada hari itu, atau null. */
  izin: string | null;
};

export type KesimpulanHari = {
  kenyataan: Kenyataan | null;
  /** Dijadwalkan KERJA dan harinya sudah tiba. */
  dijadwalkan: boolean;
  /** Ada check-in di toko ini. */
  masuk: boolean;
  /** Menit terlambat (dari jam mulai shift) bila terlambat, selain itu null. */
  terlambatMenit: number | null;
  /** KERJA di hari yang sudah lewat, tanpa check-in, tanpa izin disetujui. */
  tidakMasuk: boolean;
  /** Hari izin yang DIHITUNG: hari kerja, tidak masuk, izinnya disetujui. */
  izin: string | null;
  /** Ditetapkan LIBUR. */
  libur: boolean;
};

/**
 * Kesimpulan satu hari satu SPG di satu toko. Hari depan tidak dinilai.
 *
 * Hari izin dihitung hanya di HARI KERJA: hari yang dijadwalkan KERJA, atau —
 * bila hari itu tidak dijadwalkan — hari kerja SPG menurut pengaturan
 * (`liburSpg` = hari dalam seminggu yang bukan hari kerja SPG). Izin yang
 * menutupi hari LIBUR tidak mengurangi apa pun. Check-in di hari izin = masuk
 * (orangnya datang), sama dengan rekap absen.
 */
export function simpulkanHari(
  m: MasukanHari & { hariIni: string; sekarang: Date; toleransiMenit: number; liburSpg: readonly number[] },
): KesimpulanHari {
  const lewat = m.day <= m.hariIni;
  const kenyataan = lewat
    ? nilaiKenyataan({
        day: m.day,
        hariIni: m.hariIni,
        sekarang: m.sekarang,
        sel: m.sel,
        checkin: m.checkin,
        izin: m.izin,
        toleransiMenit: m.toleransiMenit,
      })
    : null;
  const kerja = m.sel?.kind === "KERJA" && !!m.sel.startTime;
  const libur = m.sel?.kind === "LIBUR";
  const izinSah = m.izin && JENIS_IZIN.has(m.izin) ? m.izin : null;
  const hariKerjaIni = kerja || (!m.sel && hariKerja(m.day, m.liburSpg));
  return {
    kenyataan,
    dijadwalkan: kerja && lewat,
    masuk: lewat && m.checkin !== null,
    terlambatMenit: kenyataan?.status === "TERLAMBAT" ? kenyataan.menit : null,
    tidakMasuk: kenyataan?.status === "TIDAK_MASUK",
    izin: lewat && !m.checkin && izinSah && hariKerjaIni && !libur ? izinSah : null,
    libur,
  };
}

// ─── Pengunjung satu hari satu toko ──────────────────────────────────────────

export type PengunjungSpgHari = { jumlah: number; dariTutup: boolean };

/**
 * Pengunjung per SPG pada satu hari di satu toko.
 *
 * Sumber utama: penghitung di HP (`SpgVisitorCount`, per SPG). Kalau laporan
 * tutup hari mencatat pengunjung LEBIH banyak dari jumlah semua penghitung,
 * selisihnya dibagi rata (sisa terbesar, urut id — selalu sama) ke SPG yang
 * hadir hari itu tetapi tidak menghitung. Toko yang tidak memakai penghitung
 * sama sekali jadi memakai angka tutup harinya, dibagi rata antar SPG yang
 * hadir. SPG hadir tanpa hitungan dan tanpa sisa = tidak diketahui (tidak ada
 * di hasil), bukan 0 — 0 berarti dihitung dan memang tidak ada pengunjung.
 */
export function bagiPengunjungHari(m: {
  hitungan: ReadonlyMap<string, number>;
  tutup: number | null;
  hadir: readonly string[];
}): Map<string, PengunjungSpgHari> {
  const hasil = new Map<string, PengunjungSpgHari>();
  let jumlahHitungan = 0;
  for (const [userId, n] of m.hitungan) {
    hasil.set(userId, { jumlah: n, dariTutup: false });
    jumlahHitungan += n;
  }
  const sisa = m.tutup === null ? 0 : Math.max(0, m.tutup - jumlahHitungan);
  const penerima = [...new Set(m.hadir)].filter((u) => !m.hitungan.has(u)).sort();
  if (sisa > 0 && penerima.length > 0) {
    const dasar = Math.floor(sisa / penerima.length);
    const lebih = sisa % penerima.length;
    penerima.forEach((u, i) => hasil.set(u, { jumlah: dasar + (i < lebih ? 1 : 0), dariTutup: true }));
  }
  return hasil;
}

// ─── Satu baris (SPG × toko × bulan) ────────────────────────────────────────

export type HariKinerja = KesimpulanHari & {
  day: string;
  nota: number;
  /** Potong terjual bersih dari barang yang dikembalikan pembeli. */
  potong: number;
  /** Nilai bersih nota hari itu, dalam sen. */
  nilaiSen: number;
  /** Pengunjung yang dicatat untuk SPG ini hari itu; null = tidak diketahui. */
  pengunjung: number | null;
  pengunjungDariTutup: boolean;
  /** Toko punya laporan tutup hari untuk hari itu. */
  tutup: boolean;
};

export type LainKinerja = {
  /** Ada baris `SpgShift` di toko ini untuk hari yang sudah tiba. */
  jadwalDisusun: boolean;
  titipDibuat: number;
  titipSelesai: number;
  /** Potong di nota bulan ini (kotor) dan yang dikembalikan pembeli. */
  qtyTerjual: number;
  qtyKembali: number;
  /** Target bulanan orangnya (`salesman.targets`), null = belum ditetapkan. */
  target: number | null;
  /** Penjualan bersih orangnya bulan ini di SEMUA toko — angka "Bulan ini" di berandanya. */
  nilaiOrang: number;
  /** Nota bulan ini di toko ini yang mencatat pembelinya (`SpgSale.customerId`). */
  notaBerpembeli: number;
  /** Member yang ia daftarkan di toko ini bulan ini (`Member.joinedById`). */
  memberBaru: number;
};

export type RingkasKinerja = {
  jadwalDisusun: boolean;
  /** Kolom jadwal null = jadwal belum disusun (tampil "—"). */
  hariDijadwalkan: number | null;
  hariMasuk: number;
  terlambatKali: number | null;
  terlambatMenit: number | null;
  tidakMasuk: number | null;
  hariIzin: number;
  nota: number;
  potong: number;
  nilai: number;
  rataNota: number | null;
  /** null = tidak ada hari dengan angka pengunjung. */
  pengunjung: number | null;
  hariPengunjungDariTutup: number;
  /** Nota ÷ pengunjung, hanya pada hari yang angka pengunjungnya ada (%). */
  konversiPersen: number | null;
  hariJual: number;
  hariJualDitutup: number;
  /** Hari ada laporan tutup hari ÷ hari ada penjualan (%). */
  kepatuhanTutupPersen: number | null;
  titipDibuat: number;
  titipSelesai: number;
  qtyTerjual: number;
  qtyKembali: number;
  /** Potong dikembalikan pembeli ÷ potong di nota (%). */
  persenKembali: number | null;
  target: number | null;
  nilaiOrang: number;
  capaianPersen: number | null;
  notaBerpembeli: number;
  /** Nota berpembeli ÷ nota (%), null tanpa nota. */
  persenBerpembeli: number | null;
  memberBaru: number;
};

const persen = (a: number, b: number): number | null => (b > 0 ? (a / b) * 100 : null);

/** Ringkas hari-hari satu baris menjadi kolom-kolom tabel kantor. */
export function ringkasKinerja(hari: readonly HariKinerja[], lain: LainKinerja): RingkasKinerja {
  let hariDijadwalkan = 0;
  let hariMasuk = 0;
  let terlambatKali = 0;
  let terlambatMenit = 0;
  let tidakMasuk = 0;
  let hariIzin = 0;
  let nota = 0;
  let potong = 0;
  let nilaiSen = 0;
  let pengunjung = 0;
  let adaPengunjung = false;
  let hariDariTutup = 0;
  let notaTerhitung = 0;
  let hariJual = 0;
  let hariJualDitutup = 0;
  for (const h of hari) {
    if (h.dijadwalkan) hariDijadwalkan += 1;
    if (h.masuk) hariMasuk += 1;
    if (h.terlambatMenit !== null) {
      terlambatKali += 1;
      terlambatMenit += h.terlambatMenit;
    }
    if (h.tidakMasuk) tidakMasuk += 1;
    if (h.izin) hariIzin += 1;
    nota += h.nota;
    potong += h.potong;
    nilaiSen += h.nilaiSen;
    if (h.pengunjung !== null) {
      adaPengunjung = true;
      pengunjung += h.pengunjung;
      if (h.pengunjungDariTutup) hariDariTutup += 1;
      if (h.pengunjung > 0) notaTerhitung += h.nota;
    }
    if (h.nota > 0) {
      hariJual += 1;
      if (h.tutup) hariJualDitutup += 1;
    }
  }
  const nilai = nilaiSen / 100;
  const j = lain.jadwalDisusun;
  return {
    jadwalDisusun: j,
    hariDijadwalkan: j ? hariDijadwalkan : null,
    hariMasuk,
    terlambatKali: j ? terlambatKali : null,
    terlambatMenit: j ? terlambatMenit : null,
    tidakMasuk: j ? tidakMasuk : null,
    hariIzin,
    nota,
    potong,
    nilai,
    rataNota: nota > 0 ? nilai / nota : null,
    pengunjung: adaPengunjung ? pengunjung : null,
    hariPengunjungDariTutup: hariDariTutup,
    konversiPersen: adaPengunjung ? persen(notaTerhitung, pengunjung) : null,
    hariJual,
    hariJualDitutup,
    kepatuhanTutupPersen: persen(hariJualDitutup, hariJual),
    titipDibuat: lain.titipDibuat,
    titipSelesai: lain.titipSelesai,
    qtyTerjual: lain.qtyTerjual,
    qtyKembali: lain.qtyKembali,
    persenKembali: persen(lain.qtyKembali, lain.qtyTerjual),
    target: lain.target,
    nilaiOrang: lain.nilaiOrang,
    capaianPersen: lain.target ? persen(lain.nilaiOrang, lain.target) : null,
    notaBerpembeli: lain.notaBerpembeli,
    persenBerpembeli: persen(Math.min(lain.notaBerpembeli, nota), nota),
    memberBaru: lain.memberBaru,
  };
}

// ─── Urutan tabel ────────────────────────────────────────────────────────────

export type ArahUrut = "naik" | "turun";

/**
 * Urutkan baris menurut satu nilai. Nilai kosong (null — "—" di layar) SELALU
 * di bawah, ke arah mana pun: "belum ada jadwal" bukan angka terkecil.
 * Seri dipecah dengan `cadangan` (nama) supaya urutannya tetap.
 */
export function urutkanBaris<T>(
  baris: readonly T[],
  nilai: (b: T) => number | string | null,
  arah: ArahUrut,
  cadangan: (b: T) => string,
): T[] {
  const kali = arah === "naik" ? 1 : -1;
  return [...baris].sort((a, b) => {
    const x = nilai(a);
    const y = nilai(b);
    if (x === null && y === null) return cadangan(a).localeCompare(cadangan(b), "id");
    if (x === null) return 1;
    if (y === null) return -1;
    const beda = typeof x === "string" || typeof y === "string" ? String(x).localeCompare(String(y), "id") : x - y;
    return beda !== 0 ? beda * kali : cadangan(a).localeCompare(cadangan(b), "id");
  });
}

// ─── Bulan ───────────────────────────────────────────────────────────────────

/** Semua hari kalender satu bulan "YYYY-MM", urut. */
export function hariSebulan(bulan: string): string[] {
  const [th, bl] = bulan.split("-").map(Number);
  const jumlah = new Date(Date.UTC(th, bl, 0)).getUTCDate();
  return Array.from({ length: jumlah }, (_, i) => `${bulan}-${String(i + 1).padStart(2, "0")}`);
}
