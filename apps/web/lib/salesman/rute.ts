/**
 * Rute hari ini — urutan kunjungan yang pendek melalui toko-toko rencana,
 * TANPA layanan peta berbayar. Murni, supaya bisa dites tanpa HP dan tanpa
 * basis data; kuerinya di `rute-queries.ts`.
 *
 * Jarak antar toko = garis lurus (haversine). Urutannya: tetangga terdekat dari
 * titik awal, lalu diperbaiki 2-opt (membalik sepotong rute selama itu
 * memendekkan total). Bukan jaminan urutan terbaik — tapi cukup dekat untuk
 * ~40 toko, cepat, dan SELALU sama untuk masukan yang sama (jarak kembar
 * dipecah menurut urutan masukan), supaya urutan di layar tidak meloncat-loncat
 * setiap kali dihitung ulang.
 *
 * Jarak jalan dan waktu di sini PERKIRAAN, bukan hasil peta: jalan kota berkelok
 * (garis lurus × FAKTOR_JALAN), kecepatan rata-rata KECEPATAN_KOTA_KMJ, dan
 * MENIT_SINGGAH_BAWAAN di setiap toko. Rute jalan raya sungguhan butuh API peta
 * berbayar; navigasinya diserahkan ke Google Maps lewat tautan arah yang gratis.
 */

import { haversineMeters } from "@/lib/geo/haversine";

export type Titik = { lat: number; lng: number };
export type TokoBerkoordinat = { id: string; lat: number | null; lng: number | null };

/** Jalan kota tidak lurus: jarak jalan ≈ garis lurus × 1,3 (angka kira-kira yang umum dipakai). */
export const FAKTOR_JALAN = 1.3;
/** Kecepatan rata-rata di kota, termasuk lampu merah dan macet ringan (km/jam). */
export const KECEPATAN_KOTA_KMJ = 25;
/** Lama singgah di satu toko bila tidak ditentukan lain (menit). */
export const MENIT_SINGGAH_BAWAAN = 20;
/** Google Maps membatasi persinggahan per tautan arah; rute panjang dibagi beberapa bagian. */
export const MAKS_SINGGAH_GOOGLE = 9;

/** Batas putaran 2-opt — pengaman saja; setiap langkah memendekkan rute, jadi ia berhenti sendiri jauh sebelum ini. */
const MAKS_PUTARAN_2OPT = 200;
/** Selisih yang dianggap nol, supaya dua urutan yang sama panjang tidak saling bertukar tanpa henti. */
const EPS = 1e-6;

/**
 * Koordinat yang bisa dipakai menghitung jarak. `0,0` ditolak: itu kolom yang
 * terisi nol, bukan toko di Teluk Guinea — kalau ikut, satu toko itu menyeret
 * rute ribuan kilometer.
 */
export function titikSah(lat: unknown, lng: unknown): boolean {
  if (typeof lat !== "number" || typeof lng !== "number") return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return false;
  return !(lat === 0 && lng === 0);
}

// ─── Kaki rute ───────────────────────────────────────────────────────────────

/** Satu kaki perjalanan: jarak garis lurus yang diukur, dan dua perkiraan turunannya. */
export type Kaki = {
  garisLurusMeter: number;
  /** Perkiraan jarak jalan = garis lurus × FAKTOR_JALAN. */
  jalanMeter: number;
  /** Perkiraan waktu tempuh pada KECEPATAN_KOTA_KMJ, dalam menit. */
  menitTempuh: number;
};

function kaki(garisLurusMeter: number): Kaki {
  const jalanMeter = garisLurusMeter * FAKTOR_JALAN;
  return { garisLurusMeter, jalanMeter, menitTempuh: (jalanMeter / 1000 / KECEPATAN_KOTA_KMJ) * 60 };
}

export type LangkahRute<T> = Kaki & {
  toko: T;
  titik: Titik;
};

export type HasilRute<T> = {
  /** Titik awal yang dipakai: posisi HP, atau toko pertama bila posisi tidak diketahui. */
  awal: Titik | null;
  /** Posisi HP tidak diketahui — rute dimulai DI toko pertama (kaki pertamanya nol). */
  mulaiDiToko: boolean;
  /** Toko berkoordinat, sesuai urutan kunjungan. Kaki = dari titik sebelumnya. */
  langkah: LangkahRute<T>[];
  /** Kaki pulang ke titik awal; null bila tidak diminta atau tidak ada perjalanan. */
  pulang: Kaki | null;
  /**
   * Toko tanpa titik lokasi: tidak bisa diurutkan dan tidak masuk perkiraan,
   * tapi TIDAK dibuang — ditampilkan di akhir, dalam urutan masukan.
   */
  tanpaKoordinat: T[];
  total: Kaki & { menitSinggah: number; menit: number };
};

