import { bahanPotonganRetur, type PotonganPadaKlaim, type PotonganRetur } from './rules';

/**
 * Terjemahan baris basis data menjadi bahan aturan retur.
 *
 * Satu-satunya tempat bentuk Prisma bertemu aturan uang. Layar dan penulis
 * membaca lewat berkas ini supaya keduanya mustahil berbeda pendapat soal
 * berapa yang ditahan.
 */

/** Bentuk yang dipilih dari `PaymentClaimDeduction` beserta nota returnya. */
export type PotonganBasisData = {
  amount: unknown;
  /**
   * Wajib ikut dipilih. Tanpa ini, potongan yang menunjuk nota retur HILANG
   * tidak bisa dibedakan dari potongan yang memang bukan retur — dan keduanya
   * berakhir sebagai `storeReturn: null`.
   */
  storeReturnId: string | null;
  storeReturn: {
    claimedAmount: unknown;
    status: string;
    /** Hitungan gudang. Belum ada, atau masih draft, berarti belum dihitung. */
    warehouseReturn: { physicalAmount: unknown; status: string } | null;
    /**
     * Hitungan barang SUSULAN — barang selisih yang ketemu dan dikirim balik
     * (P22a). Wajib ikut dipilih: nilai fisik nota adalah hitungan asli
     * DITAMBAH susulannya (`nilaiFisikNota`). Pembaca yang lupa memilihnya
     * menahan lebih banyak dari yang seharusnya.
     */
    followUps: { physicalAmount: unknown; status?: string }[];
    /**
     * Beban yang sudah tercatat atas nota ini. `bearer` wajib: beban yang
     * ditanggung TOKO tidak melepas apa pun (keputusan 1, 2026-10-29; P84).
     */
    charges: { status: string; bearer: string | null }[];
  } | null;
};

/** Kolom yang harus ikut dipilih supaya penerjemahannya lengkap. */
export const PILIH_POTONGAN = {
  amount: true,
  storeReturnId: true,
  storeReturn: {
    select: {
      claimedAmount: true,
      status: true,
      warehouseReturn: { select: { physicalAmount: true, status: true } },
      followUps: { where: { status: 'FINAL' }, select: { physicalAmount: true } },
      charges: { select: { status: true, bearer: true } },
    },
  },
} as const;

/**
 * Potongan retur hasil terjemahan. `ditanggungToko` menandai potongan yang
 * selisihnya sudah ditetapkan ditanggung TOKO: bagian itu tetap tertahan di
 * faktur asal (tidak pernah dikreditkan ke toko), tapi BUKAN "tertahan retur"
 * yang menunggu gudang atau keputusan — tokonya memang berutang, dan sales
 * menagihnya. Layar dan pesan yang menyebut "tertahan retur / menunggu
 * pemeriksaan" harus mengecualikannya.
 */
export type PotonganReturDiterjemahkan = PotonganRetur & { ditanggungToko?: boolean };

const angka = (v: unknown): number => Number(v ?? 0);

/**
 * Nilai fisik sebuah nota retur: hitungan asli gudang DITAMBAH setiap hitungan
 * susulan yang sudah final (barang selisih yang ketemu dan dikirim balik, P22a).
 * Dijumlah dalam sen.
 *
 * `null` selama hitungan aslinya belum ada atau belum final — susulan saja
 * tidak pernah membuat sebuah nota "sudah dihitung": tanpa hitungan aslinya
 * belum ada yang tahu berapa yang sampai pertama kali. Susulan yang membawa
 * statusnya dan belum final diabaikan; yang tidak membawanya sudah disaring
 * kuerinya (`PILIH_POTONGAN`).
 */
export function nilaiFisikNota(r: {
  warehouseReturn: { physicalAmount: unknown; status: string } | null;
  followUps: { physicalAmount: unknown; status?: string }[];
}): number | null {
  const asli = r.warehouseReturn;
  if (asli === null || asli.status !== 'FINAL') return null;
  const susulanSen = r.followUps
    .filter((f) => f.status === undefined || f.status === 'FINAL')
    .reduce((n, f) => n + Math.round(angka(f.physicalAmount) * 100), 0);
  return (Math.round(angka(asli.physicalAmount) * 100) + susulanSen) / 100;
}

