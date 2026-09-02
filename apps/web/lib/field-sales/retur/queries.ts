import { prisma, Prisma } from "@elorae/db";
import { lineVariance, creditedQtyForLine } from "./variance";
import { listPriceCandidates, type PriceCandidate } from "./pricing";
import { classifyPriceCandidates } from "./pricing-rules";

export type FieldReturnStatus =
  | "PENDING_WAREHOUSE_RECEIVING"
  | "MISMATCH_PENDING_RESOLUTION"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "CANCELLED";
export type FieldReturnReason = "DAMAGED" | "UNSOLD" | "EXPIRED" | "OTHER";
export type FieldReturnTransport = "SELF_CARRY" | "EXPEDITION";
/**
 * `ADMIN` has neither a transport mode nor a nota photo at raise (both columns are nullable for
 * that origin only — see `docs/ARCHITECTURE-NOTES.md`). `FIELD` still requires both, enforced in
 * the writer, not here.
 */
export type FieldReturnOrigin = "FIELD" | "ADMIN";

export type FieldReturnOffsetStatus = "AVAILABLE" | "APPLIED";

export type FieldReturnRow = {
  id: string;
  docNo: string;
  storeName: string;
  origin: FieldReturnOrigin;
  /** `null` on an ADMIN-origin return that has not yet been shipped. */
  transport: FieldReturnTransport | null;
  status: FieldReturnStatus;
  lineCount: number;
  createdAt: Date;
  totalValue: number | null;
  valuationStatus: "PENDING" | "VALUED";
  /**
   * The raw column — non-null on every retur, even one that isn't APPROVED+VALUED yet, because
   * the schema default is AVAILABLE. A row's REAL offsettability is `status === "APPROVED" &&
   * valuationStatus === "VALUED" && offsetStatus === "AVAILABLE"`; consumers must derive the
   * displayed 3-way badge from all three fields together, never from this column alone.
   */
  offsetStatus: FieldReturnOffsetStatus;
};

export async function listFieldReturns(params: {
  q?: string;
  origin?: FieldReturnOrigin;
  /**
   * "AVAILABLE" means genuinely offsettable — APPROVED + VALUED + offsetStatus AVAILABLE — not
   * merely `offsetStatus === "AVAILABLE"`, which every not-yet-approved retur also carries by
   * default. "APPLIED" needs no such compound filter: only a return that was APPROVED + VALUED
   * could ever have reached APPLIED in the first place.
   */
  creditFilter?: "AVAILABLE" | "APPLIED";
  page: number;
  perPage: number;
}): Promise<{ rows: FieldReturnRow[]; total: number }> {
  const q = params.q?.trim();
  const where: Prisma.FieldReturnWhereInput = {
    ...(q ? { OR: [{ docNo: { contains: q } }, { store: { name: { contains: q } } }] } : {}),
    ...(params.origin ? { origin: params.origin } : {}),
    ...(params.creditFilter === "AVAILABLE"
      ? { status: "APPROVED", valuationStatus: "VALUED", offsetStatus: "AVAILABLE" }
      : params.creditFilter === "APPLIED"
        ? { offsetStatus: "APPLIED" }
        : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.fieldReturn.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (params.page - 1) * params.perPage,
      take: params.perPage,
      select: {
        id: true,
        docNo: true,
        status: true,
        origin: true,
        transport: true,
        createdAt: true,
        totalValue: true,
        valuationStatus: true,
        offsetStatus: true,
        store: { select: { name: true } },
        _count: { select: { lines: true } },
      },
    }),
    prisma.fieldReturn.count({ where }),
  ]);

  return {
    rows: rows.map((r) => ({
      id: r.id,
      docNo: r.docNo,
      storeName: r.store.name,
      origin: r.origin,
      transport: r.transport,
      status: r.status,
      lineCount: r._count.lines,
      createdAt: r.createdAt,
      totalValue: r.totalValue === null ? null : r.totalValue.toNumber(),
      valuationStatus: r.valuationStatus,
      offsetStatus: r.offsetStatus,
    })),
    total,
  };
}