export type OpsiRute = {
  /** Posisi HP; null/tidak sah = tidak diketahui. */
  posisi?: Titik | null;
  /** Tambahkan perjalanan pulang ke titik awal. */
  kembali?: boolean;
  /** Menit singgah per toko; bawaan MENIT_SINGGAH_BAWAAN. */
  menitSinggah?: number;
};

const posisiSah = (p: Titik | null | undefined): Titik | null =>
  p && titikSah(p.lat, p.lng) ? { lat: p.lat, lng: p.lng } : null;

const menitSinggahSah = (m: number | undefined) =>
  typeof m === "number" && Number.isFinite(m) && m >= 0 ? m : MENIT_SINGGAH_BAWAAN;

/** Buang id kembar (yang pertama menang), lalu pisahkan yang berkoordinat dari yang tidak. */
function pisahkan<T extends TokoBerkoordinat>(toko: readonly T[]) {
  const dilihat = new Set<string>();
  const ada: { toko: T; titik: Titik }[] = [];
  const tanpa: T[] = [];
  for (const t of toko) {
    if (dilihat.has(t.id)) continue;
    dilihat.add(t.id);
    if (titikSah(t.lat, t.lng)) ada.push({ toko: t, titik: { lat: t.lat as number, lng: t.lng as number } });
    else tanpa.push(t);
  }
  return { ada, tanpa };
}

/**
 * Jarak dan perkiraan waktu untuk urutan yang SUDAH ditentukan (mis. urutan
 * yang disusun tangan oleh salesman) — tidak mengubah urutannya.
 */
export function hitungRute<T extends TokoBerkoordinat>(toko: readonly T[], opsi: OpsiRute = {}): HasilRute<T> {
  const { ada, tanpa } = pisahkan(toko);
  const posisi = posisiSah(opsi.posisi);
  const mulaiDiToko = posisi === null && ada.length > 0;
  const awal = posisi ?? ada[0]?.titik ?? null;

  const langkah: LangkahRute<T>[] = [];
  let sebelumnya = awal;
  for (const { toko: t, titik } of ada) {
    langkah.push({ toko: t, titik, ...kaki(sebelumnya ? haversineMeters(sebelumnya, titik) : 0) });
    sebelumnya = titik;
  }

  // Tanpa posisi dan hanya satu toko: Anda sudah di titik awal, tidak ada yang dipulangi.
  const adaPerjalanan = langkah.length > (mulaiDiToko ? 1 : 0);
  const pulang = opsi.kembali && awal && sebelumnya && adaPerjalanan ? kaki(haversineMeters(sebelumnya, awal)) : null;

  const garisLurus = langkah.reduce((s, l) => s + l.garisLurusMeter, 0) + (pulang?.garisLurusMeter ?? 0);
  const perjalanan = kaki(garisLurus);
  const menitSinggah = langkah.length * menitSinggahSah(opsi.menitSinggah);
  return {
    awal,
    mulaiDiToko,
    langkah,
    pulang,
    tanpaKoordinat: tanpa,
    total: { ...perjalanan, menitSinggah, menit: perjalanan.menitTempuh + menitSinggah },
  };
}

// ─── Pengurutan ──────────────────────────────────────────────────────────────

/**
 * Tetangga terdekat pada matriks jarak: mulai di simpul 0, selalu ke simpul
 * terdekat yang belum didatangi. Jarak kembar → indeks terkecil (stabil).
 */
export function tetanggaTerdekat(jarak: readonly (readonly number[])[]): number[] {
  const n = jarak.length;
  if (n === 0) return [];
  const sudah = new Array<boolean>(n).fill(false);
  const jalur = [0];
  sudah[0] = true;
  let kini = 0;
  for (let k = 1; k < n; k++) {
    let pilih = -1;
    for (let j = 0; j < n; j++) {
      if (sudah[j]) continue;
      // `<` ketat: yang indeksnya lebih kecil menang saat jaraknya sama.
      if (pilih === -1 || jarak[kini][j] < jarak[kini][pilih]) pilih = j;
    }
    sudah[pilih] = true;
    jalur.push(pilih);
    kini = pilih;
  }
  return jalur;
}

/**
 * Perbaikan 2-opt: balik potongan jalur `[i..j]` selama itu memendekkan total.
 * Simpul pertama (titik awal) tidak pernah dipindah. Tanpa `kembali`, ujung
 * jalur bebas — kaki setelah simpul terakhir bernilai nol. Tidak mengubah
 * masukannya.
 */
