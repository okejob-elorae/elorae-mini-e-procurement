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
    /** Beban yang sudah tercatat atas nota ini. */
    charges: { status: string }[];
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
      charges: { select: { status: true } },
    },
  },
} as const;

const angka = (v: unknown): number => Number(v ?? 0);

export function potonganRetur(deductions: PotonganBasisData[]): PotonganRetur[] {
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
     */
    const nri = r.warehouseReturn;
    const sudahDihitung = nri !== null && nri.status === 'FINAL';

    return {
      nilaiPotongan: angka(d.amount),
      retur: {
        nilaiKlaim: angka(r.claimedAmount),
        nilaiFisik: sudahDihitung ? angka(nri.physicalAmount) : null,
        // Beban yang masih TERBUKA belum menanggung apa pun; yang menanggung
        // adalah DITETAPKAN (dan LUNAS, yang sudah dibayar balik).
        bebanDiputuskan: r.charges.some((c) => c.status !== 'TERBUKA'),
      },
    };
  });

  return bahanPotonganRetur(bahan);
}