export type FieldReturnResolutionDetail = {
  id: string;
  type: string;
  qty: number;
  note: string | null;
  createdAt: Date;
  createdByLabel: string;
};

export type FieldReturnPriceSource = "DELIVERY" | "MANUAL";
/**
 * `SET` means an admin already chose a price (DELIVERY or MANUAL), regardless of whether that
 * choice can still resolve today — a dangling `priceDeliveryLineId` is still a recorded
 * decision, not an absence of one (mirrors `approveFieldReturn`'s `preserveAdminChoice` rule).
 * `AUTO`/`AMBIGUOUS`/`UNPRICEABLE` are only computed pre-approval, from the same
 * `listPriceCandidates` + `classifyPriceCandidates` the auto-resolve path itself uses.
 */
export type FieldReturnPriceState = "AUTO" | "AMBIGUOUS" | "UNPRICEABLE" | "SET";

/**
 * Shared with setLinePriceAction (app/actions/field-returns.ts), which imports this rather than
 * keeping its own copy — a retur is priceable only while still open; once APPROVED its values
 * are frozen. Kept as an array (not just a Set) because setLinePriceAction's compare-and-swap
 * needs it as a Prisma `in` filter, not only a `.has()` lookup.
 */
export const PRICEABLE_STATUSES = ["PENDING_WAREHOUSE_RECEIVING", "MISMATCH_PENDING_RESOLUTION", "PENDING_APPROVAL"] as const;
export const PRICEABLE_STATUS_SET: ReadonlySet<string> = new Set(PRICEABLE_STATUSES);

export type FieldReturnLineDetail = {
  id: string;
  itemSku: string;
  itemName: string;
  variantSku: string;
  qty: number;
  reason: FieldReturnReason;
  reasonNote: string | null;
  receivedQty: number | null;
  sellableQty: number | null;
  rejectedQty: number | null;
  /** `lineVariance(qty, receivedQty)` — 0 until received, then received minus claimed. */
  variance: number;
  /** Ordered `createdAt desc, id desc` — index 0 is the effective (latest) resolution. */
  resolutions: FieldReturnResolutionDetail[];
  creditedQty: number | null;
  unitPrice: number | null;
  lineValue: number | null;
  priceSource: FieldReturnPriceSource | null;
  priceDeliveryLineId: string | null;
  /**
   * The provenance delivery's doc number, resolved for display. `priceDeliveryLineId` carries
   * no foreign key (`relationMode = "prisma"`), so the delivery line it names can be deleted
   * out from under an already-priced return — this degrades to `null` rather than throwing.
   */
  priceDeliveryDocNo: string | null;
  priceNote: string | null;
  priceState: FieldReturnPriceState;
  /** Only populated while the retur has not yet been approved — values are frozen after that. */
  priceCandidates?: PriceCandidate[];
};

export type FieldReturnDetail = {
  id: string;
  docNo: string;
  status: FieldReturnStatus;
  storeName: string;
  raisedByLabel: string;
  origin: FieldReturnOrigin;
  /** `null` on an ADMIN-origin return that has not yet been shipped. */
  transport: FieldReturnTransport | null;
  expeditionName: string | null;
  resiNo: string | null;
  /** `null` on an ADMIN-origin return — an admin at the office has no nota to photograph. */
  notaPhotoUrl: string | null;
  note: string | null;
  createdAt: Date;
  totalValue: number | null;
  valuationStatus: "PENDING" | "VALUED";
  lines: FieldReturnLineDetail[];
};

