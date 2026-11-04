/**
 * Aturan uang piutang — dipindahkan apa adanya dari SSG Pelunasan.
 *
 * Ditulis sebagai fungsi murni, terpisah dari database, karena inilah bagian
 * yang paling mahal kalau salah: dua aturan di bawah adalah alasan program ini
 * ada, dan keduanya menahan uang yang kalau bocor tidak kembali.
 *
 * ATURAN 1 — Klaim bukan lunas.
 *   Piutang hanya berkurang setelah admin keuangan mencocokkan klaim dengan
 *   mutasi rekening. Selama klaim masih DIKIRIM, nilai yang diakui = 0.
 *   Sales pernah lapor "toko sudah transfer", piutang dianggap beres, uangnya
 *   tidak pernah masuk. Longgar sedikit di sini, celah itu terbuka lagi.
 *
 * ATURAN 2 — Retur diakui sebesar barang fisik, bukan sebesar klaim.
 *   Toko menulis nota retur 3 dus, yang sampai gudang 2 dus. Satu dus itu
 *   harus ada yang menanggung, dan sampai diputuskan, selisihnya menahan
 *   faktur tetap terbuka.
 *
 * Semua nilai uang di sini `number` rupiah penuh. Pemanggil bertanggung jawab
 * mengubah Prisma Decimal menjadi number sebelum masuk ke sini — supaya fungsi
 * ini bisa diuji tanpa menyeret Prisma.
 */

import { tanggalWib } from '@/lib/dashboard/hari-wib';

/**
 * `DIBATALKAN` berbeda arti dari `DITOLAK` walau keduanya diakui nol.
 * Ditolak = keuangan melihat dan uangnya tidak ada. Dibatalkan = klaimnya
 * sendiri salah catat. Membedakannya penting karena yang satu pernyataan
 * tentang bank, yang lain pernyataan tentang ketikan.
 */
export type StatusKlaim = 'DIKIRIM' | 'TERVERIFIKASI' | 'DITOLAK' | 'DIBATALKAN';

/** Satu potongan retur pada sebuah klaim pembayaran. */
export type PotonganRetur = {
  /** Nilai yang dipotong toko dari pembayarannya. */
  nilaiKlaim: number;
  /**
   * Nilai barang yang benar-benar dihitung gudang. `null` berarti gudang belum
   * membuat tanda terima final — bukan berarti nol.
   */
  nilaiFisik: number | null;
  /** Apakah selisihnya masih menunggu keputusan siapa yang menanggung. */
  bebanTerbuka: boolean;
  /**
   * Tahanan TETAP: notanya dibatalkan, atau potongannya menunjuk nota yang
   * tidak ada. Tahanan ini tidak lepas sendiri — tokonya memang berutang
   * sebesar potongan itu, jadi BKM lain BOLEH melunasinya (`tertahanPiutang`).
   */
  tetap?: boolean;
};

/**
 * Berapa dari potongan retur yang belum boleh diakui.
 *
 * Perhatikan bedanya `nilaiFisik: null` dengan `nilaiFisik: 0` — yang pertama
 * berarti gudang belum menghitung (tahan penuh), yang kedua berarti gudang
 * sudah menghitung dan hasilnya memang nol barang sampai (juga tahan penuh,
 * tapi lewat jalur selisih). Menyamakan keduanya adalah cara termudah
 * kehilangan uang di sini.
 */
export function returTertahan(potongan: PotonganRetur[]): number {
  let tertahan = 0;
  for (const p of potongan) {
    if (p.nilaiFisik === null) {
      // Gudang belum mengonfirmasi apa pun — tahan seluruh klaimnya.
      tertahan += p.nilaiKlaim;
      continue;
    }
    const selisih = p.nilaiKlaim - p.nilaiFisik;
    if (selisih <= 0) continue; // fisik >= klaim: tidak ada yang ditahan
    if (p.bebanTerbuka) tertahan += selisih;
    // Beban sudah diputuskan → faktur dilepas. Beban yang ditetapkan ke TOKO
    // (P84) ditahan lewat `tetap` oleh penerjemah potongan, bukan di sini.
  }
  return tertahan;
}

