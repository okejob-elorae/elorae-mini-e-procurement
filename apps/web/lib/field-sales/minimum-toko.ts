import { prisma } from "@elorae/db";
import { bacaAturanMinimum, KUNCI_MIN_PERTAMA, KUNCI_MIN_ULANG, minimumToko, type AturanMinimum, type JenisMinimum } from "./minimum-pesanan";

type Klien = {
  systemSetting: Pick<typeof prisma.systemSetting, "findMany">;
  fieldSalesOrder: Pick<typeof prisma.fieldSalesOrder, "findFirst">;
};

export type MinimumTokoTerbaca = { min: number; jenis: JenisMinimum; aturan: AturanMinimum };

/**
 * Minimum pesan PUTUS yang berlaku untuk satu toko. Dipakai penulis pesanan
 * (dengan `tx`, supaya dibaca di transaksi yang sama dengan pesanannya) dan
 * halaman katalog — keduanya harus sampai ke angka yang sama.
 *
 * "Pesan ulang" = toko sudah punya minimal satu pesanan PUTUS yang DISETUJUI.
 * Pesanan yang masih menunggu atau ditolak belum membuktikan toko ini pelanggan.
 */
export async function muatMinimumToko(storeId: string, client: Klien = prisma): Promise<MinimumTokoTerbaca> {
  // Berurutan, bukan Promise.all: klien ini bisa berupa transaksi interaktif.
  const setelan = await client.systemSetting.findMany({
    where: { key: { in: [KUNCI_MIN_PERTAMA, KUNCI_MIN_ULANG] } },
    select: { key: true, value: true },
  });
  const disetujui = await client.fieldSalesOrder.findFirst({
    where: { storeId, orderType: "PUTUS", status: "APPROVED" },
    select: { id: true },
  });
  const nilai = (k: string) => setelan.find((s) => s.key === k)?.value ?? null;
  const aturan = bacaAturanMinimum(nilai(KUNCI_MIN_PERTAMA), nilai(KUNCI_MIN_ULANG));
  return { ...minimumToko(aturan, disetujui !== null), aturan };
}

export type MinimumKatalog = {
  /** Minimum toko untuk barang tanpa minimum sendiri. */
  min: number;
  /**
   * Toko ini memakai tingkat "pesan ulang" DAN angkanya berbeda dari pesanan
   * pertama — hanya saat itu katalog menyebut "(pesan ulang)"; kalau angkanya
   * sama, keterangan itu tidak memberi tahu apa-apa.
   */
  pesanUlang: boolean;
  /** Barang yang punya `Item.minOrderQty` sendiri → angkanya. */
  perBarang: Record<string, number>;
};

/**
 * Minimum yang benar-benar berlaku untuk setiap barang di katalog toko ini —
 * aturan yang sama dengan penulis pesanan. Payload katalog (`/pwa/api/catalog`)
 * hanya tahu minimum pesanan pertama, jadi halaman katalog menimpanya dengan ini.
 */
export async function muatMinimumKatalog(storeId: string): Promise<MinimumKatalog> {
  const [toko, barang] = await Promise.all([
    muatMinimumToko(storeId),
    prisma.item.findMany({
      where: { isActive: true, type: "FINISHED_GOOD", minOrderQty: { not: null } },
      select: { id: true, minOrderQty: true },
    }),
  ]);
  const perBarang: Record<string, number> = {};
  for (const b of barang) if (b.minOrderQty !== null) perBarang[b.id] = b.minOrderQty;
  return { min: toko.min, pesanUlang: toko.jenis === "ULANG" && toko.aturan.ulang !== toko.aturan.pertama, perBarang };
}
