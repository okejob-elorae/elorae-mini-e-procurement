/**
 * Aturan kredit toko saat salesman mengambil pesanan PUTUS — murni, satu tempat.
 *
 * Dipakai tiga pihak yang tidak boleh berbeda pendapat: layar HP (peringatan
 * sebelum Kirim), server (menolak atau menandai saat pesanan dibuat), dan
 * layar persetujuan kantor. Toko konsinyasi tidak punya piutang, jadi pemanggil
 * tidak menilai mereka sama sekali.
 *
 * Mode diatur pemilik di Pengaturan → Salesman (`SystemSetting salesman.kredit`):
 * - PERINGATAN (bawaan): salesman dan penyetuju diberi tahu, pesanan jalan.
 * - TAHAN: pesanan tercatat tapi penyetuju harus menyatakan sudah memeriksa
 *   tagihannya sebelum bisa menyetujui.
 * - BLOKIR: pesanan ditolak sejak dibuat.
 *
 * Batas per toko (`Store.creditLimit`, `Store.maxOpenInvoices`) menimpa batas
 * bawaan; kosong berarti ikut bawaan, dan 0 adalah nilai sah ("tidak boleh ada").
 */

export type ModeKredit = "PERINGATAN" | "TAHAN" | "BLOKIR";
export const MODE_KREDIT: readonly ModeKredit[] = ["PERINGATAN", "TAHAN", "BLOKIR"];

export type AturanKredit = {
  mode: ModeKredit;
  /** Batas sisa piutang toko sesudah pesanan ini; null = tidak dibatasi. */
  batasNilai: number | null;
  /** Batas jumlah faktur yang belum lunas; null = tidak dibatasi. */
  batasFaktur: number | null;
  /** Tagihan baru dianggap "lewat janji" sesudah lewat sekian hari. */
  hariToleransi: number;
};

export const ATURAN_KREDIT_BAWAAN: AturanKredit = { mode: "PERINGATAN", batasNilai: null, batasFaktur: null, hariToleransi: 0 };
export const KUNCI_ATURAN_KREDIT = "salesman.kredit";

export type KeadaanTagihan = {
  /** Sisa piutang toko, dihitung ulang (bukan kolom `outstanding`). */
  sisa: number;
  fakturTerbuka: number;
  /** Sisa piutang yang sudah lewat janji bayar / jatuh tempo (sesudah toleransi). */
  lewatJanji: number;
  fakturLewatJanji: number;
};

export type AlasanKredit =
  | { kode: "LEWAT_JANJI"; nilai: number; faktur: number }
  | { kode: "MELEBIHI_BATAS_NILAI"; sisaSesudah: number; batas: number }
  | { kode: "MELEBIHI_BATAS_FAKTUR"; faktur: number; batas: number };

export type TingkatKredit = "AMAN" | ModeKredit;
export type HasilKredit = { tingkat: TingkatKredit; alasan: AlasanKredit[] };

export function nilaiKredit(
  keadaan: KeadaanTagihan,
  aturan: AturanKredit,
  toko: { creditLimit?: number | null; maxOpenInvoices?: number | null },
  nilaiPesanan: number,
): HasilKredit {
  const alasan: AlasanKredit[] = [];
  if (keadaan.lewatJanji > 0) {
    alasan.push({ kode: "LEWAT_JANJI", nilai: keadaan.lewatJanji, faktur: keadaan.fakturLewatJanji });
  }
  const batasNilai = toko.creditLimit ?? aturan.batasNilai;
  const sisaSesudah = keadaan.sisa + Math.max(0, nilaiPesanan);
  if (batasNilai !== null && batasNilai !== undefined && sisaSesudah > batasNilai) {
    alasan.push({ kode: "MELEBIHI_BATAS_NILAI", sisaSesudah, batas: batasNilai });
  }
  const batasFaktur = toko.maxOpenInvoices ?? aturan.batasFaktur;
  if (batasFaktur !== null && batasFaktur !== undefined && keadaan.fakturTerbuka >= batasFaktur) {
    alasan.push({ kode: "MELEBIHI_BATAS_FAKTUR", faktur: keadaan.fakturTerbuka, batas: batasFaktur });
  }
  return { tingkat: alasan.length === 0 ? "AMAN" : aturan.mode, alasan };
}

const angkaSah = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x >= 0;

/** `SystemSetting` → aturan. Nilai rusak dibaca sebagai bawaan per kolom, tidak dilempar. */
export function bacaAturanKredit(nilai: string | null | undefined): AturanKredit {
  if (!nilai) return ATURAN_KREDIT_BAWAAN;
  let x: Record<string, unknown>;
  try {
    x = JSON.parse(nilai) as Record<string, unknown>;
  } catch {
    return ATURAN_KREDIT_BAWAAN;
  }
  if (!x || typeof x !== "object") return ATURAN_KREDIT_BAWAAN;
  return {
    mode: MODE_KREDIT.includes(x.mode as ModeKredit) ? (x.mode as ModeKredit) : ATURAN_KREDIT_BAWAAN.mode,
    batasNilai: angkaSah(x.batasNilai) ? x.batasNilai : null,
    batasFaktur: angkaSah(x.batasFaktur) ? Math.floor(x.batasFaktur) : null,
    hariToleransi: angkaSah(x.hariToleransi) ? Math.floor(x.hariToleransi) : 0,
  };
}