export type KlaimPembayaran = {
  status: StatusKlaim;
  /** Nilai faktur yang diklaim dilunasi oleh klaim ini. */
  nilaiFaktur: number;
  potonganRetur: PotonganRetur[];
};

/** ATURAN 1: nol sampai admin melihat uangnya di mutasi bank. */
export function nilaiDiakui(klaim: KlaimPembayaran): number {
  if (klaim.status !== 'TERVERIFIKASI') return 0;
  return Math.max(0, klaim.nilaiFaktur - returTertahan(klaim.potonganRetur));
}

export type PorsiKlaim = KlaimPembayaran & {
  /** Bagian dari klaim ini yang ditujukan ke piutang yang sedang dihitung. */
  nilaiDilunasiPiutangIni: number;
};

/**
 * Sisa piutang selalu dihitung ulang dari nol, tidak pernah diketik manusia dan
 * tidak pernah dikurangi sedikit demi sedikit. Pengurangan bertahap akan
 * menyimpang begitu satu klaim dibatalkan atau sebuah retur berubah — dan
 * penyimpangan itu tidak akan terlihat sampai ada yang menagih ke tempat salah.
 */
export function hitungSisaPiutang(
  nilaiPiutang: number,
  klaimList: PorsiKlaim[],
  /**
   * Bagian faktur yang sudah dibayar SEBELUM faktur ini diimpor
   * (`Receivable.paidBeforeImport`). Faktur Rp10 jt yang di berkasnya bersisa
   * Rp4 jt membawa 6 jt di sini; tanpa itu perhitungan ulang mengembalikannya
   * ke Rp10 jt dan toko ditagih untuk uang yang sudah dibayar.
   */
  dibayarSebelumImpor = 0,
  /**
   * Uang yang masuk lewat pembayaran kantor (`Receivable.paidAmount` —
   * Keuangan → Piutang, setoran penagih, pelunasan toko), bukan lewat BKM.
   * Tanpa itu faktur yang sudah dibayar di kantor tetap tampil terbuka di
   * layar piutang dan di HP sales, dan BKM bisa melunasinya sekali lagi.
   * Dikurangkan SEBELUM dibulatkan: pembayaran kantor boleh bersen, dan faktur
   * bersen yang dilunasi penuh harus bersisa nol, bukan sisa pembulatan.
   */
  dibayarKantor = 0,
): number {
  let terbayar = Math.max(0, dibayarSebelumImpor) + Math.max(0, dibayarKantor);
  for (const klaim of klaimList) {
    const diakui = nilaiDiakui(klaim);
    if (diakui <= 0) continue;
    // Klaim bisa melunasi beberapa piutang sekaligus; ambil porsinya saja.
    const porsi = klaim.nilaiFaktur > 0 ? klaim.nilaiDilunasiPiutangIni / klaim.nilaiFaktur : 0;
    terbayar += diakui * porsi;
  }
  return Math.max(0, Math.round(nilaiPiutang - terbayar));
}

/**
 * Status klaim yang potongannya masih MEMAKAI nota retur. Klaim yang ditolak
 * atau dibatalkan tidak memotong apa pun, jadi notanya bebas dipakai lagi.
 */
export const STATUS_KLAIM_HIDUP = ['DIKIRIM', 'TERVERIFIKASI'] as const;

/**
 * Apakah potongan baru membuat sebuah nota retur terpakai melebihi nilainya.
 *
 * Satu NRT adalah satu janji barang. Memotongkannya penuh di dua BKM membuat
 * toko membayar kurang dua kali untuk barang yang sama — dan karena tiap
 * potongan diprorata terhadap nilai notanya, penahanan Aturan 2 pun ikut
 * terbagi dan tidak pernah menutup selisihnya. Dibandingkan dalam sen supaya
 * pecahan desimal tidak meloloskan atau menolak satu rupiah secara keliru.
 */
export function returTerpakaiMelebihi(nilaiNota: number, sudahDipakai: number, akanDipakai: number): boolean {
  const sen = (n: number) => Math.round(n * 100);
  return sen(sudahDipakai) + sen(akanDipakai) > sen(nilaiNota);
}