export function perbaiki2Opt(
  jalur: readonly number[],
  jarak: readonly (readonly number[])[],
  kembali: boolean,
): number[] {
  const p = [...jalur];
  const n = p.length;
  if (n < 3) return p;
  const d = (a: number, b: number) => jarak[a][b];

  for (let putaran = 0; putaran < MAKS_PUTARAN_2OPT; putaran++) {
    let membaik = false;
    for (let i = 1; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        const sesudahJ = j + 1 < n ? p[j + 1] : kembali ? p[0] : null;
        const lama = d(p[i - 1], p[i]) + (sesudahJ === null ? 0 : d(p[j], sesudahJ));
        const baru = d(p[i - 1], p[j]) + (sesudahJ === null ? 0 : d(p[i], sesudahJ));
        if (baru < lama - EPS) {
          for (let a = i, b = j; a < b; a++, b--) [p[a], p[b]] = [p[b], p[a]];
          membaik = true;
        }
      }
    }
    if (!membaik) break;
  }
  return p;
}

/**
 * Urutan otomatis: tetangga terdekat dari posisi HP (atau dari toko pertama
 * masukan bila posisi tidak diketahui — pemanggil menaruh toko paling mendesak
 * di depan), lalu 2-opt. Toko tanpa koordinat tetap ikut, di akhir.
 */
export function susunRute<T extends TokoBerkoordinat>(toko: readonly T[], opsi: OpsiRute = {}): HasilRute<T> {
  const { ada, tanpa } = pisahkan(toko);
  const posisi = posisiSah(opsi.posisi);
  if (ada.length < 2) return hitungRute([...ada.map((a) => a.toko), ...tanpa], opsi);

  // Simpul 0 = titik awal. Dengan posisi HP: posisi, lalu semua toko. Tanpa
  // posisi: toko pertama menjadi titik awal sekaligus persinggahan pertama.
  const titik = posisi ? [posisi, ...ada.map((a) => a.titik)] : ada.map((a) => a.titik);
  const jarak = titik.map((a) => titik.map((b) => haversineMeters(a, b)));
  const jalur = perbaiki2Opt(tetanggaTerdekat(jarak), jarak, opsi.kembali === true);
  const urut = posisi ? jalur.slice(1).map((i) => ada[i - 1].toko) : jalur.map((i) => ada[i].toko);
  return hitungRute([...urut, ...tanpa], opsi);
}

// ─── Google Maps ─────────────────────────────────────────────────────────────

const teksTitik = (t: Titik) => encodeURIComponent(`${t.lat.toFixed(6)},${t.lng.toFixed(6)}`);

/**
 * Tautan arah Google Maps (gratis, tanpa kunci API). Tanpa `asal`, Google
 * memakai lokasi HP sebagai awal. Dibuka di aplikasi Google Maps bila terpasang.
 */
export function tautanArahGoogle(asal: Titik | null, tujuan: Titik, singgah: readonly Titik[]): string {
  let url = "https://www.google.com/maps/dir/?api=1";
  if (asal) url += `&origin=${teksTitik(asal)}`;
  url += `&destination=${teksTitik(tujuan)}`;
  if (singgah.length > 0) url += `&waypoints=${singgah.map(teksTitik).join("%7C")}`;
  return `${url}&travelmode=driving`;
}

export type BagianPeta = {
  url: string;
  /** Nomor bagian, mulai 1. */
  nomor: number;
  /** Nomor toko (urutan rute, mulai 1) pertama dan terakhir di bagian ini; null bila bagian ini hanya perjalanan pulang. */
  dari: number | null;
  sampai: number | null;
  /** Bagian ini diakhiri perjalanan pulang ke titik awal. */
  pulang: boolean;
};

/**
 * Rute sebagai tautan Google Maps, dipotong per `maksSinggah` persinggahan
 * (+1 tujuan) karena Google membatasinya. Bagian berikut dimulai dari tujuan
 * bagian sebelumnya, jadi bagian-bagian itu bersambung.
 *
 * Posisi HP tidak diketahui → bagian pertama tanpa `origin`: Google memakai
 * lokasi HP saat tautan dibuka, dan toko pertama ikut sebagai persinggahan.
 */
export function bagianGoogleMaps(
  hasil: Pick<HasilRute<unknown>, "awal" | "mulaiDiToko" | "langkah" | "pulang">,
  maksSinggah: number = MAKS_SINGGAH_GOOGLE,
): BagianPeta[] {
  const batas = Number.isInteger(maksSinggah) && maksSinggah >= 1 ? maksSinggah : MAKS_SINGGAH_GOOGLE;
  const titik: { titik: Titik; nomor: number | null }[] = hasil.langkah.map((l, i) => ({ titik: l.titik, nomor: i + 1 }));
  if (titik.length === 0) return [];
  if (hasil.pulang && hasil.awal) titik.push({ titik: hasil.awal, nomor: null });

  const bagian: BagianPeta[] = [];
  let asal: Titik | null = hasil.mulaiDiToko ? null : hasil.awal;
  for (let i = 0; i < titik.length; i += batas + 1) {
    const potong = titik.slice(i, i + batas + 1);
    const tujuan = potong[potong.length - 1];
    const nomorToko = potong.map((p) => p.nomor).filter((x): x is number => x !== null);
    bagian.push({
      url: tautanArahGoogle(
        asal,
        tujuan.titik,
        potong.slice(0, -1).map((p) => p.titik),
      ),
      nomor: bagian.length + 1,
      dari: nomorToko[0] ?? null,
      sampai: nomorToko[nomorToko.length - 1] ?? null,
      pulang: tujuan.nomor === null,
    });
    asal = tujuan.titik;
  }
  return bagian;
}

