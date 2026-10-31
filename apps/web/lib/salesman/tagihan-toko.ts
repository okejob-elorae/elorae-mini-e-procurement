import { prisma } from "@elorae/db";
import { daftarPiutang, type BarisPiutang } from "@/lib/receivables/queries";
import { bacaAturanKredit, KUNCI_ATURAN_KREDIT, type AturanKredit, type KeadaanTagihan } from "./kredit";

/**
 * Keadaan tagihan satu toko — bahan penilaian kredit (`nilaiKredit`) dan kartu
 * ringkasan toko di aplikasi HP.
 *
 * Sisa dibaca dari `daftarPiutang`, yang MENGHITUNG ULANG dari klaim (kolom
 * `outstanding` hanya cache). "Lewat janji" mengikuti keadaan piutang yang sama
 * dengan layar Tagihan: kontrabon yang tanggal janjinya sudah lewat. Faktur yang
 * klaim bayarnya sedang menunggu verifikasi TIDAK dihitung lewat — salesman yang
 * sudah melapor tidak boleh diperlakukan sebagai penunggak.
 */

export function ringkasKeadaanTagihan(baris: Pick<BarisPiutang, "outstanding" | "keadaan" | "alasan">[], hariToleransi: number): KeadaanTagihan {
  let sisa = 0;
  let fakturTerbuka = 0;
  let lewatJanji = 0;
  let fakturLewatJanji = 0;
  for (const b of baris) {
    if (b.outstanding <= 0) continue;
    sisa += b.outstanding;
    fakturTerbuka += 1;
    if (b.keadaan === "lewat" && (b.alasan.hariTerlambat ?? 1) > hariToleransi) {
      lewatJanji += b.outstanding;
      fakturLewatJanji += 1;
    }
  }
  return { sisa, fakturTerbuka, lewatJanji, fakturLewatJanji };
}

export async function bacaAturanKreditDb(): Promise<AturanKredit> {
  const row = await prisma.systemSetting.findUnique({ where: { key: KUNCI_ATURAN_KREDIT }, select: { value: true } });
  return bacaAturanKredit(row?.value);
}

/** Toko konsinyasi tidak punya piutang — `daftarPiutang` sudah menyaringnya, hasilnya kosong. */
export async function keadaanTagihanToko(
  storeId: string,
  hariToleransi: number,
): Promise<{ keadaan: KeadaanTagihan; baris: BarisPiutang[] }> {
  const baris = (await daftarPiutang({ storeId })).filter((b) => b.outstanding > 0);
  return { keadaan: ringkasKeadaanTagihan(baris, hariToleransi), baris };
}
