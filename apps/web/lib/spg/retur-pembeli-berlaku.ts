import type { Prisma, prisma } from "@elorae/db";

/**
 * SATU definisi "retur pembeli yang berlaku" untuk setiap pembaca basis data.
 *
 * Aturannya (keputusan pemilik 2026-11-02): retur pembeli di konter SPG baru
 * dihitung setelah kantor MENYETUJUINYA (`status = DISETUJUI`). Laporan yang
 * masih menunggu, ditolak kantor, atau ditarik SPG tidak pernah mengurangi
 * apa pun. Yang disetujui berlaku pada tanggal DILAPORKAN (`createdAt`, saat
 * pembeli mengembalikannya — dijepit untuk antrean HP), tidak pernah pada
 * tanggal diputuskan: buku stok toko dan opname berurutan waktu, tutup hari
 * mencocokkan kasir pada hari uangnya dikembalikan, dan komisi menghitung retur
 * di bulan returnya.
 *
 * `SpgSaleLine.returnedQty` SUDAH berarti "yang kembali dan disetujui" — hanya
 * persetujuan yang menaikkannya — jadi pembaca kolom itu tidak perlu saringan
 * ini. Baris buku `RETUR_PEMBELI` dan perubahan `SalesHistory` juga baru ada
 * sesudah persetujuan. Yang WAJIB lewat sini adalah setiap pembaca
 * `SpgSaleReturn`/`SpgSaleReturnLine` yang MENGHITUNG retur (komisi, bahan
 * laporan SPG konsinyasi, promo Elorae, laku bersih, tutup hari, barang rusak
 * dari pembeli, penulis nota retur). `retur-pembeli-berlaku-cakupan.test.ts`
 * memindai sumber supaya pembaca baru tidak lupa.
 *
 * Yang masih menunggu tidak disimpan di mana pun: dihitung dari baris laporan
 * MENUNGGU (`qtyMenungguPerBaris`), dan ikut mengurangi yang masih bisa
 * dilaporkan dari baris nota itu supaya potong yang sama tidak dilaporkan dua kali.
 */

/** Saringan `SpgSaleReturnWhereInput` yang berlaku, sebagai konstanta. */
export const RETUR_PEMBELI_BERLAKU = { status: "DISETUJUI" } as const satisfies Prisma.SpgSaleReturnWhereInput;

/** Laporan yang masih menunggu keputusan kantor. */
export const RETUR_PEMBELI_MENUNGGU = { status: "MENUNGGU" } as const satisfies Prisma.SpgSaleReturnWhereInput;

/**
 * Saringan pemanggil + "hanya yang berlaku". Status ditulis TERAKHIR, jadi tidak
 * ada pemanggil yang bisa menimpanya (mis. menyelipkan `status: "MENUNGGU"`).
 */
export function returPembeliBerlaku(where: Prisma.SpgSaleReturnWhereInput = {}): Prisma.SpgSaleReturnWhereInput {
  return { ...where, status: RETUR_PEMBELI_BERLAKU.status };
}

/**
 * Σ qty baris laporan yang masih MENUNGGU, per baris nota (`SpgSaleLine.id`),
 * dari laporan siapa pun. `kecualiReturnId`: laporan yang sedang dibaca sendiri
 * (rincian kantor menampilkan "menunggu di laporan lain"). Daftar kosong → peta
 * kosong tanpa kueri.
 */
export async function qtyMenungguPerBaris(
  klien: Prisma.TransactionClient | typeof prisma,
  saleLineIds: readonly string[],
  opsi: { kecualiReturnId?: string } = {},
): Promise<Map<string, number>> {
  const hasil = new Map<string, number>();
  const ids = [...new Set(saleLineIds.filter(Boolean))];
  if (ids.length === 0) return hasil;
  const grup = await klien.spgSaleReturnLine.groupBy({
    by: ["spgSaleLineId"],
    where: {
      spgSaleLineId: { in: ids },
      saleReturn: RETUR_PEMBELI_MENUNGGU,
      ...(opsi.kecualiReturnId ? { returnId: { not: opsi.kecualiReturnId } } : {}),
    },
    _sum: { qty: true },
  });
  for (const g of grup) hasil.set(g.spgSaleLineId, g._sum.qty ?? 0);
  return hasil;
}
