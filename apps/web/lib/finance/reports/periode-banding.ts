/*
 * Periode pembanding laporan perbandingan dan rasio — murni, atas tanggal
 * kalender WIB "YYYY-MM-DD" (aman untuk komponen klien). Hitungan kalender
 * memakai UTC hanya sebagai kalkulator tanggal; tidak ada jam yang terlibat.
 *
 * Aturannya mengikuti cara orang membaca laporan bulanan ("bulan ini vs bulan
 * lalu vs tahun lalu"), bukan jumlah hari:
 * - periode yang mulai tanggal 1 dibandingkan dengan rentang tanggal yang sama
 *   N bulan sebelumnya (N = jumlah bulan yang dicakup); akhir bulan tetap akhir
 *   bulan, tanggal lain dijepit ke panjang bulan pembanding;
 * - rentang bebas dibandingkan dengan jendela sama panjang tepat sebelumnya;
 * - tahun lalu = tanggal yang sama 12 bulan sebelumnya, dengan aturan jepit
 *   yang sama.
 */

export type RentangTanggal = { dari: string; sampai: string };

type Tgl = { y: number; m: number; d: number };

const POLA = /^(\d{4})-(\d{2})-(\d{2})$/;

function urai(s: string): Tgl {
  const m = POLA.exec(s.trim());
  if (!m) throw new Error(`Tanggal tidak sah: ${s}`);
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

const dua = (n: number) => String(n).padStart(2, "0");
const tulis = (t: Tgl): string => `${t.y}-${dua(t.m)}-${dua(t.d)}`;

function panjangBulan(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function akhirBulan(t: Tgl): boolean {
  return t.d === panjangBulan(t.y, t.m);
}

/** Geser `n` bulan (boleh negatif). Akhir bulan tetap akhir bulan; tanggal lain dijepit. */
function geserBulan(t: Tgl, n: number): Tgl {
  const total = t.y * 12 + (t.m - 1) + n;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  const pjg = panjangBulan(y, m);
  return { y, m, d: akhirBulan(t) ? pjg : Math.min(t.d, pjg) };
}

function geserHari(t: Tgl, n: number): Tgl {
  const d = new Date(Date.UTC(t.y, t.m - 1, t.d + n));
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
}

/** Jumlah hari inklusif `dari`..`sampai`. */
export function jumlahHari(dari: string, sampai: string): number {
  const a = urai(dari);
  const b = urai(sampai);
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000) + 1;
}

/** Tanggal 1 bulan dari `tanggal`. */
export function awalBulanIni(tanggal: string): string {
  const t = urai(tanggal);
  return tulis({ y: t.y, m: t.m, d: 1 });
}

/** Periode sebelumnya dan periode yang sama tahun lalu untuk Laba Rugi / rasio. */
export function periodeBanding(dari: string, sampai: string): { sebelumnya: RentangTanggal; tahunLalu: RentangTanggal } {
  const a = urai(dari);
  const b = urai(sampai);
  const tahunLalu = { dari: tulis(geserBulan(a, -12)), sampai: tulis(geserBulan(b, -12)) };

  if (a.d === 1) {
    const n = (b.y * 12 + b.m) - (a.y * 12 + a.m) + 1;
    return {
      sebelumnya: { dari: tulis(geserBulan(a, -n)), sampai: tulis(geserBulan(b, -n)) },
      tahunLalu,
    };
  }

  const hari = jumlahHari(dari, sampai);
  const akhir = geserHari(a, -1);
  return {
    sebelumnya: { dari: tulis(geserHari(akhir, -(hari - 1))), sampai: tulis(akhir) },
    tahunLalu,
  };
}

/** Posisi Neraca pembanding: akhir bulan sebelumnya dan tanggal yang sama tahun lalu. */
export function posisiBanding(tanggal: string): { sebelumnya: string; tahunLalu: string } {
  const t = urai(tanggal);
  const awal = { y: t.y, m: t.m, d: 1 };
  return {
    sebelumnya: tulis(geserHari(awal, -1)),
    tahunLalu: tulis(geserBulan(t, -12)),
  };
}

/** Tanggal sah "YYYY-MM-DD" (kalender sungguhan), atau null. */
export function tanggalSah(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  const m = POLA.exec(s);
  if (!m) return null;
  const t = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  if (t.m < 1 || t.m > 12 || t.d < 1 || t.d > panjangBulan(t.y, t.m)) return null;
  return s;
}
