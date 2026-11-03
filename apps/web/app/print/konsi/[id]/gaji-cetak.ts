import type { RincianSiklus } from "@/lib/konsinyasi/queries";
import type { AlasanTahanBayar } from "@/lib/spg/gaji-pokok";

type BarisKomisi = RincianSiklus["komisi"][number];

/** Angka satu baris gaji & komisi di lembar cetak. */
export type AngkaGajiCetak = { komisi: number; total: number; potongan: number; koreksi: number; dibayarkan: number };

/** `angka` null = belum ada angka yang akan dibayar; `alasan` menjelaskannya. */
export type BarisGajiCetak = { k: BarisKomisi; angka: AngkaGajiCetak | null; alasan: string | null };

/**
 * Alasan baris yang belum dibayar ditahan — sama dengan yang menahan pembayarannya (P60,
 * `lib/spg/gaji-pokok.ts`). Lembar cetak tidak punya bahasa pilihan, jadi teksnya Indonesia.
 */
export const ALASAN_TAHAN: Record<AlasanTahanBayar, string> = {
  GAJI_POKOK_BELUM_DIATUR: "Ditahan: gaji bulanan SPG ini belum diatur di Pengaturan → Komisi SPG.",
  MULAI_KERJA_BELUM_DIISI: "Ditahan: tanggal mulai bekerja SPG ini belum diisi di Pengaturan → Pengguna.",
  CATATAN_HADIR_BELUM_DIPERIKSA: "Ditahan: catatan check-in toko bulan itu belum diperiksa Admin Keuangan.",
  JADWAL_MENUNGGU_PERSETUJUAN: "Ditahan: jadwal bulanan SPG ini menunggu persetujuan kantor.",
  CATATAN_HADIR_BELUM_DIMASUKKAN: "Ditahan: ada hari tanpa jadwal disetujui dan tanpa catatan check-in toko.",
  TANPA_HARI_KERJA: "Ditahan: tidak ada hari kerja terjadwal di bulan itu.",
};

export const ALASAN_KUNCI_DIBUKA = "Kunci siklus dibuka lagi — angkanya ditetapkan saat dikunci lagi.";
export const ALASAN_TANPA_RENCANA = "Belum ada angka yang akan dibayar.";

/**
 * Baris gaji & komisi lembar cetak siklus — angka yang sama dengan layar siklus dan yang dibayar
 * penulis: baris belum dibayar memakai komisi per SPG sekarang dan koreksi yang ikut (`bayar`);
 * yang sudah dibayar memakai angka tersimpannya dan koreksi yang diterapkan padanya.
 *
 * Baris belum dibayar TANPA angka bayar — ditahan, atau siklus yang kuncinya dibuka lagi (`bayar`
 * null) — tidak dicetak dengan angka tersimpannya: layar siklus menulis "—" dan HP SPG tidak
 * menyebut angka. Barisnya juga tidak ikut dijumlah.
 */
export function susunGajiCetak(komisi: readonly BarisKomisi[], terkunci: boolean) {
  const baris: BarisGajiCetak[] = komisi.map((k) => {
    if (!k.dibayarPada && (!k.bayar || k.bayar.ditahan || k.tahan)) {
      const tahan = k.bayar?.ditahan ?? k.tahan?.alasan ?? null;
      const alasan = tahan ? ALASAN_TAHAN[tahan] : terkunci ? ALASAN_TANPA_RENCANA : ALASAN_KUNCI_DIBUKA;
      return { k, angka: null, alasan };
    }
    const p = !k.dibayarPada ? k.bayar : null;
    const komisiBaris = p ? p.komisiBaru : k.komisi;
    const total = p ? p.gajiPokok + p.komisiBaru : k.total;
    // Pengurang yang diambil saat dibayar: barang hilang, beban retur pembeli, dan utang (B22).
    const potongan = p ? p.potonganHilang + p.potonganRetur + p.potonganUtang : k.potonganHilang;
    const koreksi = k.dibayarPada ? k.koreksiDiterapkan.reduce((n, x) => n + x.jumlah, 0) : p ? p.jumlahKoreksi : 0;
    const dibayarkan = k.dibayarkan ?? (p ? p.dibayar : Math.max(0, total - potongan));
    return { k, angka: { komisi: komisiBaris, total, potongan, koreksi, dibayarkan }, alasan: null };
  });
  const pasti = baris.flatMap((x) => (x.angka ? [x.angka] : []));
  return {
    baris,
    adaBelumPasti: pasti.length < baris.length,
    totalKomisi: pasti.reduce((s, x) => s + x.total, 0),
    totalPotonganHilang: pasti.reduce((s, x) => s + x.potongan, 0),
    totalKoreksi: pasti.reduce((s, x) => s + x.koreksi, 0),
    adaKoreksi: pasti.some((x) => Math.round(x.koreksi * 100) !== 0),
    totalDibayarkan: pasti.reduce((s, x) => s + x.dibayarkan, 0),
  };
}
