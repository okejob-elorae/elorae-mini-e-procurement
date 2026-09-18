import { langkahHarmoni, type AturanHarmoni } from '../palet/harmoni';
import { rasioKontras } from '../palet/kontras';
import { deltaE2000, hexKeLab, pantoneKhusus, type WarnaPantone } from '../palet/pantone';
import { hexKeHsb, normalisasiHex } from '../palet/warna';
import { AKSEN_POPULER, KROMA_NETRAL } from './aksen';
import { ATURAN_SABLON, ronaKhasAturan, type AturanSablon } from './saran';

/**
 * Pengganti satu tinta: berbagai JENIS warna, semuanya masuk dengan kain.
 *
 * Orang memilih dulu mau diganti menjadi apa (`OpsiGanti`): kalem (kontras di
 * bawah 2 — samar, menyatu lembut dengan kain), kontras kuat (4,5 ke atas),
 * satu jenis warna tertentu, atau semua jenis bergiliran.
 *
 * Jenis — solid, neon, pastel, redam, gelap, metalik — memberi variasi yang
 * benar-benar berbeda; aturan harmoni memastikan tiap pilihan tetap cocok
 * dengan kain: ronanya harus jatuh di salah satu rona aturan itu terhadap kain
 * (paling jauh `TOLERANSI_RONA` di roda). Selain itu tinta harus terbaca di
 * kain (paling tidak "lembut") dan tidak kembar dengan tinta lain di palet.
 *
 * Daftarnya bergiliran antarjenis, lalu antaraturan di dalam jenisnya: tombol
 * "Warna lain" berganti jenis di setiap klik. Daftar ini sengaja tidak
 * bergantung pada tinta yang sedang diganti — kalau bergantung, setiap
 * penggantian menggeser urutannya dan "berikutnya" tidak pernah berputar.
 *
 * Neon dan metalik di sini dipilih orang dengan sadar dan diberi label; saran
 * otomatis (aturan harmoni, galeri rekomendasi) tetap tidak memakainya.
 */

export const KELUARGA_WARNA = ['SOLID', 'NEON', 'PASTEL', 'REDAM', 'GELAP', 'METALIK'] as const;
export type KeluargaWarna = (typeof KELUARGA_WARNA)[number];

/** Pilihan "diganti menjadi apa". */
export const OPSI_GANTI = ['SEMUA', 'KALEM', 'KONTRAS', ...KELUARGA_WARNA] as const;
export type OpsiGanti = (typeof OPSI_GANTI)[number];

export type SaranPengganti = {
  hex: string;
  kode: string;
  aturan: AturanSablon;
  /** Jenis warnanya; `null` untuk netral (abu, hitam, putih) yang muncul di Kalem atau Kontras kuat. */
  keluarga: KeluargaWarna | null;
  /** Pilihan yang menghasilkannya — jenis warnanya sendiri untuk "Semua jenis". */
  jenis: Exclude<OpsiGanti, 'SEMUA'>;
};

type Calon = { warna: WarnaPantone; rona: number; L: number; C: number; rasio: number; bedaKain: number; keluarga: KeluargaWarna | null; khusus: boolean };
export type CalonKain = { kainHex: string; ronaDasar: number; semua: readonly Calon[] };

