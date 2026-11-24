/**
 * VIRA generic-read entity policy.
 *
 * Callers: lib/vira/tools/generic.ts, lib/vira/generic-query.ts, parity.spec.ts.
 */
import { bolehMembacaPiutang, bolehMembukaKonsi } from "@/lib/receivables/izin";
import { gateAllows, type ViraActor, type ViraGate } from "./akses";
import { VIRA_ENTITIES_EXTRA } from "./entities-extra";
import { PO_READ_CODES } from "./tools/purchase-orders";
import { WO_READ_CODES } from "./tools/production";

export type ViraFieldType = "string" | "number" | "boolean" | "date" | "enum" | "json";

export type ViraEntityField = {
  name: string;
  type: ViraFieldType;
  description?: string;
  /** Default true for string/number/boolean/date/enum. */
  filterable?: boolean;
  /** Number fields only; used by aggregate_entity. */
  aggregatable?: boolean;
};

export type ViraEntityRelation = {
  name: string;
  /** Target entity `name` in VIRA_ENTITIES (for denylist on nested rows). */
  entity: string;
  description?: string;
  /** Child fields the parent's own page shows, readable even without the child's gate. */
  parentShows?: readonly string[];
};

/** Fields the UI hides on some rows. Filtering, sorting or aggregating on them drops those rows. */
export type ViraEntityMask = {
  fields: readonly string[];
  /** Prisma where for rows that show the fields. */
  visibleWhere: Record<string, unknown>;
  /** Extra select `isVisible` needs; removed from the output. */
  select?: Record<string, unknown>;
  isVisible: (row: Record<string, unknown>) => boolean;
};

/** How parity.spec proves this entity's gate equals the back-office page. */
export type ViraEntityParity =
  | { kind: "route"; path: string }
  | { kind: "pageCode"; pageFile: string; codes: string[] }
  | { kind: "predicate"; module: string; exportName: string };

export type ViraEntityDef = {
  /** Stable tool id, snake_case. */
  name: string;
  /** Prisma client delegate key (camelCase), e.g. fieldSalesOrder. */
  model: string;
  descriptionId: string;
  descriptionEn: string;
  gate: ViraGate;
  /** Path under /backoffice…; `{id}` / `{doc}` placeholders. */
  urlPath: (row: Record<string, unknown>) => string;
  docNumberField?: string;
  defaultSort: { field: string; dir: "asc" | "desc" };
  fields: readonly ViraEntityField[];
  relations: readonly ViraEntityRelation[];
  /** Extra Prisma `where` AND-ed for this actor. Omit = office-wide. */
  rowScope?: (actor: ViraActor) => Record<string, unknown> | null;
  mask?: ViraEntityMask;
  parity: ViraEntityParity;
};

/**
 * Field-name denylist (case-insensitive). Wins over allowlists and includes.
 * Matches password/hash/token/secret/key, salary/gaji/upah, NIK/NPWP/KTP,
 * bank*, phone, email, address, GPS/lat/lng, photo/signature/r2*.
 */
export const FIELD_DENY_RE =
  /(password|passwd|hash|token|secret|pinhash|fcm|salary|gaji|upah|nik|npwp|ktp|bank|phone|email|address|gps|(^|_)lat$|(^|_)lng$|photo|signature|r2key|r2|idempotencykey|openkey|stocktakekey|(^|.*)key$)/i;

/** Ordinary fields the pattern catches by accident. */
const FIELD_ALLOW = new Set(["dayKey"]);

export function isDeniedField(name: string): boolean {
  return !FIELD_ALLOW.has(name) && FIELD_DENY_RE.test(name);
}

export function filterAllowedFields<T extends { name: string }>(fields: readonly T[]): T[] {
  return fields.filter((f) => !isDeniedField(f.name));
}

function f(
  name: string,
  type: ViraFieldType,
  opts?: Partial<Pick<ViraEntityField, "description" | "filterable" | "aggregatable">>,
): ViraEntityField {
  return {
    name,
    type,
    filterable: opts?.filterable ?? (type !== "json"),
    aggregatable: opts?.aggregatable ?? type === "number",
    description: opts?.description,
  };
}

