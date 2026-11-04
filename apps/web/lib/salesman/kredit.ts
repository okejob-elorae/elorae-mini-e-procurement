/**
 * Aturan kredit toko saat salesman mengambil pesanan PUTUS — murni, satu tempat.
 *
 * Dipakai tiga pihak yang tidak boleh berbeda pendapat: layar HP (peringatan
 * sebelum Kirim), server (menolak atau menandai saat pesanan dibuat), dan
 * layar persetujuan kantor. Lapis mode ini hanya menilai toko PUTUS. Tagihan
 * konsinyasi TETAP piutang, dan batas nilai MILIK toko konsinyasi menggerbangkan
 * transfernya saat disetujui (gerbang tim, atas eksposurnya saja).
 *
 * Kedua lapis membaca SATU angka: `computeStoreCreditExposure`
 * (`lib/finance/ar/credit-exposure.ts`) lewat `keadaanDariEksposur`, dan
 * membandingkannya dengan batas lewat `lewatBatasNilai` (keputusan pemilik
 * 2026-11-02, Q10: pesanan disetujui yang belum masuk nota ikut dihitung di
 * kedua pemeriksaan).
 *
 * Mode diatur pemilik di Pengaturan → Salesman (`SystemSetting salesman.kredit`):
 * - PERINGATAN (bawaan): salesman dan penyetuju diberi tahu, pesanan jalan.
 * - TAHAN: pesanan tercatat tapi penyetuju harus menyatakan sudah memeriksa
 *   tagihannya sebelum bisa menyetujui.
 * - BLOKIR: pesanan ditolak sejak dibuat.
 *
 * Batas per toko (`Store.creditLimit`, `Store.maxOpenInvoices`) menimpa batas
 * bawaan; kosong berarti ikut bawaan, dan 0 adalah nilai sah ("tidak boleh ada").
 * Toko yang dicentang "Tanpa batas kredit" (`Store.noCreditLimit`) tidak dinilai
 * batas nilai maupun batas fakturnya; tagihan lewat janji tetap dinilai.
 * Batas yang berlaku SELALU dibaca lewat `batasKreditBerlaku` — juga oleh dasar
 * kredit tim (`creditHoldAtCreate` dan gerbang persetujuan di
 * `lib/field-sales/writer.ts`), supaya kedua pemeriksaan tidak pernah berbeda
 * pendapat tentang arti kolom kosong (keputusan pemilik 2026-11-01, pilihan C).
 */

export type ModeKredit = "PERINGATAN" | "TAHAN" | "BLOKIR";
export const MODE_KREDIT: readonly ModeKredit[] = ["PERINGATAN", "TAHAN", "BLOKIR"];

export type AturanKredit = {
  mode: ModeKredit;
  /** Batas sisa tagihan toko (faktur belum lunas + disetujui belum dinota) sesudah pesanan ini; null = tidak dibatasi. */
  batasNilai: number | null;
  /** Batas jumlah faktur yang belum lunas; null = tidak dibatasi. */
  batasFaktur: number | null;
  /** Tagihan baru dianggap "lewat janji" sesudah lewat sekian hari. */
  hariToleransi: number;
};

export const ATURAN_KREDIT_BAWAAN: AturanKredit = { mode: "PERINGATAN", batasNilai: null, batasFaktur: null, hariToleransi: 0 };
export const KUNCI_ATURAN_KREDIT = "salesman.kredit";

/**
 * Bahan angka kredit dari `computeStoreCreditExposure`, tanpa impor — supaya
 * berkas murni ini tetap bisa dipakai layar HP.
 */
export type EksposurKredit = {
  receivableOutstanding: number;
  undeliveredOrderResidual: number;
  openInvoiceCount: number;
};