export async function getFieldReturnById(
  id: string,
  opts?: { canManage?: boolean },
): Promise<FieldReturnDetail | null> {
  const r = await prisma.fieldReturn.findUnique({
    where: { id },
    select: {
      id: true,
      docNo: true,
      status: true,
      origin: true,
      transport: true,
      expeditionName: true,
      resiNo: true,
      notaPhotoUrl: true,
      note: true,
      createdAt: true,
      raisedById: true,
      storeId: true,
      totalValue: true,
      valuationStatus: true,
      store: { select: { name: true } },
      lines: {
        select: {
          id: true,
          itemId: true,
          qty: true,
          variantSku: true,
          reason: true,
          reasonNote: true,
          receivedQty: true,
          sellableQty: true,
          rejectedQty: true,
          creditedQty: true,
          unitPrice: true,
          lineValue: true,
          priceSource: true,
          priceDeliveryLineId: true,
          priceNote: true,
          item: { select: { sku: true, nameId: true } },
          resolutions: {
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            select: { id: true, type: true, qty: true, note: true, createdAt: true, createdById: true },
          },
        },
      },
    },
  });
  if (!r) return null;

  /*
   * priceDeliveryLineId carries no foreign key (relationMode = "prisma"), so its delivery line
   * can be gone by the time this renders — batched here rather than per line, and a miss
   * resolves to `undefined` (no docNo), never a thrown lookup error.
   */
  const priceDeliveryLineIds = Array.from(
    new Set(r.lines.map((l) => l.priceDeliveryLineId).filter((x): x is string => x !== null))
  );
  const deliveryLines =
    priceDeliveryLineIds.length > 0
      ? await prisma.fieldSalesDeliveryLine.findMany({
          where: { id: { in: priceDeliveryLineIds } },
          select: { id: true, delivery: { select: { docNo: true } } },
        })
      : [];
  const docNoByDeliveryLineId = new Map(deliveryLines.map((dl) => [dl.id, dl.delivery.docNo]));

  /*
   * Candidates are only meaningful while the retur can still be repriced by a viewer who is
   * actually allowed to reprice it. Gated on BOTH conditions LinePriceControls itself requires
   * (canManage + PRICEABLE_STATUS_SET), not just "not yet APPROVED" — a CANCELLED retur and a
   * viewer with no field_returns:manage can never see the controls either, and firing one
   * listPriceCandidates query per line for them was pure waste.
   */
  const isOpenForPricing = (opts?.canManage ?? false) && PRICEABLE_STATUS_SET.has(r.status);
  const candidatesByLineId = new Map<string, PriceCandidate[]>();
  if (isOpenForPricing) {
    await Promise.all(
      r.lines.map(async (l) => {
        const candidates = await listPriceCandidates(prisma, {
          storeId: r.storeId,
          itemId: l.itemId,
          variantSku: l.variantSku,
        });
        candidatesByLineId.set(l.id, candidates);
      })
    );
  }

  /**
   * `raisedById` on `FieldReturn` and `createdById` on each `FieldReturnResolution` are bare
   * scalars with no relation, so every label is a separate batch lookup rather than an
   * `include`. One query covers the salesman plus every resolution's author.
   */
  const userIds = Array.from(
    new Set([r.raisedById, ...r.lines.flatMap((l) => l.resolutions.map((res) => res.createdById))])
  );
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true, email: true },
  });
  const labelById = new Map(users.map((u) => [u.id, u.name ?? u.email]));
  const labelFor = (userId: string): string => labelById.get(userId) ?? "—";

  return {
    id: r.id,
    docNo: r.docNo,
    status: r.status,
    storeName: r.store.name,
    raisedByLabel: labelFor(r.raisedById),
    origin: r.origin,
    transport: r.transport,
    expeditionName: r.expeditionName,
    resiNo: r.resiNo,
    notaPhotoUrl: r.notaPhotoUrl,
    note: r.note,
    createdAt: r.createdAt,
    totalValue: r.totalValue === null ? null : r.totalValue.toNumber(),
    valuationStatus: r.valuationStatus,
    lines: r.lines.map((l) => {
      const priceCandidates = candidatesByLineId.get(l.id);
      const priceState: FieldReturnPriceState = l.priceSource
        ? "SET"
        : priceCandidates
          ? classifyPriceCandidates(priceCandidates.map((c) => c.unitPrice)).kind
          : "UNPRICEABLE";

      return {
        id: l.id,
        itemSku: l.item.sku,
        itemName: l.item.nameId,
        variantSku: l.variantSku,
        qty: l.qty,
        reason: l.reason,
        reasonNote: l.reasonNote,
        receivedQty: l.receivedQty,
        sellableQty: l.sellableQty,
        rejectedQty: l.rejectedQty,
        variance: lineVariance(l.qty, l.receivedQty),
        resolutions: l.resolutions.map((res) => ({
          id: res.id,
          type: res.type,
          qty: res.qty,
          note: res.note,
          createdAt: res.createdAt,
          createdByLabel: labelFor(res.createdById),
        })),
        creditedQty: l.creditedQty,
        unitPrice: l.unitPrice === null ? null : l.unitPrice.toNumber(),
        lineValue: l.lineValue === null ? null : l.lineValue.toNumber(),
        priceSource: l.priceSource,
        priceDeliveryLineId: l.priceDeliveryLineId,
        priceDeliveryDocNo: l.priceDeliveryLineId ? (docNoByDeliveryLineId.get(l.priceDeliveryLineId) ?? null) : null,
        priceNote: l.priceNote,
        priceState,
        ...(isOpenForPricing ? { priceCandidates: priceCandidates ?? [] } : {}),
      };
    }),
  };
}

