/**
 * Logika dasbor salesman di aplikasi HP — murni, supaya bisa dites tanpa basis
 * data. Kuerinya di `lib/salesman/queries.ts`.
 *
 * Semua "hari" di sini hari kalender WIB, sama dengan grafik beranda backoffice:
 * penjualan jam 00.30 WIB milik hari itu, bukan hari UTC sebelumnya.
 */

import { haversineMeters } from '@/lib/geo/haversine';
import { kunciHariWib } from '@/lib/dashboard/tren';

const HARI_MS = 86_400_000;

/** Selisih hari kalender WIB, bukan selisih 24 jam. */
function selisihHari(dari: Date, sampai: Date): number {
  const a = Date.parse(`${kunciHariWib(dari)}T00:00:00Z`);
  const b = Date.parse(`${kunciHariWib(sampai)}T00:00:00Z`);
  return Math.round((b - a) / HARI_MS);
}

// ─── Penjualan ────────────────────────────────────────────────────────────────

/**
 * Tiga kanal, sengaja TIDAK dijumlahkan jadi satu: pemilik ingin salesman tahu
 * omzet putus dan konsinyasinya masing-masing. Konsinyasi adalah barang
 * titipan — dihitung ke target, tapi belum tentu laku.
 */
export type JenisJual = 'putus' | 'konsi' | 'van';
export type BarisJual = { tanggal: Date; jenis: JenisJual; nilai: number };
export type TitikSalesman = { tanggal: string; putus: number; konsi: number; van: number };

export function susunPenjualanSalesman(baris: readonly BarisJual[], hariIni: Date, n: number): TitikSalesman[] {
  const akhir = Date.parse(`${kunciHariWib(hariIni)}T00:00:00Z`);
  const titik: TitikSalesman[] = [];
  const indeks = new Map<string, TitikSalesman>();
  for (let i = n - 1; i >= 0; i--) {
    const t = { tanggal: new Date(akhir - i * HARI_MS).toISOString().slice(0, 10), putus: 0, konsi: 0, van: 0 };
    titik.push(t);
    indeks.set(t.tanggal, t);
  }
  for (const b of baris) {
    const t = indeks.get(kunciHariWib(b.tanggal));
    if (t) t[b.jenis] += b.nilai;
  }
  return titik;
}

export function jumlahkanPenjualan(titik: readonly TitikSalesman[]) {
  const j = { putus: 0, konsi: 0, van: 0, total: 0 };
  for (const t of titik) {
    j.putus += t.putus;
    j.konsi += t.konsi;
    j.van += t.van;
  }
  j.total = j.putus + j.konsi + j.van;
  return j;
}

// ─── Target ───────────────────────────────────────────────────────────────────

export type Kemajuan = {
  target: number;
  capai: number;
  persen: number;
  sisa: number;
  /** Hari kalender tersisa di bulan ini, TERMASUK hari ini. */
  sisaHari: number;
  /** Rupiah per hari yang masih dibutuhkan; null bila target sudah tercapai. */
  perHari: number | null;
  tercapai: boolean;
};

export function kemajuanTarget(target: number | null | undefined, capai: number, hariIni: Date): Kemajuan | null {
  if (!target || target <= 0) return null;
  const [th, bl, tg] = kunciHariWib(hariIni).split('-').map(Number);
  const hariDalamBulan = new Date(Date.UTC(th, bl, 0)).getUTCDate();
  const sisaHari = hariDalamBulan - tg + 1;
  const sisa = Math.max(0, target - capai);
  return {
    target,
    capai,
    persen: Math.round((capai / target) * 100),
    sisa,
    sisaHari,
    perHari: sisa > 0 ? Math.ceil(sisa / sisaHari) : null,
    tercapai: capai >= target,
  };
}

// ─── Rencana kunjungan ────────────────────────────────────────────────────────

export type TokoRencana = {
  storeId: string;
  nama: string;
  /** Kunjungan terakhir OLEH SALESMAN INI; null = belum pernah. */
  kunjunganTerakhir: Date | null;
  /** Ada tagihan yang lewat janji bayar (keadaan `lewat` di modul piutang). */
  tagih: boolean;
  sisaTagihan: number;
  lat: number | null;
  lng: number | null;
};

export type AlasanKunjungan = 'tagih' | 'lama';
export type BarisRencana = TokoRencana & {
  alasan: AlasanKunjungan[];
  /** null = belum pernah dikunjungi salesman ini. */
  hariSejak: number | null;
  jarakMeter: number | null;
};

/**
 * Toko yang perlu didatangi hari ini, dan kenapa.
 *
 * Tagihan dulu, karena uang yang terlambat makin sulit ditagih setiap harinya.
 * Lalu toko yang sudah melewati batas hari kunjungan — yang belum pernah
 * dikunjungi paling depan. Di antara yang sama mendesaknya: yang terdekat dulu
 * kalau HP tahu posisinya, kalau tidak yang paling lama ditinggal.
 */
