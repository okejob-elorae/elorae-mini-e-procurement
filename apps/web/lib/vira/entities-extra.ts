/**
 * More VIRA read entities, in a compact form. Same policy rules as entities.ts:
 * the gate is the gate of the office page, and a field is listed only when that page may show it.
 * Costs (unitCost, avgCost, HPP, service prices) are left out on purpose.
 */
import { canViewFieldReturns } from "@/lib/field-sales/retur/access";
import { bolehMembacaPelunasan, bolehMembacaPiutang, bolehMembacaRetur } from "@/lib/receivables/izin";
import { bolehMelihatBiaya } from "@/lib/salesman/biaya";
import { bolehMelihatTukar } from "@/lib/salesman/tukar-barang";
import type { ViraGate } from "./akses";
import type { ViraEntityDef, ViraEntityField, ViraEntityParity, ViraEntityRelation, ViraFieldType } from "./entities";
import { WO_READ_CODES } from "./tools/production";

type Access = { gate: ViraGate; parity: ViraEntityParity };

/** Page gated by the ROUTE_PERMISSIONS map. */
function route(path: string, code: string): Access {
  return { gate: { kind: "code", code }, parity: { kind: "route", path } };
}

/** Page that checks one code itself. */
function page(dir: string, code: string): Access {
  return {
    gate: { kind: "code", code },
    parity: { kind: "pageCode", pageFile: `apps/web/app/backoffice/${dir}/page.tsx`, codes: [code] },
  };
}

/** Page that checks a predicate. */
function izin(module: string, exportName: string, check: (p: string[]) => boolean): Access {
  return { gate: { kind: "izin", name: exportName, check }, parity: { kind: "predicate", module, exportName } };
}

const WO: Access = {
  gate: { kind: "anyOf", codes: [...WO_READ_CODES] },
  parity: { kind: "pageCode", pageFile: "apps/web/app/actions/production.ts", codes: [...WO_READ_CODES] },
};
const SHIP_CODES = ["deliveries:ship", "deliveries:pod", "deliveries:cancel_nota"];
const DELIVERIES: Access = {
  gate: { kind: "anyOf", codes: SHIP_CODES },
  parity: { kind: "pageCode", pageFile: "apps/web/app/backoffice/deliveries/page.tsx", codes: SHIP_CODES },
};
const PIUTANG = izin("@/lib/receivables/izin", "bolehMembacaPiutang", (p) => bolehMembacaPiutang(p));
const PELUNASAN = izin("@/lib/receivables/izin", "bolehMembacaPelunasan", (p) => bolehMembacaPelunasan(p));
const RETUR = izin("@/lib/receivables/izin", "bolehMembacaRetur", (p) => bolehMembacaRetur(p));
const RETUR_LAPANGAN = izin("@/lib/field-sales/retur/access", "canViewFieldReturns", (p) => canViewFieldReturns(p));
const BIAYA = izin("@/lib/salesman/biaya", "bolehMelihatBiaya", (p) => bolehMelihatBiaya(p));
const TUKAR = izin("@/lib/salesman/tukar-barang", "bolehMelihatTukar", (p) => bolehMelihatTukar(p));

type Cols = Partial<Record<ViraFieldType, string>>;

/** `{ string: "a b" }` → field list; every entity starts with id. */
function cols(c: Cols): ViraEntityField[] {
  const out: ViraEntityField[] = [{ name: "id", type: "string", filterable: true, aggregatable: false }];
  for (const [type, names] of Object.entries(c) as [ViraFieldType, string][]) {
    for (const name of names.split(" ")) out.push({ name, type, filterable: true, aggregatable: type === "number" });
  }
  return out;
}

/** Names the parent page shows even to someone without the related entity's own gate. */
const SHOWN: Record<string, readonly string[]> = {
  person: ["name"],
  store: ["code", "name"],
  supplier: ["code", "name"],
  item: ["sku", "nameId"],
  item_category: ["code", "name"],
  uom: ["code"],
  service_type: ["code", "name"],
  chart_account: ["code", "name"],
};

/** `"store salesman:person"` → relations (relation name, then entity when it differs). */
function rels(spec: string): ViraEntityRelation[] {
  return spec
    .split(" ")
    .filter(Boolean)
    .map((s) => {
      const [name, entity = name] = s.split(":");
      return { name, entity, parentShows: SHOWN[entity] };
    });
}