export type KonsiReturStockImpactLine = {
  lineId: string;
  itemName: string;
  variantSku: string;
  creditedQty: number;
  storeQty: number;
  shortfall: number;
};

/**
 * Read-only preview of what approveFieldReturn's KONSI decrement would do to a store's stock
 * ledger, so an approver can be warned before committing rather than discovering a negative row
 * afterwards. Returns ONLY the lines that would drive a StoreStock row negative, each with its
 * shortfall. Returns `null` for a nonexistent returnId (distinguishable from "no impact"); `[]`
 * for a non-KONSI store or a KONSI store with no impacted lines — approveFieldReturn never
 * touches StoreStock for a non-KONSI store, so there is genuinely nothing to preview there.
 *
 * creditedQty is computed with the SAME creditedQtyForLine helper approveFieldReturn stamps onto
 * FieldReturnLine at commit — never a second formula — because this can run while the retur is
 * still PENDING_APPROVAL, before that column has ever been written.
 *
 * Two or more lines can share the same (itemId, variantSku) — createFieldReturn only forbids a
 * duplicate itemId within one call site, never a duplicate (itemId, variantSku) pair across
 * lines, and nothing else in this feature forbids it either. approveFieldReturn's own decrement
 * loop reads/writes StoreStock SEQUENTIALLY, so a second line on the same key is evaluated
 * against what the FIRST line already left behind, not the row's original value. This preview
 * mirrors that with a running per-key quantity (seeded from one batched findMany, not one
 * findUnique per line) — evaluating every line against the ORIGINAL row would silently miss the
 * exact case where the warning matters most: a second line that only goes negative because an
 * earlier line in the same retur already spent the store's stock.
 */
