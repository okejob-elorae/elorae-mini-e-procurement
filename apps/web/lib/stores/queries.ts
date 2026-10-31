import { prisma, Prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { isValidMarkupPercent, MARKUP_PERCENT_MAX } from "@elorae/db/pricing";
import { cariTeks } from "@/lib/db/cari-teks";
import { gantiPemegangToko } from "@/lib/stores/penanggung-jawab-writer";
import {
  bacaAturanKelasToko,
  bacaKelas,
  DAFTAR_KELAS,
  KUNCI_KELAS_TOKO,
  perubahanUsulan,
  usulanPerJenis,
  type AturanKelasToko,
  type KelasToko,
  type SatuanNilaiKelas,
} from "@/lib/stores/kelas-toko";

export type StoreFields = {
  code: string;
  name: string;
  address: string;
  phone: string | null;
  contactName: string | null;
  termsType: "PUTUS" | "KONSI";
  paymentTempo: number;
  markupPercent: number | null;
  priceDiscountPercent: number | null;
  /**
   * Batas kredit toko PUTUS: sisa piutang maksimal (Rp). Kosong = ikut batas bawaan di
   * Pengaturan → Salesman; 0 adalah nilai sah ("tidak boleh ada"). Milik admin, bukan sales.
   * Opsional di masukan: pemanggil yang tidak mengirimnya (`undefined`) tidak mengubah nilai
   * yang tersimpan — formulir lama tidak menghapus batas diam-diam.
   */
  creditLimit?: number | null;
  npwp: string | null;
  lat: number | null;
  lng: number | null;
  checkinRadiusMeters: number | null;
  sellThroughMethod: "SPG_POS" | "SHELF_COUNT" | null;
  /**
   * Toko pengusaha kena pajak.
   *
   * Menentukan boleh-tidaknya potongan berjenis `pkpOnly` (PPh 23). Milik
   * admin, BUKAN sales — sama seperti termsType dan markupPercent, karena
   * mengubahnya mengubah berapa yang boleh dipotong dari tagihan.
   */
  isPkp: boolean;
  /**
   * Tagihan konsinyasi toko ini memakai PPN (hanya bermakna untuk toko KONSI).
   * Bawaan mati: tanpa PPN. Dibekukan ke siklus saat angkanya dikunci. Milik
   * admin; opsional seperti batas kredit — `undefined` tidak mengubah yang tersimpan.
   */
  consignmentVat?: boolean;
  /** Area (StoreGroup) — JGU, JTT, … Milik admin. */
  groupId: string | null;
  /**
   * Sales yang memegang toko ini SEKARANG. Milik admin; dirotasi dari
   * formulir toko atau massal dari daftar toko, dan setiap perubahan tercatat
   * di jejak audit. Bukan penjual faktur — itu tetap di faktur/pesanannya.
   */
  salesmanId: string | null;
  /** Jumlah faktur belum lunas maksimal — aturan opsional yang sama dengan `creditLimit`. */
  maxOpenInvoices?: number | null;
  /**
   * Kelas toko A/B/C — menentukan jarak kunjungan sales (diatur per kelas di
   * Pengaturan → Salesman). null = tanpa kelas, ikut batas hari umum. Milik
   * admin. Opsional seperti batas kredit: `undefined` tidak mengubah yang tersimpan.
   */
  storeClass?: KelasToko | null;
};

export type StoreListItem = StoreFields & {
  consignmentVat: boolean;
  creditLimit: number | null;
  maxOpenInvoices: number | null;
  storeClass: KelasToko | null;
  id: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function toDecimalOrNull(v: number | null): Prisma.Decimal | null {
  return v === null ? null : new Prisma.Decimal(v);
}

/**
 * Thrown by updateStore when a KONSI → PUTUS edit would strand consignment stock, now or later:
 *
 * - the store still holds a non-zero StoreStock row, so its goods are physically sitting on the
 *   store's floor with no correction path once the store stops being read as KONSI (the stock
 *   card, and the konsi retur decrement, are both gated on termsType === "KONSI");
 * - or it has a konsi order still awaiting approval, or approved with qty neither delivered nor
 *   closed. Konsi stock reaches StoreStock only when a delivery shipment completes, so that qty
 *   is on no store balance yet — but completing it after the switch would land it on a PUTUS
 *   store's StoreStock, where nothing can ever correct it.
 *
 * The store must return or transfer its stock, and settle those orders, first.
 */
export class StoreHasConsignmentStockError extends Error {
  constructor(readonly storeId: string) {
    super(`Store ${storeId} still holds consignment stock or undelivered konsi orders and cannot switch off KONSI`);
    this.name = "StoreHasConsignmentStockError";
  }
}

/**
 * Thrown when `priceDiscountPercent` is outside `0 <= percent < 100`. `computeStorePrice`
 * silently falls back to the unadjusted price (`flagged: true`) for an out-of-range value, and
 * nothing downstream reads `flagged` — so a bad stored value would charge full list price with
 * no complaint anywhere. This writer boundary is the only place that actually catches it.
 */
export class InvalidPriceDiscountPercentError extends Error {
  constructor(readonly percent: number) {
    super(`priceDiscountPercent must satisfy 0 <= percent < 100, got ${percent}`);
    this.name = "InvalidPriceDiscountPercentError";
  }
}

/**
 * Thrown when a non-null `priceDiscountPercent` is set on a KONSI store. KONSI pricing runs on
 * `markupPercent` only, and a discount must never apply there. The SPG writer prices a KONSI store
 * at its markup, but the van writer still prices every sale on the PUTUS path, discount included,
 * even at a consignment store — so a KONSI store holding a discount would silently discount its
 * van sales.
 */
export class KonsiPriceDiscountNotAllowedError extends Error {
  constructor() {
    super("A KONSI store cannot carry a priceDiscountPercent");
    this.name = "KonsiPriceDiscountNotAllowedError";
  }
}

/**
 * Rounds a percent to the two decimals its Decimal(5,2) column holds. `createStore`/`updateStore`
 * validate AND persist this value, never the raw input, so a guard cannot pass a figure the column
 * then stores differently: 99.999 passes a raw `< 100` check but lands as 100.00, and a raw -0.005
 * lands as -0.01 because MariaDB rounds half away from zero, while `Math.round` takes it to 0 —
 * either stored figure is one `computeStorePrice` flags. `Math.round` yields -0 there, which is
 * normalised to 0.
 */
function toPercentColumnScale(percent: number | null): number | null {
  if (percent === null) return null;
  const rounded = Math.round(percent * 100) / 100;
  return rounded === 0 ? 0 : rounded;
}

function atColumnScale(input: StoreFields): StoreFields {
  return {
    ...input,
    markupPercent: toPercentColumnScale(input.markupPercent),
    priceDiscountPercent: toPercentColumnScale(input.priceDiscountPercent),
  };
}

/* Takes the fields `atColumnScale` returns, so the range check runs on the figure the column stores. */
function assertValidPriceDiscount(input: Pick<StoreFields, "termsType" | "priceDiscountPercent">): void {
  if (input.priceDiscountPercent === null) return;
  if (input.priceDiscountPercent < 0 || input.priceDiscountPercent >= 100) {
    throw new InvalidPriceDiscountPercentError(input.priceDiscountPercent);
  }
  if (input.termsType === "KONSI") {
    throw new KonsiPriceDiscountNotAllowedError();
  }
}

/**
 * Thrown when `markupPercent` is outside `0 <= percent <= MARKUP_PERCENT_MAX`. The column cannot
 * hold more, and `computeStorePrice` flags anything outside the range, which the SPG writer then
 * refuses as `NO_PRICE` — so an out-of-range value is refused here, where the operator can fix it,
 * rather than at the POS.
 */
export class InvalidMarkupPercentError extends Error {
  constructor(readonly percent: number) {
    super(`markupPercent must satisfy 0 <= percent <= ${MARKUP_PERCENT_MAX}, got ${percent}`);
    this.name = "InvalidMarkupPercentError";
  }
}

/* Takes the fields `atColumnScale` returns, like `assertValidPriceDiscount`. */
function assertValidMarkupPercent(input: Pick<StoreFields, "markupPercent">): void {
  if (input.markupPercent === null) return;
  if (!isValidMarkupPercent(input.markupPercent)) {
    throw new InvalidMarkupPercentError(input.markupPercent);
  }
}

/**
 * Thrown when a KONSI → PUTUS switch meets a DRAFT konsi sell-through report. The report can only
 * be approved while the store is KONSI (`approveSellThrough` re-checks the terms), so switching
 * first would strand it — approve or cancel it before switching off Konsi.
 */
export class StoreHasDraftSellThroughError extends Error {
  constructor(readonly storeId: string) {
    super(`Store ${storeId} has a draft konsi sell-through report and cannot switch off KONSI`);
    this.name = "StoreHasDraftSellThroughError";
  }
}

/**
 * Thrown when a non-null `sellThroughMethod` is carried by a non-KONSI store — the field
 * configures how a KONSI store's own sell-through report measures units sold, and a PUTUS store
 * has no such report to configure. Also fires on a KONSI → PUTUS switch that still carries a
 * method: the switch must clear the field explicitly in the same call, never dropped silently,
 * mirroring how `assertValidPriceDiscount` refuses a discount on the opposite terms type.
 */
export class SellThroughMethodRequiresKonsiError extends Error {
  constructor() {
    super("sellThroughMethod can only be set on a KONSI store");
    this.name = "SellThroughMethodRequiresKonsiError";
  }
}

function assertValidSellThroughMethod(input: Pick<StoreFields, "termsType" | "sellThroughMethod">): void {
  if (input.sellThroughMethod === null) return;
  if (input.termsType !== "KONSI") {
    throw new SellThroughMethodRequiresKonsiError();
  }
}

function serializeStore(s: {
  id: string;
  code: string;
  name: string;
  address: string;
  phone: string | null;
  contactName: string | null;
  termsType: "PUTUS" | "KONSI";
  paymentTempo: number;
  markupPercent: Prisma.Decimal | null;
  priceDiscountPercent: Prisma.Decimal | null;
  creditLimit: Prisma.Decimal | null;
  npwp: string | null;
  lat: Prisma.Decimal | null;
  lng: Prisma.Decimal | null;
  checkinRadiusMeters: number | null;
  sellThroughMethod: "SPG_POS" | "SHELF_COUNT" | null;
  isPkp: boolean;
  consignmentVat: boolean;
  groupId: string | null;
  salesmanId: string | null;
  maxOpenInvoices: number | null;
  storeClass: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}): StoreListItem {
  return {
    id: s.id,
    code: s.code,
    name: s.name,
    address: s.address,
    phone: s.phone,
    contactName: s.contactName,
    termsType: s.termsType,
    paymentTempo: s.paymentTempo,
    markupPercent: s.markupPercent ? s.markupPercent.toNumber() : null,
    priceDiscountPercent: s.priceDiscountPercent ? s.priceDiscountPercent.toNumber() : null,
    creditLimit: s.creditLimit !== null ? s.creditLimit.toNumber() : null,
    npwp: s.npwp,
    lat: s.lat ? s.lat.toNumber() : null,
    lng: s.lng ? s.lng.toNumber() : null,
    checkinRadiusMeters: s.checkinRadiusMeters,
    sellThroughMethod: s.sellThroughMethod,
    isPkp: s.isPkp,
    consignmentVat: s.consignmentVat,
    groupId: s.groupId,
    salesmanId: s.salesmanId,
    maxOpenInvoices: s.maxOpenInvoices,
    storeClass: bacaKelas(s.storeClass),
    isActive: s.isActive,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

export const STORE_LOCATION_FILTERS = ["missing", "defaultRadius", "customRadius"] as const;
export type StoreLocationFilter = (typeof STORE_LOCATION_FILTERS)[number];

export function parseStoreLocationFilter(raw: string | undefined): StoreLocationFilter | undefined {
  return STORE_LOCATION_FILTERS.find((v) => v === raw);
}

/*
 * undefined is the only spelling of "no filter". The three buckets partition the stores: a store
 * with no coordinates has no radius gate at all, so it is "missing" whatever its override says.
 */
export function buildStoreLocationWhere(
  location: StoreLocationFilter | undefined,
): Prisma.StoreWhereInput | undefined {
  switch (location) {
    case "missing":
      return { OR: [{ lat: null }, { lng: null }] };
    case "defaultRadius":
      return { lat: { not: null }, lng: { not: null }, checkinRadiusMeters: null };
    case "customRadius":
      return { lat: { not: null }, lng: { not: null }, checkinRadiusMeters: { not: null } };
    default:
      return undefined;
  }
}

export const STORE_NPWP_FILTERS = ["missing", "present"] as const;
export type StoreNpwpFilter = (typeof STORE_NPWP_FILTERS)[number];

export function parseStoreNpwpFilter(raw: string | undefined): StoreNpwpFilter | undefined {
  return STORE_NPWP_FILTERS.find((v) => v === raw);
}

/**
 * The one definition of "this store has no NPWP" — the store list's `missing` filter, its `present`
 * filter (the exact complement) and its "No NPWP" badge (`StoreListRow.npwpMissing`, read back from
 * the database rather than re-derived in JS) all go through it, so the three cannot disagree.
 *
 * A store with no NPWP is stored as either null or an empty string, so both spellings count.
 * `Store` is `utf8mb4_unicode_ci`, a PAD SPACE collation, so `npwp = ''` also matches a value of
 * spaces only. A hand-written JS check (`trim()`, a regex) would have to restate the collation's
 * idea of blank — `trim()` also strips tabs and newlines — which is exactly how the badge and the
 * filter drifted apart once; that is why the badge asks the database instead.
 */
const NPWP_MISSING_WHERE: Prisma.StoreWhereInput = { OR: [{ npwp: null }, { npwp: "" }] };

/** undefined is the only spelling of "no filter"; `missing` and `present` partition every store. */
export function buildStoreNpwpWhere(
  npwp: StoreNpwpFilter | undefined,
): Prisma.StoreWhereInput | undefined {
  switch (npwp) {
    case "missing":
      return NPWP_MISSING_WHERE;
    case "present":
      return { NOT: NPWP_MISSING_WHERE };
    default:
      return undefined;
  }
}

/**
 * What the store writers persist: trimmed, and `null` when nothing is left, so no new
 * whitespace-only NPWP is ever saved. Rows written before this normalisation are not rewritten.
 */
function normalizeStoreNpwp(npwp: string | null): string | null {
  if (npwp === null) return null;
  const trimmed = npwp.trim();
  return trimmed === "" ? null : trimmed;
}

export type StoreListRow = StoreListItem & { npwpMissing: boolean };

/** Aksi jejak saat batas kredit toko diubah dari formulir toko. */
export const AKSI_BATAS_KREDIT_TOKO = "STORE_CREDIT_LIMIT_CHANGED";
/** Aksi jejak saat kelas toko diubah — dari formulir toko atau dari usulan otomatis. */
export const AKSI_KELAS_TOKO = "STORE_CLASS_CHANGED";
/** Aksi jejak saat sakelar PPN tagihan konsinyasi toko diubah dari formulir toko. */
export const AKSI_PPN_KONSI_TOKO = "STORE_CONSIGNMENT_VAT_CHANGED";

export async function listStores(
  opts: {
    activeOnly?: boolean;
    search?: string;
    location?: StoreLocationFilter;
    npwp?: StoreNpwpFilter;
    /** Area (StoreGroup id). */
    groupId?: string;
    /** Pemegang sekarang; "TANPA" = toko yang belum punya pemegang. */
    salesmanId?: string | "TANPA";
    /** Kelas toko; "TANPA" = toko yang belum diberi kelas. */
    storeClass?: KelasToko | "TANPA";
  } = {},
  paging?: { page: number; pageSize: number },
): Promise<{ items: StoreListRow[]; totalCount: number }> {
  const where: Prisma.StoreWhereInput = {};
  if (opts.activeOnly) where.isActive = true;
  if (opts.groupId) where.groupId = opts.groupId;
  if (opts.salesmanId) where.salesmanId = opts.salesmanId === "TANPA" ? null : opts.salesmanId;
  if (opts.storeClass) where.storeClass = opts.storeClass === "TANPA" ? null : opts.storeClass;
  if (opts.search && opts.search.trim()) {
    where.OR = [
      { name: cariTeks(opts.search.trim()) },
      { code: cariTeks(opts.search.trim()) },
    ];
  }
  const filters = [buildStoreLocationWhere(opts.location), buildStoreNpwpWhere(opts.npwp)].filter(
    (f): f is Prisma.StoreWhereInput => f !== undefined,
  );
  if (filters.length > 0) where.AND = filters;
  const [rows, totalCount] = await Promise.all([
    prisma.store.findMany({
      where,
      orderBy: { name: "asc" },
      ...(paging ? { skip: (paging.page - 1) * paging.pageSize, take: paging.pageSize } : {}),
    }),
    prisma.store.count({ where }),
  ]);
  const missing =
    rows.length === 0
      ? []
      : await prisma.store.findMany({
          where: { AND: [{ id: { in: rows.map((r) => r.id) } }, NPWP_MISSING_WHERE] },
          select: { id: true },
        });
  const missingIds = new Set(missing.map((r) => r.id));
  return {
    items: rows.map((r) => ({ ...serializeStore(r), npwpMissing: missingIds.has(r.id) })),
    totalCount,
  };
}

// Lightweight {id,name} list for filter dropdowns — all stores (incl. inactive,
// since orders can reference a since-deactivated store), ordered by name.
export async function listStoreOptions(): Promise<{ id: string; name: string }[]> {
  return prisma.store.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
}

/* Same shape as `listStoreOptions`, active stores only — for pickers that raise NEW documents. */
export async function listActiveStoreOptions(): Promise<{ id: string; name: string }[]> {
  return prisma.store.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } });
}

/**
 * Toko aktif untuk HP. `hanyaMilik` = saat kunci "hanya toko sendiri" menyala,
 * sempitkan ke toko yang dipegang sales itu.
 */
export async function listActiveStoresForPwa(opsi?: { hanyaMilik?: string }) {
  const rows = await prisma.store.findMany({
    where: { isActive: true, ...(opsi?.hanyaMilik ? { salesmanId: opsi.hanyaMilik } : {}) },
    orderBy: { name: "asc" },
  });
  return rows.map(serializeStore);
}

export async function getStore(id: string) {
  const s = await prisma.store.findUnique({ where: { id } });
  return s ? serializeStore(s) : null;
}

export async function createStore(rawInput: StoreFields): Promise<StoreListItem> {
  const input = atColumnScale(rawInput);
  assertValidMarkupPercent(input);
  assertValidPriceDiscount(input);
  assertValidSellThroughMethod(input);
  const created = await prisma.store.create({
    data: {
      code: input.code,
      name: input.name,
      address: input.address,
      phone: input.phone,
      contactName: input.contactName,
      termsType: input.termsType,
      paymentTempo: input.paymentTempo,
      markupPercent: toDecimalOrNull(input.markupPercent),
      priceDiscountPercent: toDecimalOrNull(input.priceDiscountPercent),
      creditLimit: toDecimalOrNull(input.creditLimit ?? null),
      npwp: normalizeStoreNpwp(input.npwp),
      lat: toDecimalOrNull(input.lat),
      lng: toDecimalOrNull(input.lng),
      checkinRadiusMeters: input.checkinRadiusMeters,
      sellThroughMethod: input.sellThroughMethod,
      isPkp: input.isPkp,
      consignmentVat: input.consignmentVat ?? false,
      groupId: input.groupId,
      salesmanId: input.salesmanId,
      maxOpenInvoices: input.maxOpenInvoices ?? null,
      storeClass: input.storeClass ?? null,
    },
  });
  return serializeStore(created);
}

/**
 * Simpan formulir toko. Perubahan pemegang, batas kredit, kelas, dan PPN konsinyasi ditulis ke
 * jejak audit di transaksi yang sama — kolomnya hanya menyimpan nilai terakhir.
 */
export async function updateStore(id: string, rawInput: StoreFields, olehUserId: string): Promise<StoreListItem> {
  const input = atColumnScale(rawInput);
  assertValidMarkupPercent(input);
  assertValidPriceDiscount(input);
  assertValidSellThroughMethod(input);

  return runSerializable(async (tx) => {
    if (input.termsType === "PUTUS") {
      const current = await tx.store.findUnique({ where: { id }, select: { termsType: true } });
      if (current?.termsType === "KONSI") {
        const draftSellThrough = await tx.konsiSellThrough.findFirst({
          where: { storeId: id, status: "DRAFT" },
          select: { id: true },
        });
        if (draftSellThrough) throw new StoreHasDraftSellThroughError(id);

        const strandedStock = await tx.storeStock.findFirst({
          where: { storeId: id, qty: { not: 0 } },
          select: { id: true },
        });
        if (strandedStock) throw new StoreHasConsignmentStockError(id);

        const pendingKonsi = await tx.fieldSalesOrder.findFirst({
          where: { storeId: id, orderType: "KONSI", status: "PENDING_APPROVAL" },
          select: { id: true },
        });
        if (pendingKonsi) throw new StoreHasConsignmentStockError(id);

        /* Prisma cannot compare columns, so the open remainder is summed in JS. */
        const approvedKonsiLines = await tx.fieldSalesOrderLine.findMany({
          where: { order: { storeId: id, orderType: "KONSI", status: "APPROVED" } },
          select: { qty: true, deliveredQty: true, cancelledQty: true },
        });
        const openKonsiQty = approvedKonsiLines.reduce(
          (sum, l) => sum + Math.max(l.qty - l.deliveredQty - l.cancelledQty, 0),
          0,
        );
        if (openKonsiQty > 0) throw new StoreHasConsignmentStockError(id);
      }
    }

    const sebelum = await tx.store.findUnique({
      where: { id },
      select: { salesmanId: true, creditLimit: true, maxOpenInvoices: true, storeClass: true, consignmentVat: true },
    });
    const updated = await tx.store.update({
      where: { id },
      data: {
        code: input.code,
        name: input.name,
        address: input.address,
        phone: input.phone,
        contactName: input.contactName,
        termsType: input.termsType,
        paymentTempo: input.paymentTempo,
        markupPercent: toDecimalOrNull(input.markupPercent),
        priceDiscountPercent: toDecimalOrNull(input.priceDiscountPercent),
        npwp: normalizeStoreNpwp(input.npwp),
        lat: toDecimalOrNull(input.lat),
        lng: toDecimalOrNull(input.lng),
        checkinRadiusMeters: input.checkinRadiusMeters,
        sellThroughMethod: input.sellThroughMethod,
        isPkp: input.isPkp,
        groupId: input.groupId,
        salesmanId: input.salesmanId,
        ...(input.creditLimit !== undefined ? { creditLimit: toDecimalOrNull(input.creditLimit) } : {}),
        ...(input.maxOpenInvoices !== undefined ? { maxOpenInvoices: input.maxOpenInvoices } : {}),
        ...(input.storeClass !== undefined ? { storeClass: input.storeClass } : {}),
        ...(input.consignmentVat !== undefined ? { consignmentVat: input.consignmentVat } : {}),
      },
    });
    const kreditSebelum = {
      creditLimit: sebelum?.creditLimit ? sebelum.creditLimit.toNumber() : null,
      maxOpenInvoices: sebelum?.maxOpenInvoices ?? null,
    };
    const kreditSesudah = {
      creditLimit: updated.creditLimit ? updated.creditLimit.toNumber() : null,
      maxOpenInvoices: updated.maxOpenInvoices,
    };
    // Batas kredit menentukan pesanan mana yang ditahan atau ditolak — siapa
    // mengubahnya, kapan, dan dari berapa hanya hidup di jejak ini.
    if (
      sebelum &&
      (kreditSebelum.creditLimit !== kreditSesudah.creditLimit ||
        kreditSebelum.maxOpenInvoices !== kreditSesudah.maxOpenInvoices)
    ) {
      await tx.auditLog.create({
        data: {
          userId: olehUserId,
          action: AKSI_BATAS_KREDIT_TOKO,
          entityType: "Store",
          entityId: id,
          changes: { before: kreditSebelum, after: kreditSesudah },
        },
      });
    }
    // Kelas menentukan seberapa sering toko didatangi — jejaknya sama dengan batas kredit.
    const kelasSebelum = bacaKelas(sebelum?.storeClass);
    const kelasSesudah = bacaKelas(updated.storeClass);
    if (sebelum && kelasSebelum !== kelasSesudah) {
      await tx.auditLog.create({
        data: {
          userId: olehUserId,
          action: AKSI_KELAS_TOKO,
          entityType: "Store",
          entityId: id,
          changes: { before: { storeClass: kelasSebelum }, after: { storeClass: kelasSesudah } },
          metadata: { sumber: "FORMULIR" },
        },
      });
    }
    // PPN tagihan konsinyasi menentukan pendapatan dan faktur pajak siklus yang dikunci sesudahnya.
    if (sebelum && sebelum.consignmentVat !== updated.consignmentVat) {
      await tx.auditLog.create({
        data: {
          userId: olehUserId,
          action: AKSI_PPN_KONSI_TOKO,
          entityType: "Store",
          entityId: id,
          changes: { before: { consignmentVat: sebelum.consignmentVat }, after: { consignmentVat: updated.consignmentVat } },
        },
      });
    }
    await gantiPemegangToko(tx, {
      storeId: id,
      sebelum: sebelum?.salesmanId ?? null,
      sesudah: input.salesmanId,
      olehUserId,
    });
    return serializeStore(updated);
  });
}

export async function deactivateStore(id: string): Promise<void> {
  await prisma.store.update({ where: { id }, data: { isActive: false } });
}

export async function getActiveVisit(userId: string) {
  const v = await prisma.storeVisit.findFirst({
    where: { userId, checkoutAt: null },
    include: { store: { select: { name: true, termsType: true } } },
    orderBy: { checkinAt: "desc" },
  });
  if (!v) return null;
  return {
    id: v.id,
    storeId: v.storeId,
    store: v.store,
    checkinAt: v.checkinAt,
    checkinOutOfRadius: v.checkinOutOfRadius,
    checkinDistanceMeters: v.checkinDistanceMeters,
  };
}

type VisitRow = Prisma.StoreVisitGetPayload<{ include: { user: { select: { name: true; email: true } } } }>;

function mapVisitRow(r: VisitRow) {
  return {
    id: r.id,
    checkinAt: r.checkinAt,
    checkoutAt: r.checkoutAt,
    checkinLat: r.checkinLat.toNumber(),
    checkinLng: r.checkinLng.toNumber(),
    checkoutLat: r.checkoutLat ? r.checkoutLat.toNumber() : null,
    checkoutLng: r.checkoutLng ? r.checkoutLng.toNumber() : null,
    autoClosed: r.autoClosed,
    checkinOutOfRadius: r.checkinOutOfRadius,
    checkinDistanceMeters: r.checkinDistanceMeters,
    user: r.user,
  };
}

/** The latest `limit` visits only. A caller that needs a page plus the total uses `listVisitsForStorePage`. */
export async function listVisitsForStore(storeId: string, limit: number) {
  const rows = await prisma.storeVisit.findMany({
    where: { storeId },
    include: { user: { select: { name: true, email: true } } },
    orderBy: { checkinAt: "desc" },
    take: limit,
  });
  return rows.map(mapVisitRow);
}

/**
 * One page of a store's visits, newest first. `total` and `latestCheckinAt` cover EVERY visit of
 * the store, not just the page, so the detail screen's stats stay right on page 2. An out-of-range
 * `page` is clamped to the last one and the page actually served is returned.
 */
export async function listVisitsForStorePage(storeId: string, paging: { page: number; pageSize: number }) {
  const agg = await prisma.storeVisit.aggregate({ where: { storeId }, _count: { _all: true }, _max: { checkinAt: true } });
  const total = agg._count._all;
  const lastPage = Math.max(1, Math.ceil(total / paging.pageSize));
  const page = Math.min(Math.max(1, paging.page), lastPage);
  const rows = await prisma.storeVisit.findMany({
    where: { storeId },
    include: { user: { select: { name: true, email: true } } },
    orderBy: [{ checkinAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * paging.pageSize,
    take: paging.pageSize,
  });
  return { rows: rows.map(mapVisitRow), total, page, latestCheckinAt: agg._max.checkinAt };
}

export async function listRecentVisitsForUser(userId: string, limit: number) {
  const rows = await prisma.storeVisit.findMany({
    where: { userId },
    include: { store: { select: { name: true } } },
    orderBy: { checkinAt: "desc" },
    take: limit,
  });
  return rows.map(r => ({
    id: r.id,
    storeId: r.storeId,
    store: r.store,
  }));
}

export async function listVisitPhotos(visitId: string) {
  return prisma.visitPhoto.findMany({
    where: { visitId },
    orderBy: { capturedAt: "asc" },
    select: { id: true, url: true, caption: true, capturedAt: true },
  });
}

export async function listVisitPhotosForVisits(visitIds: string[]) {
  const map = new Map<string, Array<{ id: string; url: string; caption: string | null; capturedAt: Date }>>();
  if (visitIds.length === 0) return map;
  const rows = await prisma.visitPhoto.findMany({
    where: { visitId: { in: visitIds } },
    orderBy: { capturedAt: "asc" },
    select: { id: true, visitId: true, url: true, caption: true, capturedAt: true },
  });
  for (const r of rows) {
    const list = map.get(r.visitId) ?? [];
    list.push({ id: r.id, url: r.url, caption: r.caption, capturedAt: r.capturedAt });
    map.set(r.visitId, list);
  }
  return map;
}

// ─── Kelas toko ──────────────────────────────────────────────────────────────

/** Rentang nilai beli yang dipakai mengusulkan kelas toko. */
export const HARI_NILAI_KELAS = 180;

/** Aturan kelas toko dari `SystemSetting` (nilai rusak → bawaan per kolom). */
export async function aturanKelasToko(): Promise<AturanKelasToko> {
  const baris = await prisma.systemSetting.findUnique({ where: { key: KUNCI_KELAS_TOKO }, select: { value: true } });
  return bacaAturanKelasToko(baris?.value);
}

export type BarisKelasToko = {
  storeId: string;
  code: string;
  name: string;
  termsType: "PUTUS" | "KONSI";
  areaKode: string | null;
  kelas: KelasToko | null;
  /** Nilai beli 180 hari: rupiah untuk toko putus, potong untuk toko konsinyasi. */
  nilai: number;
  satuan: SatuanNilaiKelas;
  /** null = belum ada pembelian dalam 180 hari — tidak diberi usulan. */
  usulan: KelasToko | null;
};

/**
 * Setiap toko aktif dengan nilai belinya 180 hari terakhir dan usulan kelasnya.
 *
 * Nilai beli:
 * - Toko PUTUS = rupiah seluruh nota pengiriman dalam 180 hari (menurut tanggal
 *   kirim). Yang dihitung barang yang benar-benar diterima toko, bukan yang
 *   dipesan: pesanan yang sisanya ditutup hanya terhitung bagian terkirimnya.
 * - Toko KONSI = jumlah POTONG di pesanan konsinyasi yang disetujui dalam 180
 *   hari (menurut tanggal disetujui). Konsinyasi tidak punya harga beli —
 *   barangnya titipan, dibayar sesudah laku — jadi rupiah pesanannya tidak
 *   sebanding dengan toko putus. Karena itu kedua jenis diperingkat terpisah
 *   (`usulanPerJenis`), dan layar menyebut satuannya.
 * Penjualan van ke toko tidak ikut: definisi pemilik adalah kiriman putus dan
 * konsinyasi. Toko tanpa pembelian tetap tanpa usulan.
 */
export async function daftarKelasToko(aturan: AturanKelasToko, hariIni: Date = new Date()): Promise<BarisKelasToko[]> {
  const sejak = new Date(hariIni.getTime() - HARI_NILAI_KELAS * 86_400_000);
  const [toko, kirim, konsi] = await Promise.all([
    prisma.store.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true, termsType: true, storeClass: true, group: { select: { code: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.fieldSalesDelivery.findMany({
      where: { deliveredAt: { gte: sejak }, order: { orderType: "PUTUS", status: "APPROVED" } },
      select: { total: true, order: { select: { storeId: true } } },
    }),
    prisma.fieldSalesOrder.findMany({
      where: { orderType: "KONSI", status: "APPROVED", approvedAt: { gte: sejak } },
      select: { storeId: true, lines: { select: { qty: true } } },
    }),
  ]);

  const rupiah = new Map<string, number>();
  for (const d of kirim) rupiah.set(d.order.storeId, (rupiah.get(d.order.storeId) ?? 0) + Number(d.total));
  const potong = new Map<string, number>();
  for (const o of konsi) {
    const n = o.lines.reduce((j, l) => j + l.qty, 0);
    potong.set(o.storeId, (potong.get(o.storeId) ?? 0) + n);
  }

  const usulan = usulanPerJenis(
    toko.map((t) => ({
      storeId: t.id,
      termsType: t.termsType,
      rupiah: rupiah.get(t.id) ?? 0,
      potong: potong.get(t.id) ?? 0,
    })),
    aturan.otomatis,
  );
  return toko.map((t) => ({
    storeId: t.id,
    code: t.code,
    name: t.name,
    termsType: t.termsType,
    areaKode: t.group?.code ?? null,
    kelas: bacaKelas(t.storeClass),
    nilai: usulan[t.id].nilai,
    satuan: usulan[t.id].satuan,
    usulan: usulan[t.id].usulan,
  }));
}

/** Jumlah toko aktif per kelas, untuk ringkasan di Pengaturan → Salesman. */
export async function jumlahTokoPerKelas(): Promise<Record<KelasToko | "TANPA", number>> {
  const rows = await prisma.store.groupBy({ by: ["storeClass"], where: { isActive: true }, _count: { _all: true } });
  const hasil: Record<KelasToko | "TANPA", number> = { A: 0, B: 0, C: 0, TANPA: 0 };
  for (const r of rows) hasil[bacaKelas(r.storeClass) ?? "TANPA"] += r._count._all;
  return hasil;
}

/**
 * "Terapkan usulan" di halaman Kelas toko: ubah kelas toko terpilih menjadi
 * usulannya. Usulan DIHITUNG ULANG di sini — kelas kiriman layar tidak
 * dipercaya — dan kelas sekarang dibaca di dalam transaksi, supaya jejak
 * mencatat nilai "sebelum" yang benar. Setiap toko yang berubah mendapat satu
 * baris jejak `STORE_CLASS_CHANGED` beserta nilai beli yang mendasarinya.
 */
export async function terapkanUsulanKelas(
  storeIds: readonly string[],
  olehUserId: string,
  hariIni: Date = new Date(),
): Promise<{ diubah: number }> {
  const daftar = await daftarKelasToko(await aturanKelasToko(), hariIni);
  const dasar = new Map(daftar.map((b) => [b.storeId, b]));
  const ids = [...new Set(storeIds)].filter((id) => dasar.has(id));
  if (ids.length === 0) return { diubah: 0 };

  return prisma.$transaction(async (tx) => {
    const sekarang = await tx.store.findMany({ where: { id: { in: ids } }, select: { id: true, storeClass: true } });
    const ubah = perubahanUsulan(
      sekarang.map((t) => ({ storeId: t.id, kelas: bacaKelas(t.storeClass), usulan: dasar.get(t.id)?.usulan ?? null })),
      ids,
    );
    if (ubah.length === 0) return { diubah: 0 };
    // Satu pembaruan per kelas tujuan, bukan per toko — ratusan toko tetap
    // selesai jauh di bawah batas waktu transaksi.
    for (const k of DAFTAR_KELAS) {
      const ke = ubah.filter((u) => u.ke === k).map((u) => u.storeId);
      if (ke.length) await tx.store.updateMany({ where: { id: { in: ke } }, data: { storeClass: k } });
    }
    await tx.auditLog.createMany({
      data: ubah.map((u) => {
        const b = dasar.get(u.storeId);
        return {
          userId: olehUserId,
          action: AKSI_KELAS_TOKO,
          entityType: "Store",
          entityId: u.storeId,
          changes: { before: { storeClass: u.dari }, after: { storeClass: u.ke } },
          metadata: { sumber: "USULAN_OTOMATIS", hari: HARI_NILAI_KELAS, nilai: b?.nilai ?? 0, satuan: b?.satuan ?? null },
        };
      }),
    });
    return { diubah: ubah.length };
  });
}