const keSen = (n: number) => Math.round(n * 100);

/**
 * Bagian sisa sebuah piutang yang HANYA ditahan Aturan 2: potongan retur di BKM
 * yang sudah terverifikasi, yang returnya belum dihitung gudang atau selisihnya
 * belum diputuskan. Bagian ini lepas sendiri begitu returnya beres, jadi BKM
 * lain tidak boleh melunasinya (KEPUTUSAN SEMENTARA PEMILIK 2026-10-06) —
 * kalau boleh, toko membayar bagian itu dua kali: sekali lewat BKM kedua,
 * sekali lagi lewat potongan yang dilepas.
 *
 * BKM yang belum terverifikasi tidak ikut: ia sendiri belum diakui (Aturan 1).
 * BKM gabungan diprorata menurut porsi faktur ini.
 *
 * Tahanan TETAP (nota dibatalkan, penunjuk menggantung — `PotonganRetur.tetap`)
 * tidak ikut: ia tidak pernah lepas sendiri, tokonya memang berutang sebesar
 * potongan itu, dan BKM berikutnya adalah cara menagihnya (`batalkanRetur`).
 */
export function tertahanPiutang(klaimList: PorsiKlaim[]): number {
  return tertahanPiutangRinci(klaimList).lepasSendiri;
}

/**
 * Mengapa sebagian sisa faktur menunggu (Q15, jawaban pemilik 2026-11-02 "Ya,
 * diingatkan"): returnya belum dihitung gudang, selisihnya belum diputuskan
 * siapa menanggung, atau keduanya pada faktur yang sama.
 */
export type JenisTahanan = "BELUM_DIHITUNG" | "MENUNGGU_BEBAN" | "CAMPURAN";

export type RincianTahanan = {
  /** Bagian yang lepas sendiri begitu returnya beres — `tertahanPiutang`. */
  lepasSendiri: number;
  /** Tahanan TETAP (nota batal / penunjuk menggantung): tokonya memang berutang. */
  tetap: number;
  /** Mengapa bagian `lepasSendiri` menunggu. `null` kalau tidak ada yang menunggu. */
  jenisLepas: JenisTahanan | null;
};

/**
 * `tertahanPiutang` beserta rinciannya, diprorata menurut porsi faktur ini di
 * setiap BKM terverifikasi. Satu-satunya tempat pembagian ini dihitung —
 * `pisahTahananRetur` membaca hasilnya.
 */
export function tertahanPiutangRinci(klaimList: PorsiKlaim[]): RincianTahanan {
  let lepasSendiri = 0;
  let tetap = 0;
  let adaHitung = false;
  let adaBeban = false;
  for (const k of klaimList) {
    if (k.status !== "TERVERIFIKASI" || !(k.nilaiFaktur > 0)) continue;
    const nf = k.nilaiFaktur;
    const semua = Math.min(nf, returTertahan(k.potonganRetur));
    const tetapK = Math.min(nf, returTertahan(k.potonganRetur.filter((p) => p.tetap)));
    // Yang lepas sendiri = tahanan seluruhnya dikurangi yang tetap tertahan
    // sesudahnya (keduanya dibatasi nilai BKM).
    const tahan = semua - tetapK;
    const porsi = k.nilaiDilunasiPiutangIni / nf;
    lepasSendiri += Math.max(0, tahan) * porsi;
    tetap += tetapK * porsi;
    if (tahan > 0 && porsi > 0) {
      const lepas = k.potonganRetur.filter((p) => !p.tetap);
      if (returTertahan(lepas.filter((p) => p.nilaiFisik === null)) > 0) adaHitung = true;
      if (returTertahan(lepas.filter((p) => p.nilaiFisik !== null)) > 0) adaBeban = true;
    }
  }
  const jenisLepas: JenisTahanan | null =
    adaHitung && adaBeban ? "CAMPURAN" : adaHitung ? "BELUM_DIHITUNG" : adaBeban ? "MENUNGGU_BEBAN" : null;
  return { lepasSendiri, tetap, jenisLepas };
}