export async function previewKonsiReturStockImpact(returnId: string): Promise<KonsiReturStockImpactLine[] | null> {
  const ret = await prisma.fieldReturn.findUnique({
    where: { id: returnId },
    select: {
      storeId: true,
      store: { select: { termsType: true } },
      lines: {
        orderBy: { id: "asc" },
        select: {
          id: true,
          itemId: true,
          variantSku: true,
          qty: true,
          receivedQty: true,
          item: { select: { nameId: true } },
          resolutions: {
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 1,
            select: { type: true },
          },
        },
      },
    },
  });
  if (!ret) return null;
  if (ret.store.termsType !== "KONSI") return [];

  const itemIds = Array.from(new Set(ret.lines.map((l) => l.itemId)));
  const stockRows =
    itemIds.length > 0
      ? await prisma.storeStock.findMany({
          where: { storeId: ret.storeId, itemId: { in: itemIds } },
          select: { itemId: true, variantSku: true, qty: true },
        })
      : [];

  /* Running per-key quantity, seeded from the DB and then walked down line-by-line in the same
     order approveFieldReturn's own loop processes ret.lines — see the doc comment above. */
  const runningQtyByKey = new Map<string, number>();
  for (const row of stockRows) {
    runningQtyByKey.set(`${row.itemId}::${row.variantSku}`, row.qty.toNumber());
  }

  const impacted: KonsiReturStockImpactLine[] = [];

  for (const line of ret.lines) {
    const latestType = line.resolutions[0]?.type ?? null;
    const creditedQty = creditedQtyForLine({
      qty: line.qty,
      receivedQty: line.receivedQty,
      latestResolutionType: latestType,
    });
    if (!creditedQty) continue;

    const key = `${line.itemId}::${line.variantSku}`;
    const storeQtyBeforeThisLine = runningQtyByKey.get(key) ?? 0;
    runningQtyByKey.set(key, storeQtyBeforeThisLine - creditedQty);

    const shortfall = creditedQty - storeQtyBeforeThisLine;
    if (shortfall <= 0) continue;

    impacted.push({
      lineId: line.id,
      itemName: line.item.nameId,
      variantSku: line.variantSku,
      creditedQty,
      storeQty: storeQtyBeforeThisLine,
      shortfall,
    });
  }

  return impacted;
}

/**
 * Two figures describing an ADMIN-origin return that has left this store's `StoreStock` ledger
 * (or is about to) but has not yet reached APPROVED — split by WHERE the return currently sits,
 * so the store card can tell "still on a truck" from "already off the shelf" instead of the two
 * reading identically:
 *
 * - `raisedQty`: claimed by a return still `PENDING_WAREHOUSE_RECEIVING` — the ledger's
 *   temporary OVERSTATEMENT `receive-writer.ts` documents. `StoreStock` for an ADMIN return only
 *   decrements at receipt, so between raise and receipt the store's own ledger still counts
 *   units that are physically on a truck.
 * - `receivedQty`: what the warehouse actually counted in on a return sitting in
 *   `MISMATCH_PENDING_RESOLUTION` or `PENDING_APPROVAL` — `receive-writer.ts` has already
 *   applied this decrement, so it is the ledger's temporary UNDERSTATEMENT: the units are gone
 *   from `StoreStock` but there is no `RETUR_OUT` movement row to explain the drop until the
 *   return reaches APPROVED (`getStoreStockCard` only lists movements for an APPROVED return).
 *   An `INVESTIGATE` resolution can hold a return here indefinitely.
 *
 * Together these cover every ADMIN-origin status except `APPROVED` (by then the movement row
 * exists) and `CANCELLED` (nothing left the ledger). Deliberately NOT folded into
 * `getStoreStockCard` or netted out of the stocktake's `expectedQty` — both read the ledger
 * as-is, by design; this is a separate, purely informational pair for the store card to display
 * alongside it.
 */
export type InTransitAdminReturnQty = {
  raisedQty: number;
  receivedQty: number;
};

export async function getInTransitAdminReturnQty(storeId: string): Promise<InTransitAdminReturnQty> {
  const [raised, received] = await Promise.all([
    prisma.fieldReturnLine.aggregate({
      where: { returnDoc: { storeId, origin: "ADMIN", status: "PENDING_WAREHOUSE_RECEIVING" } },
      _sum: { qty: true },
    }),
    prisma.fieldReturnLine.aggregate({
      where: {
        returnDoc: {
          storeId,
          origin: "ADMIN",
          status: { in: ["MISMATCH_PENDING_RESOLUTION", "PENDING_APPROVAL"] },
        },
      },
      _sum: { receivedQty: true },
    }),
  ]);
  return {
    raisedQty: raised._sum.qty ?? 0,
    receivedQty: received._sum.receivedQty ?? 0,
  };
}
