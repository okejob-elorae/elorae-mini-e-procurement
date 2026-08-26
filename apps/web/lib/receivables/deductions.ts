import { bahanPotonganRetur, type PotonganPadaKlaim, type PotonganRetur } from './rules';

/**
 * Terjemahan baris basis data menjadi bahan aturan retur.
 *
 * Satu-satunya tempat bentuk Prisma bertemu aturan uang. Sebelumnya penerjemahan
 * ini ada dua salinan — di `queries.ts` dan di `writer.ts` — dan keduanya
 * menganggap setiap potongan retur belum dihitung gudang, karena tabel returnya
 * memang belum ada. Sekarang nilainya nyata, jadi salinannya dijadikan satu:
 * layar dan penulis harus mustahil berbeda pendapat soal berapa yang ditahan.
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
    countedAmount: unknown;
    bearer: string | null;
    status: string;
  } | null;
};

/** Kolom yang harus ikut dipilih supaya penerjemahannya lengkap. */
export const PILIH_POTONGAN = {
  amount: true,
  storeReturnId: true,
  storeReturn: {
    select: { claimedAmount: true, countedAmount: true, bearer: true, status: true },
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
        retur: { nilaiKlaim: angka(d.amount), nilaiFisik: null, bebanDiputuskan: false },
      };
    }

    /*
     * Nota retur yang dibatalkan berarti barangnya tidak jadi datang, dan tidak
     * ada siapa pun untuk dibebani — tokonya memang berutang sebesar potongan
     * itu. Dibaca sebagai fisik nol dengan beban terbuka, jadi ditahan penuh dan
     * muncul di layar piutang sebagai "tertahan". Itulah yang membuat ada orang
     * datang membetulkannya; menganggapnya lunas akan menghapus utang diam-diam.
     */
    if (r.status === 'BATAL') {
      return {
        nilaiPotongan: angka(d.amount),
        retur: { nilaiKlaim: angka(r.claimedAmount), nilaiFisik: 0, bebanDiputuskan: false },
      };
    }

    return {
      nilaiPotongan: angka(d.amount),
      retur: {
        nilaiKlaim: angka(r.claimedAmount),
        nilaiFisik: r.countedAmount === null || r.countedAmount === undefined
          ? null
          : angka(r.countedAmount),
        bebanDiputuskan: r.bearer !== null,
      },
    };
  });

  return bahanPotonganRetur(bahan);
}
