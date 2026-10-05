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
    // Beban sudah diputuskan → faktur dilepas, penagihan penggantinya jalan sendiri.
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
): number {
  let terbayar = Math.max(0, dibayarSebelumImpor);
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
    if (nilaiFisik === null || nilaiKlaim <= 0) {
      hasil.push({ nilaiKlaim: p.nilaiPotongan, nilaiFisik: null, bebanTerbuka: true });
      continue;
    }
    hasil.push({
      nilaiKlaim: p.nilaiPotongan,
      nilaiFisik: p.nilaiPotongan * (nilaiFisik / nilaiKlaim),
      bebanTerbuka: !bebanDiputuskan,
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

/** Giliran siapa mengerjakan sebuah langkah. */
export function giliranRetur(langkah: LangkahRetur): 'gudang' | 'keuangan' | 'tidak_ada' {
  if (langkah === 'cek') return 'gudang';
  if (langkah === 'keputusan' || langkah === 'jodoh') return 'keuangan';
  return 'tidak_ada';
}
