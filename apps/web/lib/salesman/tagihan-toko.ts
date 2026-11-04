import { prisma } from "@elorae/db";
import { computeStoreCreditExposure } from "@/lib/finance/ar/credit-exposure";
import { daftarPiutang, type BarisPiutang } from "@/lib/receivables/queries";
import { bacaAturanKredit, keadaanDariEksposur, KUNCI_ATURAN_KREDIT, type AturanKredit, type KeadaanTagihan } from "./kredit";

/**
 * Keadaan tagihan satu toko — bahan penilaian kredit (`nilaiKredit`) dan kartu
 * ringkasan toko di aplikasi HP.
 *
 * `sisa`, `belumDinota`, dan `fakturTerbuka` dibaca dari SATU angka kredit,
 * `computeStoreCreditExposure` — angka yang sama dengan gerbang persetujuan
 * (keputusan pemilik Q10, 2026-11-02). `daftarPiutang` hanya menyumbang keadaan
 * janji bayar dan daftar fakturnya. "Lewat janji" mengikuti keadaan piutang yang
 * sama dengan layar Tagihan: kontrabon yang tanggal janjinya sudah lewat. Faktur
 * yang klaim bayarnya sedang menunggu verifikasi TIDAK dihitung lewat — salesman
 * yang sudah melapor tidak boleh diperlakukan sebagai penunggak.
 */

export function ringkasLewatJanji(
  baris: Pick<BarisPiutang, "outstanding" | "keadaan" | "alasan">[],
  hariToleransi: number,
): Pick<KeadaanTagihan, "lewatJanji" | "fakturLewatJanji"> {
  let lewatJanji = 0;
  let fakturLewatJanji = 0;
  for (const b of baris) {
    if (b.outstanding <= 0) continue;
    if (b.keadaan === "lewat" && (b.alasan.hariTerlambat ?? 1) > hariToleransi) {
      lewatJanji += b.outstanding;
      fakturLewatJanji += 1;
    }
  }
  return { lewatJanji, fakturLewatJanji };
}

export async function bacaAturanKreditDb(): Promise<AturanKredit> {
  const row = await prisma.systemSetting.findUnique({ where: { key: KUNCI_ATURAN_KREDIT }, select: { value: true } });
  return bacaAturanKredit(row?.value);
}

/**
 * Untuk toko mana pun, konsinyasi juga — tagihan konsinyasi adalah piutang.
 *
 * Daftar faktur yang dikembalikan hanya faktur yang terbuka MENURUT KEDUA
 * bacaan: dihitung ulang terbuka oleh `daftarPiutang`, dan dihitung terbuka oleh
 * angka kredit (`openReceivableIds`). Faktur yang hanya terbuka di salah satunya
 * berarti kedua keluarga kolom piutang tidak selaras — dicatat, tidak dilempar,
 * dan tidak ditebak.
 *
 * Perbandingannya memakai aturan terbuka yang SAMA di kedua sisi: sisa yang
 * dibulatkan paling sedikit satu rupiah (seperti `openReceivableIds`). Sisa di
 * bawah satu rupiah yang sama di kedua keluarga kolom bukan selisih, jadi tidak
 * dicatat — kalau dicatat, peringatannya muncul di setiap pemuatan dan tidak
 * lagi berarti apa-apa.
 */
export async function keadaanTagihanToko(
  storeId: string,
  hariToleransi: number,
): Promise<{ keadaan: KeadaanTagihan; baris: BarisPiutang[] }> {
  const [eksposur, semua] = await Promise.all([computeStoreCreditExposure(prisma, storeId), daftarPiutang({ storeId })]);
  const terbuka = new Set(eksposur.openReceivableIds);
  const hitungUlangTerbuka = semua.filter((b) => b.outstanding > 0);
  const terbukaHitungUlang = new Set(semua.filter((b) => Math.round(b.outstanding) >= 1).map((b) => b.id));
  for (const id of new Set([...terbuka, ...terbukaHitungUlang])) {
    if (terbuka.has(id) !== terbukaHitungUlang.has(id)) {
      console.warn("[kredit] piutang %s: kolom tim dan hitung ulang berbeda", id);
    }
  }
  const baris = hitungUlangTerbuka.filter((b) => terbuka.has(b.id));
  return { keadaan: keadaanDariEksposur(eksposur, ringkasLewatJanji(baris, hariToleransi)), baris };
}
