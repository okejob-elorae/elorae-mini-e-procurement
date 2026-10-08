/*
 * Dari jurnal ke dokumen sumbernya. Murni (tanpa Prisma) supaya bisa dipakai
 * di komponen klien dan dites. Nomor dokumennya dicari `info-dokumen.ts`.
 *
 * Satu tempat untuk alamat setiap jenis sumber jurnal otomatis — jenis baru di
 * `generateAutoJournal` perlu baris di `tautanDokumenSumber`.
 */

/**
 * Jenis sumber jurnal otomatis — pilihan saringan "Sumber" di halaman Jurnal.
 * Labelnya `financeJournals.sourceTypes.<JENIS>`.
 */
export const JENIS_SUMBER_JURNAL = [
  "SALESORDER_REVENUE",
  "SALESORDER_COGS",
  "SALESRETURN_REVENUE",
  "SALESRETURN_COGS",
  "SETTLEMENT",
  "GRN",
  "GRN_REVERSAL",
  "FG_RECEIPT",
  "OPNAME",
  "VAN_LOAD",
  "VAN_SALE",
  "VAN_RECONCILE",
  "SUPPLIER_PAYMENT",
  "SUPPLIER_PAYMENT_REVERSAL",
  "KOL_FEE",
  "KOL_PAYMENT",
  "KOL_PAYMENT_REVERSAL",
  "KOL_SAMPLE",
  "FIELD_DELIVERY",
  "FIELD_COLLECTION",
  "STORE_RETURN",
  "STORE_EXCHANGE",
  "STORE_INVOICE",
  "PPN_MASA",
  "PPN_MASA_REVERSAL",
  "PPH_FINAL",
  "PPH_FINAL_REVERSAL",
  "TAX_PAYMENT",
  "TAX_PAYMENT_REVERSAL",
  "CASH_VOUCHER",
  "CASH_VOUCHER_REVERSAL",
  "SUPPLIER_PAYMENT_DOC",
  "SUPPLIER_PAYMENT_DOC_REVERSAL",
  "YEAR_END_CLOSE",
  "OPENING",
  // Jurnal operasional (lib/finance/operasional).
  "CONSIGNMENT_SHIPMENT",
  "CONSIGNMENT_ORDER",
  "CONSIGNMENT_RETURN",
  "CONSIGNMENT_CYCLE",
  "CONSIGNMENT_COMMISSION",
  "CONSIGNMENT_COMMISSION_PAYMENT",
  "CONSIGNMENT_PAYMENT",
  "SPG_COMMISSION",
  "SPG_COMMISSION_PAYMENT",
  "STOCK_LOSS",
  "LOSS_SALES_DEDUCTION",
  "DAMAGED_STOCK",
  "STOCK_ADJUSTMENT",
  "VENDOR_RETURN",
  "TRAVEL_CLAIM",
  "TRAVEL_CLAIM_PAYMENT",
  // Aset tetap (lib/finance/aset) dan jurnal berulang (lib/finance/berulang).
  "FIXED_ASSET",
  "FIXED_ASSET_REVERSAL",
  "DEPRECIATION",
  "ASSET_DISPOSAL",
  "ASSET_DISPOSAL_REVERSAL",
  "RECURRING",
  "RECURRING_REVERSAL",
] as const;

/** Nilai `?source=` → saringan kueri; nilai tak dikenal tidak menyaring apa pun. */
export function saringanSumber(source: string | undefined): { manualOnly?: true; sourceType?: string } {
  if (source === "manual") return { manualOnly: true };
  if (source && (JENIS_SUMBER_JURNAL as readonly string[]).includes(source)) return { sourceType: source };
  return {};
}

/** Data induk untuk dokumen yang tidak punya halaman sendiri. */
export type IndukDokumen = {
  poId?: string | null;
  woId?: string | null;
  canvasserId?: string | null;
  /** Pengiriman sampel KOL tampil di rincian kolaborasinya. */
  kolaborasiId?: string | null;
  /** Nota tagihan putus tampil di rincian pesanan lapangannya. */
  fieldOrderId?: string | null;
  /** Hitungan gudang (NRI) tampil di rincian nota retur tokonya. */
  storeReturnId?: string | null;
  /** Kiriman titipan, gaji SPG, dan pembayaran toko tampil di rincian siklus konsinyasinya. */
  cycleId?: string | null;
  /** Komisi SPG toko putus tampil di halaman Komisi SPG bulan itu ("YYYY-MM"). */
  periode?: string | null;
  /** Faktur piutang manual/impor tidak punya halaman sendiri: dicari di daftar Faktur & Piutang. */
  noFaktur?: string | null;
};