export type KeadaanTagihan = {
  /**
   * Sisa faktur yang belum lunas = `computeStoreCreditExposure.receivableOutstanding`
   * (kolom tim `outstandingAmount`, yang dijaga selaras oleh setiap penulis piutang).
   */
  sisa: number;
  /**
   * Pesanan PUTUS yang sudah disetujui tapi belum masuk nota, dari
   * `computeStoreCreditExposure`. Ikut batas nilai, tidak pernah ikut hitungan faktur.
   */
  belumDinota: number;
  fakturTerbuka: number;
  /** Sisa piutang yang sudah lewat janji bayar / jatuh tempo (sesudah toleransi). */
  lewatJanji: number;
  fakturLewatJanji: number;
};

export type AlasanKredit =
  | { kode: "LEWAT_JANJI"; nilai: number; faktur: number }
  | {
      kode: "MELEBIHI_BATAS_NILAI";
      sisaSesudah: number;
      batas: number;
      /** Rinciannya: faktur belum lunas, disetujui belum dinota, dan pesanan ini. */
      sisaFaktur?: number;
      belumDinota?: number;
      pesanan?: number;
    }
  | { kode: "MELEBIHI_BATAS_FAKTUR"; faktur: number; batas: number };

export type TingkatKredit = "AMAN" | ModeKredit;
export type HasilKredit = { tingkat: TingkatKredit; alasan: AlasanKredit[] };

/**
 * Keputusan pemilik P21 (2026-11-02, "Tidak"): toko KONSINYASI yang kolom
 * batasnya kosong TIDAK dibatasi sama sekali — batas bawaan di Pengaturan →
 * Salesman hanya untuk toko PUTUS. Ini mengoreksi kesimpulan sebelumnya (Q11)
 * dari jawaban 1 November. Toko konsi yang berbatas sendiri tetap dinilai.
 */
export const BAWAAN_BERLAKU_UNTUK_KONSI: boolean = false;

/** Batas milik satu toko, apa adanya dari master toko. */
export type BatasToko = {
  creditLimit?: number | null;
  maxOpenInvoices?: number | null;
  /** Dicentang "Tanpa batas kredit": batas nilai dan batas faktur tidak dinilai. */
  noCreditLimit?: boolean;
  /** Tidak diisi = PUTUS (lapis mode hanya menilai toko putus). */
  termsType?: "PUTUS" | "KONSI";
};

/**
 * Satu batas yang berlaku, dengan asalnya — supaya layar bisa menulis "khusus
 * toko ini", "ikut bawaan", atau "tanpa batas" dari keputusan yang SAMA dengan
 * pemeriksaannya.
 * - TOKO: angka di master toko (0 sah: tidak boleh ada).
 * - BAWAAN: kolom toko kosong, angka bawaan Pengaturan dipakai.
 * - TANPA_BATAS: toko dicentang "Tanpa batas kredit".
 * - BAWAAN_KOSONG: kolom toko kosong dan bawaan Pengaturan juga kosong.
 * - KONSI_KOSONG: toko konsinyasi berkolom kosong — tidak dibatasi (P21, lihat `BAWAAN_BERLAKU_UNTUK_KONSI`).
 */
export type BatasBerlaku =
  | { sumber: "TOKO"; nilai: number }
  | { sumber: "BAWAAN"; nilai: number }
  | { sumber: "TANPA_BATAS"; nilai: null }
  | { sumber: "BAWAAN_KOSONG"; nilai: null }
  | { sumber: "KONSI_KOSONG"; nilai: null };

export type SumberBatas = BatasBerlaku["sumber"];

const adaAngka = (x: number | null | undefined): x is number => x !== null && x !== undefined;

function satuBatas(milikToko: number | null | undefined, bawaan: number | null, toko: BatasToko): BatasBerlaku {
  if (toko.noCreditLimit === true) return { sumber: "TANPA_BATAS", nilai: null };
  if (adaAngka(milikToko)) return { sumber: "TOKO", nilai: milikToko };
  if (toko.termsType === "KONSI" && !BAWAAN_BERLAKU_UNTUK_KONSI) return { sumber: "KONSI_KOSONG", nilai: null };
  if (adaAngka(bawaan)) return { sumber: "BAWAAN", nilai: bawaan };
  return { sumber: "BAWAAN_KOSONG", nilai: null };
}