/** Rona harus sedekat ini (derajat, roda pelukis) ke rona aturan supaya dianggap mengikuti aturan itu. */
const TOLERANSI_RONA = 20;
/** Di bawah rasio ini tinta nyaris menyatu dengan kain ("samar"). */
const RASIO_MIN = 1.8;
/** Kalem: kontras di bawah ini — permintaan pemilik, "harus di bawah 2 sehingga samar". */
const RASIO_KALEM = 2;
/** Kalem tetap harus tampak berbeda dari kain, bukan kain itu sendiri. */
const BEDA_KAIN_KALEM = 5;
/** Kontras kuat: sama dengan "Terbaca kuat". */
const RASIO_KUAT = 4.5;
/** Pengganti yang lebih dekat dari ini ke tinta lain praktis tinta yang sama. */
const BEDA_ANTARTINTA = 10;
/** Pilihan per aturan di dalam satu jenis — satu per rona aturan, paling banyak dua. */
const PER_ATURAN = 2;
/** Selisih pembulatan hex ↔ HSB tidak membuat warna dianggap berbeda. */
const DE_SAMA = 1;
/** Di bawah kepekatan ini warna dianggap netral — bukan variasi warna. */
const KROMA_WARNA = 12;
/** Kain "kalem berwarna": berona tetapi pudar, dan tidak gelap — krem, khaki, army, mocca, sage. */
const KAIN_KALEM_KROMA_MAKS = 35;
const KAIN_KALEM_TERANG_MIN = 30;

/**
 * Batas kepekatan (kroma Lab) sebuah tinta menurut porsinya di desain, atau
 * `null` kalau bebas.
 *
 * Aturan harmoni hanya mengatur rona; ia tidak tahu bahwa biru royal sepekat
 * 2728 C bertabrakan dengan kaos pasir yang pudar. Di kain kalem berwarna, tinta
 * besar ikut kalem — pola 60-30-10: yang dominan paling tenang, yang mencolok
 * untuk aksen. Kain netral (hitam, putih, abu), kain gelap, dan kain yang sudah
 * pekat tidak dibatasi: warna berani memang lazim di sana.
 */
export function batasKromaTinta(kainHex: string, porsi: number): number | null {
  const [L, a, b] = hexKeLab(kainHex);
  const C = Math.hypot(a, b);
  if (C < KROMA_NETRAL || C >= KAIN_KALEM_KROMA_MAKS || L < KAIN_KALEM_TERANG_MIN) return null;
  if (porsi >= 40) return C + 25;
  if (porsi >= 20) return C + 45;
  return null;
}

/**
 * Jenis sebuah Pantone. Neon dan metalik menurut nomornya; tinta biasa menurut
 * terang dan kepekatannya. Netral (abu, hitam, putih) tidak punya jenis — ia
 * bukan variasi warna.
 */
export function keluargaPantone(w: WarnaPantone): KeluargaWarna | null {
  const [L, a, b] = w.lab;
  const C = Math.hypot(a, b);
  const khusus = pantoneKhusus(w.kode);
  if (khusus) return C >= KROMA_WARNA ? khusus : null;
  if (C < KROMA_WARNA) return null;
  if (L >= 75 && C <= 45) return 'PASTEL';
  if (L < 35) return 'GELAP';
  return C >= 35 ? 'SOLID' : 'REDAM';
}

type Siap = { warna: WarnaPantone; rona: number; L: number; C: number; keluarga: KeluargaWarna | null; khusus: boolean };
const katalogSiap = new WeakMap<readonly WarnaPantone[], Siap[]>();

function siapkan(katalog: readonly WarnaPantone[]): Siap[] {
  let hasil = katalogSiap.get(katalog);
  if (!hasil) {
    hasil = katalog.map((warna) => {
      const [L, a, b] = warna.lab;
      return { warna, rona: hexKeHsb(warna.hex).h, L, C: Math.hypot(a, b), keluarga: keluargaPantone(warna), khusus: pantoneKhusus(warna.kode) !== null };
    });
    katalogSiap.set(katalog, hasil);
  }
  return hasil;
}

/**
 * Semua calon untuk satu kain, dengan kontras dan jaraknya ke kain. Rona dasar
 * = rona kain; kain netral tidak punya rona, jadi memakai rona aksen pertama
 * galeri — sama dengan saran aturan harmoni, supaya keduanya sepakat.
 */