function ent(
  name: string,
  model: string,
  descriptionId: string,
  descriptionEn: string,
  access: Access,
  url: string | ((r: Record<string, unknown>) => string),
  c: Cols,
  opts: { doc?: string; sort?: string; asc?: boolean; rel?: string } = {},
): ViraEntityDef {
  return {
    name,
    model,
    descriptionId,
    descriptionEn,
    ...access,
    urlPath: (r) => `/backoffice/${typeof url === "string" ? url.replace("{id}", String(r.id)) : url(r)}`,
    docNumberField: opts.doc,
    defaultSort: { field: opts.sort ?? "createdAt", dir: opts.asc ? "asc" : "desc" },
    fields: cols(c),
    relations: rels(opts.rel ?? ""),
  };
}

const FSO = "field_sales_orders:view";
const JURNAL = "journals:view";
const SPG = "spg_sales:view";
const TOKO = "stores:view";

export const VIRA_ENTITIES_EXTRA: readonly ViraEntityDef[] = [
  // People: names only.
  ent("person", "user", "Nama pengguna / staf", "User and staff names",
    route("/backoffice/settings/users", "settings_security:manage"), "settings/users",
    { string: "name" }, { sort: "name", asc: true }),

  // Items and stock
  ent("item_category", "itemCategory", "Kategori barang", "Item categories",
    route("/backoffice/items/categories", "items:view"), "items/categories",
    { string: "code name", boolean: "isActive", number: "sortOrder" }, { sort: "sortOrder", asc: true }),
  ent("consumption_rule", "consumptionRule", "Resep bahan per barang jadi (BOM)", "Bill-of-material rules",
    route("/backoffice/items", "items:view"), (r) => `items/${r.finishedGoodId}`,
    { string: "finishedGoodId materialId size notes", number: "qtyRequired wastePercent", boolean: "isActive" },
    { sort: "id", rel: "finishedGood:item material:item" }),
  ent("stock_movement", "stockMovement", "Gerakan stok gudang utama", "Main-warehouse stock movements",
    page("inventory/movements", "inventory:view"), "inventory/movements",
    { string: "itemId variantSku refType refId refDocNumber notes", enum: "type", number: "qty balanceQty", date: "createdAt" },
    { rel: "item" }),
  ent("stock_adjustment", "stockAdjustment", "Penyesuaian stok", "Stock adjustments",
    route("/backoffice/inventory/adjustment", "inventory:view"), "inventory/adjustment/{id}",
    { string: "docNumber itemId reason source createdById approvedById", enum: "type", number: "qtyChange prevQty newQty", date: "createdAt" },
    { doc: "docNumber", rel: "item createdBy:person approvedBy:person" }),
  // Header only: counters must not see system quantities (stock-opname/angka-sistem.ts).
  ent("stock_opname", "stockOpname", "Opname gudang (tanpa angka hitungan)", "Warehouse stock opname (no counts)",
    route("/backoffice/inventory/stock-opname", "inventory_opname:view"), "inventory/stock-opname/{id}",
    { string: "docNumber notes", enum: "scope status", date: "snapshotAt submittedAt approvedAt cancelledAt createdAt" },
    { doc: "docNumber" }),
  ent("fabric_roll", "fabricRoll", "Rol kain", "Fabric rolls",
    page("inventory", "inventory:view"), (r) => `inventory/grn/${r.grnId}`,
    { string: "grnId itemId rollCode rollRef uomId", number: "initialLength remainingLength", boolean: "isClosed", date: "createdAt" },
    { rel: "item uom grn" }),
  ent("rejected_goods", "rejectedGoodsLedger", "Barang reject produksi", "Rejected goods ledger",
    route("/backoffice/inventory/rejected-goods", "inventory:view"), "inventory/rejected-goods",
    { string: "itemId variantSku refType refDocNumber woId notes", number: "qty", date: "receivedAt" },
    { sort: "receivedAt", rel: "item" }),
  ent("damaged_stock_movement", "damagedStockMovement", "Gerakan gudang rusak", "Damaged-stock movements",
    page("gudang-rusak", "inventory:view"), "gudang-rusak",
    { string: "itemId variantSku productName kind refType refId note", number: "qty", date: "createdAt" }),

  // Purchasing and production
  ent("supplier_type", "supplierType", "Jenis pemasok", "Supplier types",
    route("/backoffice/suppliers/types", "supplier_types:view"), "suppliers/types",
    { string: "code name", boolean: "isActive" }, { sort: "code", asc: true }),
  ent("service_type", "serviceType", "Jenis jasa produksi", "Production service types",
    route("/backoffice/service-types", "work_orders:view"), "service-types",
    { string: "code name", boolean: "isActive" }, { sort: "code", asc: true }),
  ent("work_order_step", "workOrderStep", "Tahap jasa SPK", "Work-order service steps",
    WO, (r) => `work-orders/${r.woId}`,
    { string: "woId stepName serviceTypeId supplierId issueDocNumber receiptDocNumber notes", number: "sequence qty", date: "issuedAt receivedAt" },
    { sort: "id", rel: "serviceType:service_type supplier wo:work_order" }),
  ent("material_issue", "materialIssue", "Pengeluaran bahan SPK", "Work-order material issues",
    WO, (r) => `work-orders/${r.woId}`,
    { string: "docNumber woId notes", enum: "issueType", boolean: "isPartial acknowledged", date: "issuedAt ackAt" },
    { doc: "docNumber", sort: "issuedAt", rel: "wo:work_order" }),
  ent("fg_receipt", "fGReceipt", "Penerimaan barang jadi SPK", "Finished-goods receipts",
    WO, (r) => `work-orders/${r.woId}`,
    { string: "docNumber woId qcNotes", enum: "receiptType", number: "qtyReceived qtyRejected qtyAccepted", boolean: "qcPassed", date: "receivedAt" },
    { doc: "docNumber", sort: "receivedAt", rel: "wo:work_order" }),
  ent("item_request", "itemRequest", "Permintaan barang", "Item requests",
    page("item-requests", "item_requests:view"), "item-requests/{id}",
    { string: "docNumber sourceWoId notes createdById", enum: "status", date: "neededBy createdAt" },
    { doc: "docNumber", rel: "createdBy:person lines:item_request_line sourceWo:work_order" }),
  ent("item_request_line", "itemRequestLine", "Baris permintaan barang", "Item-request lines",
    page("item-requests", "item_requests:view"), (r) => `item-requests/${r.requestId}`,
    { string: "requestId itemId variantSku uomId poId", enum: "status", number: "qty" },
    { sort: "id", rel: "item uom po:purchase_order" }),
  ent("vendor_return", "vendorReturn", "Retur ke pemasok", "Vendor returns",
    route("/backoffice/vendor-returns", "vendor_returns:view"), "vendor-returns/{id}",
    { string: "docNumber woId vendorId grnId poId trackingNumber", enum: "status", number: "totalItems totalValue", date: "processedAt completedAt createdAt" },
    { doc: "docNumber", rel: "vendor:supplier wo:work_order" }),
  ent("vendor_bill_line", "vendorBillLine", "Baris tagihan pemasok", "Vendor-bill lines",
    page("vendor-bills", "vendor_bills:view"), (r) => `vendor-bills/${r.billId}`,
    { string: "billId itemId variantSku poItemId woStepId", enum: "type", number: "qty price amount" },
    { sort: "id", rel: "bill:vendor_bill" }),
  ent("supplier_payment", "supplierPayment", "Pembayaran pemasok", "Supplier payments",
    page("supplier-payments", "supplier_payments:view"), "supplier-payments/{id}",
    { string: "docNumber supplierId method reference status note", number: "grossAmount netAmount", boolean: "isAdvance", date: "date giroDueDate cancelledAt createdAt" },
    { doc: "docNumber", rel: "allocations:supplier_payment_allocation" }),
  ent("supplier_payment_allocation", "supplierPaymentAllocation", "Alokasi pembayaran pemasok", "Supplier-payment allocations",
    page("supplier-payments", "supplier_payments:view"), (r) => `supplier-payments/${r.paymentId}`,
    { string: "paymentId targetType targetId note", number: "amount" }, { sort: "id" }),
  ent("plan_year", "planYear", "Rencana produksi tahunan", "Yearly production plans",
    page("production/planning", "production_planning:view"), "production/planning",
    { string: "notes", number: "year", enum: "status", boolean: "isLocked", date: "createdAt" }, { sort: "year" }),
  ent("plan_category", "planCategory", "Kategori rencana produksi", "Production-plan categories",
    page("production/planning", "production_planning:view"), "production/planning",
    { string: "planYearId code name description parentId itemId itemCategoryId", number: "targetQty sortOrder" },
    { sort: "sortOrder", asc: true, rel: "item itemCategory:item_category planYear:plan_year" }),
  ent("plan_stage", "planStage", "Tahap rencana produksi", "Production-plan stages",
    page("production/planning", "production_planning:view"), "production/planning/tahap/{id}",
    { string: "planCategoryId name variantSku supplierId workOrderId", number: "targetQty targetMonth", date: "scheduleStart deadline" },
    { sort: "id", rel: "supplier planCategory:plan_category" }),
  ent("forecast_result", "forecastResult", "Hasil perkiraan permintaan", "Demand forecast results",
    page("forecast", "forecast:view"), "forecast",
    { string: "itemId parentSku productName", enum: "abcClass xyzClass", number: "year totalHistoricalQty avgMonthlyDemand forecastAnnual", date: "generatedAt" },
    { sort: "generatedAt", rel: "item" }),

  // Marketplace
  ent("sales_order_item", "salesOrderItem", "Baris pesanan marketplace", "Marketplace order lines",
    route("/backoffice/sales-orders", "sales_orders:view"), (r) => `sales-orders/${r.salesOrderId}`,
    { string: "salesOrderId itemId productName", number: "qty returnedQty unitPrice lineTotal", boolean: "isCanceledItem" },
    { sort: "id", rel: "salesOrder:sales_order" }),
  ent("sales_return", "salesReturn", "Retur marketplace", "Marketplace returns",
    route("/backoffice/returns", "sales_returns:view"), "returns/{id}",
    { string: "jubelioReturnNo salesOrderId channelOrderNo", enum: "channel status", number: "totalQty totalValue", date: "receivedAt decidedAt createdAt" },
    { rel: "items:sales_return_item salesOrder:sales_order" }),
  ent("sales_return_item", "salesReturnItem", "Baris retur marketplace", "Marketplace return lines",
    route("/backoffice/returns", "sales_returns:view"), (r) => `returns/${r.salesReturnId}`,
    { string: "salesReturnId itemId variantSku productName itemReason", enum: "decision", number: "qty unitPrice subtotal", date: "decidedAt" },
    { sort: "id", rel: "item" }),

  // Promos
  ent("promo", "promo", "Promo salesman", "Field-sales promos",
    route("/backoffice/promos", "promos:view"), "promos/{id}",
    { string: "name", enum: "type level termsType", number: "value minQty minOrderSubtotal minOrderQty priority bonusBuyQty bonusFreeQty", boolean: "allStores isActive", date: "startsAt endsAt createdAt" },
    { rel: "tiers:promo_tier items:promo_item" }),
  ent("promo_tier", "promoTier", "Tingkat harga promo", "Promo price tiers",
    route("/backoffice/promos", "promos:view"), (r) => `promos/${r.promoId}`,
    { string: "promoId", number: "minQty unitPrice" }, { sort: "id" }),
  ent("promo_item", "promoItem", "Barang promo", "Promo items",
    route("/backoffice/promos", "promos:view"), (r) => `promos/${r.promoId}`,
    { string: "promoId itemId" }, { sort: "id", rel: "item" }),
  ent("counter_promo", "counterPromo", "Promo konter", "Counter promos",
    page("promo-konter", "promos:view"), "promo-konter/{id}",
    { string: "name type note", number: "value buyQty freeQty minSubtotal storeSharePercent priority", boolean: "allItems allStores isActive memberOnly", date: "startsAt endsAt createdAt" }),

  // Field sales
  ent("delivery_shipment_line", "deliveryShipmentLine", "Baris surat jalan", "Delivery-shipment lines",
    DELIVERIES, (r) => `deliveries/${r.shipmentId}`,
    { string: "shipmentId itemId variantSku", number: "plannedQty deliveredQty returnedQty lostQty" },
    { sort: "id", rel: "shipment:delivery_shipment" }),
  ent("preorder_window", "preorderWindow", "Periode inden", "Pre-order windows",
    page("inden", FSO), "inden/{id}",
    { string: "name note", boolean: "isActive", date: "opensAt closesAt shipFrom shipTo releasedAt createdAt" }),
  ent("announcement", "announcement", "Pengumuman", "Announcements",
    page("pengumuman", FSO), "pengumuman/{id}",
    { string: "title body audience", boolean: "requireAck pinned", date: "publishedAt expiresAt archivedAt createdAt" }),
  ent("visit_schedule", "visitSchedule", "Jadwal kunjungan salesman", "Salesman visit schedule",
    page("jadwal-kunjungan", FSO), "jadwal-kunjungan",
    { string: "salesmanId storeId dayKey note" }, { sort: "dayKey" }),
  ent("sales_target", "salesTarget", "Target penjualan", "Sales targets",
    page("target-sales", FSO), "target-sales",
    { string: "salesmanId month scope refId measure", number: "value" }, { sort: "month" }),
  ent("expense_claim", "expenseClaim", "Biaya perjalanan", "Travel expense claims",
    BIAYA, "biaya-perjalanan/{id}",
    { string: "userId category status", number: "amount", date: "spentAt reviewedAt paidAt createdAt" }, { sort: "spentAt" }),
  ent("store_exchange", "storeExchange", "Tukar barang toko", "Store exchanges",
    TUKAR, "tukar-barang/{id}",
    { string: "docNo storeId salesmanId status", date: "reviewedAt completedAt createdAt" }, { doc: "docNo" }),
  ent("field_return", "fieldReturn", "Retur lapangan", "Field returns",
    RETUR_LAPANGAN, "field-returns/{id}",
    { string: "docNo storeId raisedById", enum: "status origin transport valuationStatus offsetStatus", date: "receivedAt approvedAt createdAt" },
    { doc: "docNo", rel: "store" }),

  // Stores
  ent("store_transfer", "storeTransfer", "Mutasi antar toko", "Store transfers",
    page("store-transfers", TOKO), "store-transfers/{id}",
    { string: "docNo fromStoreId toStoreId reason", enum: "status", date: "movedAt shippedAt approvedAt cancelledAt createdAt" },
    { doc: "docNo", rel: "fromStore:store toStore:store createdBy:person" }),
  ent("konsi_sell_through", "konsiSellThrough", "Laku konsinyasi", "Consignment sell-through",
    page("konsi-sell-through", TOKO), "konsi-sell-through/{id}",
    { string: "docNo storeId salesmanId", enum: "method status", number: "total", boolean: "baseline", date: "periodStart periodEnd invoiceDate dueDate approvedAt createdAt" },
    { doc: "docNo", rel: "store salesman:person" }),
  ent("competitor_price", "competitorPrice", "Harga pesaing", "Competitor prices",
    page("harga-pesaing", TOKO), "harga-pesaing",
    { string: "storeId brand productName category note", number: "price", date: "createdAt" }),
  ent("store_proposal", "storeProposal", "Usulan toko baru", "New-store proposals",
    page("stores/usulan", TOKO), "stores/usulan/{id}",
    { string: "name status storeId proposedById", enum: "termsType", date: "reviewedAt createdAt" }),

  // Receivables
  ent("collection_note", "collectionNote", "Kontrabon", "Collection notes",
    PIUTANG, "kontrabon/{id}",
    { string: "docNo storeId salesmanId source", enum: "status", number: "amount", date: "handoverDate promisedDate confirmedAt createdAt" },
    { doc: "docNo", rel: "store salesman:person" }),
  ent("payment_claim", "paymentClaim", "Bukti kas masuk (BKM)", "Payment claims",
    PELUNASAN, "pelunasan/{id}",
    { string: "docNo storeId salesmanId collectionNoteId giroStatus", enum: "method status", number: "invoiceAmount receivedAmount", date: "claimedTransferAt giroEffectiveDate verifiedAt createdAt" },
    { doc: "docNo", rel: "store salesman:person verifiedBy:person" }),
  // No claimed amounts or quantities: counters must not see the claim (retur-toko/buta.ts).
  ent("store_return", "storeReturn", "Nota retur toko (tanpa nilai klaim)", "Store returns (no claim values)",
    RETUR, "retur-toko/{id}",
    { string: "noNrt storeId salesmanId", enum: "status deliveryMethod", date: "claimDate createdAt" },
    { doc: "noNrt", rel: "store salesman:person" }),

  // SPG (office view)
  ent("spg_sale", "spgSale", "Penjualan SPG", "SPG counter sales",
    page("spg-sales", SPG), "spg-sales/{id}",
    { string: "docNo storeId salesmanId", number: "subtotal total discountTotal", date: "createdAt" },
    { doc: "docNo", rel: "store salesman:person lines:spg_sale_line" }),
  ent("spg_sale_line", "spgSaleLine", "Baris penjualan SPG", "SPG sale lines",
    page("spg-sales", SPG), (r) => `spg-sales/${r.spgSaleId}`,
    { string: "spgSaleId itemId variantSku productName", number: "qty returnedQty unitPrice lineTotal discount" },
    { sort: "id", rel: "item" }),
  ent("lost_sale", "lostSale", "Barang dicari tapi tidak ada", "Lost sales",
    page("spg-lost-sales", SPG), "spg-lost-sales",
    { string: "storeId itemId variantSku description", number: "qty", date: "createdAt" }, { rel: "store" }),
  ent("spg_daily_close", "spgDailyClose", "Tutup hari SPG", "SPG daily close",
    page("spg-tutup-hari", SPG), "spg-tutup-hari/{id}",
    { string: "storeId day", number: "notaCount pcs returnPcs grossTotal discountTotal netTotal visitorCount", date: "createdAt" },
    { sort: "day" }),

  // Finance
  ent("chart_account", "chartAccount", "Bagan akun", "Chart of accounts",
    page("finance/coa", "coa:view"), "finance/coa",
    { string: "code name parentId", enum: "type", number: "depth", boolean: "isActive" }, { sort: "code", asc: true }),
  ent("journal", "journal", "Jurnal", "Journals",
    page("finance/journals", JURNAL), "finance/journals/{id}",
    { string: "description sourceType sourceId status", boolean: "isManual", date: "date approvedAt createdAt" },
    { sort: "date", rel: "lines:journal_line" }),
  ent("journal_line", "journalLine", "Baris jurnal", "Journal lines",
    page("finance/journals", JURNAL), (r) => `finance/journals/${r.journalId}`,
    { string: "journalId chartAccountId memo channel storeId", number: "debit credit" },
    { sort: "id", rel: "account:chart_account" }),
  ent("cash_voucher", "cashVoucher", "Bukti kas/bank", "Cash vouchers",
    page("finance/kas", JURNAL), "finance/kas/{id}",
    { string: "docNumber type counterpart supplierId description status", number: "totalAmount netAmount", date: "date cancelledAt createdAt" },
    { doc: "docNumber", sort: "date", rel: "lines:cash_voucher_line" }),
  ent("cash_voucher_line", "cashVoucherLine", "Baris bukti kas/bank", "Cash-voucher lines",
    page("finance/kas", JURNAL), (r) => `finance/kas/${r.voucherId}`,
    { string: "voucherId chartAccountId memo channel storeId", number: "amount" }, { sort: "id" }),
  ent("fixed_asset", "fixedAsset", "Aset tetap", "Fixed assets",
    page("finance/aset-tetap", JURNAL), "finance/aset-tetap/{id}",
    { string: "code name category method location status", number: "cost residualValue usefulLifeMonths", date: "acquisitionDate disposedAt" },
    { doc: "code", sort: "acquisitionDate" }),
  ent("recurring_journal", "recurringJournal", "Jurnal berulang", "Recurring journals",
    page("finance/jurnal-berulang", JURNAL), "finance/jurnal-berulang/{id}",
    { string: "name description frequency lastRunPeriod", number: "dayOfMonth", boolean: "autoReverse active", date: "startDate endDate" },
    { sort: "name", asc: true }),
  ent("accounting_period", "accountingPeriod", "Periode buku", "Accounting periods",
    page("finance/tutup-buku", JURNAL), "finance/tutup-buku",
    { string: "status closeNote reopenReason", number: "year month", date: "closedAt reopenedAt" }, { sort: "year" }),
  ent("budget", "budget", "Anggaran", "Budgets",
    page("finance/anggaran", JURNAL), "finance/anggaran",
    { string: "chartAccountId note", number: "year month amount" }, { sort: "year" }),

  // Creative
  ent("kol_campaign", "kolCampaign", "Campaign KOL", "KOL campaigns",
    page("kreatif/campaign", "creative:view"), "kreatif/campaign/{id}",
    { string: "name brand product objective status", number: "budget targetKol targetContent targetViews", date: "startDate endDate archivedAt createdAt" }),
  ent("kol_content", "kolContent", "Konten KOL", "KOL content",
    page("kreatif/konten-kol", "creative:view"), "kreatif/konten-kol",
    { string: "collabId link draftStatus", enum: "platform format", date: "plannedAt liveAt approvedAt createdAt" }),

  // Audit: who did what, without the changed values.
  ent("audit_log", "auditLog", "Jejak audit (tanpa isi perubahan)", "Audit trail (no changed values)",
    route("/backoffice/audit-trail", "audit_trail:view"), "audit-trail",
    { string: "userId action entityType entityId", date: "createdAt" }, { rel: "user:person" }),
];