/**
 * Batas nilai dan batas faktur yang berlaku untuk satu toko. SATU-SATUNYA
 * tempat arti kolom kosong diputuskan: dipakai `nilaiKredit` (HP, saat pesanan
 * dibuat, panel persetujuan), dasar kredit tim di penulis pesanan, rincian toko,
 * dan pratinjau persetujuan. Bawaan Pengaturan yang kosong berarti tidak
 * dibatasi — sama dengan keadaan pabrik.
 */
export function batasKreditBerlaku(
  toko: BatasToko,
  aturan: Pick<AturanKredit, "batasNilai" | "batasFaktur">,
): { nilai: BatasBerlaku; faktur: BatasBerlaku } {
  return {
    nilai: satuBatas(toko.creditLimit, aturan.batasNilai, toko),
    faktur: satuBatas(toko.maxOpenInvoices, aturan.batasFaktur, toko),
  };
}

/**
 * Keadaan tagihan dari satu bacaan `computeStoreCreditExposure`, ditambah
 * keadaan janji bayar dari daftar piutang. Satu-satunya cara lapis mode
 * memperoleh `sisa`, `belumDinota`, dan `fakturTerbuka` — angka yang sama
 * dengan gerbang persetujuan.
 */
export function keadaanDariEksposur(
  eksposur: EksposurKredit,
  lewat: Pick<KeadaanTagihan, "lewatJanji" | "fakturLewatJanji">,
): KeadaanTagihan {
  return {
    sisa: eksposur.receivableOutstanding,
    belumDinota: eksposur.undeliveredOrderResidual,
    fakturTerbuka: eksposur.openInvoiceCount,
    lewatJanji: lewat.lewatJanji,
    fakturLewatJanji: lewat.fakturLewatJanji,
  };
}

/**
 * Apakah sisa sesudah pesanan melewati batas nilai — dibandingkan per sen,
 * supaya pecahan float (0,1 + 0,2) tidak pernah memutus beda. Sama dengan batas
 * BUKAN lewat. Dipakai kedua lapis kredit dan pratinjaunya.
 */
export function lewatBatasNilai(sisaSesudah: number, batas: number): boolean {
  return Math.round(sisaSesudah * 100) > Math.round(batas * 100);
}

export function nilaiKredit(
  keadaan: KeadaanTagihan,
  aturan: AturanKredit,
  toko: BatasToko,
  nilaiPesanan: number,
): HasilKredit {
  const alasan: AlasanKredit[] = [];
  if (keadaan.lewatJanji > 0) {
    alasan.push({ kode: "LEWAT_JANJI", nilai: keadaan.lewatJanji, faktur: keadaan.fakturLewatJanji });
  }
  const batas = batasKreditBerlaku(toko, aturan);
  // Halaman HP yang tersimpan sebelum pembaruan tidak membawa `belumDinota`: dihitung nol.
  const belumDinota = Number.isFinite(keadaan.belumDinota) ? keadaan.belumDinota : 0;
  const pesanan = Math.max(0, nilaiPesanan);
  const sisaSesudah = keadaan.sisa + belumDinota + pesanan;
  if (batas.nilai.nilai !== null && lewatBatasNilai(sisaSesudah, batas.nilai.nilai)) {
    alasan.push({
      kode: "MELEBIHI_BATAS_NILAI",
      sisaSesudah,
      batas: batas.nilai.nilai,
      sisaFaktur: keadaan.sisa,
      belumDinota,
      pesanan,
    });
  }
  if (batas.faktur.nilai !== null && keadaan.fakturTerbuka >= batas.faktur.nilai) {
    alasan.push({ kode: "MELEBIHI_BATAS_FAKTUR", faktur: keadaan.fakturTerbuka, batas: batas.faktur.nilai });
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
