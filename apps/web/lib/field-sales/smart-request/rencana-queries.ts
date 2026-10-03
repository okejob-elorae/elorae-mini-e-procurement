import { prisma } from "@elorae/db";
import { computeStorePrice } from "@elorae/db/pricing";
import { getSmartRequestHistory, sentItemIds } from "@/lib/field-sales/queries";
import { nilaiStokToko } from "@/lib/konsinyasi/stok-di-toko";
import { barangBaru, HARI_BARU_MAKS } from "@/lib/salesman/saran-tawar";
import { bahanSaranTawar } from "@/lib/salesman/saran-tawar-queries";
import { loadSmartRequestCandidates, type KandidatMuat } from "./load-candidates";
import type { BahanRencana, KandidatRencana, StokTokoBarang, SumberRencana } from "./rencana";

/**
 * Pemuat bahan rencana kirim. Aturannya murni di `rencana.ts`; di sini hanya
 * bahan-bahannya dibaca, dengan pemuat yang sudah ada:
 *   - kandidat per kategori         → `loadSmartRequestCandidates`
 *   - pernah dikirim / dipesan      → `sentItemIds` + `getSmartRequestHistory` (+ van, kiriman konsinyasi, buku toko)
 *   - stok & laku di toko ini       → `nilaiStokToko` (buku stok toko, atau titipan konsinyasi)
 *   - laku di toko sejenis          → `bahanSaranTawar` (pcs + jumlah toko, tanpa nama dan rupiah toko lain)
 *   - umur barang                   → `barangBaru`
 * Setiap kueri dibatasi ke toko ini dan ke barang kandidat — tidak ada yang
 * menulis apa pun.
 */

/** Dasar "laku di toko ini": sama dengan pilihan sumber `muatStokDiToko`. */
export type DasarLaku = "BUKU_TOKO" | "TITIPAN" | "RIWAYAT_PESANAN";

export async function dasarLakuToko(storeId: string, termsType: "PUTUS" | "KONSI"): Promise<DasarLaku> {
  const ada = await prisma.storeStockMovement.findFirst({ where: { storeId }, select: { id: true } });
  if (ada) return "BUKU_TOKO";
  return termsType === "KONSI" ? "TITIPAN" : "RIWAYAT_PESANAN";
}

export type InfoBarangRencana = { sku: string; nama: string; kategoriId: string; variantsMentah: unknown; harga: number | null };

export async function muatBahanRencana(input: {
  storeId: string;
  termsType: "PUTUS" | "KONSI";
  marginPercent: number | null;
  kategoriIds: string[];
  sumber: SumberRencana[];
  hariIni: Date;
}): Promise<{ bahan: BahanRencana; info: Map<string, InfoBarangRencana>; dasarLaku: DasarLaku }> {
  const konsi = input.termsType === "KONSI";
  const perKategori = await loadSmartRequestCandidates(input.kategoriIds);
  const muat: KandidatMuat[] = input.kategoriIds.flatMap((id) => perKategori.get(id) ?? []);
  const itemIds = muat.map((k) => k.itemId);

  const dasarLaku = await dasarLakuToko(input.storeId, input.termsType);
  const stokTokoDiketahui = dasarLaku !== "RIWAYAT_PESANAN";

  const kosong = itemIds.length === 0;
  const [riwayat, konsiTerkirim, van, kirimanKonsi, bukuToko, penilaian, saran] = await Promise.all([
    kosong ? null : getSmartRequestHistory(input.storeId, itemIds),
    kosong ? new Set<string>() : sentItemIds(input.storeId),
    kosong
      ? []
      : prisma.vanSaleLine.findMany({
          where: { itemId: { in: itemIds }, vanSale: { storeId: input.storeId } },
          select: { itemId: true },
          distinct: ["itemId"],
        }),
    kosong
      ? []
      : prisma.consignmentShipmentItem.findMany({
          where: { itemId: { in: itemIds }, shipment: { storeId: input.storeId } },
          select: { itemId: true },
          distinct: ["itemId"],
        }),
    kosong
      ? []
      : prisma.storeStockMovement.findMany({
          where: { storeId: input.storeId, itemId: { in: itemIds } },
          select: { itemId: true },
          distinct: ["itemId"],
        }),
    kosong || !stokTokoDiketahui ? null : nilaiStokToko([input.storeId], input.hariIni),
    kosong || !input.sumber.includes("LAKU_DI_TOKO_LAIN") ? null : bahanSaranTawar(input.storeId, input.hariIni),
  ]);

  // Pernah dikirim = muncul di pesanan yang tidak ditolak (semua jenis), jual
  // van ke toko ini, kiriman modul konsinyasi, atau buku stok toko.
  const pernahDikirim = new Set<string>(konsiTerkirim);
  if (riwayat) for (const id of itemIds) if (!riwayat.neverOrdered.has(id)) pernahDikirim.add(id);
  for (const r of van) pernahDikirim.add(r.itemId);
  for (const r of kirimanKonsi) if (r.itemId) pernahDikirim.add(r.itemId);
  for (const r of bukuToko) pernahDikirim.add(r.itemId);

  const stokToko = new Map<string, StokTokoBarang>();
  const nilai = penilaian?.get(input.storeId);
  if (nilai) {
    for (const b of nilai.baris) {
      const ada = stokToko.get(b.itemId) ?? { sisa: 0, dalamProses: 0, laku: 0 };
      // Saldo minus (buku dan rak berbeda) dihitung nol: barang fisik tidak kurang dari nol.
      ada.sisa += Math.max(0, b.qty);
      ada.dalamProses += Math.max(0, b.dalamProses);
      ada.laku += Math.max(0, b.soldLast60);
      stokToko.set(b.itemId, ada);
    }
  }

  const jualTokoLain = new Map<string, { pcs: number; toko: number }>();
  for (const j of saran?.bahan.jualSejenis ?? []) jualTokoLain.set(j.itemId, { pcs: j.pcs, toko: j.toko });

  // Umur semua kandidat yang ada stoknya — ambang "baru" dinilai penyusun dari isian salesman.
  const umurHari = new Map(
    barangBaru(
      muat.map((k) => ({
        itemId: k.itemId,
        tersedia: Object.values(k.available).reduce((s, n) => s + Math.max(0, n), 0),
        dibuat: k.dibuat,
      })),
      input.hariIni,
      HARI_BARU_MAKS,
    ).map((b) => [b.itemId, b.umurHari]),
  );

  const info = new Map<string, InfoBarangRencana>();
  const kandidat: KandidatRencana[] = muat.map((k) => {
    // Harga konsinyasi TIDAK PERNAH dihitung untuk HP — bukan disembunyikan, memang tidak ada.
    const harga = konsi
      ? null
      : computeStorePrice({ sellingPrice: k.hargaJual, termsType: "PUTUS", marginPercent: input.marginPercent }).price;
    info.set(k.itemId, { sku: k.sku, nama: k.nama, kategoriId: k.kategoriId, variantsMentah: k.variantsMentah, harga });
    return { itemId: k.itemId, sku: k.sku, kategoriId: k.kategoriId, variants: k.variants, available: k.available, harga };
  });

  return {
    bahan: {
      kandidat,
      pernahDikirim,
      stokTokoDiketahui,
      stokToko,
      dipesanToko: riwayat?.qtyByItem ?? new Map(),
      jualTokoLain,
      umurHari,
    },
    info,
    dasarLaku,
  };
}
