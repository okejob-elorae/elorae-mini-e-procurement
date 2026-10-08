/**
 * Angka konten dan biaya kolaborasi — murni, aman untuk klien.
 *
 * Uang dihitung dalam SEN (bilangan bulat) lalu dikembalikan ke rupiah, supaya
 * 0,1 + 0,2 tidak menjadi 0,30000000000000004 di total laporan.
 *
 * Angka konten tidak pernah ditimpa di basis data: setiap pengisian adalah baris
 * `KolContentMetric` baru. Yang mewakili sebuah konten adalah baris TERBARU-nya
 * (`angkaTerbaru`), bukan jumlah semua pengisian.
 */

export type AngkaKonten = { views: number; likes: number; comments: number; shares: number; saves: number };

export const ANGKA_NOL: AngkaKonten = { views: 0, likes: 0, comments: 0, shares: 0, saves: 0 };

const sah = (n: unknown): number => (typeof n === "number" && Number.isFinite(n) ? n : 0);

/** Rupiah → sen (bulat). `toFixed` dulu supaya 1250,555 tidak terbaca 125055,4999. */
export function keSen(n: number): number {
  return Math.round(Number((sah(n) * 100).toFixed(4)));
}

export function dariSen(sen: number): number {
  return sah(sen) / 100;
}

/** Jumlah uang aman-sen; isian yang bukan angka dianggap nol. */
export function jumlahUang(daftar: readonly number[]): number {
  return dariSen(daftar.reduce((s, n) => s + keSen(n), 0));
}

const bulatkan = (n: number, digit = 2): number => {
  const f = 10 ** digit;
  return Math.round(Number((n * f).toFixed(4))) / f;
};

export function totalInteraksi(a: AngkaKonten): number {
  return sah(a.likes) + sah(a.comments) + sah(a.shares) + sah(a.saves);
}

export function jumlahkanAngka(daftar: readonly AngkaKonten[]): AngkaKonten {
  return daftar.reduce<AngkaKonten>(
    (s, a) => ({
      views: s.views + sah(a.views),
      likes: s.likes + sah(a.likes),
      comments: s.comments + sah(a.comments),
      shares: s.shares + sah(a.shares),
      saves: s.saves + sah(a.saves),
    }),
    { ...ANGKA_NOL },
  );
}

/** Baris angka terbaru menurut `recordedAt` (Date atau teks ISO). */
export function angkaTerbaru<T extends { recordedAt: string | Date }>(baris: readonly T[]): T | null {
  let terbaru: T | null = null;
  let waktu = -Infinity;
  for (const b of baris) {
    const w = new Date(b.recordedAt).getTime();
    if (w > waktu) {
      waktu = w;
      terbaru = b;
    }
  }
  return terbaru;
}

/**
 * Engagement rate dalam PERSEN (4,8 berarti 4,8%), dua desimal.
 * Penyebutnya views; bila views nol, pengikut; bila keduanya nol, `null`.
 */
export function engagementRate(a: AngkaKonten, pengikut?: number | null): number | null {
  const penyebut = sah(a.views) > 0 ? sah(a.views) : sah(pengikut);
  if (penyebut <= 0) return null;
  return bulatkan((totalInteraksi(a) / penyebut) * 100);
}

const bagi = (atas: number, bawah: number, kali = 1): number | null => (sah(bawah) > 0 ? bulatkan((sah(atas) * kali) / sah(bawah)) : null);

/** Biaya per 1.000 views. */
export function cpm(biaya: number, views: number): number | null {
  return bagi(biaya, views, 1000);
}

/** Biaya per view. */
export function cpv(biaya: number, views: number): number | null {
  return bagi(biaya, views);
}

/** Biaya per interaksi (likes + komentar + share + save). */
export function cpe(biaya: number, interaksi: number): number | null {
  return bagi(biaya, interaksi);
}

/**
 * GMV ÷ biaya. `null` bila biayanya nol ATAU belum ada GMV sama sekali — satu
 * aturan untuk semua layar (Hari ini, rincian kolaborasi, profil KOL,
 * Laporan, rekap, CSV): sebelum ada penjualan ROAS tertulis "—", bukan "0,00×"
 * merah yang menakut-nakuti (audit ulang 2026-10-08).
 */