export function susunRencanaKunjungan(
  toko: readonly TokoRencana[],
  opsi: { batasHari: number; hariIni: Date; posisi?: { lat: number; lng: number } | null },
): BarisRencana[] {
  const baris: BarisRencana[] = [];
  for (const t of toko) {
    const hariSejak = t.kunjunganTerakhir ? selisihHari(t.kunjunganTerakhir, opsi.hariIni) : null;
    const alasan: AlasanKunjungan[] = [];
    if (t.tagih) alasan.push('tagih');
    if (hariSejak === null || hariSejak >= opsi.batasHari) alasan.push('lama');
    if (alasan.length === 0) continue;
    const jarakMeter =
      opsi.posisi && t.lat !== null && t.lng !== null
        ? Math.round(haversineMeters(opsi.posisi, { lat: t.lat, lng: t.lng }))
        : null;
    baris.push({ ...t, alasan, hariSejak, jarakMeter });
  }
  const peringkat = (b: BarisRencana) => (b.alasan.includes('tagih') ? 0 : 1);
  return baris.sort((a, b) => {
    const p = peringkat(a) - peringkat(b);
    if (p !== 0) return p;
    if (opsi.posisi && (a.jarakMeter !== null || b.jarakMeter !== null)) {
      if (a.jarakMeter === null) return 1;
      if (b.jarakMeter === null) return -1;
      return a.jarakMeter - b.jarakMeter;
    }
    // Sesama tagihan: yang uangnya paling besar dulu.
    if (peringkat(a) === 0 && a.sisaTagihan !== b.sisaTagihan) return b.sisaTagihan - a.sisaTagihan;
    // Belum pernah dikunjungi (null) paling depan, lalu yang paling lama.
    return (b.hariSejak ?? Infinity) - (a.hariSejak ?? Infinity);
  });
}

// ─── Pola pesanan ─────────────────────────────────────────────────────────────

export type PolaPesanan = {
  terakhir: Date | null;
  hariSejak: number | null;
  /** Median jeda antarpesanan dalam hari; null bila pesanannya kurang dari dua. */
  jedaMedian: number | null;
  /** Sudah melewati jeda biasanya — saatnya menawarkan pesanan lagi. */
  waktunya: boolean;
};

/** Median, bukan rata-rata: satu jeda panjang (toko tutup lebaran) tidak menggeser kebiasaannya. */
export function polaPesanan(tanggal: readonly Date[], hariIni: Date): PolaPesanan {
  if (tanggal.length === 0) return { terakhir: null, hariSejak: null, jedaMedian: null, waktunya: false };
  const urut = [...tanggal].sort((a, b) => a.getTime() - b.getTime());
  const terakhir = urut[urut.length - 1];
  const hariSejak = selisihHari(terakhir, hariIni);
  if (urut.length < 2) return { terakhir, hariSejak, jedaMedian: null, waktunya: false };
  const jeda = urut
    .slice(1)
    .map((d, i) => selisihHari(urut[i], d))
    .sort((a, b) => a - b);
  const tengah = Math.floor(jeda.length / 2);
  const jedaMedian = jeda.length % 2 ? jeda[tengah] : Math.round((jeda[tengah - 1] + jeda[tengah]) / 2);
  return { terakhir, hariSejak, jedaMedian, waktunya: jedaMedian > 0 && hariSejak >= jedaMedian };
}

// ─── WhatsApp ─────────────────────────────────────────────────────────────────

/** Nomor apa pun → bentuk internasional tanpa +. Nomor lokal dianggap Indonesia. */
function internasional(telepon: string | null | undefined): string | null {
  const angka = (telepon ?? '').replace(/\D/g, '');
  if (!angka) return null;
  return angka.startsWith('0') ? `62${angka.slice(1)}` : angka.startsWith('8') ? `62${angka}` : angka;
}

/**
 * Nomor toko → bentuk internasional tanpa +, seperti yang diminta wa.me.
 *
 * Hanya nomor HP. Nomor Indonesia yang sesudah 62 bukan 8 adalah telepon rumah
 * atau kantor (022…, 021…) — WhatsApp akan membuka obrolan yang tidak pernah
 * dibaca siapa pun, dan salesman mengira tokonya sudah diingatkan. Untuk nomor
 * begitu yang ditawarkan adalah panggilan biasa (`nomorTelepon`).
 */
export function nomorWhatsApp(telepon: string | null | undefined): string | null {
  const n = internasional(telepon);
  if (!n || n.length < 10 || n.length > 15) return null;
  if (n.startsWith('62') && n[2] !== '8') return null;
  return n;
}

/** Nomor untuk tautan `tel:` — telepon rumah pun boleh. */
export function nomorTelepon(telepon: string | null | undefined): string | null {
  const n = internasional(telepon);
  return n && n.length >= 9 && n.length <= 15 ? `+${n}` : null;
}

/**
 * Tautan obrolan WhatsApp dengan pesan yang sudah terisi. Hanya MEMBUKA
 * WhatsApp — salesman sendiri yang membaca, mengubah, dan menekan kirim.
 */
export function tautanWhatsApp(telepon: string | null | undefined, pesan: string): string | null {
  const n = nomorWhatsApp(telepon);
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(pesan)}` : null;
}