/** Same rule as `showMoney` / `fsoShowsMoney` on the field-sales order tools. */
const FSO_MONEY_VISIBLE = { OR: [{ orderType: { not: "KONSI" } }, { status: "APPROVED" }] };
/** KONSI money only after approval — shared with `lib/vira/tools/field-sales-orders.ts`. */
export function fsoShowsMoney(o: { orderType?: unknown; status?: unknown } | undefined): boolean {
  return o !== undefined && (o.orderType !== "KONSI" || o.status === "APPROVED");
}

/** Entities deliberately not exposed — keep in sync with the report. */
export const VIRA_ENTITIES_EXCLUDED: { model: string; reason: string }[] = [
  { model: "User (all but id and name)", reason: "Auth identity + passwordHash/pinHash. Names are exposed as `person`." },
  { model: "Session / Account", reason: "Auth internals." },
  { model: "SpgSaleReturn", reason: "Use list_spg_buyer_returns." },
  { model: "SpgCharge / SpgDebt / SpgCommission*", reason: "Salary/commission PII; not safe for generic browse." },
  { model: "VanSale / VanStock / VanLoad", reason: "Row-scoped to salesman; canvassing PWA surface." },
  { model: "LeaveRequest", reason: "Existing list_leave_requests; row visibility differs by role — keep dedicated tool." },
  { model: "StoreVisit / VisitPhoto", reason: "GPS + photos; field check-in PII." },
  { model: "Payment (full)", reason: "proofUrl/proofR2Key + settlement paths; use dedicated AR tools." },
  { model: "CollectionSubmission", reason: "Collector queue; row-scoped." },
  { model: "AuditLog.changes / Notification*", reason: "Changed values can hold denied fields; the rest of AuditLog is exposed as `audit_log`." },
  { model: "StockOpnameItem / StockOpnameRoll", reason: "Blind count: counters must not see system quantities." },
  { model: "StoreReturnItem / WarehouseReturn*", reason: "Blind count: counters must not see the claim (retur-toko/buta.ts)." },
  { model: "StoreNote", reason: "Per-user rows (own notes unless the user manages stores)." },
  { model: "CollectionTask", reason: "The office list drops tasks by consignment holder; not expressible as a where." },
  { model: "Attendance", reason: "GPS and photos." },
  { model: "StoreCustomer / Member / CustomerRequest", reason: "Customer PII." },
  { model: "Kol / KolBrief / KolPaymentTerm", reason: "Creator PII and fees." },
  { model: "ContentPlan / SettlementLine / TaxPayment / BankStatement*", reason: "Page gate or sensitive fields not reviewed yet." },
  { model: "SpgDebt / StockLoss / SpgSchedule*", reason: "Page opens by supervisor predicate with amounts per person." },
  { model: "Jubelio*", reason: "Integration internals; separate Jubelio screens." },
  { model: "Supplier.bank* / npwpEnc", reason: "Bank + tax id encrypted columns — denylist; whole supplier still exposed without those fields." },
];

/**
 * Back-office entities VIRA may query generically.
 * Gates match the page/action the URL opens (parity-tested).
 */
