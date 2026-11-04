import { kalimatTertahan } from "@/lib/receivables/jatuh-tempo";
import type { BarisPiutang } from "@/lib/receivables/queries";

/**
 * Kalimat "Tertahan retur" di HP (Tagihan daftar toko dan faktur per toko) — tiga bagian dari
 * bahan yang SAMA dengan baris Piutang kantor (`kalimatTertahan`), supaya angka di HP dan di
 * kantor tidak pernah berbeda (owner Q15/P46):
 *
 * 1. yang MENUNGGU dan sebabnya: hitungan gudang (`BELUM_DIHITUNG`), keputusan selisih
 *    (`MENUNGGU_BEBAN`), atau keduanya (`CAMPURAN`);
 * 2. potongan yang TIDAK JADI diakui — tetap utang toko;
 * 3. bagian di luar tahanan yang sudah lewat jatuh tempo (tagih ke toko); tanpa itu, bagian tetap
 *    ditagih lewat BKM berikutnya.
 *
 * Murni (tanpa React) supaya bisa dites; pemanggil memberi penerjemah `pwaPiutang` dan
 * pemformat rupiahnya.
 */
export function susunKalimatTertahan(
  alasan: BarisPiutang["alasan"],
  t: (kunci: string, nilai?: Record<string, string | number>) => string,
  rupiah: (n: number) => string,
): string {
  const k = kalimatTertahan(alasan);
  const bagian: string[] = [];
  if (k.tunggu) {
    const value = rupiah(k.tunggu.nilai);
    bagian.push(
      k.tunggu.sebab === "BELUM_DIHITUNG"
        ? t("why_tertahan_hitung", { value })
        : k.tunggu.sebab === "CAMPURAN"
          ? t("why_tertahan_campur", { value })
          : t("why_tertahan", { value }),
    );
  }
  if (k.tetap) bagian.push(t("why_tertahan_tetap", { value: rupiah(k.tetap) }));
  if (k.lewatTempo) {
    bagian.push(
      t(k.tunggu ? "why_tertahan_lewatTempo" : "why_tertahan_lewatTempoSemua", {
        value: rupiah(k.lewatTempo.nilai),
        days: k.lewatTempo.hari,
      }),
    );
  } else if (k.tetap) {
    bagian.push(t("why_tertahan_tagihBkm"));
  }
  // Tanpa bahan rincian sama sekali: kalimat umumnya, seperti sebelumnya.
  if (bagian.length === 0) bagian.push(t("why_tertahan", { value: rupiah(alasan.nilaiTertahan ?? 0) }));
  return bagian.join(" ");
}