/**
 * SATU pembagian sisa faktur yang sebagian ditahan retur (Q15):
 * - `bebas` — yang boleh ditagih dan dilunasi BKM baru sekarang;
 * - `ditahan` — yang menunggu returnya beres (dan `sebab`-nya);
 * - `nilaiTertahan` — angka tahanan yang ditampilkan: yang menunggu DITAMBAH
 *   tahanan tetap, karena keduanya membuat faktur ini belum lunas.
 * Tahanan tetap tetap terutang, jadi ia tidak mengurangi `bebas`. Jangan
 * menghitung pembagian ini dengan cara lain di tempat lain.
 */
export function pisahTahananRetur(
  sisa: number,
  rinci: RincianTahanan,
): { bebas: number; ditahan: number; nilaiTertahan: number; sebab: JenisTahanan | null } {
  const bebas = sisaBolehDilunasi(sisa, rinci.lepasSendiri);
  const ditahan = Math.max(0, sisa - bebas);
  const nilaiTertahan = Math.max(0, sisa - sisaBolehDilunasi(sisa, rinci.lepasSendiri + rinci.tetap));
  return { bebas, ditahan, nilaiTertahan, sebab: ditahan > 0 ? rinci.jenisLepas : null };
}

/** Yang masih boleh dilunasi BKM baru: sisa dikurangi yang sedang ditahan, dibulatkan ke rupiah. */
export function sisaBolehDilunasi(sisa: number, tertahan: number): number {
  return Math.max(0, Math.round(sisa - tertahan));
}

export type KeadaanPiutang = 'lunas' | 'klaim' | 'tertahan' | 'lewat' | 'tt' | 'belum';

export type BahanKeadaan = {
  sisa: number;
  /** Ada klaim pembayaran yang masih menunggu verifikasi admin. */
  klaimMenunggu: { docNo: string } | null;
  /** Nilai retur yang tertahan pada klaim yang SUDAH terverifikasi. */
  nilaiTertahan: number;
  /** Kontrabon berjalan, kalau ada. */
  kontrabon: { docNo: string; janjiBayar: Date } | null;
  /** Hari ini, disuntikkan supaya fungsi tetap murni dan bisa diuji. */
  hariIni: Date;
};

/**
 * Enam keadaan, diperiksa BERURUTAN — yang pertama cocok itulah keadaannya.
 * Urutannya bukan selera: "lunas" harus menang atas segalanya, dan "klaim"
 * harus menang atas "lewat" supaya sales yang sudah melapor tidak dimarahi
 * sebagai penunggak.
 */
export function keadaanPiutang(b: BahanKeadaan): KeadaanPiutang {
  if (b.sisa <= 0) return 'lunas';
  if (b.klaimMenunggu) return 'klaim';
  if (b.nilaiTertahan > 0) return 'tertahan';
  // Dibandingkan per HARI KALENDER WIB, bukan per instan: janji disimpan tengah
  // malam WIB, jadi `janjiBayar < hariIni` menandai faktur lewat janji sejak
  // 00.01 di hari janjinya sendiri.
  if (b.kontrabon && tanggalWib(b.kontrabon.janjiBayar) < tanggalWib(b.hariIni)) return 'lewat';
  if (b.kontrabon) return 'tt';
  return 'belum';
}

/** Selisih hari kalender, dibulatkan ke bawah. */
export function selisihHari(dari: Date, sampai: Date): number {
  const MS = 24 * 60 * 60 * 1000;
  return Math.floor((sampai.getTime() - dari.getTime()) / MS);
}

/** Satu potongan pada klaim, apa adanya dari basis data. */
export type PotonganPadaKlaim = {
  /** Nilai yang dipotong dari pembayaran ini. */
  nilaiPotongan: number;
  /**
   * Nota retur yang ditunjuk potongan ini, kalau ada. `null` berarti potongan
   * ini bukan retur sama sekali — potongan promosi, misalnya.
   */
  retur: {
    /** Nilai yang diklaim toko di NRT. */
    nilaiKlaim: number;
    /** Nilai fisik yang dihitung gudang di NRI. `null` = belum dihitung. */
    nilaiFisik: number | null;
    /** Sudah ada yang ditetapkan menanggung selisihnya. */
    bebanDiputuskan: boolean;
    /** Nota dibatalkan / penunjuk menggantung — lihat `PotonganRetur.tetap`. */
    tetap?: boolean;
  } | null;
};