// ─── Pilihan salesman, disimpan per hari di HP ───────────────────────────────

/** Pilihan yang disimpan di HP (localStorage): berlaku untuk satu hari WIB saja. */
export type RuteTersimpan = {
  /** Hari WIB `YYYY-MM-DD`; pilihan hari lain diabaikan. */
  tanggal: string;
  /** Toko di rute, sesuai urutan pilihan (termasuk yang sudah dikunjungi hari ini). */
  urutan: string[];
  /** Toko rencana yang sengaja dihapus — jangan dimunculkan lagi hari ini. */
  dihapus: string[];
  /** Urutan disusun tangan; false = diurutkan otomatis setiap kali dihitung. */
  manual: boolean;
  kembali: boolean;
};

export type PilihanRute = Omit<RuteTersimpan, "tanggal">;

/** Kunci localStorage per pengguna — satu HP bisa dipakai bergantian. */
export function kunciSimpanRute(userId: string): string {
  return `elorae.pwa.rute.v1.${userId}`;
}

const daftarTeks = (x: unknown): string[] => [
  ...new Set(Array.isArray(x) ? x.filter((v): v is string => typeof v === "string" && v.length > 0) : []),
];

/** Teks localStorage → pilihan hari ini. Rusak, bentuk salah, atau hari lain → null (mulai dari rencana). */
export function bacaRuteTersimpan(teks: string | null | undefined, tanggal: string): RuteTersimpan | null {
  if (!teks) return null;
  let x: unknown;
  try {
    x = JSON.parse(teks);
  } catch {
    return null;
  }
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  if (o.tanggal !== tanggal || !Array.isArray(o.urutan)) return null;
  return {
    tanggal,
    urutan: daftarTeks(o.urutan),
    dihapus: daftarTeks(o.dihapus),
    manual: o.manual === true,
    kembali: o.kembali === true,
  };
}

/**
 * Gabungkan pilihan tersimpan dengan data hari ini:
 * - tanpa simpanan: rencana kunjungan hari ini, diurutkan otomatis;
 * - dengan simpanan: urutan pilihan dipertahankan (toko yang bukan toko Anda
 *   lagi dibuang), toko yang BARU masuk rencana ditambahkan di akhir — kecuali
 *   yang sudah Anda hapus hari ini.
 */
export function pulihkanRute(
  tersimpan: RuteTersimpan | null,
  rencana: readonly string[],
  milik: Iterable<string>,
): PilihanRute {
  const punya = new Set(milik);
  const unik = (a: readonly string[]) => [...new Set(a)].filter((id) => punya.has(id));
  if (!tersimpan) return { urutan: unik(rencana), dihapus: [], manual: false, kembali: false };

  const urutan = unik(tersimpan.urutan);
  const ada = new Set(urutan);
  const dihapus = new Set(tersimpan.dihapus);
  for (const id of unik(rencana)) {
    if (!ada.has(id) && !dihapus.has(id)) {
      urutan.push(id);
      ada.add(id);
    }
  }
  return { urutan, dihapus: tersimpan.dihapus, manual: tersimpan.manual, kembali: tersimpan.kembali };
}

/** Tukar satu id dengan tetangganya (−1 = naik, 1 = turun). Di ujung atau id asing: tidak berubah. */
export function geserUrutan(ids: readonly string[], id: string, arah: -1 | 1): string[] {
  const hasil = [...ids];
  const i = hasil.indexOf(id);
  const j = i + arah;
  if (i === -1 || j < 0 || j >= hasil.length) return hasil;
  [hasil[i], hasil[j]] = [hasil[j], hasil[i]];
  return hasil;
}

/** Menit perkiraan → jam dan menit utuh untuk ditampilkan. Di atas nol selalu paling sedikit 1 menit. */
export function pecahMenit(menit: number): { jam: number; menit: number } {
  if (!Number.isFinite(menit) || menit <= 0) return { jam: 0, menit: 0 };
  const bulat = Math.max(1, Math.round(menit));
  return { jam: Math.floor(bulat / 60), menit: bulat % 60 };
}
