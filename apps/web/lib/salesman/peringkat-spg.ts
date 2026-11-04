import { prisma } from "@elorae/db";
import { bacaAturanPeringkat, KUNCI_PERINGKAT, susunPeringkat, type AturanPeringkat, type BarisPeringkat } from "./komisi";
import { daftarSpg } from "./queries";
import { capaianRinciSpg } from "./target-rinci-queries";

/**
 * Papan peringkat SPG — SPG dengan SPG, tidak dicampur salesman: counter di
 * toko dan kunjungan keliling bukan pekerjaan yang sama.
 *
 * Urutannya PENJUALAN BERSIH bulan itu (nota SPG sendiri, dikurangi retur
 * pembeli — `capaianRinciSpg`, angka yang sama dengan halaman Target), bulan
 * kalender WIB sampai hari ini. Rupiah rekan TIDAK pernah keluar dari server:
 * `susunPeringkat` hanya mengisi omzet milik penonton, dan karena tanpa target
 * tidak ada persen yang dikirim, yang terlihat dari rekan hanya urutannya.
 * Nama rekan mengikuti `salesman.peringkat` (pengaturan yang sama dengan papan
 * salesman); nama sendiri selalu terlihat.
 */

export type BarisPeringkatSpg = BarisPeringkat & {
  /** Toko rekan — null bila namanya disembunyikan (toko akan membocorkan siapa orangnya). */
  toko: string | null;
  /** Pcs bersih — hanya milik penonton. */
  pcs: number | null;
};

export async function peringkatSpgBulan(
  bulan: string,
  penontonId: string,
  hariIni: Date = new Date(),
): Promise<{ aturan: AturanPeringkat; baris: BarisPeringkatSpg[] }> {
  const [setelan, spg] = await Promise.all([
    prisma.systemSetting.findUnique({ where: { key: KUNCI_PERINGKAT }, select: { value: true } }),
    daftarSpg(),
  ]);
  const aturan = bacaAturanPeringkat(setelan?.value);
  const capaian = await capaianRinciSpg(
    spg.map((s) => s.id),
    bulan,
    hariIni,
  );
  const peserta = spg.map((s) => ({ id: s.id, nama: s.nama, omzet: capaian.get(s.id)?.total ?? 0, target: null }));
  const tokoDari = new Map(spg.map((s) => [s.id, s.tokoNama]));
  const baris = susunPeringkat(peserta, penontonId, aturan).map((b) => {
    const c = capaian.get(b.id);
    return {
      ...b,
      toko: b.nama !== null ? (tokoDari.get(b.id) ?? null) : null,
      pcs: b.diriSendiri && c ? Object.values(c.kategori).reduce((n, x) => n + x.pcs, 0) : null,
    };
  });
  return { aturan, baris };
}
