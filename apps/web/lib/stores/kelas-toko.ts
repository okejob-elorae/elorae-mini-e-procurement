/**
 * Kelas toko A/B/C dan jarak kunjungan per kelas — murni, supaya bisa dites
 * tanpa basis data dan dipakai layar HP maupun backoffice.
 *
 * Kelas ditetapkan admin di master toko (`Store.storeClass`, "A" | "B" | "C" |
 * null). Setiap kelas punya jarak kunjungannya sendiri, diatur pemilik di
 * Pengaturan → Salesman (`SystemSetting salesman.kelasToko`): toko A yang
 * besar didatangi lebih sering daripada toko C. Toko tanpa kelas tetap memakai
 * batas hari kunjungan umum (`salesman.visitIntervalDays`) — jadi selama belum
 * ada toko yang diberi kelas, rencana kunjungan persis seperti sebelumnya.
 *
 * Usulan kelas otomatis memeringkat toko menurut nilai belinya 180 hari
 * terakhir: 20% teratas A, 30% berikutnya B, sisanya C (bawaan, bisa diatur).
 * Toko yang tidak membeli apa pun tidak diberi usulan — "tidak membeli" bukan
 * bukti toko kecil; bisa toko baru, bisa sedang tutup.
 */

import type { TokoRencana } from "@/lib/salesman/dasbor";
import { susunRencanaDenganMenurun, type BarisRencanaMenurun, type TokoMenurun } from "@/lib/salesman/toko-menurun";

export type KelasToko = "A" | "B" | "C";
export const DAFTAR_KELAS: readonly KelasToko[] = ["A", "B", "C"];
export const KUNCI_KELAS_TOKO = "salesman.kelasToko";

/** Jarak hari yang masih masuk akal untuk satu kunjungan — sama dengan batas umum. */
export const JARAK_HARI_MAKS = 365;

export type BatasPersentil = {
  /** Persentil minimal kelas A (bawaan 80 = 20% teratas). */
  batasA: number;
  /** Persentil minimal kelas B (bawaan 50 = 30% berikutnya). */
  batasB: number;
};

export type AturanKelasToko = {
  /** Jarak kunjungan per kelas, dalam hari. */
  jarakHari: Record<KelasToko, number>;
  otomatis: BatasPersentil & {
    /**
     * Toko yang BELUM diberi kelas oleh admin memakai kelas usulannya untuk
     * jarak kunjungan. Kelas pilihan admin selalu menang. Bawaan mati: angka
     * penjualan belum tentu mencerminkan pentingnya sebuah toko.
     */
    aktif: boolean;
  };
};

export const ATURAN_KELAS_BAWAAN: AturanKelasToko = {
  jarakHari: { A: 7, B: 14, C: 30 },
  otomatis: { aktif: false, batasA: 80, batasB: 50 },
};

/** Nilai kolom `storeClass` → kelas. Apa pun selain A/B/C dianggap tanpa kelas. */
export function bacaKelas(v: unknown): KelasToko | null {
  if (typeof v !== "string") return null;
  const k = v.trim().toUpperCase();
  return (DAFTAR_KELAS as readonly string[]).includes(k) ? (k as KelasToko) : null;
}

const objek = (x: unknown): Record<string, unknown> | null =>
  x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null;

const hariSah = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x) && x >= 1 && x <= JARAK_HARI_MAKS;
const persentilSah = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x) && x >= 1 && x <= 99;

/**
 * `SystemSetting` → aturan. Nilai rusak jatuh ke bawaan PER KOLOM, tidak
 * dilempar: satu angka yang salah ketik tidak boleh mengosongkan rencana
 * kunjungan semua salesman. Pasangan persentil harus A di atas B; kalau
 * bertabrakan keduanya kembali ke bawaan (tidak ada tebakan mana yang benar).
 */
export function bacaAturanKelasToko(nilai: string | null | undefined): AturanKelasToko {
  if (!nilai) return ATURAN_KELAS_BAWAAN;
  let x: Record<string, unknown> | null;
  try {
    x = objek(JSON.parse(nilai));
  } catch {
    return ATURAN_KELAS_BAWAAN;
  }
  if (!x) return ATURAN_KELAS_BAWAAN;

  const jarak = objek(x.jarakHari) ?? {};
  const oto = objek(x.otomatis) ?? {};
  const bawaan = ATURAN_KELAS_BAWAAN;

  let batasA = persentilSah(oto.batasA) ? oto.batasA : bawaan.otomatis.batasA;
  let batasB = persentilSah(oto.batasB) ? oto.batasB : bawaan.otomatis.batasB;
  if (batasB >= batasA) {
    batasA = bawaan.otomatis.batasA;
    batasB = bawaan.otomatis.batasB;
  }

  return {
    jarakHari: {
      A: hariSah(jarak.A) ? jarak.A : bawaan.jarakHari.A,
      B: hariSah(jarak.B) ? jarak.B : bawaan.jarakHari.B,
      C: hariSah(jarak.C) ? jarak.C : bawaan.jarakHari.C,
    },
    otomatis: { aktif: oto.aktif === true, batasA, batasB },
  };
}