export function calonUntukKain(kainHex: string, katalog: readonly WarnaPantone[]): CalonKain {
  const labKain = hexKeLab(kainHex);
  const aksenNetral = katalog.find((w) => w.kode === AKSEN_POPULER[0]);
  const ronaDasar = Math.hypot(labKain[1], labKain[2]) < KROMA_NETRAL ? (aksenNetral ? hexKeHsb(aksenNetral.hex).h : 80) : hexKeHsb(kainHex).h;
  const semua = siapkan(katalog).map((c) => ({ ...c, rasio: rasioKontras(c.warna.hex, kainHex), bedaKain: deltaE2000(c.warna.lab, labKain) }));
  return { kainHex, ronaDasar, semua };
}

function jarakRona(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}

/** Seberapa khas sebuah calon untuk pilihannya — makin kecil makin khas. */
function watak(opsi: Exclude<OpsiGanti, 'SEMUA'>, c: Calon): number {
  switch (opsi) {
    case 'KALEM':
      // Kalem: kepekatan rendah, tetapi tetap tampak berbeda dari kain.
      return c.C / 15 - Math.min(c.bedaKain, 15) / 5;
    case 'KONTRAS':
      return -Math.min(c.rasio, 12) / 3 - c.C / 30;
    case 'SOLID':
      return -Math.min(c.C, 80) / 6 - Math.min(c.rasio, 4.5);
    case 'PASTEL':
      return Math.abs(c.L - 85) / 3 - Math.min(c.rasio, 4.5);
    case 'REDAM':
      return Math.abs(c.C - 22) / 3 - Math.min(c.rasio, 4.5);
    case 'GELAP':
      return Math.abs(c.L - 25) / 3 - Math.min(c.rasio, 4.5);
    default:
      return -Math.min(c.rasio, 4.5);
  }
}

/** Calon yang memenuhi syarat sebuah pilihan, sebelum dicocokkan dengan aturan. */
function lolos(opsi: Exclude<OpsiGanti, 'SEMUA'>, c: Calon): boolean {
  if (opsi === 'KALEM') return !c.khusus && c.rasio < RASIO_KALEM && c.bedaKain >= BEDA_KAIN_KALEM;
  if (opsi === 'KONTRAS') return !c.khusus && c.rasio >= RASIO_KUAT;
  return c.keluarga === opsi && c.rasio >= RASIO_MIN;
}

/** Rona khas sebuah aturan: geseran dari rona dasar, tanpa 0° kecuali Monochromatic dan Shades. */
function geseranAturan(aturan: AturanSablon): number[] {
  return [...new Set((langkahHarmoni(aturan) ?? []).map((l) => l.dh))].filter((dh) => ronaKhasAturan(aturan, dh));
}

function bergiliran<T>(daftar: readonly (readonly T[])[]): T[] {
  const hasil: T[] = [];
  const panjang = Math.max(0, ...daftar.map((d) => d.length));
  for (let r = 0; r < panjang; r++) for (const d of daftar) if (d[r]) hasil.push(d[r]);
  return hasil;
}

/**
 * Pengganti untuk setiap pilihan sekaligus — daftar tiap jenis dihitung sekali
 * dan "Semua jenis" disusun darinya. Tiap daftar bergiliran antaraturan (aturan
 * palet di depan); "Semua jenis" bergiliran antarjenis.
 *
 * Warna berpigmen harus jatuh di rona aturannya; netral (abu, hitam, putih) —
 * yang hanya muncul di Kalem dan Kontras kuat — tidak punya rona, jadi
 * dihitung sebagai Monochromatic dan Shades saja.
 */