/**
 * Ubah potongan pada sebuah klaim menjadi bahan `returTertahan`.
 *
 * Potongan yang tidak menunjuk nota retur tidak pernah ditahan: ia bukan janji
 * tentang barang yang akan datang, melainkan pengurang harga yang sudah pasti.
 *
 * Nilai fisiknya DIPRORATA menurut porsi potongan ini terhadap seluruh nilai
 * NRT. Satu nota retur boleh dipotong lewat beberapa pembayaran, dan
 * membandingkan tiap potongan langsung dengan nilai fisik seluruh nota membuat
 * setiap potongan tampak sudah tertutup — selisihnya lenyap sepenuhnya.
 *
 *   NRT 1.000.000, fisik 800.000, dipotong 600.000 lalu 400.000.
 *   Diprorata : (600.000 − 480.000) + (400.000 − 320.000) = 200.000 ✓
 *   Tidak     : (600.000 − 800.000) + (400.000 − 800.000) = 0       ✗
 *
 * NRT bernilai nol tidak bisa diprorata dan diperlakukan sebagai belum
 * dihitung — arah yang aman, karena piutang jadi terlihat lebih besar, bukan
 * lebih kecil.
 */
export function bahanPotonganRetur(potongan: PotonganPadaKlaim[]): PotonganRetur[] {
  const hasil: PotonganRetur[] = [];
  for (const p of potongan) {
    if (!p.retur) continue;
    const { nilaiKlaim, nilaiFisik, bebanDiputuskan } = p.retur;
    const tetap = p.retur.tetap ? { tetap: true } : {};
    if (nilaiFisik === null || nilaiKlaim <= 0) {
      hasil.push({ nilaiKlaim: p.nilaiPotongan, nilaiFisik: null, bebanTerbuka: true, ...tetap });
      continue;
    }
    hasil.push({
      nilaiKlaim: p.nilaiPotongan,
      nilaiFisik: p.nilaiPotongan * (nilaiFisik / nilaiKlaim),
      bebanTerbuka: !bebanDiputuskan,
      ...tetap,
    });
  }
  return hasil;
}

export type LangkahRetur = 'jodoh' | 'cek' | 'keputusan' | 'beres' | 'batal';

/**
 * Langkah berikutnya sebuah retur, diperiksa berurutan.
 *
 * Empat langkah dari alur aslinya, plus `batal`. Yang membedakan program ini
 * dari tabel angka adalah tiap baris menyebut langkah berikutnya dan giliran
 * siapa — jadi keadaannya harus satu kata yang bisa diterjemahkan jadi kalimat,
 * bukan gabungan tiga kolom yang harus dibaca sendiri.
 *
 * `jodoh` diperiksa lebih dulu dari `cek`: penerimaan gudang tanpa nota toko
 * sudah terhitung fisiknya — yang kurang bukan hitungannya, melainkan nota
 * mana yang ia lunasi.
 *
 * `keputusan` hanya muncul kalau gudang menerima KURANG dari klaim. Menerima
 * lebih banyak bukan utang toko dan tidak menahan apa pun.
 */
export function langkahRetur(r: {
  dibatalkan: boolean;
  adaNotaToko: boolean;
  adaHitunganFinal: boolean;
  nilaiKlaim: number;
  nilaiFisik: number | null;
  bebanDiputuskan: boolean;
}): LangkahRetur {
  if (r.dibatalkan) return 'batal';
  if (!r.adaNotaToko) return 'jodoh';
  if (!r.adaHitunganFinal || r.nilaiFisik === null) return 'cek';
  if (r.nilaiKlaim - r.nilaiFisik > 0 && !r.bebanDiputuskan) return 'keputusan';
  return 'beres';
}