/**
 * Jarak kunjungan satu toko: jarak kelasnya kalau berkelas, selain itu batas
 * hari kunjungan umum (`bacaBatasHari` di `lib/salesman/pengaturan.ts`).
 */
export function jarakKunjungan(
  toko: { storeClass?: string | null },
  aturan: AturanKelasToko,
  batasBawaan: number,
): number {
  const kelas = bacaKelas(toko.storeClass);
  return kelas ? aturan.jarakHari[kelas] : batasBawaan;
}

/** Persentil → bagian toko per kelas, untuk layar ("A = 20% teratas"). */
export function persenDariBatas(b: BatasPersentil): Record<KelasToko, number> {
  return { A: 100 - b.batasA, B: b.batasA - b.batasB, C: b.batasB };
}

/** Kebalikan `persenDariBatas`. Keabsahannya diperiksa `bacaAturanKelasToko`. */
export function batasDariPersen(persenA: number, persenB: number): BatasPersentil {
  return { batasA: 100 - persenA, batasB: 100 - persenA - persenB };
}

/**
 * Usulan kelas dari nilai beli per toko.
 *
 * Peringkat persentil titik-tengah: (toko di bawahnya + ½ × toko yang sama
 * nilainya) ÷ jumlah toko × 100. Titik-tengah, bukan "persen di bawahnya",
 * supaya toko yang nilainya sama selalu sekelas dan toko satu-satunya tidak
 * otomatis dicap C. Toko bernilai 0 (atau rusak) tidak diberi usulan dan tidak
 * ikut populasi — kalau ikut, toko yang baru dibuka menarik semua toko lain ke atas.
 */
export function usulkanKelas(
  nilaiPerToko: Readonly<Record<string, number>> | ReadonlyMap<string, number>,
  batas: BatasPersentil = ATURAN_KELAS_BAWAAN.otomatis,
): Record<string, KelasToko | null> {
  const masukan: [string, number][] =
    nilaiPerToko instanceof Map ? [...nilaiPerToko.entries()] : Object.entries(nilaiPerToko);
  const hasil: Record<string, KelasToko | null> = {};
  const populasi: number[] = [];
  for (const [id, n] of masukan) {
    hasil[id] = null;
    if (Number.isFinite(n) && n > 0) populasi.push(n);
  }
  if (populasi.length === 0) return hasil;

  populasi.sort((a, b) => a - b);
  const jumlah = populasi.length;
  // Indeks pertama yang >= n (pencarian biner) — populasi terurut naik.
  const pertamaTidakKurang = (n: number) => {
    let lo = 0;
    let hi = jumlah;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (populasi[m] < n) lo = m + 1;
      else hi = m;
    }
    return lo;
  };
  const pertamaLebih = (n: number) => {
    let lo = 0;
    let hi = jumlah;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (populasi[m] <= n) lo = m + 1;
      else hi = m;
    }
    return lo;
  };

  for (const [id, n] of masukan) {
    if (!(Number.isFinite(n) && n > 0)) continue;
    const bawah = pertamaTidakKurang(n);
    const sama = pertamaLebih(n) - bawah;
    const persentil = ((bawah + sama / 2) / jumlah) * 100;
    hasil[id] = persentil >= batas.batasA ? "A" : persentil >= batas.batasB ? "B" : "C";
  }
  return hasil;
}

export type SatuanNilaiKelas = "RUPIAH" | "POTONG";
export type UsulanKelas = { nilai: number; satuan: SatuanNilaiKelas; usulan: KelasToko | null };

/**
 * Usulan untuk toko putus dan konsinyasi, diperingkat TERPISAH:
 * toko putus menurut rupiah kiriman, toko konsinyasi menurut jumlah potong
 * yang disetujui dikirim. Pesanan konsinyasi tidak punya harga beli (barang
 * titipan, dibayar sesudah laku), jadi rupiahnya tidak sebanding dengan toko
 * putus — mencampur keduanya dalam satu peringkat membandingkan rupiah dengan potong.
 */