export function saranSemuaPilihan(input: {
  calon: CalonKain;
  /** Semua tinta palet; yang di `indeks` adalah yang diganti. */
  hex: readonly string[];
  indeks: number;
  /** Aturan palet saat ini didahulukan di setiap pilihan. */
  aturanUtama: AturanHarmoni;
  /** Porsi tinta ini di desain (%) — tinta besar di kain kalem tidak diberi warna mencolok. */
  porsi?: number;
}): Record<OpsiGanti, SaranPengganti[]> {
  const batasKroma = input.porsi === undefined ? null : batasKromaTinta(input.calon.kainHex, input.porsi);
  const lain = input.hex.flatMap((h, i) => {
    const bersih = i === input.indeks ? null : normalisasiHex(h);
    return bersih ? [hexKeLab(bersih)] : [];
  });
  const urutanAturan = ATURAN_SABLON.includes(input.aturanUtama as AturanSablon)
    ? [input.aturanUtama as AturanSablon, ...ATURAN_SABLON.filter((a) => a !== input.aturanUtama)]
    : [...ATURAN_SABLON];

  const untuk = (opsi: Exclude<OpsiGanti, 'SEMUA'>): SaranPengganti[] => {
    // Syarat murah dulu, baru jarak ke tinta lain (ΔE2000 itu mahal).
    const calon = input.calon.semua.filter(
      (c) => lolos(opsi, c) && (batasKroma === null || c.C <= batasKroma) && lain.every((l) => deltaE2000(l, c.warna.lab) >= BEDA_ANTARTINTA),
    );
    const perAturan = urutanAturan.map((aturan) => {
      const netralBoleh = aturan === 'MONOCHROMATIC' || aturan === 'SHADES';
      const terpilih: { c: Calon; skor: number }[] = [];
      for (const dh of geseranAturan(aturan)) {
        const sasaran = input.calon.ronaDasar + dh;
        let terbaik: { c: Calon; skor: number } | null = null;
        for (const c of calon) {
          const berpigmen = c.C >= KROMA_WARNA;
          if (!berpigmen && !netralBoleh) continue;
          const jarak = berpigmen ? jarakRona(c.rona, sasaran) : 0;
          if (jarak > TOLERANSI_RONA) continue;
          const skor = jarak / 4 + watak(opsi, c);
          if (!terbaik || skor < terbaik.skor) terbaik = { c, skor };
        }
        if (terbaik && !terpilih.some((t) => t.c === terbaik.c)) terpilih.push(terbaik);
      }
      return terpilih
        .sort((a, b) => a.skor - b.skor)
        .slice(0, PER_ATURAN)
        .map(({ c }): SaranPengganti => ({ hex: c.warna.hex, kode: c.warna.kode, aturan, keluarga: c.keluarga, jenis: opsi }));
    });
    return unik(bergiliran(perAturan));
  };

  const hasil = {} as Record<OpsiGanti, SaranPengganti[]>;
  for (const opsi of OPSI_GANTI) if (opsi !== 'SEMUA') hasil[opsi] = untuk(opsi);
  hasil.SEMUA = unik(bergiliran(KELUARGA_WARNA.map((k) => hasil[k])));
  return hasil;
}

/** Satu pilihan saja — lihat `saranSemuaPilihan`. */
export function saranPengganti(input: Parameters<typeof saranSemuaPilihan>[0] & { opsi?: OpsiGanti }): SaranPengganti[] {
  return saranSemuaPilihan(input)[input.opsi ?? 'SEMUA'];
}

function unik(daftar: readonly SaranPengganti[]): SaranPengganti[] {
  const ada = new Set<string>();
  return daftar.filter((x) => !ada.has(x.kode) && Boolean(ada.add(x.kode)));
}

/** Saran yang warnanya sama dengan `hex`, bila ada. */
export function saranYangDipakai<T extends { hex: string }>(daftar: readonly T[], hex: string): T | null {
  const bersih = normalisasiHex(hex);
  if (!bersih) return null;
  const lab = hexKeLab(bersih);
  return daftar.find((x) => deltaE2000(hexKeLab(x.hex), lab) < DE_SAMA) ?? null;
}

/** Saran sesudah warna `hex` — berputar ke awal, dan mulai dari awal kalau `hex` bukan saran. */
export function saranBerikutnya<T extends { hex: string }>(daftar: readonly T[], hex: string): T | null {
  if (daftar.length === 0) return null;
  const kini = saranYangDipakai(daftar, hex);
  return kini ? daftar[(daftar.indexOf(kini) + 1) % daftar.length] : daftar[0];
}
