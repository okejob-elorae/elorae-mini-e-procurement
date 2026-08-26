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

export type StatusKlaim = 'DIKIRIM' | 'TERVERIFIKASI' | 'DITOLAK';

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
export function hitungSisaPiutang(nilaiPiutang: number, klaimList: PorsiKlaim[]): number {
  let terbayar = 0;
  for (const klaim of klaimList) {
    const diakui = nilaiDiakui(klaim);
    if (diakui <= 0) continue;
    // Klaim bisa melunasi beberapa piutang sekaligus; ambil porsinya saja.
    const porsi = klaim.nilaiFaktur > 0 ? klaim.nilaiDilunasiPiutangIni / klaim.nilaiFaktur : 0;
    terbayar += diakui * porsi;
  }
  return Math.max(0, Math.round(nilaiPiutang - terbayar));
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
  if (b.kontrabon && b.kontrabon.janjiBayar < b.hariIni) return 'lewat';
  if (b.kontrabon) return 'tt';
  return 'belum';
}

/** Selisih hari kalender, dibulatkan ke bawah. */
export function selisihHari(dari: Date, sampai: Date): number {
  const MS = 24 * 60 * 60 * 1000;
  return Math.floor((sampai.getTime() - dari.getTime()) / MS);
}