/** Pembayaran pemasok ber-sourceId `poId#generasi`; jenis lain memakai sourceId apa adanya. */
export function idDokumenDariSumber(sourceType: string | null, sourceId: string | null): string | null {
  if (!sourceType || !sourceId) return null;
  if (
    sourceType === "SUPPLIER_PAYMENT" ||
    sourceType === "SUPPLIER_PAYMENT_REVERSAL" ||
    // Jurnal KOL ber-sourceId `<kolaborasi>#…`.
    sourceType === "KOL_FEE" ||
    sourceType === "KOL_PAYMENT" ||
    sourceType === "KOL_PAYMENT_REVERSAL" ||
    // Jurnal lapangan bergenerasi: `<id>`, `<id>#2`, … (lib/finance/lapangan/selaras.ts).
    sourceType === "FIELD_COLLECTION" ||
    sourceType === "STORE_RETURN" ||
    sourceType === "STORE_INVOICE" ||
    // Penyelesaian masa PPN dan PPh final ber-sourceId `<masa>#<generasi>` (lib/finance/pajak/masa.ts).
    sourceType === "PPN_MASA" ||
    sourceType === "PPN_MASA_REVERSAL" ||
    sourceType === "PPH_FINAL" ||
    sourceType === "PPH_FINAL_REVERSAL" ||
    // Jurnal penutup tahun ber-sourceId `<tahun>`, `<tahun>#2`, `<tahun>#2#balik` (lib/finance/periode).
    sourceType === "YEAR_END_CLOSE" ||
    // Jurnal operasional bergenerasi: `<id>`, `<id>#2`, … (lib/finance/operasional, lewat selaras.ts).
    sourceType === "CONSIGNMENT_RETURN" ||
    sourceType === "CONSIGNMENT_CYCLE" ||
    sourceType === "CONSIGNMENT_COMMISSION" ||
    sourceType === "CONSIGNMENT_PAYMENT" ||
    sourceType === "SPG_COMMISSION" ||
    sourceType === "STOCK_LOSS"
  ) {
    const id = sourceId.split("#")[0];
    return id ? id : null;
  }
  // Saldo awal: `<OpeningBalanceImport.id>`, pembaliknya `<id>:balik` (lib/finance/saldo-awal/jenis.ts).
  if (sourceType === "OPENING") return sourceId.replace(/:balik$/, "") || null;
  // Pelepasan aset bergenerasi: `<aset>`, `<aset>#2`, … (lib/finance/aset/writer.ts). Penyusutan
  // (`<aset>/<YYYY-MM>`) dan jurnal berulang (`<templat>/<YYYY-MM>`) memakai sourceId apa adanya:
  // nomor dokumennya menyebut bulannya (info-dokumen.ts).
  if (sourceType === "ASSET_DISPOSAL" || sourceType === "ASSET_DISPOSAL_REVERSAL") return sourceId.split("#")[0] || null;
  return sourceId;
}

export function kunciDokumen(jenis: string, id: string): string {
  return `${jenis}|${id}`;
}

function seg(id: string): string {
  return encodeURIComponent(id);
}

