import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { createFieldReturn } from "./writer";
import { receiveFieldReturn } from "./receive-writer";
import { resolveFieldReturnLine } from "./resolve-writer";
import { approveFieldReturn } from "./approve-writer";
import { getFieldReturnById } from "./queries";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("approveFieldReturn (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  let uomId = "";
  let itemId = "";
  let shortItemId = "";
  let noRowItemId = "";
  let unpricedItemId = "";
  let ambiguousItemId = "";
  let storeId = "";
  let raisedById = "";
  let adminId = "";

  /*
   * Retur A: claimed == received == 12, no variance — straight to PENDING_APPROVAL. Priced by
   * a real delivery of the SAME 12 pcs for 10.000.000 to the same store/item/variant, so
   * creditedQty (12) matches the delivery's own qty exactly — required for the "unit price
   * doesn't multiply back" test, which needs the full delivered qty, not a partial claim.
   */
  let returnId = "";
  let lineId = "";

  /* The 12-pcs-for-10.000.000 delivery line that prices Retur A (and, by store+item+variant,
     any other retur line against the same item). */
  let deliveryLineId = "";

  /*
   * Retur B: claimed 5, received 2 — left UNRESOLVED. receiveFieldReturn and
   * resolveFieldReturnLine keep FieldReturn.status in sync with per-line settled state on
   * every write of their own, so there is no way to reach PENDING_APPROVAL with an unsettled
   * line through the real writers. The status is hand-stamped below to simulate that drift
   * and exercise approveFieldReturn's own defense-in-depth check directly, rather than
   * leaving it untested because the app can't normally produce the state.
   */
  let mismatchedReturnId = "";

  /* Retur C: claimed 12, received 10, settled via SALESMAN_BEARS — the short-received case,
     priced by its own 12-pcs-for-10.000.000 delivery. */
  let shortReturnId = "";
  let shortLineId = "";

  /* Retur D: claimed 3 == received 3, split 1 sellable / 2 rejected. */
  let rejectedReturnId = "";
  let rejectedLineId = "";

  /* Retur E: claimed 2 == received 2, fully rejected — sellableQty 0. */
  let fullyRejectedReturnId = "";

  /* Retur F: claimed 4 == received 4, all sellable, for an item with NO pre-existing InventoryValue row. */
  let noRowReturnId = "";

  /* Retur G: claimed 2, received 4 (surplus of 2), settled via ACCEPT_SURPLUS. */
  let surplusReturnId = "";
  let surplusLineId = "";

  /* Retur H: claimed == received == 3, for an item that has NEVER been delivered — the line
     stays unpriced (UNPRICEABLE) unless an admin later sets a MANUAL price on it. */
  let unpricedReturnId = "";
  let unpricedLineId = "";

  /* Retur I: claimed == received == 3, for an item TWO deliveries priced differently
     (AMBIGUOUS) — the line stays unpriced unless an admin retargets it to one delivery. */
  let ambiguousReturnId = "";
  let ambiguousLineId = "";
  /*
   * The two disagreeing deliveries (a cheap one, 3 pcs for 6.000.000, is also created below
   * to keep resolveLinePrice's classification genuinely AMBIGUOUS, but nothing needs to hold
   * its id). The retarget test deliberately uses the EXPENSIVE one (1 pc for 3.000.000)
   * instead — retargeting to a delivery whose own qty (1) differs from the credited qty (3)
   * is what actually exercises the multiplication (3 x 3.000.000/unit = 9.000.000), rather
   * than one where creditedQty happens to equal the delivery's qty and the test would pass
   * even if lineValue were wired straight to lineTotal.
   */
  let expensiveDeliveryLineId = "";

  /* Retur J: claimed 5, received 2, settled via INVESTIGATE — INVESTIGATE never settles, so
     this retur can never leave MISMATCH_PENDING_RESOLUTION and approveFieldReturn must refuse
     it, exactly like the never-received-a-resolution case. */
  let investigatingReturnId = "";
  let investigatingLineId = "";

  /* Retur K: claimed 12, received 10, settled via WRITE_OFF — same numbers as Retur C, but
     WRITE_OFF instead of SALESMAN_BEARS, so the resolution-amount branch's OTHER settling
     type gets its own end-to-end coverage. */
  let writeOffReturnId = "";
  let writeOffLineId = "";

  /*
   * Retur L: TWO lines in one retur — one against a priced item, one against an item that has
   * never been delivered — so totalValue-is-null-not-partial actually has something to fail
   * against (mkReturn only ever builds a single line).
   */
  let twoLineReturnId = "";
  let twoLinePricedLineId = "";
  let twoLineUnpricedLineId = "";

  /* Order/delivery scaffolding created only to price the returs above — tracked as arrays
     because there are several, and torn down before the orders/items/users they reference. */
  let deliveryIds: string[] = [];
  let orderIds: string[] = [];

  /*
   * KONSI-decrement fixtures (Task 5). `storeId`/`putusStoreId` are the SAME store (PUTUS,
   * created below) — kept as two names because the new tests read as "the PUTUS store" while
   * every pre-existing test in this file reads `storeId`. `konsiStoreId` is a second, new store.
   */
  let putusStoreId = "";
  let konsiStoreId = "";
  let neverHeldItemId = "";
  let konsiSurplusItemId = "";

  /* Retur M: KONSI store, claimed == received == 6, no variance. StoreStock seeded 10. */
  let konsiReturnId = "";

  /* Retur N: the PUTUS store, claimed == received == 4. Its StoreStock row (seeded 7,
     deliberately, so this cannot pass against a no-op implementation) must stay untouched. */
  let putusReturnId = "";

  /* Retur O: KONSI store, item shortItemId, claimed == received == 6. StoreStock seeded only 2. */
  let shortStoreReturnId = "";

  /* Retur P: KONSI store, item neverHeldItemId (no StoreStock row for this store+item at all). */
  let neverHeldReturnId = "";

  /* Retur Q: KONSI store, item konsiSurplusItemId, claimed 4, received 6, ACCEPT_SURPLUS ->
     creditedQty is the RECEIVED qty (6), not the claimed one (4). StoreStock seeded 10. */
  let konsiSurplusReturnId = "";
  let konsiSurplusLineId = "";

  /* Retur R: KONSI store, item konsiBearsItemId, claimed 6, received 4, sellable 4, settled
     SALESMAN_BEARS -> creditedQty is the CLAIMED qty (6), NOT sellableQty (4) or receivedQty
     (4) — the two coincide here on purpose, to catch a decrement that reads either of those
     instead of creditedQty. StoreStock seeded 10. */
  let konsiBearsItemId = "";
  let konsiBearsReturnId = "";
  let konsiBearsLineId = "";

  beforeEach(async () => {
    uomId = "";
    itemId = "";
    shortItemId = "";
    noRowItemId = "";
    unpricedItemId = "";
    ambiguousItemId = "";
    storeId = "";
    raisedById = "";
    adminId = "";
    returnId = "";
    lineId = "";
    deliveryLineId = "";
    mismatchedReturnId = "";
    shortReturnId = "";
    shortLineId = "";
    rejectedReturnId = "";
    rejectedLineId = "";
    fullyRejectedReturnId = "";
    noRowReturnId = "";
    surplusReturnId = "";
    surplusLineId = "";
    unpricedReturnId = "";
    unpricedLineId = "";
    ambiguousReturnId = "";
    ambiguousLineId = "";
    expensiveDeliveryLineId = "";
    investigatingReturnId = "";
    investigatingLineId = "";
    writeOffReturnId = "";
    writeOffLineId = "";
    twoLineReturnId = "";
    twoLinePricedLineId = "";
    twoLineUnpricedLineId = "";
    deliveryIds = [];
    orderIds = [];
    putusStoreId = "";
    konsiStoreId = "";
    neverHeldItemId = "";
    konsiSurplusItemId = "";
    konsiReturnId = "";
    putusReturnId = "";
    shortStoreReturnId = "";
    neverHeldReturnId = "";
    konsiSurplusReturnId = "";
    konsiSurplusLineId = "";
    konsiBearsItemId = "";
    konsiBearsReturnId = "";
    konsiBearsLineId = "";

    const uom = await prisma.uOM.create({ data: { code: `TEST-UOM-FRA-${token}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;

    const item = await prisma.item.create({
      data: { sku: `TEST-FRA-${token}`, nameId: "Retur approve item", nameEn: "Retur approve item", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 40000 },
    });
    itemId = item.id;

    const shortItem = await prisma.item.create({
      data: { sku: `TEST-FRA-SHORT-${token}`, nameId: "Retur approve item short", nameEn: "Retur approve item short", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 40000 },
    });
    shortItemId = shortItem.id;

    const noRowItem = await prisma.item.create({
      data: { sku: `TEST-FRA-NOROW-${token}`, nameId: "Retur approve item no row", nameEn: "Retur approve item no row", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 40000 },
    });
    noRowItemId = noRowItem.id;
    /* Deliberately no InventoryValue row seeded for noRowItemId — this fixture pins the
       no-row → avgCost 0 path. */

    const unpricedItem = await prisma.item.create({
      data: { sku: `TEST-FRA-UNPRICED-${token}`, nameId: "Retur approve item unpriced", nameEn: "Retur approve item unpriced", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 40000 },
    });
    unpricedItemId = unpricedItem.id;
    /* Deliberately never delivered — resolveLinePrice must report UNPRICEABLE for it. */

    const ambiguousItem = await prisma.item.create({
      data: { sku: `TEST-FRA-AMBIG-${token}`, nameId: "Retur approve item ambiguous", nameEn: "Retur approve item ambiguous", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 40000 },
    });
    ambiguousItemId = ambiguousItem.id;

    const neverHeldItem = await prisma.item.create({
      data: { sku: `TEST-FRA-NEVERHELD-${token}`, nameId: "Retur approve item never held", nameEn: "Retur approve item never held", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 40000 },
    });
    neverHeldItemId = neverHeldItem.id;

    const konsiSurplusItem = await prisma.item.create({
      data: { sku: `TEST-FRA-KONSI-SURPLUS-${token}`, nameId: "Retur approve item konsi surplus", nameEn: "Retur approve item konsi surplus", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 40000 },
    });
    konsiSurplusItemId = konsiSurplusItem.id;

    const konsiBearsItem = await prisma.item.create({
      data: { sku: `TEST-FRA-KONSI-BEARS-${token}`, nameId: "Retur approve item konsi bears", nameEn: "Retur approve item konsi bears", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 40000 },
    });
    konsiBearsItemId = konsiBearsItem.id;

    /*
     * Seed the main inventory row with variantSku: null — the real shape a Jubelio-ingested
     * variantless row takes — so the writer's OR-tolerant lookup is genuinely exercised, not
     * just a "" row a strict lookup would also have found.
     */
    await prisma.inventoryValue.create({
      data: { itemId, variantSku: null, qtyOnHand: 50, reservedQty: 0, avgCost: 10000, totalValue: 500000 },
    });
    await prisma.inventoryValue.create({
      data: { itemId: shortItemId, variantSku: null, qtyOnHand: 20, reservedQty: 0, avgCost: 5000, totalValue: 100000 },
    });
    await prisma.inventoryValue.create({
      data: { itemId: unpricedItemId, variantSku: null, qtyOnHand: 15, reservedQty: 0, avgCost: 7000, totalValue: 105000 },
    });

    const store = await prisma.store.create({
      data: { code: `TEST-FRA-STORE-${token}`, name: "Test Retur Approve Store", address: "Test address", termsType: "PUTUS", isActive: true },
    });
    storeId = store.id;
    putusStoreId = store.id;

    const konsiStore = await prisma.store.create({
      data: { code: `TEST-FRA-KONSI-STORE-${token}`, name: "Test Retur Approve Konsi Store", address: "Test address", termsType: "KONSI", isActive: true },
    });
    konsiStoreId = konsiStore.id;

    /*
     * StoreStock seeds for the KONSI-decrement tests. The PUTUS row is seeded DELIBERATELY —
     * a test asserting it stays untouched proves nothing unless a row that could wrongly be
     * decremented actually exists when it runs.
     */
    await prisma.storeStock.create({ data: { storeId: konsiStoreId, itemId, variantSku: "", qty: 10, avgCost: 10000 } });
    await prisma.storeStock.create({ data: { storeId: putusStoreId, itemId, variantSku: "", qty: 7, avgCost: 10000 } });
    await prisma.storeStock.create({ data: { storeId: konsiStoreId, itemId: shortItemId, variantSku: "", qty: 2, avgCost: 5000 } });
    await prisma.storeStock.create({ data: { storeId: konsiStoreId, itemId: konsiSurplusItemId, variantSku: "", qty: 10, avgCost: 10000 } });
    await prisma.storeStock.create({ data: { storeId: konsiStoreId, itemId: konsiBearsItemId, variantSku: "", qty: 10, avgCost: 10000 } });
    /* Deliberately no StoreStock row for (konsiStoreId, neverHeldItemId) — the store never held it. */

    const raisedBy = await prisma.user.create({ data: { email: `test-fra-${token}@example.com`, name: "Test Retur Salesman" } });
    raisedById = raisedBy.id;

    const admin = await prisma.user.create({ data: { email: `test-fra-admin-${token}@example.com`, name: "Test Warehouse Admin" } });
    adminId = admin.id;

    const mkReturn = async (opts: { itemId: string; qty: number; reason: "DAMAGED" | "UNSOLD"; storeId?: string }) =>
      createFieldReturn({
        storeId: opts.storeId ?? storeId,
        raisedById,
        transport: "SELF_CARRY",
        notaPhotoUrl: "https://cdn.example/nota.jpg",
        notaPhotoR2Key: "field-returns/x/nota.jpg",
        lines: [{ itemId: opts.itemId, variantSku: "", qty: opts.qty, reason: opts.reason }],
      });

    /*
     * Builds a real FieldSalesOrder + FieldSalesDelivery + FieldSalesDeliveryLine to this
     * store for the given item, at variantSku "" (the same convention mkReturn's lines use),
     * so resolveLinePrice's store+item+variant lookup finds it. Bypasses the delivery writer
     * (out of scope here), same as pricing.test.ts's fixture.
     */
    const mkDelivery = async (opts: { itemId: string; qty: number; lineTotal: number; suffix: string }) => {
      const unitPrice = opts.lineTotal / opts.qty;
      const order = await prisma.fieldSalesOrder.create({
        data: {
          orderNo: `PUTUS/TEST-FRA-${opts.suffix}-${token}`,
          storeId,
          salesmanId: raisedById,
          status: "APPROVED",
          orderType: "PUTUS",
          subtotal: opts.lineTotal,
          total: opts.lineTotal,
          lines: {
            create: [{ itemId: opts.itemId, variantSku: "", productName: "Test delivery line", qty: opts.qty, unitPrice, lineTotal: opts.lineTotal }],
          },
        },
        include: { lines: true },
      });
      orderIds.push(order.id);
      const orderLine = order.lines[0];
      const delivery = await prisma.fieldSalesDelivery.create({
        data: {
          docNo: `TEST-FRA-DLV-${opts.suffix}-${token}`,
          orderId: order.id,
          deliveredAt: new Date("2026-08-01T00:00:00.000Z"),
          deliveredById: raisedById,
          invoiceDate: new Date("2026-08-01T00:00:00.000Z"),
          dueDate: new Date("2026-08-08T00:00:00.000Z"),
          subtotal: opts.lineTotal,
          total: opts.lineTotal,
          lines: {
            create: [{ orderLineId: orderLine.id, itemId: opts.itemId, variantSku: "", productName: "Test delivery line", qty: opts.qty, unitPrice, lineTotal: opts.lineTotal }],
          },
        },
        include: { lines: true },
      });
      deliveryIds.push(delivery.id);
      return delivery.lines[0].id;
    };

    /* Retur A — claimed and received in full (12 pcs), priced by a real delivery of the same
       12 pcs for 10.000.000 to this store. */
    deliveryLineId = await mkDelivery({ itemId, qty: 12, lineTotal: 10_000_000, suffix: "MAIN" });
    const createdA = await mkReturn({ itemId, qty: 12, reason: "UNSOLD" });
    returnId = createdA.returnId;
    const lineA = await prisma.fieldReturnLine.findFirstOrThrow({ where: { returnId: seededId(returnId) } });
    lineId = lineA.id;
    await receiveFieldReturn({
      returnId,
      receivedById: adminId,
      counts: [{ lineId: lineA.id, receivedQty: 12, sellableQty: 12, rejectedQty: 0 }],
    });

    /* Retur B — left unresolved, then hand-stamped (see comment above the declaration). */
    const createdB = await mkReturn({ itemId, qty: 5, reason: "UNSOLD" });
    mismatchedReturnId = createdB.returnId;
    const lineB = await prisma.fieldReturnLine.findFirstOrThrow({ where: { returnId: seededId(mismatchedReturnId) } });
    await receiveFieldReturn({
      returnId: mismatchedReturnId,
      receivedById: adminId,
      counts: [{ lineId: lineB.id, receivedQty: 2, sellableQty: 2, rejectedQty: 0 }],
    });
    await prisma.fieldReturn.update({ where: { id: mismatchedReturnId }, data: { status: "PENDING_APPROVAL" } });

    /* Retur C — claimed 12, received 10, settled via SALESMAN_BEARS. Priced by its own
       12-pcs-for-10.000.000 delivery (same ratio as Retur A, different item). */
    await mkDelivery({ itemId: shortItemId, qty: 12, lineTotal: 10_000_000, suffix: "SHORT" });
    const createdC = await mkReturn({ itemId: shortItemId, qty: 12, reason: "DAMAGED" });
    shortReturnId = createdC.returnId;
    const lineC = await prisma.fieldReturnLine.findFirstOrThrow({ where: { returnId: seededId(shortReturnId) } });
    shortLineId = lineC.id;
    await receiveFieldReturn({
      returnId: shortReturnId,
      receivedById: adminId,
      counts: [{ lineId: lineC.id, receivedQty: 10, sellableQty: 10, rejectedQty: 0 }],
    });
    await resolveFieldReturnLine({ lineId: lineC.id, type: "SALESMAN_BEARS", createdById: adminId });

    /* Retur K — claimed 12, received 10, settled via WRITE_OFF (same numbers as Retur C, the
       OTHER settling type on the amount branch). Priced by the SAME shortItemId delivery
       Retur C already set up — resolveLinePrice matches on store+item+variant, not on which
       retur is asking, so no second delivery is needed. */
    const createdK = await mkReturn({ itemId: shortItemId, qty: 12, reason: "DAMAGED" });
    writeOffReturnId = createdK.returnId;
    const lineK = await prisma.fieldReturnLine.findFirstOrThrow({
      where: { returnId: seededId(writeOffReturnId) },
    });
    writeOffLineId = lineK.id;
    await receiveFieldReturn({
      returnId: writeOffReturnId,
      receivedById: adminId,
      counts: [{ lineId: lineK.id, receivedQty: 10, sellableQty: 10, rejectedQty: 0 }],
    });
    await resolveFieldReturnLine({ lineId: lineK.id, type: "WRITE_OFF", createdById: adminId });

    /* Retur D. */
    const createdD = await mkReturn({ itemId, qty: 3, reason: "DAMAGED" });
    rejectedReturnId = createdD.returnId;
    const lineD = await prisma.fieldReturnLine.findFirstOrThrow({ where: { returnId: seededId(rejectedReturnId) } });
    rejectedLineId = lineD.id;
    await receiveFieldReturn({
      returnId: rejectedReturnId,
      receivedById: adminId,
      counts: [{ lineId: lineD.id, receivedQty: 3, sellableQty: 1, rejectedQty: 2 }],
    });

    /* Retur E — fully rejected, sellableQty 0. */
    const createdE = await mkReturn({ itemId, qty: 2, reason: "DAMAGED" });
    fullyRejectedReturnId = createdE.returnId;
    const lineE = await prisma.fieldReturnLine.findFirstOrThrow({ where: { returnId: seededId(fullyRejectedReturnId) } });
    await receiveFieldReturn({
      returnId: fullyRejectedReturnId,
      receivedById: adminId,
      counts: [{ lineId: lineE.id, receivedQty: 2, sellableQty: 0, rejectedQty: 2 }],
    });

    /* Retur F — no pre-existing InventoryValue row for noRowItemId. */
    const createdF = await mkReturn({ itemId: noRowItemId, qty: 4, reason: "UNSOLD" });
    noRowReturnId = createdF.returnId;
    const lineF = await prisma.fieldReturnLine.findFirstOrThrow({ where: { returnId: seededId(noRowReturnId) } });
    await receiveFieldReturn({
      returnId: noRowReturnId,
      receivedById: adminId,
      counts: [{ lineId: lineF.id, receivedQty: 4, sellableQty: 4, rejectedQty: 0 }],
    });

    /* Retur G — claimed 2, received 4 (surplus of 2), settled via ACCEPT_SURPLUS. Priced by
       the same itemId delivery as Retur A/C; the resolution stamps no amount for a surplus. */
    const createdG = await mkReturn({ itemId, qty: 2, reason: "UNSOLD" });
    surplusReturnId = createdG.returnId;
    const lineG = await prisma.fieldReturnLine.findFirstOrThrow({ where: { returnId: seededId(surplusReturnId) } });
    surplusLineId = lineG.id;
    await receiveFieldReturn({
      returnId: surplusReturnId,
      receivedById: adminId,
      counts: [{ lineId: lineG.id, receivedQty: 4, sellableQty: 4, rejectedQty: 0 }],
    });
    await resolveFieldReturnLine({ lineId: lineG.id, type: "ACCEPT_SURPLUS", createdById: adminId });

    /* Retur H — claimed == received == 3, for an item that has never been delivered. */
    const createdH = await mkReturn({ itemId: unpricedItemId, qty: 3, reason: "UNSOLD" });
    unpricedReturnId = createdH.returnId;
    const lineH = await prisma.fieldReturnLine.findFirstOrThrow({ where: { returnId: seededId(unpricedReturnId) } });
    unpricedLineId = lineH.id;
    await receiveFieldReturn({
      returnId: unpricedReturnId,
      receivedById: adminId,
      counts: [{ lineId: lineH.id, receivedQty: 3, sellableQty: 3, rejectedQty: 0 }],
    });

    /*
     * Retur I — claimed == received == 3, for an item TWO deliveries priced differently:
     * 1 pc for 3.000.000 (3.000.000/unit) and 3 pcs for 6.000.000 (2.000.000/unit, the
     * cheaper one). resolveLinePrice reports AMBIGUOUS and the line stays unpriced unless
     * an admin retargets it to one delivery.
     */
    expensiveDeliveryLineId = await mkDelivery({ itemId: ambiguousItemId, qty: 1, lineTotal: 3_000_000, suffix: "AMBIG-EXP" });
    await mkDelivery({ itemId: ambiguousItemId, qty: 3, lineTotal: 6_000_000, suffix: "AMBIG-CHEAP" });
    const createdI = await mkReturn({ itemId: ambiguousItemId, qty: 3, reason: "UNSOLD" });
    ambiguousReturnId = createdI.returnId;
    const lineI = await prisma.fieldReturnLine.findFirstOrThrow({ where: { returnId: seededId(ambiguousReturnId) } });
    ambiguousLineId = lineI.id;
    await receiveFieldReturn({
      returnId: ambiguousReturnId,
      receivedById: adminId,
      counts: [{ lineId: lineI.id, receivedQty: 3, sellableQty: 3, rejectedQty: 0 }],
    });

    /* Retur J — claimed 5, received 2, settled via INVESTIGATE. INVESTIGATE never settles, so
       this retur holds in MISMATCH_PENDING_RESOLUTION and can never reach approval. */
    const createdJ = await mkReturn({ itemId, qty: 5, reason: "DAMAGED" });
    investigatingReturnId = createdJ.returnId;
    const lineJ = await prisma.fieldReturnLine.findFirstOrThrow({ where: { returnId: seededId(investigatingReturnId) } });
    investigatingLineId = lineJ.id;
    await receiveFieldReturn({
      returnId: investigatingReturnId,
      receivedById: adminId,
      counts: [{ lineId: lineJ.id, receivedQty: 2, sellableQty: 2, rejectedQty: 0 }],
    });
    await resolveFieldReturnLine({ lineId: lineJ.id, type: "INVESTIGATE", createdById: adminId });

    /*
     * Retur L — two lines: one against itemId (priced by its 12-pcs-for-10.000.000 delivery),
     * one against unpricedItemId (never delivered). mkReturn only ever builds a single line,
     * so this fixture is built directly against createFieldReturn.
     */
    const createdTwoLine = await createFieldReturn({
      storeId,
      raisedById,
      transport: "SELF_CARRY",
      notaPhotoUrl: "https://cdn.example/nota.jpg",
      notaPhotoR2Key: "field-returns/x/nota.jpg",
      lines: [
        { itemId, variantSku: "", qty: 5, reason: "UNSOLD" },
        { itemId: unpricedItemId, variantSku: "", qty: 2, reason: "UNSOLD" },
      ],
    });
    twoLineReturnId = createdTwoLine.returnId;
    const twoLineLines = await prisma.fieldReturnLine.findMany({ where: { returnId: seededId(twoLineReturnId) } });
    const twoLinePriced = twoLineLines.find((l) => l.itemId === itemId)!;
    const twoLineUnpriced = twoLineLines.find((l) => l.itemId === unpricedItemId)!;
    twoLinePricedLineId = twoLinePriced.id;
    twoLineUnpricedLineId = twoLineUnpriced.id;
    await receiveFieldReturn({
      returnId: twoLineReturnId,
      receivedById: adminId,
      counts: [
        { lineId: twoLinePricedLineId, receivedQty: 5, sellableQty: 5, rejectedQty: 0 },
        { lineId: twoLineUnpricedLineId, receivedQty: 2, sellableQty: 2, rejectedQty: 0 },
      ],
    });

    /* Retur M — KONSI store, claimed == received == 6 (no variance). StoreStock seeded 10. */
    const createdKonsi = await mkReturn({ itemId, qty: 6, reason: "UNSOLD", storeId: konsiStoreId });
    konsiReturnId = createdKonsi.returnId;
    const lineKonsi = await prisma.fieldReturnLine.findFirstOrThrow({ where: { returnId: seededId(konsiReturnId) } });
    await receiveFieldReturn({
      returnId: konsiReturnId,
      receivedById: adminId,
      counts: [{ lineId: lineKonsi.id, receivedQty: 6, sellableQty: 6, rejectedQty: 0 }],
    });

    /* Retur N — the PUTUS store, claimed == received == 4. Must never touch StoreStock. */
    const createdPutus = await mkReturn({ itemId, qty: 4, reason: "UNSOLD", storeId: putusStoreId });
    putusReturnId = createdPutus.returnId;
    const linePutus = await prisma.fieldReturnLine.findFirstOrThrow({ where: { returnId: seededId(putusReturnId) } });
    await receiveFieldReturn({
      returnId: putusReturnId,
      receivedById: adminId,
      counts: [{ lineId: linePutus.id, receivedQty: 4, sellableQty: 4, rejectedQty: 0 }],
    });

    /* Retur O — KONSI store, item shortItemId, claimed == received == 6. StoreStock only holds 2,
       so the decrement must drive it to -4 rather than refuse. */
    const createdShortStore = await mkReturn({ itemId: shortItemId, qty: 6, reason: "UNSOLD", storeId: konsiStoreId });
    shortStoreReturnId = createdShortStore.returnId;
    const lineShortStore = await prisma.fieldReturnLine.findFirstOrThrow({ where: { returnId: seededId(shortStoreReturnId) } });
    await receiveFieldReturn({
      returnId: shortStoreReturnId,
      receivedById: adminId,
      counts: [{ lineId: lineShortStore.id, receivedQty: 6, sellableQty: 6, rejectedQty: 0 }],
    });

    /* Retur P — KONSI store, item neverHeldItemId, claimed == received == 6, with NO StoreStock
       row at all for this store+item — the decrement must CREATE one at -6, not refuse. */
    const createdNeverHeld = await mkReturn({ itemId: neverHeldItemId, qty: 6, reason: "UNSOLD", storeId: konsiStoreId });
    neverHeldReturnId = createdNeverHeld.returnId;
    const lineNeverHeld = await prisma.fieldReturnLine.findFirstOrThrow({ where: { returnId: seededId(neverHeldReturnId) } });
    await receiveFieldReturn({
      returnId: neverHeldReturnId,
      receivedById: adminId,
      counts: [{ lineId: lineNeverHeld.id, receivedQty: 6, sellableQty: 6, rejectedQty: 0 }],
    });

    /* Retur Q — KONSI store, item konsiSurplusItemId, claimed 4, received 6 (surplus of 2),
       settled ACCEPT_SURPLUS -> creditedQty is the RECEIVED qty (6), not the claimed one (4).
       StoreStock seeded 10. */
    const createdKonsiSurplus = await mkReturn({ itemId: konsiSurplusItemId, qty: 4, reason: "UNSOLD", storeId: konsiStoreId });
    konsiSurplusReturnId = createdKonsiSurplus.returnId;
    const lineKonsiSurplus = await prisma.fieldReturnLine.findFirstOrThrow({ where: { returnId: seededId(konsiSurplusReturnId) } });
    konsiSurplusLineId = lineKonsiSurplus.id;
    await receiveFieldReturn({
      returnId: konsiSurplusReturnId,
      receivedById: adminId,
      counts: [{ lineId: konsiSurplusLineId, receivedQty: 6, sellableQty: 6, rejectedQty: 0 }],
    });
    await resolveFieldReturnLine({ lineId: konsiSurplusLineId, type: "ACCEPT_SURPLUS", createdById: adminId });

    /* Retur R — KONSI store, item konsiBearsItemId, claimed 6, received 4, sellable 4, settled
       SALESMAN_BEARS -> creditedQty is the CLAIMED qty (6), not sellableQty/receivedQty (4).
       StoreStock seeded 10. */
    const createdKonsiBears = await mkReturn({ itemId: konsiBearsItemId, qty: 6, reason: "DAMAGED", storeId: konsiStoreId });
    konsiBearsReturnId = createdKonsiBears.returnId;
    const lineKonsiBears = await prisma.fieldReturnLine.findFirstOrThrow({ where: { returnId: seededId(konsiBearsReturnId) } });
    konsiBearsLineId = lineKonsiBears.id;
    await receiveFieldReturn({
      returnId: konsiBearsReturnId,
      receivedById: adminId,
      counts: [{ lineId: konsiBearsLineId, receivedQty: 4, sellableQty: 4, rejectedQty: 0 }],
    });
    await resolveFieldReturnLine({ lineId: konsiBearsLineId, type: "SALESMAN_BEARS", createdById: adminId });
  });

  afterEach(async () => {
    const itemIds = [
      seededId(itemId),
      seededId(shortItemId),
      seededId(noRowItemId),
      seededId(unpricedItemId),
      seededId(ambiguousItemId),
      seededId(neverHeldItemId),
      seededId(konsiSurplusItemId),
      seededId(konsiBearsItemId),
    ];
    const returnIds = [
      seededId(returnId),
      seededId(mismatchedReturnId),
      seededId(shortReturnId),
      seededId(rejectedReturnId),
      seededId(fullyRejectedReturnId),
      seededId(noRowReturnId),
      seededId(surplusReturnId),
      seededId(unpricedReturnId),
      seededId(ambiguousReturnId),
      seededId(investigatingReturnId),
      seededId(writeOffReturnId),
      seededId(twoLineReturnId),
      seededId(konsiReturnId),
      seededId(putusReturnId),
      seededId(shortStoreReturnId),
      seededId(neverHeldReturnId),
      seededId(konsiSurplusReturnId),
      seededId(konsiBearsReturnId),
    ];
    const storeIds = [seededId(storeId), seededId(konsiStoreId)];
    await prisma.stockAdjustment.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.rejectedGoodsLedger.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.storeStock.deleteMany({ where: { storeId: { in: storeIds } } });
    await prisma.fieldReturnResolution.deleteMany({ where: { line: { returnId: { in: returnIds } } } });
    await prisma.fieldReturnLine.deleteMany({ where: { returnId: { in: returnIds } } });
    await prisma.fieldReturn.deleteMany({ where: { id: { in: returnIds } } });
    /* Delivery lines before deliveries, order lines before orders — FieldSalesDeliveryLine's
       orderLineId FK is real and enforced. */
    await prisma.fieldSalesDeliveryLine.deleteMany({ where: { deliveryId: { in: deliveryIds } } });
    await prisma.fieldSalesDelivery.deleteMany({ where: { id: { in: deliveryIds } } });
    await prisma.fieldSalesOrderLine.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.fieldSalesOrder.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.store.deleteMany({ where: { id: { in: storeIds } } });
    await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.user.deleteMany({ where: { id: { in: [seededId(raisedById), seededId(adminId)] } } });
  });

  it("refuses a retur whose status has drifted out of sync with its lines", async () => {
    await expect(approveFieldReturn({ returnId: mismatchedReturnId, approvedById: adminId }))
      .rejects.toMatchObject({ code: "UNRESOLVED_LINES" });
  });

  it("refuses a nonexistent retur with NOT_FOUND, not INVALID_STATE", async () => {
    /* Syntactically cuid-shaped but never seeded — must not be created and then deleted. */
    const unseededReturnId = "clnonexistentreturnid00000000";
    await expect(approveFieldReturn({ returnId: unseededReturnId, approvedById: adminId }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("restores sellableQty to qtyOnHand", async () => {
    const before = await prisma.inventoryValue.findFirstOrThrow({ where: { itemId: seededId(itemId) } });
    await approveFieldReturn({ returnId, approvedById: adminId });
    const after = await prisma.inventoryValue.findFirstOrThrow({ where: { itemId: seededId(itemId) } });
    expect(Number(after.qtyOnHand)).toBe(Number(before.qtyOnHand) + 12);
  });

  it("does not fork a phantom variantSku row on the OR-tolerant lookup", async () => {
    await approveFieldReturn({ returnId, approvedById: adminId });
    const count = await prisma.inventoryValue.count({ where: { itemId: seededId(itemId) } });
    expect(count).toBe(1);
  });

  it("restores stock at the current average cost, unchanged — never a blend", async () => {
    const before = await prisma.inventoryValue.findFirstOrThrow({ where: { itemId: seededId(itemId) } });
    await approveFieldReturn({ returnId, approvedById: adminId });
    const after = await prisma.inventoryValue.findFirstOrThrow({ where: { itemId: seededId(itemId) } });
    expect(Number(after.avgCost)).toBe(Number(before.avgCost));
    expect(Number(after.totalValue)).toBe(Number(after.qtyOnHand) * Number(after.avgCost));
  });

  it("lands a brand-new inventory row at avgCost 0 when none existed", async () => {
    const beforeCount = await prisma.inventoryValue.count({ where: { itemId: seededId(noRowItemId) } });
    expect(beforeCount).toBe(0);
    await approveFieldReturn({ returnId: noRowReturnId, approvedById: adminId });
    const after = await prisma.inventoryValue.findFirstOrThrow({ where: { itemId: seededId(noRowItemId) } });
    expect(Number(after.qtyOnHand)).toBe(4);
    expect(Number(after.avgCost)).toBe(0);
    expect(Number(after.totalValue)).toBe(0);
    /* A fresh variantless row must land at null, not "" — the shape the OR-tolerant lookup
       (and every other writer) expects, not a phantom "" row alongside a null one. */
    expect(after.variantSku).toBeNull();
  });

  it("stamps approvedAt and approvedById on approve", async () => {
    await approveFieldReturn({ returnId, approvedById: adminId });
    const row = await prisma.fieldReturn.findUniqueOrThrow({ where: { id: seededId(returnId) } });
    expect(row.approvedAt).not.toBeNull();
    expect(row.approvedById).toBe(adminId);
  });

  it("writes a POSITIVE StockAdjustment sourced FIELD_RETURN with the real before/after qty and cost", async () => {
    const before = await prisma.inventoryValue.findFirstOrThrow({ where: { itemId: seededId(itemId) } });
    await approveFieldReturn({ returnId, approvedById: adminId });
    const adj = await prisma.stockAdjustment.findFirstOrThrow({ where: { itemId: seededId(itemId), source: "FIELD_RETURN" } });
    expect(adj.type).toBe("POSITIVE");
    expect(Number(adj.qtyChange)).toBe(12);
    expect(Number(adj.prevQty)).toBe(Number(before.qtyOnHand));
    expect(Number(adj.newQty)).toBe(Number(before.qtyOnHand) + 12);
    expect(Number(adj.prevAvgCost)).toBe(Number(before.avgCost));
    expect(Number(adj.newAvgCost)).toBe(Number(before.avgCost));
  });

  it("writes no StockAdjustment when a line's sellableQty is zero", async () => {
    await approveFieldReturn({ returnId: fullyRejectedReturnId, approvedById: adminId });
    const count = await prisma.stockAdjustment.count({ where: { itemId: seededId(itemId), source: "FIELD_RETURN" } });
    expect(count).toBe(0);
  });

  it("restores the RECEIVED quantity, not the claimed one", async () => {
    /* claimed 12, received 10, settled by SALESMAN_BEARS */
    const before = await prisma.inventoryValue.findFirstOrThrow({ where: { itemId: seededId(shortItemId) } });
    await approveFieldReturn({ returnId: shortReturnId, approvedById: adminId });
    const after = await prisma.inventoryValue.findFirstOrThrow({ where: { itemId: seededId(shortItemId) } });
    expect(Number(after.qtyOnHand)).toBe(Number(before.qtyOnHand) + 10);
  });

  it("routes rejectedQty to the rejected ledger with variantSku normalised to null", async () => {
    await approveFieldReturn({ returnId: rejectedReturnId, approvedById: adminId });
    const led = await prisma.rejectedGoodsLedger.findFirstOrThrow({ where: { itemId: seededId(itemId), refType: "FIELD_RETURN" } });
    expect(Number(led.qty)).toBe(2);
    expect(led.variantSku).toBeNull();
  });

  it("does not add rejected units to sellable stock", async () => {
    const before = await prisma.inventoryValue.findFirstOrThrow({ where: { itemId: seededId(itemId) } });
    await approveFieldReturn({ returnId: rejectedReturnId, approvedById: adminId });
    const after = await prisma.inventoryValue.findFirstOrThrow({ where: { itemId: seededId(itemId) } });
    /* received 3 = 1 sellable + 2 rejected; only the 1 lands in stock */
    expect(Number(after.qtyOnHand)).toBe(Number(before.qtyOnHand) + 1);
  });

  it("writes no RejectedGoodsLedger row when a line's rejectedQty is zero", async () => {
    await approveFieldReturn({ returnId, approvedById: adminId });
    const count = await prisma.rejectedGoodsLedger.count({ where: { itemId: seededId(itemId) } });
    expect(count).toBe(0);
  });

  it("refuses a second approve", async () => {
    await approveFieldReturn({ returnId, approvedById: adminId });
    await expect(approveFieldReturn({ returnId, approvedById: adminId }))
      .rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("stamps the line value from the delivered price", async () => {
    await approveFieldReturn({ returnId, approvedById: adminId });
    const line = await prisma.fieldReturnLine.findUniqueOrThrow({ where: { id: seededId(lineId) } });
    expect(Number(line.lineValue)).toBe(10_000_000);
    expect(line.priceSource).toBe("DELIVERY");
    expect(line.priceDeliveryLineId).toBe(deliveryLineId);
  });

  it("ties out exactly even though the unit price does not multiply back", async () => {
    await approveFieldReturn({ returnId, approvedById: adminId });
    const line = await prisma.fieldReturnLine.findUniqueOrThrow({ where: { id: seededId(lineId) } });
    /* 10.000.000 / 12 = 833.333,33 at 2dp, and 12 x 833.333,33 = 9.999.999,96 */
    expect(Number(line.unitPrice)).toBe(833_333.33);
    expect(Number(line.lineValue)).toBe(10_000_000);
    expect(Number(line.creditedQty) * Number(line.unitPrice)).not.toBe(Number(line.lineValue));
  });

  it("credits the CLAIMED qty when the salesman bears the shortfall", async () => {
    /* claimed 12, received 10, settled SALESMAN_BEARS */
    await approveFieldReturn({ returnId: shortReturnId, approvedById: adminId });
    const line = await prisma.fieldReturnLine.findUniqueOrThrow({ where: { id: seededId(shortLineId) } });
    expect(line.creditedQty).toBe(12);
    expect(Number(line.lineValue)).toBe(10_000_000);
  });

  it("stamps what the salesman owes on the resolution that settled it", async () => {
    await approveFieldReturn({ returnId: shortReturnId, approvedById: adminId });
    const res = await prisma.fieldReturnResolution.findFirstOrThrow({
      where: { lineId: seededId(shortLineId) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    /* 2 missing units at 833.333,3333 */
    expect(Number(res.amount)).toBe(1_666_666.67);
  });

  it("stamps the company's write-off expense on the resolution that settled it", async () => {
    /* claimed 12, received 10, settled WRITE_OFF — same numbers as SALESMAN_BEARS above, the
       OTHER settling type on the amount branch. Deleting WRITE_OFF from that branch's
       condition leaves this test as the only thing that would catch it. */
    await approveFieldReturn({ returnId: writeOffReturnId, approvedById: adminId });
    const res = await prisma.fieldReturnResolution.findFirstOrThrow({
      where: { lineId: seededId(writeOffLineId) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    expect(Number(res.amount)).toBe(1_666_666.67);
  });

  it("stamps no amount on an accepted surplus", async () => {
    await approveFieldReturn({ returnId: surplusReturnId, approvedById: adminId });
    const res = await prisma.fieldReturnResolution.findFirstOrThrow({
      where: { lineId: seededId(surplusLineId) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    expect(res.amount).toBeNull();
  });

  it("sums the header total and marks the retur VALUED", async () => {
    await approveFieldReturn({ returnId, approvedById: adminId });
    const row = await prisma.fieldReturn.findUniqueOrThrow({ where: { id: seededId(returnId) } });
    expect(Number(row.totalValue)).toBe(10_000_000);
    expect(row.valuationStatus).toBe("VALUED");
  });

  it("credits the store for the full received qty even when part of it is rejected", async () => {
    /* Retur D: claimed 3 == received 3, split 1 sellable / 2 rejected. Damage is the
       company's to absorb, not the store's — the store is credited for all 3 it sent back,
       not just the 1 that landed back in sellable stock. */
    await approveFieldReturn({ returnId: rejectedReturnId, approvedById: adminId });
    const line = await prisma.fieldReturnLine.findUniqueOrThrow({ where: { id: seededId(rejectedLineId) } });
    expect(line.creditedQty).toBe(3);
    expect(Number(line.lineValue)).toBe(2_500_000);
  });

  it("totalValue is null when only one of several lines can be priced, though that line still gets its own lineValue", async () => {
    /*
     * A single-line retur can't distinguish "sums correctly" from "just copies the one
     * line's value" (total = lineValue passes either way), and can't distinguish
     * null-when-any-unpriced from a partial sum (there is nothing else to leave out). This
     * retur has one priceable line (itemId, 5 units against the 12-pcs delivery) and one
     * that can never be priced (unpricedItemId, never delivered).
     */
    await approveFieldReturn({ returnId: twoLineReturnId, approvedById: adminId });
    const priced = await prisma.fieldReturnLine.findUniqueOrThrow({ where: { id: seededId(twoLinePricedLineId) } });
    const unpriced = await prisma.fieldReturnLine.findUniqueOrThrow({ where: { id: seededId(twoLineUnpricedLineId) } });
    const row = await prisma.fieldReturn.findUniqueOrThrow({ where: { id: seededId(twoLineReturnId) } });
    expect(Number(priced.lineValue)).toBe(4_166_666.67);
    expect(unpriced.lineValue).toBeNull();
    expect(row.totalValue).toBeNull();
    expect(row.valuationStatus).toBe("PENDING");
  });

  it("approves and restores stock even when a line cannot be priced", async () => {
    const before = await prisma.inventoryValue.findFirstOrThrow({ where: { itemId: seededId(unpricedItemId) } });
    await approveFieldReturn({ returnId: unpricedReturnId, approvedById: adminId });
    const row = await prisma.fieldReturn.findUniqueOrThrow({ where: { id: seededId(unpricedReturnId) } });
    const after = await prisma.inventoryValue.findFirstOrThrow({ where: { itemId: seededId(unpricedItemId) } });
    expect(row.status).toBe("APPROVED");
    expect(row.valuationStatus).toBe("PENDING");
    expect(row.totalValue).toBeNull();
    expect(Number(after.qtyOnHand)).toBe(Number(before.qtyOnHand) + 3);
  });

  it("leaves an ambiguous line unpriced rather than guessing", async () => {
    await approveFieldReturn({ returnId: ambiguousReturnId, approvedById: adminId });
    const line = await prisma.fieldReturnLine.findUniqueOrThrow({ where: { id: seededId(ambiguousLineId) } });
    expect(line.lineValue).toBeNull();
    expect(line.priceSource).toBeNull();
  });

  it("honours a price an admin already retargeted", async () => {
    /*
     * Retarget to the EXPENSIVE delivery (1 pc for 3.000.000), not the cheap one (3 pcs for
     * 6.000.000, the same qty as the 3 credited units here). If lineValue were wired straight
     * to the target delivery's own lineTotal instead of creditedQty * effectiveUnitPrice, the
     * cheap delivery's 6.000.000 would pass by coincidence (3 credited == 3 delivered). The
     * expensive delivery's qty (1) differs from the credited qty (3), so only a genuine
     * multiplication produces the expected 3 x 3.000.000 = 9.000.000.
     */
    await prisma.fieldReturnLine.update({
      where: { id: seededId(ambiguousLineId) },
      data: { priceSource: "DELIVERY", priceDeliveryLineId: expensiveDeliveryLineId },
    });
    await approveFieldReturn({ returnId: ambiguousReturnId, approvedById: adminId });
    const line = await prisma.fieldReturnLine.findUniqueOrThrow({ where: { id: seededId(ambiguousLineId) } });
    expect(line.priceDeliveryLineId).toBe(expensiveDeliveryLineId);
    expect(Number(line.lineValue)).toBe(9_000_000);
  });

  it("preserves a dangling admin price choice rather than wiping its provenance", async () => {
    /*
     * The admin's priceDeliveryLineId points at a delivery line that does not exist (deleted,
     * or never existed) — a recorded choice that failed to resolve, not an absence of one.
     * The line must stay unpriced (goods still move; nothing is stamped), but priceSource,
     * priceDeliveryLineId and priceNote must survive exactly as the admin left them, on a
     * terminal APPROVED retur with no UI path back to re-enter them.
     */
    const danglingDeliveryLineId = "clnonexistentdeliveryline0000";
    await prisma.fieldReturnLine.update({
      where: { id: seededId(ambiguousLineId) },
      data: { priceSource: "DELIVERY", priceDeliveryLineId: danglingDeliveryLineId, priceNote: "dari nota lama" },
    });
    await approveFieldReturn({ returnId: ambiguousReturnId, approvedById: adminId });
    const row = await prisma.fieldReturn.findUniqueOrThrow({ where: { id: seededId(ambiguousReturnId) } });
    const line = await prisma.fieldReturnLine.findUniqueOrThrow({ where: { id: seededId(ambiguousLineId) } });
    expect(row.status).toBe("APPROVED");
    expect(line.priceSource).toBe("DELIVERY");
    expect(line.priceDeliveryLineId).toBe(danglingDeliveryLineId);
    expect(line.priceNote).toBe("dari nota lama");
    expect(line.lineValue).toBeNull();
    /*
     * creditedQty is a units fact independent of whose price choice won — it must still be
     * stamped even though the price provenance is preserved untouched. Retur I is claimed 3 ==
     * received 3 (no variance), so the credited qty is the received qty, 3. Before this fix the
     * whole update was skipped whenever preserveAdminChoice held, so this would have stayed
     * null forever on a terminal APPROVED retur with no way back in to fix it.
     */
    expect(line.creditedQty).toBe(3);
  });

  it("honours a manual price and keeps its note", async () => {
    await prisma.fieldReturnLine.update({
      where: { id: seededId(unpricedLineId) },
      data: { priceSource: "MANUAL", unitPrice: 500_000, priceNote: "harga nota lama" },
    });
    await approveFieldReturn({ returnId: unpricedReturnId, approvedById: adminId });
    const line = await prisma.fieldReturnLine.findUniqueOrThrow({ where: { id: seededId(unpricedLineId) } });
    expect(Number(line.lineValue)).toBe(1_500_000);
    expect(line.priceSource).toBe("MANUAL");
    expect(line.priceNote).toBe("harga nota lama");
  });

  it("honours a genuine manual price of exactly 0 rather than discarding it as unset", async () => {
    /*
     * setLinePriceAction refuses to WRITE a manual price <= 0, so this row only exists via
     * hand-run SQL against a MANUAL-sourced line — exactly the scenario the writer's own
     * `unitPrice !== null` comment defends against. Before that fix, `if (line.unitPrice)` was
     * falsy for a Prisma Decimal of 0 (an object, but its own truthiness check on a Decimal
     * instance is unrelated to the numeric value it wraps in a way that made 0 look "unset"),
     * so this would have wrongly hit preserveAdminChoice and left the line unpriced instead of
     * honouring the recorded (if unusual) zero price.
     */
    await prisma.fieldReturnLine.update({
      where: { id: seededId(unpricedLineId) },
      data: { priceSource: "MANUAL", unitPrice: 0, priceNote: "harga nol dari hand-run SQL" },
    });
    await approveFieldReturn({ returnId: unpricedReturnId, approvedById: adminId });
    const line = await prisma.fieldReturnLine.findUniqueOrThrow({ where: { id: seededId(unpricedLineId) } });
    expect(line.priceSource).toBe("MANUAL");
    expect(Number(line.unitPrice)).toBe(0);
    expect(Number(line.lineValue)).toBe(0);
  });

  it("never values a retur held under investigation — it cannot reach approval at all", async () => {
    /*
     * INVESTIGATE is non-settling, so the retur holds in MISMATCH_PENDING_RESOLUTION and
     * approveFieldReturn refuses it (INVALID_STATE) before the valuation loop ever runs. This
     * pins the refusal itself, and that the line's valuation columns are left untouched as a
     * consequence of never reaching that loop — not a claim that creditedQtyForLine's own
     * null-for-INVESTIGATE behaviour is exercised here (that is variance.test.ts's job).
     */
    await expect(approveFieldReturn({ returnId: investigatingReturnId, approvedById: adminId }))
      .rejects.toMatchObject({ code: "INVALID_STATE" });
    const line = await prisma.fieldReturnLine.findUniqueOrThrow({ where: { id: seededId(investigatingLineId) } });
    expect(line.lineValue).toBeNull();
    expect(line.creditedQty).toBeNull();
  });

  it("freezes the value — changing the delivery price afterwards does not move it", async () => {
    await approveFieldReturn({ returnId, approvedById: adminId });
    await prisma.fieldSalesDeliveryLine.update({
      where: { id: seededId(deliveryLineId) },
      data: { lineTotal: 1 },
    });
    /*
     * A raw findUniqueOrThrow on FieldReturnLine only proves the stored column never changed —
     * that passes under ANY implementation, since nothing re-runs approveFieldReturn between
     * the mutation and the read and lineValue is a stored column, not a computed one. Re-read
     * through getFieldReturnById instead: it is the one path that recomputes a still-open
     * line's price from live candidates (isOpenForPricing), so this is only genuinely
     * falsifiable if getFieldReturnById itself ever started re-deriving an APPROVED line's
     * value from the (now-mutated) delivery instead of returning the frozen stored one.
     */
    const detail = await getFieldReturnById(seededId(returnId));
    const line = detail?.lines.find((l) => l.id === seededId(lineId));
    expect(line?.unitPrice).toBe(833_333.33);
    expect(line?.lineValue).toBe(10_000_000);
  });

  it("decrements StoreStock by creditedQty when the store is KONSI", async () => {
    await approveFieldReturn({ returnId: konsiReturnId, approvedById: adminId });
    const ss = await prisma.storeStock.findFirstOrThrow({
      where: { storeId: seededId(konsiStoreId), itemId: seededId(itemId) },
    });
    expect(Number(ss.qty)).toBe(4); /* seeded 10, credited 6 */
  });

  it("leaves StoreStock untouched for a PUTUS store's retur", async () => {
    /* the PUTUS store has a StoreStock row seeded deliberately, so this cannot pass vacuously */
    const before = await prisma.storeStock.findFirstOrThrow({
      where: { storeId: seededId(putusStoreId), itemId: seededId(itemId) },
    });
    await approveFieldReturn({ returnId: putusReturnId, approvedById: adminId });
    const after = await prisma.storeStock.findFirstOrThrow({
      where: { storeId: seededId(putusStoreId), itemId: seededId(itemId) },
    });
    expect(Number(after.qty)).toBe(Number(before.qty));
  });

  it("drives the row NEGATIVE rather than refusing when the store does not hold the stock", async () => {
    /* store holds 2, retur credits 6 */
    await approveFieldReturn({ returnId: shortStoreReturnId, approvedById: adminId });
    const ss = await prisma.storeStock.findFirstOrThrow({
      where: { storeId: seededId(konsiStoreId), itemId: seededId(shortItemId) },
    });
    expect(Number(ss.qty)).toBe(-4);
  });

  it("creates the StoreStock row at a negative qty when the store never held the item at all", async () => {
    await approveFieldReturn({ returnId: neverHeldReturnId, approvedById: adminId });
    const ss = await prisma.storeStock.findFirstOrThrow({
      where: { storeId: seededId(konsiStoreId), itemId: seededId(neverHeldItemId) },
    });
    expect(Number(ss.qty)).toBe(-6);
  });

  it("decrements by the RECEIVED qty on ACCEPT_SURPLUS, not the claimed qty", async () => {
    /* claimed 4, received 6, settled ACCEPT_SURPLUS -> creditedQty 6 */
    await approveFieldReturn({ returnId: konsiSurplusReturnId, approvedById: adminId });
    const ss = await prisma.storeStock.findFirstOrThrow({
      where: { storeId: seededId(konsiStoreId), itemId: seededId(konsiSurplusItemId) },
    });
    expect(Number(ss.qty)).toBe(4); /* seeded 10, credited 6 */
  });

  it("decrements by the CLAIMED qty under SALESMAN_BEARS, not sellableQty or receivedQty", async () => {
    /*
     * claimed 6, received 4, sellable 4, settled SALESMAN_BEARS -> creditedQty is the CLAIMED
     * qty (6), the store's paper says it sent 6. sellableQty and receivedQty both read 4 here on
     * purpose, so a decrement that reads either of THOSE instead of creditedQty would leave the
     * row at 6 (10 - 4), not the correct 4 (10 - 6) — silently passing every other case in this
     * file, since Retur M/O/P all have qty == receivedQty == sellableQty with no divergence to
     * catch a wrong field.
     */
    await approveFieldReturn({ returnId: konsiBearsReturnId, approvedById: adminId });
    const ss = await prisma.storeStock.findFirstOrThrow({
      where: { storeId: seededId(konsiStoreId), itemId: seededId(konsiBearsItemId) },
    });
    expect(Number(ss.qty)).toBe(4); /* seeded 10, credited 6 (claimed) */
  });
});
