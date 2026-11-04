import type { Prisma, prisma } from "@elorae/db";

/**
 * SATU definisi "retur pembeli yang berlaku" untuk setiap pembaca basis data.
 *
 * Aturannya (keputusan pemilik 2026-11-02): retur pembeli di konter SPG baru
 * dihitung setelah kantor MENYETUJUINYA (`status = DISETUJUI`). Laporan yang
 * masih menunggu, ditolak kantor, atau ditarik SPG tidak pernah mengurangi
 * apa pun. Tanggalnya per pembaca:
 * - laporan SPG konsinyasi, promo Elorae, laku bersih, dan baris buku stok
 *   `RETUR_PEMBELI`: tanggal DILAPORKAN (`createdAt`, saat pembeli
 *   mengembalikannya — dijepit untuk antrean HP), tidak pernah tanggal diputuskan;
 * - tutup hari: hari uangnya DIKEMBALIKAN kasir (`refundedAt`) — sejak P13a
 *   uang itu baru keluar dari laci sesudah kantor menyetujui;
 * - komisi: bulan nota ASLI lewat koreksi (P9) — milik modul komisi, tidak di sini.
 *
 * `SpgSaleLine.returnedQty` SUDAH berarti "yang kembali dan disetujui" — hanya
 * persetujuan yang menaikkannya — jadi pembaca kolom itu tidak perlu saringan
 * ini. Baris buku `RETUR_PEMBELI` dan perubahan `SalesHistory` juga baru ada
 * sesudah persetujuan. Yang WAJIB lewat sini adalah setiap pembaca
 * `SpgSaleReturn`/`SpgSaleReturnLine` yang MENGHITUNG retur (komisi, bahan
 * laporan SPG konsinyasi, promo Elorae, laku bersih, tutup hari, barang rusak
 * dari pembeli, penulis nota retur, opname toko). `retur-pembeli-berlaku-cakupan.test.ts`
 * memindai sumber supaya pembaca baru tidak lupa.
 *
 * Yang masih menunggu tidak disimpan di mana pun: dihitung dari baris laporan
 * MENUNGGU (`qtyMenungguPerBaris`), dan ikut mengurangi yang masih bisa
 * dilaporkan dari baris nota itu supaya potong yang sama tidak dilaporkan dua
 * kali. Begitu juga yang DITAHAN beban (`qtyDitahanBebanPerBaris`): laporan
 * ditolak yang uangnya sudah dikembalikan — potongnya menunggu nasib bebannya.
 */

/** Saringan `SpgSaleReturnWhereInput` yang berlaku, sebagai konstanta. */
export const RETUR_PEMBELI_BERLAKU = { status: "DISETUJUI" } as const satisfies Prisma.SpgSaleReturnWhereInput;

/** Laporan yang masih menunggu keputusan kantor. */
export const RETUR_PEMBELI_MENUNGGU = { status: "MENUNGGU" } as const satisfies Prisma.SpgSaleReturnWhereInput;

/**
 * Laporan yang BELUM berlaku (menunggu atau ditolak). Tutup hari memakainya,
 * bersama `refundedAt` di hari itu, untuk MENJELASKAN selisih kasir — potong
 * yang uangnya dikembalikan sebelum disetujui. Tidak pernah mengurangi penjualan bersih.
 */
export const RETUR_PEMBELI_UANG_KEMBALI_BELUM_BERLAKU = {
  status: { in: ["MENUNGGU", "DITOLAK"] },
} satisfies Prisma.SpgSaleReturnWhereInput;

/**
 * Laporan DITOLAK yang uangnya sudah dikembalikan (dicatat SPG atau ditandai
 * kantor, P78): potongnya DITAHAN — tidak bisa dilaporkan ulang, nasibnya lewat
 * beban SPG (penolakan dibatalkan, P82, atau barangnya diputuskan, P79).
 */
export const RETUR_PEMBELI_DITAHAN_BEBAN = {
  status: "DITOLAK",
  OR: [{ refundedAt: { not: null } }, { refundMarkedById: { not: null } }],
} satisfies Prisma.SpgSaleReturnWhereInput;

/**
 * Saringan pemanggil + "hanya yang berlaku". Status ditulis TERAKHIR, jadi tidak
 * ada pemanggil yang bisa menimpanya (mis. menyelipkan `status: "MENUNGGU"`).
 */
export function returPembeliBerlaku(where: Prisma.SpgSaleReturnWhereInput = {}): Prisma.SpgSaleReturnWhereInput {
  return { ...where, status: RETUR_PEMBELI_BERLAKU.status };
}

type Klien = Prisma.TransactionClient | typeof prisma;

const idUnik = (saleLineIds: readonly string[]) => [...new Set(saleLineIds.filter(Boolean))];

function petaJumlah(grup: { spgSaleLineId: string; _sum: { qty: number | null } }[]): Map<string, number> {
  return new Map(grup.map((g) => [g.spgSaleLineId, g._sum.qty ?? 0]));
}

/**
 * Σ qty baris laporan yang masih MENUNGGU, per baris nota (`SpgSaleLine.id`),
 * dari laporan siapa pun. `kecualiReturnId`: laporan yang sedang dibaca sendiri
 * (rincian kantor menampilkan "menunggu di laporan lain"). Daftar kosong → peta
 * kosong tanpa kueri.
 */
export async function qtyMenungguPerBaris(
  klien: Klien,
  saleLineIds: readonly string[],
  opsi: { kecualiReturnId?: string } = {},
): Promise<Map<string, number>> {
  const ids = idUnik(saleLineIds);
  if (ids.length === 0) return new Map();
  const grup = await klien.spgSaleReturnLine.groupBy({
    by: ["spgSaleLineId"],
    where: {
      spgSaleLineId: { in: ids },
      saleReturn: RETUR_PEMBELI_MENUNGGU,
      ...(opsi.kecualiReturnId ? { returnId: { not: opsi.kecualiReturnId } } : {}),
    },
    _sum: { qty: true },
  });
  return petaJumlah(grup);
}

/**
 * Σ qty baris laporan yang DITAHAN beban (`RETUR_PEMBELI_DITAHAN_BEBAN`), per
 * baris nota. Laporan yang barangnya sudah diputuskan DIBELI_SPG tetap ditahan
 * (penjualannya berdiri); yang diputuskan KEMBALI_STOK atau penolakannya
 * dibatalkan sudah DISETUJUI, jadi tidak lagi di sini.
 */
export async function qtyDitahanBebanPerBaris(
  klien: Klien,
  saleLineIds: readonly string[],
  opsi: { kecualiReturnId?: string } = {},
): Promise<Map<string, number>> {
  const ids = idUnik(saleLineIds);
  if (ids.length === 0) return new Map();
  const grup = await klien.spgSaleReturnLine.groupBy({
    by: ["spgSaleLineId"],
    where: {
      spgSaleLineId: { in: ids },
      saleReturn: RETUR_PEMBELI_DITAHAN_BEBAN,
      ...(opsi.kecualiReturnId ? { returnId: { not: opsi.kecualiReturnId } } : {}),
    },
    _sum: { qty: true },
  });
  return petaJumlah(grup);
}
