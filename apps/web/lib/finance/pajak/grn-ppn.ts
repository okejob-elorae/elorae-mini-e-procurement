import type { Prisma, PrismaClient } from "@elorae/db";
import { pisahPpn, ppnBerlaku, type PengaturanPpn } from "./ppn";
import { bacaPengaturanPpn } from "./ppn-pengaturan";

type AnyClient = PrismaClient | Prisma.TransactionClient;

/**
 * PPN MASUKAN atas penerimaan barang (GRN) — dihitung SEKALI saat GRN dibuat
 * dan disimpan di `GRN.ppnAmount`; jurnal penerimaan barang membaca angka
 * tersimpan itu (bukan pengaturan hari ini), jadi jurnal yang diposting ulang
 * kemudian tetap sama dengan kartu stoknya.
 *
 * KEPUTUSAN SEMENTARA (2026-10-08, usulan Claude — ingatkan pemilik): PPN
 * masukan hanya diakui pada baris PO berstatus "Exclude PPN" — tanda tegas
 * bahwa pemasok menagih PPN DI ATAS harga (pemasok PKP, ada faktur). Baris
 * "Include PPN" (bawaan PO) TIDAK dipisah: pemasok non-PKP juga tercatat
 * "Include PPN", dan tanpa kolom status PKP pemasok tidak ada cara membedakan
 * keduanya — PPN di dalamnya tetap ikut biaya persediaan (aman ke arah pajak;
 * lebih kecil kredit pajaknya, bukan lebih besar). GRN tanpa PO dan PO lama
 * tanpa tarif (`ppnRatePercent` null) juga tanpa PPN masukan.
 *
 * Hanya PKP (dan tanggal ≥ `berlakuSejak`). Non-PKP/BELUM_DITETAPKAN → 0
 * (perilaku lama; PPN baris "Exclude PPN" belum masuk biaya — lihat laporan).
 */

export type BarisGrnPpn = { itemId: string; variantSku?: string | null; nilai: number };
export type BarisPoPpn = { itemId: string; variantSku?: string | null; ppnIncluded: boolean };

const kunci = (itemId: string, varian?: string | null) => `${itemId}\t${varian?.trim() ?? ""}`;

/** Murni: PPN masukan baris "Exclude PPN" GRN ini, beserta DPP-nya. */
export function ppnMasukanGrn(input: {
  baris: readonly BarisGrnPpn[];
  barisPo: readonly BarisPoPpn[] | null;
  tarifPo: number | null;
  pengaturan: PengaturanPpn;
  tanggal: Date;
}): { ppn: number; dpp: number; kenaPpn: Set<string> } {
  const kosong = { ppn: 0, dpp: 0, kenaPpn: new Set<string>() };
  if (!input.barisPo || input.tarifPo == null || !ppnBerlaku(input.pengaturan, input.tanggal)) return kosong;
  const eksklusif = new Set(input.barisPo.filter((b) => !b.ppnIncluded).map((b) => kunci(b.itemId, b.variantSku)));
  let dppSen = 0;
  const kena = new Set<string>();
  for (const b of input.baris) {
    const k = kunci(b.itemId, b.variantSku);
    if (!eksklusif.has(k)) continue;
    kena.add(k);
    dppSen += Math.round(Number((b.nilai * 100).toFixed(4)));
  }
  if (dppSen <= 0) return kosong;
  const p = pisahPpn(dppSen / 100, { termasukPpn: false, pengaturan: input.pengaturan, tanggal: input.tanggal });
  return { ppn: p.ppn, dpp: p.dpp, kenaPpn: kena };
}

/** Penanda baris GRN tersimpan (`GRN.items[].ppnIncluded`). */
export function kunciBarisPpn(itemId: string, variantSku?: string | null): string {
  return kunci(itemId, variantSku);
}

/**
 * Untuk `createGRN` (di dalam transaksinya): baca PO + pengaturan PPN lalu
 * hitung. Mengembalikan juga himpunan baris yang dikenai PPN supaya `items`
 * GRN menandainya (`ppnIncluded: false`) — jurnal membaca DPP dari tanda itu.
 */
export async function hitungPpnMasukanGrn(
  client: AnyClient,
  input: { poId: string | null; baris: readonly BarisGrnPpn[]; tanggal: Date },
): Promise<{ ppn: number; dpp: number; kenaPpn: Set<string>; barisPo: BarisPoPpn[] | null }> {
  if (!input.poId) return { ppn: 0, dpp: 0, kenaPpn: new Set(), barisPo: null };
  const [po, pengaturan] = await Promise.all([
    client.purchaseOrder.findUnique({
      where: { id: input.poId },
      select: { ppnRatePercent: true, items: { select: { itemId: true, variantSku: true, ppnIncluded: true } } },
    }),
    bacaPengaturanPpn(client),
  ]);
  if (!po) return { ppn: 0, dpp: 0, kenaPpn: new Set(), barisPo: null };
  const barisPo = po.items.map((i) => ({ itemId: i.itemId, variantSku: i.variantSku, ppnIncluded: i.ppnIncluded }));
  const r = ppnMasukanGrn({
    baris: input.baris,
    barisPo,
    tarifPo: po.ppnRatePercent == null ? null : Number(po.ppnRatePercent),
    pengaturan,
    tanggal: input.tanggal,
  });
  return { ...r, barisPo };
}
