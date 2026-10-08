import { prisma } from "@elorae/db";
import { kunciDokumen, type IndukDokumen } from "./tautan";
import { infoDokumenOperasional } from "@/lib/finance/operasional/info-dokumen";
import { infoDokumenAset } from "@/lib/finance/aset/queries";
import { infoDokumenBerulang } from "@/lib/finance/berulang/queries";
import { fakturImporDibatalkan } from "@/lib/receivables/impor/batal";

/*
 * Nomor dokumen sumber jurnal (dan induknya, untuk dokumen tanpa halaman
 * sendiri), dicari per jenis dalam satu kueri per jenis. Hanya di server.
 */

export type InfoDokumen = IndukDokumen & { nomor: string | null };

type Pasangan = { jenis: string; id: string };

/** Nama marketplace untuk dibaca orang — kode mentah (`TIKTOK`) tidak ditampilkan apa adanya. */
const NAMA_MARKETPLACE: Record<string, string> = { SHOPEE: "Shopee", TIKTOK: "TikTok", TOKOPEDIA: "Tokopedia" };

function namaMarketplace(kode: string): string {
  return NAMA_MARKETPLACE[kode] ?? kode;
}

function idsPer(pasangan: Pasangan[], ...jenis: string[]): string[] {
  return [...new Set(pasangan.filter((p) => jenis.includes(p.jenis)).map((p) => p.id))];
}

/** Satu kueri yang gagal tidak menggagalkan halaman: dokumennya tampil tanpa nomor. */
async function aman<T>(nama: string, ids: string[], kueri: () => Promise<T[]>): Promise<T[]> {
  if (ids.length === 0) return [];
  try {
    return await kueri();
  } catch (e) {
    console.error(`[info-dokumen] gagal membaca ${nama}`, e);
    return [];
  }
}

