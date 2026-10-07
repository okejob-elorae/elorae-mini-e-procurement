import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import {
  buildActionItems,
  getActionItemCounts,
  getClaimsAwaitingVerification,
  type ActionItemCounts,
} from "@/lib/dashboard/action-items";
import { getAntreanKantor, hitungBarangStokMinus, jalurTautan } from "@/lib/dashboard/antrean-kantor";
import { ringkasPiutangBeranda } from "@/lib/dashboard/piutang-ringkas";
import { getDraftPOCount, getOverduePOCount } from "@/lib/purchase-orders/queries";
import { getMarketplaceKpi } from "@/lib/sales-orders/queries";
import { kartuBeranda } from "@/app/backoffice/dashboard/kartu-beranda";
import { hitungTugasKreatif } from "@/lib/creative/tugas-queries";
import { bagiLencana } from "./lencana";
import { grupUntukRute } from "./menu";

const NOL: ActionItemCounts = {
  fieldSalesPendingApproval: 0,
  storeChangesPending: 0,
  taxInvoicePending: 0,
  salesReturnPending: 0,
  journalPending: 0,
};

/** Satu hitungan yang gagal hanya menghilangkan lencananya sendiri. */
async function aman<T>(nama: string, jalan: () => Promise<T>, cadangan: T): Promise<T> {
  try {
    return await jalan();
  } catch (err) {
    console.error(`lencana menu: ${nama} gagal dihitung`, err);
    return cadangan;
  }
}

/**
 * Lencana menu samping: daftar "perlu ditindaklanjuti" Beranda yang SAMA —
 * baris dan pagar izinnya dari `buildActionItems(…, izin)` — dibagi ke grup
 * dan halaman tempat pekerjaannya. Grupnya DITURUNKAN dari halaman tujuan
 * lewat susunan menu (`grupUntukRute`), bukan peta tulisan tangan: peta lama
 * menaruh jurnal gagal dan faktur pajak di grup "#" yang tidak ada.
 *
 * Hitungan yang barisnya tidak boleh dilihat penonton tidak dijalankan.
 * "BKM menunggu admin lain" (milik penonton sendiri) bukan pekerjaannya, jadi
 * tidak dilencanai — sama seperti Beranda yang menamainya "menunggu orang lain".
 */
export async function hitungLencanaMenu(
  izin: string[],
  userId: string | null,
): Promise<{ grup: Record<string, number>; halaman: Record<string, number> }> {
  const kartu = kartuBeranda(izin);
  const bolehPo = hasPermission(izin, PERMISSIONS.PURCHASE_ORDERS_VIEW);
  const bolehKreatif = hasPermission(izin, PERMISSIONS.CREATIVE_VIEW);

  const [counts, overduePOs, draftPOs, stokMinus, marketplace, piutang, klaim, antrean, kreatif] = await Promise.all([
    aman("hitungan", () => getActionItemCounts(izin), NOL),
    bolehPo ? aman("PO terlambat", getOverduePOCount, 0) : 0,
    bolehPo ? aman("PO draf", getDraftPOCount, 0) : 0,
    // Per BARANG — angka yang sama dengan Beranda dan Inventori `?oversold=1`.
    kartu.stok ? aman("stok minus", hitungBarangStokMinus, 0) : 0,
    kartu.penjualanMarketplace ? aman("marketplace", getMarketplaceKpi, null) : null,
    kartu.piutang ? aman("piutang", ringkasPiutangBeranda, null) : null,
    kartu.klaimMenunggu ? aman("BKM", () => getClaimsAwaitingVerification(userId), null) : null,
    aman("antrean kantor", () => getAntreanKantor(izin), {}),
    // Hari ini Ruang KOL — angka yang sama dengan lencana tab Hari ini (agendanya pribadi).
    bolehKreatif ? aman("kreatif", () => hitungTugasKreatif(userId), 0) : 0,
  ]);

  const items = buildActionItems(
    {
      ...counts,
      overduePOs,
      draftPOs,
      oversoldSkus: stokMinus,
      unshippedOrders: marketplace?.pendingFulfillmentCount ?? 0,
      overduePromises: piutang ? { count: piutang.lewatJumlah, amount: piutang.lewatNilai } : undefined,
      claimsAwaitingVerification: klaim?.bisaDiputuskan,
      antrean,
    },
    izin,
  ).filter((item) => !item.permission || hasPermission(izin, item.permission));

  const kreatifButir = kreatif > 0 ? [{ key: "kreatifHariIni", href: "/backoffice/kreatif", count: kreatif }] : [];

  return bagiLencana([...items, ...kreatifButir], (b) => grupUntukRute(jalurTautan(b.href)));
}
