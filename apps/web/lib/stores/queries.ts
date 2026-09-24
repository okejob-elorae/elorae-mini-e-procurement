import { prisma, Prisma } from "@elorae/db";

export type StoreFields = {
  code: string;
  name: string;
  address: string;
  phone: string | null;
  contactName: string | null;
  termsType: "PUTUS" | "KONSI";
  paymentTempo: number;
  marginPercent: number | null;
  priceDiscountPercent: number | null;
  creditLimit: number | null;
  npwp: string | null;
  lat: number | null;
  lng: number | null;
  checkinRadiusMeters: number | null;
  sellThroughMethod: "SPG_POS" | "SHELF_COUNT" | null;
};

export type StoreListItem = StoreFields & {
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
 * `marginPercent` only — a discount must never apply there, even though the SPG/van pricing
 * paths hardcode PUTUS pricing (they run at consignment stores too, since an SPG is an in-store
 * promoter at a KONSI store selling at retail).
 */
export class KonsiPriceDiscountNotAllowedError extends Error {
  constructor() {
    super("A KONSI store cannot carry a priceDiscountPercent");
    this.name = "KonsiPriceDiscountNotAllowedError";
  }
}

function assertValidPriceDiscount(input: Pick<StoreFields, "termsType" | "priceDiscountPercent">): void {
  if (input.priceDiscountPercent === null) return;
  // Validate what `toDecimalOrNull` will actually persist (Decimal(5,2)), not the raw JS number —
  // e.g. 99.999 passes a raw `< 100` check but rounds to 100.00 in the column, which
  // computeStorePrice then flags and prices at full list.
  const stored = Math.round(input.priceDiscountPercent * 100) / 100;
  if (stored < 0 || stored >= 100) {
    throw new InvalidPriceDiscountPercentError(input.priceDiscountPercent);
  }
  if (input.termsType === "KONSI") {
    throw new KonsiPriceDiscountNotAllowedError();
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
  marginPercent: Prisma.Decimal | null;
  priceDiscountPercent: Prisma.Decimal | null;
  creditLimit: Prisma.Decimal | null;
  npwp: string | null;
  lat: Prisma.Decimal | null;
  lng: Prisma.Decimal | null;
  checkinRadiusMeters: number | null;
  sellThroughMethod: "SPG_POS" | "SHELF_COUNT" | null;
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
    marginPercent: s.marginPercent ? s.marginPercent.toNumber() : null,
    priceDiscountPercent: s.priceDiscountPercent ? s.priceDiscountPercent.toNumber() : null,
    creditLimit: s.creditLimit !== null ? s.creditLimit.toNumber() : null,
    npwp: s.npwp,
    lat: s.lat ? s.lat.toNumber() : null,
    lng: s.lng ? s.lng.toNumber() : null,
    checkinRadiusMeters: s.checkinRadiusMeters,
    sellThroughMethod: s.sellThroughMethod,
    isActive: s.isActive,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

export async function listStores(
  opts: { activeOnly?: boolean; search?: string } = {},
  paging?: { page: number; pageSize: number },
): Promise<{ items: StoreListItem[]; totalCount: number }> {
  const where: Prisma.StoreWhereInput = {};
  if (opts.activeOnly) where.isActive = true;
  if (opts.search && opts.search.trim()) {
    where.OR = [
      { name: { contains: opts.search.trim() } },
      { code: { contains: opts.search.trim() } },
    ];
  }
  const [rows, totalCount] = await Promise.all([
    prisma.store.findMany({
      where,
      orderBy: { name: "asc" },
      ...(paging ? { skip: (paging.page - 1) * paging.pageSize, take: paging.pageSize } : {}),
    }),
    prisma.store.count({ where }),
  ]);
  return { items: rows.map(serializeStore), totalCount };
}

// Lightweight {id,name} list for filter dropdowns — all stores (incl. inactive,
// since orders can reference a since-deactivated store), ordered by name.
export async function listStoreOptions(): Promise<{ id: string; name: string }[]> {
  return prisma.store.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
}

export async function listActiveStoresForPwa() {
  const rows = await prisma.store.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
  return rows.map(serializeStore);
}

export async function getStore(id: string) {
  const s = await prisma.store.findUnique({ where: { id } });
  return s ? serializeStore(s) : null;
}

export async function createStore(input: StoreFields): Promise<StoreListItem> {
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
      marginPercent: toDecimalOrNull(input.marginPercent),
      priceDiscountPercent: toDecimalOrNull(input.priceDiscountPercent),
      creditLimit: toDecimalOrNull(input.creditLimit),
      npwp: input.npwp,
      lat: toDecimalOrNull(input.lat),
      lng: toDecimalOrNull(input.lng),
      checkinRadiusMeters: input.checkinRadiusMeters,
      sellThroughMethod: input.sellThroughMethod,
    },
  });
  return serializeStore(created);
}

export async function updateStore(id: string, input: StoreFields): Promise<StoreListItem> {
  assertValidPriceDiscount(input);
  assertValidSellThroughMethod(input);

  if (input.termsType === "PUTUS") {
    const current = await prisma.store.findUnique({ where: { id }, select: { termsType: true } });
    if (current?.termsType === "KONSI") {
      const draftSellThrough = await prisma.konsiSellThrough.findFirst({
        where: { storeId: id, status: "DRAFT" },
        select: { id: true },
      });
      if (draftSellThrough) throw new StoreHasDraftSellThroughError(id);

      const strandedStock = await prisma.storeStock.findFirst({
        where: { storeId: id, qty: { not: 0 } },
        select: { id: true },
      });
      if (strandedStock) throw new StoreHasConsignmentStockError(id);

      const pendingKonsi = await prisma.fieldSalesOrder.findFirst({
        where: { storeId: id, orderType: "KONSI", status: "PENDING_APPROVAL" },
        select: { id: true },
      });
      if (pendingKonsi) throw new StoreHasConsignmentStockError(id);

      /* Prisma cannot compare columns, so the open remainder is summed in JS. */
      const approvedKonsiLines = await prisma.fieldSalesOrderLine.findMany({
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

  const updated = await prisma.store.update({
    where: { id },
    data: {
      code: input.code,
      name: input.name,
      address: input.address,
      phone: input.phone,
      contactName: input.contactName,
      termsType: input.termsType,
      paymentTempo: input.paymentTempo,
      marginPercent: toDecimalOrNull(input.marginPercent),
      priceDiscountPercent: toDecimalOrNull(input.priceDiscountPercent),
      creditLimit: toDecimalOrNull(input.creditLimit),
      npwp: input.npwp,
      lat: toDecimalOrNull(input.lat),
      lng: toDecimalOrNull(input.lng),
      checkinRadiusMeters: input.checkinRadiusMeters,
      sellThroughMethod: input.sellThroughMethod,
    },
  });
  return serializeStore(updated);
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

export async function listVisitsForStore(storeId: string, limit: number) {
  const rows = await prisma.storeVisit.findMany({
    where: { storeId },
    include: { user: { select: { name: true, email: true } } },
    orderBy: { checkinAt: "desc" },
    take: limit,
  });
  return rows.map(r => ({
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
  }));
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