export function roas(gmv: number, biaya: number): number | null {
  if (!(Number.isFinite(gmv) && gmv > 0)) return null;
  return bagi(gmv, biaya);
}

/**
 * Rincian biaya satu (atau beberapa) kolaborasi.
 *
 * `fee` SELALU angka yang disepakati dengan KOL: neto untuk gross-up, bruto
 * untuk dipotong — sama dengan `KolBrief.fee` dan dengan yang tertulis di
 * rincian kolaborasi. PPh gross-up yang ditanggung Elorae berdiri sendiri di
 * `pph`, jadi `fee + pph` = biaya bruto fee (termasuk PPh) = Σ bruto termin =
 * beban di jurnal. PPh yang DIPOTONG dari KOL bukan biaya tambahan.
 */
export type RincianBiaya = { fee: number; pph: number; boost: number; ongkir: number; sampel: number; komisi: number; total: number };

/** Biaya bruto fee (termasuk PPh gross-up yang ditanggung Elorae). */
export function feeBruto(b: Pick<RincianBiaya, "fee" | "pph">): number {
  return dariSen(keSen(b.fee) + keSen(b.pph));
}

/**
 * Biaya satu kolaborasi = fee + PPh gross-up + boost + ongkir + Σ(HPP × qty) sampel + komisi
 * (Σ `KolSale.commission`).
 *
 * Fee dimasukkan apa adanya — pemanggil yang memutuskan apakah ia memakai fee
 * penuh atau fee yang sudah diakui (`nilaiFeeDiakui`).
 */
export function biayaKolaborasi(input: {
  fee?: number;
  /** PPh gross-up yang ditanggung Elorae (bukan PPh yang dipotong dari KOL). */
  pph?: number;
  boostCost?: number;
  ongkir?: readonly number[];
  sampel?: readonly { unitCost: number; qty: number }[];
  komisi?: readonly number[];
}): RincianBiaya {
  const fee = keSen(input.fee ?? 0);
  const pph = keSen(input.pph ?? 0);
  const boost = keSen(input.boostCost ?? 0);
  const ongkir = (input.ongkir ?? []).reduce((s, n) => s + keSen(n), 0);
  const sampel = (input.sampel ?? []).reduce((s, b) => s + keSen(b.unitCost) * Math.trunc(sah(b.qty)), 0);
  const komisi = (input.komisi ?? []).reduce((s, n) => s + keSen(n), 0);
  return {
    fee: dariSen(fee),
    pph: dariSen(pph),
    boost: dariSen(boost),
    ongkir: dariSen(ongkir),
    sampel: dariSen(sampel),
    komisi: dariSen(komisi),
    total: dariSen(fee + pph + boost + ongkir + sampel + komisi),
  };
}

export type KeadaanBudget = "TANPA_BUDGET" | "AMAN" | "HAMPIR" | "LEWAT";

/** Mulai persen berapa bar budget berubah kuning. */
export const BUDGET_HAMPIR_PERSEN = 80;

/** Hijau < 80%, kuning ≥ 80%, merah bila terpakai melebihi budget. */
export function keadaanBudget(
  terpakai: number,
  budget: number | null | undefined,
): { keadaan: KeadaanBudget; persen: number | null; sisa: number | null } {
  if (!budget || sah(budget) <= 0) return { keadaan: "TANPA_BUDGET", persen: null, sisa: null };
  const persen = bulatkan((sah(terpakai) / sah(budget)) * 100);
  const sisa = dariSen(keSen(budget) - keSen(terpakai));
  const keadaan: KeadaanBudget = sisa < 0 ? "LEWAT" : persen >= BUDGET_HAMPIR_PERSEN ? "HAMPIR" : "AMAN";
  return { keadaan, persen, sisa };
}

/** "1.250.000" — titik ribuan, dibulatkan ke bilangan bulat. Tidak bergantung ICU. */
export function angkaTitik(n: number): string {
  const bulat = Math.round(Math.abs(sah(n)));
  const teks = String(bulat).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return sah(n) < 0 && bulat > 0 ? `-${teks}` : teks;
}

/** "Rp 1.250.000" untuk teks pesan dan rekap. */
export function rupiahTeks(n: number): string {
  const t = angkaTitik(n);
  return t.startsWith("-") ? `-Rp ${t.slice(1)}` : `Rp ${t}`;
}