export const VIRA_ENTITIES: readonly ViraEntityDef[] = [
  {
    name: "item",
    model: "item",
    descriptionId: "Barang / SKU (katalog)",
    descriptionEn: "Catalog items (SKU)",
    gate: { kind: "code", code: "items:view" },
    urlPath: (r) => `/backoffice/items/${r.id}`,
    docNumberField: "sku",
    defaultSort: { field: "createdAt", dir: "desc" },
    fields: [
      f("id", "string"),
      f("sku", "string", { description: "SKU" }),
      f("nameId", "string", { description: "Indonesian name" }),
      f("nameEn", "string"),
      f("type", "enum"),
      f("isActive", "boolean"),
      f("sellingPrice", "number"),
      f("salesChannel", "enum"),
      f("source", "enum"),
      f("uomId", "string", { filterable: true }),
      f("categoryId", "string"),
      f("createdAt", "date"),
      f("updatedAt", "date"),
    ],
    relations: [
      { name: "uom", entity: "uom", description: "Unit of measure" },
      { name: "inventoryValues", entity: "inventory_value", description: "Main-warehouse balances" },
    ],
    parity: { kind: "route", path: "/backoffice/items" },
  },
  {
    name: "uom",
    model: "uOM",
    descriptionId: "Satuan (UOM)",
    descriptionEn: "Units of measure",
    gate: { kind: "code", code: "items:view" },
    urlPath: () => `/backoffice/settings/uom`,
    docNumberField: "code",
    defaultSort: { field: "code", dir: "asc" },
    fields: [
      f("id", "string"),
      f("code", "string"),
      f("nameId", "string"),
      f("nameEn", "string"),
    ],
    relations: [],
    parity: { kind: "route", path: "/backoffice/items" },
  },
  {
    name: "inventory_value",
    model: "inventoryValue",
    descriptionId: "Stok gudang utama per SKU",
    descriptionEn: "Main-warehouse (Gudang Utama) stock balances",
    gate: { kind: "code", code: "inventory:view" },
    urlPath: (r) => `/backoffice/items/${r.itemId}`,
    defaultSort: { field: "lastUpdated", dir: "desc" },
    fields: [
      f("id", "string"),
      f("itemId", "string"),
      f("variantSku", "string"),
      f("qtyOnHand", "number"),
      f("reservedQty", "number"),
      f("avgCost", "number"),
      f("totalValue", "number"),
      f("lastUpdated", "date"),
    ],
    relations: [{ name: "item", entity: "item", parentShows: ["sku", "nameId"] }],
    parity: { kind: "route", path: "/backoffice/inventory" },
  },
  {
    name: "store_stock",
    model: "storeStock",
    descriptionId: "Stok toko konsinyasi",
    descriptionEn: "Consignment store stock rows",
    gate: { kind: "code", code: "stores:view" },
    urlPath: (r) => `/backoffice/stores/${r.storeId}`,
    defaultSort: { field: "updatedAt", dir: "desc" },
    fields: [
      f("id", "string"),
      f("storeId", "string"),
      f("itemId", "string"),
      f("variantSku", "string"),
      f("qty", "number"),
      f("updatedAt", "date"),
      // avgCost left out: the store page does not show cost
    ],
    relations: [
      { name: "store", entity: "store", parentShows: ["code", "name"] },
      { name: "item", entity: "item", parentShows: ["sku", "nameId"] },
    ],
    parity: {
      kind: "pageCode",
      pageFile: "apps/web/app/backoffice/stores/page.tsx",
      codes: ["stores:view"],
    },
  },
  {
    name: "store",
    model: "store",
    descriptionId: "Toko",
    descriptionEn: "Stores (putus / konsi)",
    gate: { kind: "code", code: "stores:view" },
    urlPath: (r) => `/backoffice/stores/${r.id}`,
    docNumberField: "code",
    defaultSort: { field: "name", dir: "asc" },
    fields: [
      f("id", "string"),
      f("code", "string"),
      f("name", "string"),
      f("termsType", "enum"),
      f("paymentTempo", "number"),
      f("creditLimit", "number"),
      f("noCreditLimit", "boolean"),
      f("maxOpenInvoices", "number"),
      f("isActive", "boolean"),
      f("salesmanId", "string"),
      f("isPkp", "boolean"),
      f("createdAt", "date"),
      f("updatedAt", "date"),
      // address/phone/npwp/lat/lng denied by FIELD_DENY_RE
    ],
    relations: [],
    parity: {
      kind: "pageCode",
      pageFile: "apps/web/app/backoffice/stores/page.tsx",
      codes: ["stores:view"],
    },
  },
  {
    name: "supplier",
    model: "supplier",
    descriptionId: "Pemasok",
    descriptionEn: "Suppliers",
    gate: { kind: "code", code: "suppliers:view" },
    urlPath: (r) => `/backoffice/suppliers/${r.id}`,
    docNumberField: "code",
    defaultSort: { field: "code", dir: "asc" },
    fields: [
      f("id", "string"),
      f("code", "string"),
      f("name", "string"),
      f("typeId", "string"),
      f("isActive", "boolean"),
      f("status", "enum"),
      f("paymentTermsDays", "number"),
      f("createdAt", "date"),
      f("updatedAt", "date"),
    ],
    relations: [],
    parity: { kind: "route", path: "/backoffice/suppliers" },
  },
  {
    name: "purchase_order",
    model: "purchaseOrder",
    descriptionId: "Purchase order (PO)",
    descriptionEn: "Purchase orders",
    gate: { kind: "anyOf", codes: [...PO_READ_CODES] },
    urlPath: (r) => `/backoffice/purchase-orders/${r.id}`,
    docNumberField: "docNumber",
    defaultSort: { field: "createdAt", dir: "desc" },
    fields: [
      f("id", "string"),
      f("docNumber", "string"),
      f("supplierId", "string"),
      f("status", "enum"),
      f("etaDate", "date"),
      f("paymentDueDate", "date"),
      f("totalAmount", "number"),
      f("taxAmount", "number"),
      f("grandTotal", "number"),
      f("currency", "string"),
      f("createdById", "string"),
      f("createdAt", "date"),
      f("updatedAt", "date"),
      f("closedAt", "date"),
    ],
    relations: [
      { name: "supplier", entity: "supplier", parentShows: ["code", "name"] },
      { name: "items", entity: "po_item" },
    ],
    // Same anyOf as getPOs / list_purchase_orders — not the narrower route gate.
    parity: {
      kind: "pageCode",
      pageFile: "apps/web/app/actions/purchase-orders.ts",
      codes: [...PO_READ_CODES],
    },
  },
  {
    name: "po_item",
    model: "pOItem",
    descriptionId: "Baris PO",
    descriptionEn: "Purchase-order lines",
    gate: { kind: "anyOf", codes: [...PO_READ_CODES] },
    urlPath: (r) => `/backoffice/purchase-orders/${r.poId}`,
    defaultSort: { field: "createdAt", dir: "desc" },
    fields: [
      f("id", "string"),
      f("poId", "string"),
      f("itemId", "string"),
      f("variantSku", "string"),
      f("qty", "number"),
      f("price", "number"),
      f("receivedQty", "number"),
      f("uomId", "string"),
      f("createdAt", "date"),
    ],
    relations: [{ name: "item", entity: "item", parentShows: ["sku", "nameId"] }],
    parity: {
      kind: "pageCode",
      pageFile: "apps/web/app/actions/purchase-orders.ts",
      codes: [...PO_READ_CODES],
    },
  },
  {
    name: "work_order",
    model: "workOrder",
    descriptionId: "SPK / work order",
    descriptionEn: "Production work orders",
    gate: { kind: "anyOf", codes: [...WO_READ_CODES] },
    urlPath: (r) => `/backoffice/work-orders/${r.id}`,
    docNumberField: "docNumber",
    defaultSort: { field: "createdAt", dir: "desc" },
    fields: [
      f("id", "string"),
      f("docNumber", "string"),
      f("status", "enum"),
      f("plannedQty", "number"),
      f("actualQty", "number"),
      f("targetDate", "date"),
      f("finishedGoodId", "string"),
      f("vendorId", "string"),
      f("createdAt", "date"),
      f("updatedAt", "date"),
    ],
    relations: [
      { name: "vendor", entity: "supplier", parentShows: ["code", "name"] },
      { name: "finishedGood", entity: "item", parentShows: ["sku", "nameId"] },
      { name: "steps", entity: "work_order_step" },
    ],
    parity: {
      kind: "pageCode",
      pageFile: "apps/web/app/actions/production.ts",
      codes: [...WO_READ_CODES],
    },
  },
  {
    name: "sales_order",
    model: "salesOrder",
    descriptionId: "Pesanan marketplace",
    descriptionEn: "Marketplace sales orders",
    gate: { kind: "code", code: "sales_orders:view" },
    urlPath: (r) => `/backoffice/sales-orders/${r.id}`,
    docNumberField: "salesorderNo",
    defaultSort: { field: "createdAt", dir: "desc" },
    fields: [
      f("id", "string"),
      f("salesorderNo", "string"),
      f("status", "string"),
      f("fulfillmentStatus", "string"),
      f("channel", "enum"),
      f("grandTotal", "number"),
      f("createdAt", "date"),
      f("updatedAt", "date"),
    ],
    relations: [],
    parity: { kind: "route", path: "/backoffice/sales-orders" },
  },
  {
    name: "field_sales_order",
    model: "fieldSalesOrder",
    descriptionId: "Pesanan salesman (putus/konsi)",
    descriptionEn: "Field sales orders",
    gate: { kind: "code", code: "field_sales_orders:view" },
    urlPath: (r) => `/backoffice/field-sales-orders/${r.id}`,
    docNumberField: "orderNo",
    defaultSort: { field: "createdAt", dir: "desc" },
    fields: [
      f("id", "string"),
      f("orderNo", "string"),
      f("storeId", "string"),
      f("salesmanId", "string"),
      f("status", "enum"),
      f("deliveryStatus", "enum"),
      f("orderType", "enum"),
      f("origin", "enum"),
      f("subtotal", "number"),
      f("total", "number"),
      f("creditHoldAtCreate", "boolean"),
      f("kreditDitahan", "boolean"),
      f("approvedAt", "date"),
      f("createdAt", "date"),
      f("updatedAt", "date"),
    ],
    relations: [
      { name: "store", entity: "store", parentShows: ["code", "name"] },
      { name: "salesman", entity: "person", parentShows: ["name"] },
      { name: "lines", entity: "field_sales_order_line" },
    ],
    mask: {
      fields: ["subtotal", "total"],
      visibleWhere: FSO_MONEY_VISIBLE,
      // isVisible reads these; toPrismaSelect no longer loads the full allowlist.
      select: { orderType: true, status: true },
      isVisible: fsoShowsMoney,
    },
    parity: { kind: "route", path: "/backoffice/field-sales-orders" },
  },
  {
    name: "field_sales_order_line",
    model: "fieldSalesOrderLine",
    descriptionId: "Baris pesanan salesman",
    descriptionEn: "Field sales order lines",
    gate: { kind: "code", code: "field_sales_orders:view" },
    urlPath: (r) => `/backoffice/field-sales-orders/${r.orderId}`,
    defaultSort: { field: "id", dir: "asc" },
    fields: [
      f("id", "string"),
      f("orderId", "string"),
      f("itemId", "string"),
      f("variantSku", "string"),
      f("productName", "string"),
      f("qty", "number"),
      f("unitPrice", "number"),
      f("lineTotal", "number"),
    ],
    relations: [{ name: "item", entity: "item", parentShows: ["sku", "nameId"] }],
    mask: {
      fields: ["unitPrice", "lineTotal"],
      visibleWhere: { order: FSO_MONEY_VISIBLE },
      select: { order: { select: { orderType: true, status: true } } },
      isVisible: (r) => fsoShowsMoney(r.order as Record<string, unknown> | undefined),
    },
    parity: { kind: "route", path: "/backoffice/field-sales-orders" },
  },
  {
    name: "delivery_shipment",
    model: "deliveryShipment",
    descriptionId: "Surat jalan / pengiriman",
    descriptionEn: "Delivery shipments",
    gate: {
      kind: "anyOf",
      codes: ["deliveries:ship", "deliveries:pod", "deliveries:cancel_nota"],
    },
    urlPath: (r) => `/backoffice/deliveries/${r.id}`,
    docNumberField: "docNo",
    defaultSort: { field: "createdAt", dir: "desc" },
    fields: [
      f("id", "string"),
      f("docNo", "string"),
      f("orderId", "string"),
      f("method", "enum"),
      f("status", "enum"),
      f("carrierName", "string"),
      f("resiNumber", "string"),
      f("packedAt", "date"),
      f("shippedAt", "date"),
      f("deliveredAt", "date"),
      f("createdAt", "date"),
      // proof/signature/gps denied
    ],
    relations: [],
    parity: {
      kind: "pageCode",
      pageFile: "apps/web/app/backoffice/deliveries/page.tsx",
      codes: ["deliveries:ship", "deliveries:pod", "deliveries:cancel_nota"],
    },
  },
  {
    name: "receivable",
    model: "receivable",
    descriptionId: "Piutang / tagihan toko",
    descriptionEn: "Store receivables",
    gate: {
      kind: "izin",
      name: "bolehMembacaPiutang",
      check: (p) => bolehMembacaPiutang(p),
    },
    urlPath: (r) => `/backoffice/piutang?q=${encodeURIComponent(String(r.invoiceNo ?? r.id))}`,
    docNumberField: "invoiceNo",
    defaultSort: { field: "dueDate", dir: "asc" },
    fields: [
      f("id", "string"),
      f("invoiceNo", "string"),
      f("storeId", "string"),
      f("invoiceDate", "date"),
      f("dueDate", "date"),
      f("originalAmount", "number"),
      f("paidAmount", "number"),
      f("outstandingAmount", "number"),
      f("amount", "number"),
      f("outstanding", "number"),
      f("status", "enum"),
      f("source", "enum"),
      f("isConsignment", "boolean"),
      f("salesmanId", "string"),
      f("createdAt", "date"),
      f("updatedAt", "date"),
    ],
    relations: [
      { name: "store", entity: "store", parentShows: ["code", "name"] },
      { name: "salesman", entity: "person", parentShows: ["name"] },
    ],
    parity: {
      kind: "predicate",
      module: "@/lib/receivables/izin",
      exportName: "bolehMembacaPiutang",
    },
  },
  {
    name: "tax_invoice",
    model: "taxInvoice",
    descriptionId: "Faktur pajak",
    descriptionEn: "Tax invoices",
    gate: { kind: "code", code: "tax_invoices:view" },
    urlPath: (r) =>
      `/backoffice/finance/faktur-pajak?q=${encodeURIComponent(String(r.invoiceNo ?? r.id))}`,
    docNumberField: "invoiceNo",
    defaultSort: { field: "createdAt", dir: "desc" },
    fields: [
      f("id", "string"),
      f("deliveryId", "string"),
      f("sellThroughId", "string"),
      f("status", "enum"),
      f("invoiceNo", "string"),
      f("markedAt", "date"),
      f("taxableAmount", "number"),
      f("ppnAmount", "number"),
      f("createdAt", "date"),
      f("updatedAt", "date"),
      // buyerNpwp denied
    ],
    relations: [],
    parity: { kind: "route", path: "/backoffice/finance/faktur-pajak" },
  },
  {
    name: "consignment_cycle",
    model: "consignmentCycle",
    descriptionId: "Siklus konsinyasi",
    descriptionEn: "Consignment billing cycles",
    gate: {
      kind: "izin",
      name: "bolehMembukaKonsi",
      check: (p) => bolehMembukaKonsi(p),
    },
    urlPath: (r) => `/backoffice/konsinyasi/${r.id}`,
    docNumberField: "noKonsi",
    defaultSort: { field: "periodYear", dir: "desc" },
    fields: [
      f("id", "string"),
      f("noKonsi", "string"),
      f("storeId", "string"),
      f("periodYear", "number"),
      f("periodMonth", "number"),
      f("noNota", "string"),
      f("notaAt", "date"),
      f("noFakturPajak", "string"),
      f("fakturPajakAt", "date"),
      f("lockedAt", "date"),
      f("promoBorneByElorae", "number"),
      f("lossChargedToStore", "number"),
      f("createdAt", "date"),
      f("updatedAt", "date"),
    ],
    relations: [{ name: "store", entity: "store", parentShows: ["code", "name"] }],
    parity: {
      kind: "predicate",
      module: "@/lib/receivables/izin",
      exportName: "bolehMembukaKonsi",
    },
  },
  {
    name: "vendor_bill",
    model: "vendorBill",
    descriptionId: "Tagihan pemasok (Vendor Billing)",
    descriptionEn: "Vendor bills / supplier invoices",
    gate: { kind: "code", code: "vendor_bills:view" },
    urlPath: (r) => `/backoffice/vendor-bills/${r.id}`,
    docNumberField: "docNumber",
    defaultSort: { field: "createdAt", dir: "desc" },
    fields: [
      f("id", "string"),
      f("docNumber", "string"),
      f("supplierId", "string"),
      f("vendorInvoiceNo", "string"),
      f("status", "enum"),
      f("billDate", "date"),
      f("dueDate", "date"),
      f("total", "number"),
      f("paidAmount", "number"),
      f("createdAt", "date"),
      f("updatedAt", "date"),
    ],
    relations: [{ name: "supplier", entity: "supplier", parentShows: ["code", "name"] }],
    parity: { kind: "route", path: "/backoffice/vendor-bills" },
  },
  {
    name: "store_stocktake",
    model: "storeStocktake",
    descriptionId: "Opname stok toko",
    descriptionEn: "Store stocktakes",
    gate: { kind: "code", code: "stores:view" },
    urlPath: (r) => `/backoffice/store-stocktakes/${r.id}`,
    docNumberField: "docNo",
    defaultSort: { field: "createdAt", dir: "desc" },
    fields: [
      f("id", "string"),
      f("docNo", "string"),
      f("storeId", "string"),
      f("status", "enum"),
      f("countedAt", "date"),
      f("isFullCount", "boolean"),
      f("createdAt", "date"),
      f("approvedAt", "date"),
    ],
    relations: [{ name: "store", entity: "store" }],
    parity: {
      kind: "pageCode",
      pageFile: "apps/web/app/backoffice/store-stocktakes/page.tsx",
      codes: ["stores:view"],
    },
  },
  {
    name: "grn",
    model: "gRN",
    descriptionId: "Penerimaan barang (GRN)",
    descriptionEn: "Goods receipts",
    gate: { kind: "code", code: "inventory:view" },
    urlPath: (r) => `/backoffice/inventory?q=${encodeURIComponent(String(r.docNumber ?? r.id))}`,
    docNumberField: "docNumber",
    defaultSort: { field: "createdAt", dir: "desc" },
    fields: [
      f("id", "string"),
      f("docNumber", "string"),
      f("poId", "string"),
      f("supplierId", "string"),
      f("grnDate", "date"),
      f("totalAmount", "number"),
      f("createdAt", "date"),
    ],
    relations: [{ name: "supplier", entity: "supplier" }],
    parity: { kind: "route", path: "/backoffice/inventory" },
  },
  ...VIRA_ENTITIES_EXTRA,
];

const byName = new Map(VIRA_ENTITIES.map((e) => [e.name, e]));

export function getEntity(name: string): ViraEntityDef | undefined {
  return byName.get(name);
}

export function entitiesForActor(actor: ViraActor): ViraEntityDef[] {
  return VIRA_ENTITIES.filter((e) => gateAllows(e.gate, actor.permissions));
}

/** Allowed field names for an entity after denylist. */
export function allowedFieldNames(entity: ViraEntityDef): string[] {
  return filterAllowedFields(entity.fields).map((f) => f.name);
}

export function findRelation(entity: ViraEntityDef, name: string): ViraEntityRelation | undefined {
  return entity.relations.find((r) => r.name === name && !isDeniedField(r.name));
}