export function potonganRetur(deductions: PotonganBasisData[]): PotonganReturDiterjemahkan[] {
  // Nota yang selisihnya ditanggung toko — sejajar dengan `bahan` (dipasangkan di bawah).
  const tokoMenanggung: boolean[] = [];
  const bahan: PotonganPadaKlaim[] = deductions.map((d) => {
    const r = d.storeReturn;

    /*
     * Penunjuk menggantung. `relationMode = "prisma"` tidak memasang foreign key,
     * jadi sebuah potongan bisa menunjuk nota retur yang tidak ada — data lama,
     * impor setengah jadi, atau nota yang terhapus. Ditahan penuh, karena
     * satu-satunya arah lain adalah melepas uang yang belum tentu kembali.
     *
     * Bedanya dengan `storeReturnId: null` sangat penting: yang itu memang bukan
     * retur (potongan promosi, misalnya) dan tidak pernah ditahan. Keduanya
     * sampai ke sini sebagai `storeReturn: null`, jadi `storeReturnId` harus
     * ikut dibaca — kalau tidak, potongan retur yang notanya hilang lolos
     * sebagai potongan biasa dan uangnya lepas tanpa jejak.
     */
    if (!r) {
      tokoMenanggung.push(false);
      if (d.storeReturnId === null) return { nilaiPotongan: angka(d.amount), retur: null };
      return {
        nilaiPotongan: angka(d.amount),
        // Tahanan tetap: tidak lepas sendiri, BKM lain boleh melunasinya.
        retur: { nilaiKlaim: angka(d.amount), nilaiFisik: null, bebanDiputuskan: false, tetap: true },
      };
    }

    /*
     * Nota retur yang dibatalkan berarti barangnya tidak jadi datang dan tidak
     * ada siapa pun untuk dibebani — tokonya memang berutang sebesar potongan
     * itu. Dibaca sebagai fisik nol dengan beban terbuka, jadi ditahan penuh dan
     * muncul di layar piutang sebagai "tertahan". Itulah yang membuat ada orang
     * datang membetulkannya; menganggapnya lunas akan menghapus utang diam-diam.
     */
    if (r.status === 'BATAL') {
      tokoMenanggung.push(false);
      return {
        nilaiPotongan: angka(d.amount),
        // Tahanan tetap: nota batal tidak pernah dihitung atau diputuskan, jadi
        // potongannya ditagih lewat BKM berikutnya (`tertahanPiutang`).
        retur: { nilaiKlaim: angka(r.claimedAmount), nilaiFisik: 0, bebanDiputuskan: false, tetap: true },
      };
    }

    /*
     * NRI yang masih DRAFT dianggap belum ada. Brief menyebutnya tegas — yang
     * melepas potongan adalah NRI **final**. Selama gudang belum menutup
     * hitungannya, angkanya masih bisa berubah, dan melepas uang atas angka
     * yang masih bergerak persis kesalahan yang aturan ini cegah.
     *
     * Barang susulan yang sudah dihitung ikut menjadi nilai fisik nota: barang
     * selisih yang ketemu di toko dan dikirim balik mengecilkan yang ditahan.
     */
    const nilaiFisik = nilaiFisikNota(r);

    /*
     * Beban yang masih TERBUKA belum menanggung apa pun; yang menanggung adalah
     * DITETAPKAN (dan LUNAS). Satu pengecualian: beban yang ditetapkan ke TOKO
     * (P84, keputusan 1 2026-10-29) — selisihnya TETAP TERBUKA di nota asal.
     * Bagian itu tidak pernah dikreditkan ke toko: tahanan tetap, yang boleh
     * dilunasi BKM berikutnya — itulah cara toko membayar. Mengalihkannya ke
     * sales (menutup nota sebelum toko membayar) melepasnya.
     */
    const diputuskan = r.charges.filter((c) => c.status !== 'TERBUKA');
    const toko = diputuskan.some((c) => c.bearer === 'TOKO');
    tokoMenanggung.push(toko);

    return {
      nilaiPotongan: angka(d.amount),
      retur: toko
        ? { nilaiKlaim: angka(r.claimedAmount), nilaiFisik, bebanDiputuskan: false, tetap: true }
        : { nilaiKlaim: angka(r.claimedAmount), nilaiFisik, bebanDiputuskan: diputuskan.length > 0 },
    };
  });

  // `bahanPotonganRetur` melewati potongan yang bukan retur, jadi hasilnya
  // dipasangkan kembali dengan bahannya menurut urutan.
  const hasil = bahanPotonganRetur(bahan);
  const tanda = bahan.flatMap((b, i) => (b.retur ? [tokoMenanggung[i]] : []));
  return hasil.map((p, i) => (tanda[i] ? { ...p, ditanggungToko: true } : p));
}