/** Halaman dokumen sumber; null bila jenisnya tidak dikenal (jangan menebak alamat). */
export function tautanDokumenSumber(
  jenis: string | null,
  id: string | null,
  induk: IndukDokumen = {},
): string | null {
  if (!jenis || !id) return null;
  switch (jenis) {
    case "SETTLEMENT":
      return `/backoffice/finance/settlements/${seg(id)}`;
    case "OPNAME":
      return `/backoffice/inventory/stock-opname/${seg(id)}`;
    case "GRN":
    case "GRN_REVERSAL":
      // Penerimaan barang tidak punya halaman sendiri: tampil di PO-nya, atau di tab GRN.
      return induk.poId ? `/backoffice/purchase-orders/${seg(induk.poId)}` : "/backoffice/inventory?tab=grn";
    case "FG_RECEIPT":
      return induk.woId ? `/backoffice/work-orders/${seg(induk.woId)}` : "/backoffice/work-orders";
    case "SALESORDER_REVENUE":
    case "SALESORDER_COGS":
      return `/backoffice/sales-orders/${seg(id)}`;
    case "SALESRETURN_REVENUE":
    case "SALESRETURN_COGS":
      return `/backoffice/returns/${seg(id)}`;
    case "VAN_LOAD":
      // Muatan van tampil di halaman van kanvasernya.
      return induk.canvasserId ? `/backoffice/canvassing/${seg(induk.canvasserId)}` : "/backoffice/canvassing";
    case "VAN_SALE":
      return `/backoffice/van-sales/${seg(id)}`;
    case "VAN_RECONCILE":
      return `/backoffice/canvassing/reconcile/${seg(id)}`;
    case "SUPPLIER_PAYMENT":
    case "SUPPLIER_PAYMENT_REVERSAL":
      return `/backoffice/purchase-orders/${seg(id)}`;
    case "KOL_KOLABORASI":
    case "KOL_FEE":
    case "KOL_PAYMENT":
    case "KOL_PAYMENT_REVERSAL":
      return `/backoffice/kreatif/kolaborasi/${seg(id)}?tab=pembayaran`;
    case "KOL_SAMPLE":
      // Pengiriman sampel tidak punya halaman sendiri: tampil di kolaborasinya.
      return induk.kolaborasiId ? `/backoffice/kreatif/kolaborasi/${seg(induk.kolaborasiId)}` : "/backoffice/kreatif/sampel";
    case "FIELD_DELIVERY":
      // Nota tagihan tampil di kartu pengiriman pesanan lapangannya.
      return induk.fieldOrderId ? `/backoffice/field-sales-orders/${seg(induk.fieldOrderId)}` : "/backoffice/field-sales-orders";
    case "FIELD_COLLECTION":
      return `/backoffice/pelunasan/${seg(id)}`;
    case "STORE_RETURN":
      // Hitungan gudang tampil di rincian nota retur tokonya; yang belum dijodohkan hanya di daftar.
      return induk.storeReturnId ? `/backoffice/retur-toko/${seg(induk.storeReturnId)}` : "/backoffice/retur-toko";
    case "STORE_EXCHANGE":
      return `/backoffice/tukar-barang/${seg(id)}`;
    case "STORE_INVOICE":
      // Faktur piutang manual/impor: daftar Faktur & Piutang yang dicari nomornya (lunas pun tampil saat dicari).
      return induk.noFaktur ? `/backoffice/piutang?cari=${encodeURIComponent(induk.noFaktur)}` : "/backoffice/piutang";
    case "PPN_MASA":
    case "PPN_MASA_REVERSAL":
      return `/backoffice/finance/pajak/ppn?masa=${seg(id)}`;
    case "PPH_FINAL":
    case "PPH_FINAL_REVERSAL":
      return `/backoffice/finance/pajak/pph-final?tahun=${seg(id.slice(0, 4))}`;
    case "TAX_PAYMENT":
    case "TAX_PAYMENT_REVERSAL":
      return `/backoffice/finance/pajak/setoran?id=${seg(id)}`;
    case "CASH_VOUCHER":
    case "CASH_VOUCHER_REVERSAL":
      // Voucher kas & bank (BKK/BKMK/TRF) dan pembatalannya (lib/finance/kas).
      return `/backoffice/finance/kas/${seg(id)}`;
    case "SUPPLIER_PAYMENT_DOC":
    case "SUPPLIER_PAYMENT_DOC_REVERSAL":
      // Dokumen pembayaran pemasok BYR/… dan pembatalannya (lib/purchasing/pembayaran-*).
      return `/backoffice/supplier-payments/${seg(id)}`;
    case "YEAR_END_CLOSE":
      // Jurnal penutup (dan pembaliknya) dikelola di halaman Tutup buku, baris tahunnya.
      return "/backoffice/finance/tutup-buku";
    case "OPENING":
      // Saldo awal (dan pembaliknya) dikelola di halaman Saldo awal, satu jenis per jurnal.
      return "/backoffice/finance/saldo-awal";
    // Jurnal operasional (lib/finance/operasional).
    case "CONSIGNMENT_SHIPMENT":
    case "CONSIGNMENT_COMMISSION_PAYMENT":
    case "CONSIGNMENT_PAYMENT":
      // Kiriman, gaji SPG, dan pembayaran toko tampil di rincian siklusnya; kiriman tanpa siklus hanya di daftar.
      return induk.cycleId ? `/backoffice/konsinyasi/${seg(induk.cycleId)}` : "/backoffice/konsinyasi";
    case "CONSIGNMENT_CYCLE":
    case "CONSIGNMENT_COMMISSION":
      return `/backoffice/konsinyasi/${seg(id)}`;
    case "CONSIGNMENT_ORDER":
      return `/backoffice/field-sales-orders/${seg(id)}`;
    case "CONSIGNMENT_RETURN":
      return induk.storeReturnId ? `/backoffice/retur-toko/${seg(induk.storeReturnId)}` : "/backoffice/retur-toko";
    case "SPG_COMMISSION":
    case "SPG_COMMISSION_PAYMENT":
      return induk.periode ? `/backoffice/komisi-spg?bulan=${seg(induk.periode)}` : "/backoffice/komisi-spg";
    case "STOCK_LOSS":
      return `/backoffice/barang-hilang/${seg(id)}`;
    case "LOSS_SALES_DEDUCTION":
      return "/backoffice/laporan/komisi-salesman";
    case "DAMAGED_STOCK":
      return "/backoffice/gudang-rusak";
    case "STOCK_ADJUSTMENT":
      return "/backoffice/inventory?tab=adjustments";
    case "VENDOR_RETURN":
      return `/backoffice/vendor-returns/${seg(id)}`;
    case "TRAVEL_CLAIM":
    case "TRAVEL_CLAIM_PAYMENT":
      return `/backoffice/biaya-perjalanan/${seg(id)}`;
    // Aset tetap: perolehan, pelepasan, pembatalannya (id aset) dan penyusutan (`<aset>/<YYYY-MM>`).
    case "FIXED_ASSET":
    case "FIXED_ASSET_REVERSAL":
    case "ASSET_DISPOSAL":
    case "ASSET_DISPOSAL_REVERSAL":
    case "DEPRECIATION": {
      const asetId = id.split("/")[0];
      return asetId ? `/backoffice/finance/aset-tetap/${seg(asetId)}` : "/backoffice/finance/aset-tetap";
    }
    // Jurnal berulang (`<templat>/<YYYY-MM>`) dan pembalik akrualnya.
    case "RECURRING":
    case "RECURRING_REVERSAL": {
      const templatId = id.split("/")[0];
      return templatId ? `/backoffice/finance/jurnal-berulang/${seg(templatId)}` : "/backoffice/finance/jurnal-berulang";
    }
    default:
      return null;
  }
}

