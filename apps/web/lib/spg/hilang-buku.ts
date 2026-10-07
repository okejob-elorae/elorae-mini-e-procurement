import type { Prisma } from "@elorae/db";
import { kunciBaris } from "./stok";
import { waktuHitungTerakhir } from "./opname-hitung";

/**
 * Barang hilang yang dicatat MANUAL oleh kantor di toko yang punya buku stok
 * mengurangi buku itu (`HILANG`, −qty, refType `StockLoss`), di transaksi yang
 * sama dengan catatannya. Tanpa itu opname berikutnya atas potong yang sama
 * menemukan kurang lagi dan membuka catatan barang hilang KEDUA.
 *
 * Sumber lain tidak menulis apa pun: OPNAME sudah menulis selisihnya sendiri,
 * MUTASI sudah keluar dari buku toko asal saat dikirim, dan PENERIMAAN hanya
 * memasukkan yang diterima. Toko TANPA buku tidak dibukakan buku — titipannya
 * dikurangi lewat catatan itu sendiri (`muatStokDiToko`).
 *
 * Membatalkan catatan menulis pembaliknya (+qty, jenis yang sama), bersih dari
 * baris catatan itu yang masih ada — KECUALI barang yang sudah dihitung opname
 * SESUDAH catatan itu: opname itu sudah melihat raknya (aturan yang sama
 * dengan pekerjaan dari antrean HP).
 */

export const REF_BUKU_HILANG = "StockLoss";

type Tx = Prisma.TransactionClient;

export type BarisBukuHilang = { itemId: string | null; variantSku: string; qty: number };

/** Tulis gerakan HILANG untuk catatan MANUAL. Mengembalikan banyak baris yang ditulis (0 = toko tanpa buku). */
export async function tulisBukuHilang(
  tx: Tx,
  isi: { lossId: string; storeId: string; baris: BarisBukuHilang[]; createdById: string; waktu: Date },
): Promise<number> {
  const baris = isi.baris.filter((b): b is BarisBukuHilang & { itemId: string } => Boolean(b.itemId) && b.qty > 0);
  if (baris.length === 0) return 0;
  const berbuku = await tx.storeStockMovement.findFirst({ where: { storeId: isi.storeId }, select: { id: true } });
  if (!berbuku) return 0;
  await tx.storeStockMovement.createMany({
    data: baris.map((b) => ({
      storeId: isi.storeId,
      itemId: b.itemId,
      variantSku: b.variantSku ?? "",
      qty: -b.qty,
      kind: "HILANG" as const,
      refType: REF_BUKU_HILANG,
      refId: isi.lossId,
      createdById: isi.createdById,
      createdAt: isi.waktu,
    })),
  });
  return baris.length;
}

type GerakHilang = { itemId: string; variantSku: string; qty: number; createdAt: Date };

/**
 * Murni: pembalik per barang × ukuran = −Σ gerakan catatan itu (bersih dari
 * pembalik yang sudah ada), dilewati untuk kunci yang sudah dihitung opname
 * sesudah gerakan HILANG pertamanya.
 */
export function rencanaBalikHilang(
  gerak: readonly GerakHilang[],
  hitungTerakhir: ReadonlyMap<string, Date>,
): { balik: { itemId: string; variantSku: string; qty: number }[]; dilewati: { itemId: string; variantSku: string; qty: number }[] } {
  const per = new Map<string, { itemId: string; variantSku: string; qty: number; pertama: Date | null }>();
  for (const g of gerak) {
    const k = kunciBaris(g.itemId, g.variantSku);
    const ada = per.get(k) ?? { itemId: g.itemId, variantSku: g.variantSku ?? "", qty: 0, pertama: null };
    ada.qty += g.qty;
    if (g.qty < 0 && (!ada.pertama || g.createdAt < ada.pertama)) ada.pertama = g.createdAt;
    per.set(k, ada);
  }
  const balik: { itemId: string; variantSku: string; qty: number }[] = [];
  const dilewati: { itemId: string; variantSku: string; qty: number }[] = [];
  for (const [k, p] of per) {
    if (p.qty >= 0) continue;
    const baris = { itemId: p.itemId, variantSku: p.variantSku, qty: -p.qty };
    const hitung = hitungTerakhir.get(k);
    if (hitung && p.pertama && hitung > p.pertama) dilewati.push(baris);
    else balik.push(baris);
  }
  return { balik, dilewati };
}

/** Balik gerakan HILANG sebuah catatan yang dibatalkan. Tanpa gerakan (toko tanpa buku, catatan bukan MANUAL) tidak menulis apa pun. */
export async function balikBukuHilang(
  tx: Tx,
  isi: { lossId: string; storeId: string | null; createdById: string; waktu: Date },
): Promise<{ balik: { itemId: string; variantSku: string; qty: number }[]; dilewati: { itemId: string; variantSku: string; qty: number }[] }> {
  if (!isi.storeId) return { balik: [], dilewati: [] };
  const gerak = await tx.storeStockMovement.findMany({
    where: { storeId: isi.storeId, kind: "HILANG", refType: REF_BUKU_HILANG, refId: isi.lossId },
    select: { itemId: true, variantSku: true, qty: true, createdAt: true },
  });
  if (gerak.length === 0) return { balik: [], dilewati: [] };
  const awal = new Date(Math.min(...gerak.filter((g) => g.qty < 0).map((g) => g.createdAt.getTime())));
  const hitung = Number.isFinite(awal.getTime())
    ? await waktuHitungTerakhir(tx, isi.storeId, [...new Set(gerak.map((g) => g.itemId))], awal)
    : new Map<string, Date>();
  const rencana = rencanaBalikHilang(gerak, hitung);
  if (rencana.balik.length > 0) {
    await tx.storeStockMovement.createMany({
      data: rencana.balik.map((b) => ({
        storeId: isi.storeId as string,
        itemId: b.itemId,
        variantSku: b.variantSku,
        qty: b.qty,
        kind: "HILANG" as const,
        refType: REF_BUKU_HILANG,
        refId: isi.lossId,
        createdById: isi.createdById,
        createdAt: isi.waktu,
      })),
    });
  }
  return rencana;
}