export function usulanPerJenis(
  toko: readonly { storeId: string; termsType: "PUTUS" | "KONSI"; rupiah: number; potong: number }[],
  batas: BatasPersentil,
): Record<string, UsulanKelas> {
  const nilai = (t: (typeof toko)[number]) => (t.termsType === "KONSI" ? t.potong : t.rupiah);
  const putus = usulkanKelas(
    Object.fromEntries(toko.filter((t) => t.termsType !== "KONSI").map((t) => [t.storeId, nilai(t)])),
    batas,
  );
  const konsi = usulkanKelas(
    Object.fromEntries(toko.filter((t) => t.termsType === "KONSI").map((t) => [t.storeId, nilai(t)])),
    batas,
  );
  const hasil: Record<string, UsulanKelas> = {};
  for (const t of toko) {
    const k = t.termsType === "KONSI";
    hasil[t.storeId] = {
      nilai: nilai(t),
      satuan: k ? "POTONG" : "RUPIAH",
      usulan: (k ? konsi : putus)[t.storeId] ?? null,
    };
  }
  return hasil;
}

/**
 * Perubahan yang benar-benar dilakukan saat admin menekan "Terapkan usulan".
 *
 * Hanya toko yang dipilih, yang punya usulan, dan yang usulannya berbeda dari
 * kelasnya sekarang. Toko tanpa pembelian (usulan null) TIDAK dikosongkan
 * kelasnya: kelas pilihan admin untuk toko baru atau toko yang sedang tutup
 * adalah keputusan, bukan data yang kedaluwarsa. Id yang tidak dikenal diabaikan.
 */
export function perubahanUsulan(
  daftar: readonly { storeId: string; kelas: KelasToko | null; usulan: KelasToko | null }[],
  dipilih: Iterable<string>,
): { storeId: string; dari: KelasToko | null; ke: KelasToko }[] {
  const pilih = new Set(dipilih);
  const hasil: { storeId: string; dari: KelasToko | null; ke: KelasToko }[] = [];
  for (const b of daftar) {
    if (!pilih.has(b.storeId) || b.usulan === null || b.usulan === b.kelas) continue;
    hasil.push({ storeId: b.storeId, dari: b.kelas, ke: b.usulan });
  }
  return hasil;
}

// ─── Rencana kunjungan ───────────────────────────────────────────────────────

/** Baris "toko saya" plus kelasnya dan jarak kunjungan yang berlaku untuknya. */
export type TokoRencanaKelas = TokoRencana & {
  kelas: KelasToko | null;
  /** Kelas berasal dari usulan otomatis, bukan pilihan admin. */
  kelasOtomatis: boolean;
  /** Jarak kunjungan yang dipakai untuk toko ini, dalam hari. */
  jarakHari: number;
};

/**
 * Rencana kunjungan dengan jarak kunjungan PER TOKO.
 *
 * Aturan urut dan alasannya tetap milik `susunRencanaDenganMenurun` (dites di
 * sana); di sini hanya "sudah waktunya dikunjungi" yang dinilai per toko.
 * Caranya: semua toko dinilai jatuh tempo dulu (batas −∞), lalu alasan "lama"
 * dicabut dari toko yang belum mencapai jaraknya sendiri, dan toko yang tidak
 * punya alasan lain (tagihan, menurun) dibuang. Urutan tidak bergantung pada
 * alasan "lama", jadi membuang baris tidak mengubah urutan sisanya — hasilnya
 * sama dengan kalau setiap toko dinilai dengan jaraknya sejak awal. Toko tanpa
 * `jarakHari` memakai `opsi.batasHari`.
 */
export function susunRencanaPerKelas<T extends TokoRencana & { jarakHari?: number | null }>(
  toko: readonly T[],
  menurun: readonly TokoMenurun[],
  opsi: { batasHari: number; hariIni: Date; posisi?: { lat: number; lng: number } | null },
): (BarisRencanaMenurun & Omit<T, keyof TokoRencana | "jarakHari"> & { jarakHari: number })[] {
  const jarak = new Map(toko.map((t) => [t.storeId, t.jarakHari ?? opsi.batasHari]));
  const semua = susunRencanaDenganMenurun(toko, menurun, { ...opsi, batasHari: Number.NEGATIVE_INFINITY });
  const hasil: (BarisRencanaMenurun & Omit<T, keyof TokoRencana | "jarakHari"> & { jarakHari: number })[] = [];
  for (const b of semua) {
    const jarakHari = jarak.get(b.storeId) ?? opsi.batasHari;
    const lama = b.hariSejak === null || b.hariSejak >= jarakHari;
    const alasan = lama ? b.alasan : b.alasan.filter((a) => a !== "lama");
    if (alasan.length === 0 && !b.menurun) continue;
    // Baris hasil `susunRencanaDenganMenurun` adalah salinan tokonya
    // (`{ ...t, … }`), jadi kolom tambahan seperti `kelas` ikut terbawa.
    hasil.push({ ...(b as BarisRencanaMenurun & Omit<T, keyof TokoRencana | "jarakHari">), alasan, jarakHari });
  }
  return hasil;
}
