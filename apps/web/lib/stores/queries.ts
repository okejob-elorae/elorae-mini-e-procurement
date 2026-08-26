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
  lat: number | null;
  lng: number | null;
  checkinRadiusMeters: number | null;
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
 * Thrown by updateStore when a KONSI → PUTUS edit would strand consignment stock: the store
 * still holds a non-zero StoreStock row, so its goods are physically sitting on the store's
 * floor with no correction path once the store stops being read as KONSI (the stock card, and
 * the konsi retur decrement, are both gated on termsType === "KONSI"). The store must return or
 * transfer that stock first.
 */
export class StoreHasConsignmentStockError extends Error {
  constructor(readonly storeId: string) {
    super(`Store ${storeId} still holds consignment stock and cannot switch off KONSI`);
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
  lat: Prisma.Decimal | null;
  lng: Prisma.Decimal | null;
  checkinRadiusMeters: number | null;
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
    lat: s.lat ? s.lat.toNumber() : null,
    lng: s.lng ? s.lng.toNumber() : null,
    checkinRadiusMeters: s.checkinRadiusMeters,
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
      lat: toDecimalOrNull(input.lat),
      lng: toDecimalOrNull(input.lng),
      checkinRadiusMeters: input.checkinRadiusMeters,
    },
  });
  return serializeStore(created);
}

export async function updateStore(id: string, input: StoreFields): Promise<StoreListItem> {
  assertValidPriceDiscount(input);

  if (input.termsType === "PUTUS") {
    const current = await prisma.store.findUnique({ where: { id }, select: { termsType: true } });
    if (current?.termsType === "KONSI") {
      const strandedStock = await prisma.storeStock.findFirst({
        where: { storeId: id, qty: { not: 0 } },
        select: { id: true },
      });
      if (strandedStock) throw new StoreHasConsignmentStockError(id);
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
      lat: toDecimalOrNull(input.lat),
      lng: toDecimalOrNull(input.lng),
      checkinRadiusMeters: input.checkinRadiusMeters,
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