/** Peta `kunciDokumen(jenis, id)` → nomor (+ induk). Dokumen yang tidak ditemukan tidak masuk peta. */
export async function cariInfoDokumen(pasangan: Pasangan[]): Promise<Map<string, InfoDokumen>> {
  const hasil = new Map<string, InfoDokumen>();
  const isi = (jenisList: string[], id: string, info: InfoDokumen) => {
    for (const jenis of jenisList) hasil.set(kunciDokumen(jenis, id), info);
  };

  const grnIds = idsPer(pasangan, "GRN", "GRN_REVERSAL");
  const fgIds = idsPer(pasangan, "FG_RECEIPT");
  const opnameIds = idsPer(pasangan, "OPNAME");
  const soIds = idsPer(pasangan, "SALESORDER_REVENUE", "SALESORDER_COGS");
  const returIds = idsPer(pasangan, "SALESRETURN_REVENUE", "SALESRETURN_COGS");
  const muatIds = idsPer(pasangan, "VAN_LOAD");
  const jualVanIds = idsPer(pasangan, "VAN_SALE");
  const rekonIds = idsPer(pasangan, "VAN_RECONCILE");
  const poIds = idsPer(pasangan, "SUPPLIER_PAYMENT", "SUPPLIER_PAYMENT_REVERSAL");
  const settlementIds = idsPer(pasangan, "SETTLEMENT");
  const kolabIds = idsPer(pasangan, "KOL_KOLABORASI", "KOL_FEE", "KOL_PAYMENT", "KOL_PAYMENT_REVERSAL");
  const sampelIds = idsPer(pasangan, "KOL_SAMPLE");

  const [grn, fg, opname, so, retur, muat, jualVan, rekon, po, settlement, kolab, sampel] = await Promise.all([
    aman("GRN", grnIds, () =>
      prisma.gRN.findMany({ where: { id: { in: grnIds } }, select: { id: true, docNumber: true, poId: true } }),
    ),
    aman("FGReceipt", fgIds, () =>
      prisma.fGReceipt.findMany({ where: { id: { in: fgIds } }, select: { id: true, docNumber: true, woId: true } }),
    ),
    aman("StockOpname", opnameIds, () =>
      prisma.stockOpname.findMany({ where: { id: { in: opnameIds } }, select: { id: true, docNumber: true } }),
    ),
    aman("SalesOrder", soIds, () =>
      prisma.salesOrder.findMany({ where: { id: { in: soIds } }, select: { id: true, salesorderNo: true } }),
    ),
    aman("SalesReturn", returIds, () =>
      prisma.salesReturn.findMany({ where: { id: { in: returIds } }, select: { id: true, jubelioReturnNo: true } }),
    ),
    aman("VanLoad", muatIds, () =>
      prisma.vanLoad.findMany({ where: { id: { in: muatIds } }, select: { id: true, docNo: true, canvasserId: true } }),
    ),
    aman("VanSale", jualVanIds, () =>
      prisma.vanSale.findMany({ where: { id: { in: jualVanIds } }, select: { id: true, docNo: true } }),
    ),
    aman("VanReconcile", rekonIds, () =>
      prisma.vanReconcile.findMany({ where: { id: { in: rekonIds } }, select: { id: true, docNo: true } }),
    ),
    aman("PurchaseOrder", poIds, () =>
      prisma.purchaseOrder.findMany({ where: { id: { in: poIds } }, select: { id: true, docNumber: true } }),
    ),
    aman("Settlement", settlementIds, () =>
      prisma.settlement.findMany({
        where: { id: { in: settlementIds } },
        select: { id: true, marketplace: true, seller: true },
      }),
    ),
    aman("KolBrief", kolabIds, () =>
      prisma.kolBrief.findMany({ where: { id: { in: kolabIds } }, select: { id: true, docNo: true } }),
    ),
    aman("KolShipment", sampelIds, () =>
      prisma.kolShipment.findMany({
        where: { id: { in: sampelIds } },
        select: { id: true, collabId: true, trackingNo: true, collab: { select: { docNo: true } } },
      }),
    ),
  ]);

  for (const r of grn) isi(["GRN", "GRN_REVERSAL"], r.id, { nomor: r.docNumber, poId: r.poId });
  for (const r of fg) isi(["FG_RECEIPT"], r.id, { nomor: r.docNumber, woId: r.woId });
  for (const r of opname) isi(["OPNAME"], r.id, { nomor: r.docNumber });
  for (const r of so) isi(["SALESORDER_REVENUE", "SALESORDER_COGS"], r.id, { nomor: r.salesorderNo });
  for (const r of retur) isi(["SALESRETURN_REVENUE", "SALESRETURN_COGS"], r.id, { nomor: r.jubelioReturnNo });
  for (const r of muat) isi(["VAN_LOAD"], r.id, { nomor: r.docNo, canvasserId: r.canvasserId });
  for (const r of jualVan) isi(["VAN_SALE"], r.id, { nomor: r.docNo });
  for (const r of rekon) isi(["VAN_RECONCILE"], r.id, { nomor: r.docNo });
  for (const r of po) isi(["SUPPLIER_PAYMENT", "SUPPLIER_PAYMENT_REVERSAL"], r.id, { nomor: r.docNumber });
  for (const r of settlement) isi(["SETTLEMENT"], r.id, { nomor: `${namaMarketplace(r.marketplace)} · ${r.seller}` });
  for (const r of kolab) isi(["KOL_KOLABORASI", "KOL_FEE", "KOL_PAYMENT", "KOL_PAYMENT_REVERSAL"], r.id, { nomor: r.docNo });
  for (const r of sampel) isi(["KOL_SAMPLE"], r.id, { nomor: r.trackingNo ? `${r.collab.docNo} · ${r.trackingNo}` : r.collab.docNo, kolaborasiId: r.collabId });

  // Penjualan lapangan & piutang toko (lib/finance/lapangan).
  const notaIds = idsPer(pasangan, "FIELD_DELIVERY");
  const bkmIds = idsPer(pasangan, "FIELD_COLLECTION");
  const nriIds = idsPer(pasangan, "STORE_RETURN");
  const tukarIds = idsPer(pasangan, "STORE_EXCHANGE");
  const fakturIds = idsPer(pasangan, "STORE_INVOICE");
  const [nota, bkm, nri, tukar, faktur] = await Promise.all([
    aman("FieldSalesDelivery", notaIds, () =>
      prisma.fieldSalesDelivery.findMany({ where: { id: { in: notaIds } }, select: { id: true, docNo: true, orderId: true } }),
    ),
    aman("PaymentClaim", bkmIds, () =>
      prisma.paymentClaim.findMany({ where: { id: { in: bkmIds } }, select: { id: true, docNo: true } }),
    ),
    aman("WarehouseReturn", nriIds, () =>
      prisma.warehouseReturn.findMany({ where: { id: { in: nriIds } }, select: { id: true, noNri: true, storeReturnId: true } }),
    ),
    aman("StoreExchange", tukarIds, () =>
      prisma.storeExchange.findMany({ where: { id: { in: tukarIds } }, select: { id: true, docNo: true } }),
    ),
    aman("Receivable", fakturIds, () =>
      prisma.receivable.findMany({ where: { id: { in: fakturIds } }, select: { id: true, invoiceNo: true } }),
    ),
  ]);
  for (const r of nota) isi(["FIELD_DELIVERY"], r.id, { nomor: r.docNo, fieldOrderId: r.orderId });
  for (const r of bkm) isi(["FIELD_COLLECTION"], r.id, { nomor: r.docNo });
  for (const r of nri) isi(["STORE_RETURN"], r.id, { nomor: r.noNri, storeReturnId: r.storeReturnId });
  for (const r of tukar) isi(["STORE_EXCHANGE"], r.id, { nomor: r.docNo });
  for (const r of faktur) isi(["STORE_INVOICE"], r.id, { nomor: r.invoiceNo, noFaktur: r.invoiceNo });
  // Faktur impor yang batch-nya dibatalkan (barisnya dihapus): jurnal + pembaliknya tetap menunjuk
  // dokumen yang dikenal lewat jejak pembatalannya — bukan "yatim".
  const fakturHilang = fakturIds.filter((id) => !faktur.some((r) => r.id === id));
  if (fakturHilang.length) {
    try {
      for (const [id, no] of await fakturImporDibatalkan(fakturHilang)) isi(["STORE_INVOICE"], id, { nomor: `${no} (impor dibatalkan)` });
    } catch (e) {
      console.error("[info-dokumen] gagal membaca faktur impor yang dibatalkan", e);
    }
  }

  // Pajak (lib/finance/pajak): masa PPN / PPh final dinamai masanya, setoran NTPN-nya.
  for (const p of pasangan) {
    if (p.jenis === "PPN_MASA" || p.jenis === "PPN_MASA_REVERSAL") isi([p.jenis], p.id, { nomor: `Masa PPN ${p.id}` });
    if (p.jenis === "PPH_FINAL" || p.jenis === "PPH_FINAL_REVERSAL") isi([p.jenis], p.id, { nomor: `PPh final ${p.id}` });
  }
  const setoranIds = idsPer(pasangan, "TAX_PAYMENT", "TAX_PAYMENT_REVERSAL");
  const setoran = await aman("TaxPayment", setoranIds, () =>
    prisma.taxPayment.findMany({ where: { id: { in: setoranIds } }, select: { id: true, type: true, period: true, ntpn: true } }),
  );
  for (const r of setoran) isi(["TAX_PAYMENT", "TAX_PAYMENT_REVERSAL"], r.id, { nomor: `${r.type} ${r.period}${r.ntpn ? ` · ${r.ntpn}` : ""}` });

  // Kas & bank dan pembayaran pemasok (lib/finance/kas, lib/purchasing/pembayaran-*).
  const voucherIds = idsPer(pasangan, "CASH_VOUCHER", "CASH_VOUCHER_REVERSAL");
  const bayarPemasokIds = idsPer(pasangan, "SUPPLIER_PAYMENT_DOC", "SUPPLIER_PAYMENT_DOC_REVERSAL");
  const [voucher, bayarPemasok] = await Promise.all([
    aman("CashVoucher", voucherIds, () =>
      prisma.cashVoucher.findMany({ where: { id: { in: voucherIds } }, select: { id: true, docNumber: true } }),
    ),
    aman("SupplierPayment", bayarPemasokIds, () =>
      prisma.supplierPayment.findMany({ where: { id: { in: bayarPemasokIds } }, select: { id: true, docNumber: true } }),
    ),
  ]);
  for (const r of voucher) isi(["CASH_VOUCHER", "CASH_VOUCHER_REVERSAL"], r.id, { nomor: r.docNumber });
  for (const r of bayarPemasok) isi(["SUPPLIER_PAYMENT_DOC", "SUPPLIER_PAYMENT_DOC_REVERSAL"], r.id, { nomor: r.docNumber });

  // Jurnal operasional: konsinyasi, komisi, barang hilang, gudang rusak, stok manual, retur pemasok, biaya perjalanan.
  try {
    for (const r of await infoDokumenOperasional(pasangan)) isi([r.jenis], r.id, r.info);
  } catch (e) {
    console.error("[info-dokumen] gagal membaca dokumen operasional", e);
  }

  // Aset tetap (kode aset; penyusutan "<kode> · <YYYY-MM>") dan jurnal berulang ("<nama templat> · <YYYY-MM>").
  try {
    const [aset, berulang] = await Promise.all([infoDokumenAset(pasangan), infoDokumenBerulang(pasangan)]);
    for (const [kunci, v] of aset) hasil.set(kunci, { nomor: v.nomor });
    for (const [kunci, v] of berulang) hasil.set(kunci, { nomor: v.nomor });
  } catch (e) {
    console.error("[info-dokumen] gagal membaca aset tetap / jurnal berulang", e);
  }

  return hasil;
}