function duaDigit(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Bulan kalender WIB yang memuat tanggal jurnal, sebagai isian `from`/`to`
 * buku besar akun ("YYYY-MM-DD"). Dipakai tautan akun di rincian jurnal.
 */
export function rentangBulanWib(iso: string): { dari: string; sampai: string } | null {
  const waktu = new Date(iso).getTime();
  if (Number.isNaN(waktu)) return null;
  // WIB = UTC+7 tanpa musim panas, jadi geser lalu baca komponen UTC.
  const wib = new Date(waktu + 7 * 60 * 60 * 1000);
  const tahun = wib.getUTCFullYear();
  const bulan = wib.getUTCMonth() + 1;
  const hariTerakhir = new Date(Date.UTC(tahun, bulan, 0)).getUTCDate();
  return {
    dari: `${tahun}-${duaDigit(bulan)}-01`,
    sampai: `${tahun}-${duaDigit(bulan)}-${duaDigit(hariTerakhir)}`,
  };
}

/**
 * Buku besar satu akun pada periode yang sama dengan laporan/jurnal asalnya.
 * `dari` null = sejak awal.
 */
export function tautanBukuBesar(accountId: string, rentang?: { dari: string | null; sampai: string }): string {
  const dasar = `/backoffice/finance/journals/ledger/${encodeURIComponent(accountId)}`;
  if (!rentang) return dasar;
  const qs = new URLSearchParams();
  if (rentang.dari) qs.set("from", rentang.dari);
  qs.set("to", rentang.sampai);
  return `${dasar}?${qs.toString()}`;
}