/** Hasil sales pemegang toko mencari barang selisih retur (P88). */
export type CekSelisih = "DITANYAKAN" | "DITEMUKAN" | "TIDAK_DITEMUKAN";

/**
 * BELUM DIPUTUSKAN — angka 14 bukan jawaban pemilik: P88 dijawab "setuju" atas
 * pertanyaan tanpa batas hari ("boleh membebankan sebelum sales melapor 'tidak
 * ketemu'?"), dan jumlah harinya masih ditanyakan. Tidak dipakai penulis mana pun;
 * kantor boleh membebankan kapan saja. Jangan dipasang sebelum pemilik menjawab.
 */
export const BATAS_HARI_LAPOR_SELISIH = 14;

const HARI_MS = 86_400_000;

/**
 * BELUM DIPUTUSKAN pemilik (P88 terbuka, lihat `BATAS_HARI_LAPOR_SELISIH`) — tidak
 * dipakai penulis mana pun, jangan dipasang. Rancangannya: seketika kalau sales
 * melaporkan barangnya TIDAK ditemukan; selain itu mulai hari ke-N sejak
 * selisihnya lahir, dihitung per hari kalender WIB (tengah malam WIB batasnya).
 * `mulai` = tanggal WIB (YYYY-MM-DD) sejak kapan boleh tanpa laporan sales.
 */
export function bolehDibebankanKeSales(b: {
  cek: CekSelisih;
  dibuatPada: Date;
  sekarang: Date;
}): { boleh: boolean; mulai: string } {
  const lahir = Date.parse(`${tanggalWib(b.dibuatPada)}T00:00:00Z`);
  const mulai = new Date(lahir + BATAS_HARI_LAPOR_SELISIH * HARI_MS).toISOString().slice(0, 10);
  if (b.cek === "TIDAK_DITEMUKAN") return { boleh: true, mulai };
  return { boleh: tanggalWib(b.sekarang) >= mulai, mulai };
}

/**
 * Status beban selisih yang ditanggung sales sesudah besarnya atau potongannya
 * berubah: LUNAS begitu yang sudah dipotong menutup besarnya (dibandingkan
 * dalam sen), DITETAPKAN selama masih kurang. Beban bernilai nol yang belum
 * pernah dipotong tidak berubah status — tidak ada yang lunas atau kurang.
 */
export function statusBebanSales(
  amount: number,
  settled: number,
  sekarang: "DITETAPKAN" | "LUNAS",
): "DITETAPKAN" | "LUNAS" {
  if (keSen(amount) <= 0 && keSen(settled) <= 0) return sekarang;
  return keSen(settled) >= keSen(amount) ? "LUNAS" : "DITETAPKAN";
}

/**
 * Giliran siapa mengerjakan sebuah langkah.
 *
 * Langkah `keputusan` yang membawa hasil cek sales (`cek`) dibagi lagi:
 * - sales belum melapor, atau barang yang ia temukan sudah sampai dan masih
 *   ada sisa selisih → `sales` (mencari / memeriksa lagi);
 * - sales melapor barangnya ditemukan, susulannya belum dihitung → `gudang`;
 * - sales melapor tidak ditemukan, atau batas lapor (14 hari) sudah lewat →
 *   `keuangan` (kantor memutuskan penanggungnya).
 * Tanpa `cek` perilakunya sama dengan sebelumnya.
 */
export function giliranRetur(
  langkah: LangkahRetur,
  cek?: { status: CekSelisih; adaSusulanSesudahLapor: boolean; batasLewat: boolean } | null,
): "gudang" | "keuangan" | "sales" | "tidak_ada" {
  if (langkah === "cek") return "gudang";
  if (langkah === "jodoh") return "keuangan";
  if (langkah === "keputusan") {
    if (!cek || cek.status === "TIDAK_DITEMUKAN" || cek.batasLewat) return "keuangan";
    if (cek.status === "DITEMUKAN" && !cek.adaSusulanSesudahLapor) return "gudang";
    return "sales";
  }
  return "tidak_ada";
}
