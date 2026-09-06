import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { listAmplop } from "./amplop-queries";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const asOf = new Date("2026-06-01T00:00:00.000+07:00");

d("amplop queries (test bed only)", () => {
  /*
   * Regenerated per test, not once per describe: Store.code / FieldSalesOrder.orderNo /
   * FieldSalesDelivery.docNo are all @unique on this token, same reasoning as
   * apps/web/lib/finance/ar/queries.test.ts — a single leaked afterEach would fail every
   * remaining test in this file with P2002 on the shared bed.
   */
  let token = "";

  /* Users. */
  let collectorUserId = "";
  let salesmanUserId = "";
  let adminUserId = "";
  let bothRoleUserId = "";
  let multiStoreUserId = "";
  /* F7: has no receivables at all — pins the empty-amplop render. */
  let emptyUserId = "";

  /* Stores. */
  let collectorStoreId = "";
  let salesmanStoreId = "";
  let bothStoreId = "";
  let storeHighId = "";
  let storeMedId = "";
  let storeLowId = "";
  /* F4: tied with storeLowId at totalOverdue 0, named to sort before it — the name tiebreak. */
  let storeZeroId = "";

  /* collectorStoreId's four receivables: a WRITTEN_OFF row, a PAID row, a row with no
   * TaxInvoice, and a row carrying a PENDING CollectionSubmission. Each has its own
   * order/delivery. */
  let writtenOffOrderId = "";
  let writtenOffDeliveryId = "";
  let writtenOffReceivableId = "";

  let paidOrderId = "";
  let paidDeliveryId = "";
  let paidReceivableId = "";

  let noFakturOrderId = "";
  let noFakturDeliveryId = "";
  let noFakturReceivableId = "";

  let submittedOrderId = "";
  let submittedDeliveryId = "";
  let submittedReceivableId = "";
  let submittedTaxInvoiceId = "";
  let submissionId = "";

  /* salesmanStoreId: one receivable, delivered by adminUserId, ordered by salesmanUserId. */
  let salesmanOrderId = "";
  let salesmanDeliveryId = "";
  let salesmanReceivableId = "";

  /* bothStoreId: one receivable where bothRoleUserId is both the collector and the salesman. */
  let bothOrderId = "";
  let bothDeliveryId = "";
  let bothReceivableId = "";

  /* Three stores for multiStoreUserId, with three distinct totalOverdue figures. */
  let storeHighOrderId = "";
  let storeHighDeliveryId = "";
  let storeHighReceivableId = "";

  let storeMedOrderId = "";
  let storeMedDeliveryId = "";
  let storeMedReceivableId = "";

  let storeLowOrderId = "";
  let storeLowDeliveryId = "";
  let storeLowReceivableId = "";

  let storeZeroOrderId = "";
  let storeZeroDeliveryId = "";
  let storeZeroReceivableId = "";

  /* One FieldReturn against collectorStoreId, partially drawn down. */
  let returId = "";
  let itemId = "";
  let uomId = "";

  const remainingCreditForFixture = 300;
  const pendingAmountForFixture = 150;

  beforeEach(async () => {
    token = Math.random().toString(36).slice(2, 10);

    collectorUserId = ""; salesmanUserId = ""; adminUserId = ""; bothRoleUserId = ""; multiStoreUserId = ""; emptyUserId = "";
    collectorStoreId = ""; salesmanStoreId = ""; bothStoreId = ""; storeHighId = ""; storeMedId = ""; storeLowId = ""; storeZeroId = "";
    writtenOffOrderId = ""; writtenOffDeliveryId = ""; writtenOffReceivableId = "";
    paidOrderId = ""; paidDeliveryId = ""; paidReceivableId = "";
    noFakturOrderId = ""; noFakturDeliveryId = ""; noFakturReceivableId = "";
    submittedOrderId = ""; submittedDeliveryId = ""; submittedReceivableId = ""; submittedTaxInvoiceId = ""; submissionId = "";
    salesmanOrderId = ""; salesmanDeliveryId = ""; salesmanReceivableId = "";
    bothOrderId = ""; bothDeliveryId = ""; bothReceivableId = "";
    storeHighOrderId = ""; storeHighDeliveryId = ""; storeHighReceivableId = "";
    storeMedOrderId = ""; storeMedDeliveryId = ""; storeMedReceivableId = "";
    storeLowOrderId = ""; storeLowDeliveryId = ""; storeLowReceivableId = "";
    storeZeroOrderId = ""; storeZeroDeliveryId = ""; storeZeroReceivableId = "";
    returId = ""; itemId = ""; uomId = "";

    const [collectorUser, salesmanUser, adminUser, bothRoleUser, multiStoreUser, emptyUser] = await Promise.all([
      prisma.user.create({ data: { email: `amplop-collector-${token}@test.local`, name: `Collector ${token}` } }),
      prisma.user.create({ data: { email: `amplop-salesman-${token}@test.local`, name: `Salesman ${token}` } }),
      prisma.user.create({ data: { email: `amplop-admin-${token}@test.local`, name: `Admin ${token}`, role: "ADMIN" } }),
      prisma.user.create({ data: { email: `amplop-both-${token}@test.local`, name: `Both ${token}` } }),
      prisma.user.create({ data: { email: `amplop-multi-${token}@test.local`, name: `Multi ${token}` } }),
      prisma.user.create({ data: { email: `amplop-empty-${token}@test.local`, name: `Empty ${token}` } }),
    ]);
    collectorUserId = collectorUser.id;
    salesmanUserId = salesmanUser.id;
    adminUserId = adminUser.id;
    bothRoleUserId = bothRoleUser.id;
    multiStoreUserId = multiStoreUser.id;
    emptyUserId = emptyUser.id;

    const [collectorStore, salesmanStore, bothStore, storeHigh, storeMed, storeLow, storeZero] = await Promise.all([
      prisma.store.create({ data: { code: `TEST-AMP-COL-${token}`, name: `Toko Collector ${token}`, address: "test", termsType: "PUTUS" } }),
      prisma.store.create({ data: { code: `TEST-AMP-SLS-${token}`, name: `Toko Salesman ${token}`, address: "test", termsType: "PUTUS" } }),
      prisma.store.create({ data: { code: `TEST-AMP-BOTH-${token}`, name: `Toko Both ${token}`, address: "test", termsType: "PUTUS" } }),
      prisma.store.create({ data: { code: `TEST-AMP-HIGH-${token}`, name: `Toko High ${token}`, address: "test", termsType: "PUTUS" } }),
      prisma.store.create({ data: { code: `TEST-AMP-MED-${token}`, name: `Toko Med ${token}`, address: "test", termsType: "PUTUS" } }),
      prisma.store.create({ data: { code: `TEST-AMP-LOW-${token}`, name: `Toko Low ${token}`, address: "test", termsType: "PUTUS" } }),
      /* Name sorts before "Toko Low ..." so the totalOverdue-0 tie between the two is broken by
       * name ascending, not by insertion order. */
      prisma.store.create({ data: { code: `TEST-AMP-ZERO-${token}`, name: `Toko AAA Zero ${token}`, address: "test", termsType: "PUTUS" } }),
    ]);
    collectorStoreId = collectorStore.id;
    salesmanStoreId = salesmanStore.id;
    bothStoreId = bothStore.id;
    storeHighId = storeHigh.id;
    storeMedId = storeMed.id;
    storeLowId = storeLow.id;
    storeZeroId = storeZero.id;

    /*
     * Helper to seed one order -> delivery -> receivable chain. Mirrors the shape
     * apps/web/lib/finance/ar/queries.test.ts already seeds. `deliveredById` defaults to
     * `adminUserId` since only the salesman-vs-deliveredById test cares which user recorded the
     * delivery — every other chain just needs a real user to satisfy the FK.
     */
    const mkChain = async (params: {
      tag: string;
      storeId: string;
      salesmanId: string;
      deliveredById?: string;
      collectorId?: string;
      dueDate: Date;
      amount: number;
      status?: "OUTSTANDING" | "PARTIAL" | "PAID" | "WRITTEN_OFF";
      outstandingOverride?: number;
    }) => {
      const order = await prisma.fieldSalesOrder.create({
        data: {
          orderNo: `TEST-AMP-ORD-${params.tag}-${token}`,
          storeId: params.storeId,
          salesmanId: params.salesmanId,
          subtotal: params.amount,
          total: params.amount,
        },
      });
      const delivery = await prisma.fieldSalesDelivery.create({
        data: {
          docNo: `TEST-AMP-DLV-${params.tag}-${token}`,
          orderId: order.id,
          deliveredAt: params.dueDate,
          deliveredById: params.deliveredById ?? adminUserId,
          invoiceDate: params.dueDate,
          dueDate: params.dueDate,
          subtotal: params.amount,
          total: params.amount,
        },
      });
      const outstanding = params.outstandingOverride ?? (params.status === "PAID" || params.status === "WRITTEN_OFF" ? 0 : params.amount);
      const receivable = await prisma.receivable.create({
        data: {
          deliveryId: delivery.id,
          storeId: params.storeId,
          invoiceDate: params.dueDate,
          dueDate: params.dueDate,
          originalAmount: params.amount,
          outstandingAmount: outstanding,
          status: params.status ?? "OUTSTANDING",
          collectorId: params.collectorId,
        },
      });
      return { orderId: order.id, deliveryId: delivery.id, receivableId: receivable.id };
    };

    const writtenOff = await mkChain({
      tag: "WOFF", storeId: collectorStoreId, salesmanId: adminUserId, collectorId: collectorUserId,
      dueDate: new Date("2026-04-01T00:00:00.000+07:00"), amount: 500, status: "WRITTEN_OFF",
    });
    writtenOffOrderId = writtenOff.orderId; writtenOffDeliveryId = writtenOff.deliveryId; writtenOffReceivableId = writtenOff.receivableId;

    const paid = await mkChain({
      tag: "PAID", storeId: collectorStoreId, salesmanId: adminUserId, collectorId: collectorUserId,
      dueDate: new Date("2026-04-15T00:00:00.000+07:00"), amount: 500, status: "PAID",
    });
    paidOrderId = paid.orderId; paidDeliveryId = paid.deliveryId; paidReceivableId = paid.receivableId;

    const noFaktur = await mkChain({
      tag: "NOFK", storeId: collectorStoreId, salesmanId: adminUserId, collectorId: collectorUserId,
      dueDate: new Date("2026-07-01T00:00:00.000+07:00"), amount: 400,
    });
    noFakturOrderId = noFaktur.orderId; noFakturDeliveryId = noFaktur.deliveryId; noFakturReceivableId = noFaktur.receivableId;

    const submitted = await mkChain({
      tag: "SUBM", storeId: collectorStoreId, salesmanId: adminUserId, collectorId: collectorUserId,
      dueDate: new Date("2026-05-01T00:00:00.000+07:00"), amount: 600,
    });
    submittedOrderId = submitted.orderId; submittedDeliveryId = submitted.deliveryId; submittedReceivableId = submitted.receivableId;

    const taxInvoice = await prisma.taxInvoice.create({
      data: { deliveryId: submittedDeliveryId, status: "CREATED" },
    });
    submittedTaxInvoiceId = taxInvoice.id;

    const submission = await prisma.collectionSubmission.create({
      data: {
        receivableId: submittedReceivableId,
        collectorId: collectorUserId,
        amount: pendingAmountForFixture,
        method: "CASH",
        paidAt: asOf,
        status: "PENDING",
      },
    });
    submissionId = submission.id;

    /* salesmanStoreId: order raised by salesmanUserId, delivery COMPLETED by adminUserId — the
     * expedition-completed-by-backoffice-admin shape this feature must not key on. */
    const salesmanChain = await mkChain({
      tag: "SLSM", storeId: salesmanStoreId, salesmanId: salesmanUserId, deliveredById: adminUserId,
      dueDate: new Date("2026-05-10T00:00:00.000+07:00"), amount: 700,
    });
    salesmanOrderId = salesmanChain.orderId; salesmanDeliveryId = salesmanChain.deliveryId; salesmanReceivableId = salesmanChain.receivableId;

    /* bothStoreId: bothRoleUserId is both the order's salesman and the receivable's collector. */
    const bothChain = await mkChain({
      tag: "BOTH", storeId: bothStoreId, salesmanId: bothRoleUserId, collectorId: bothRoleUserId,
      dueDate: new Date("2026-05-10T00:00:00.000+07:00"), amount: 300,
    });
    bothOrderId = bothChain.orderId; bothDeliveryId = bothChain.deliveryId; bothReceivableId = bothChain.receivableId;

    /* Four stores, all collected by multiStoreUserId: storeHigh/storeMed/storeLow give three
     * distinct totalOverdue figures (1000/300/0), and storeZero ties storeLow at 0 to exercise
     * the name-ascending tiebreak (F4). */
    const storeHighChain = await mkChain({
      tag: "HIGH", storeId: storeHighId, salesmanId: adminUserId, collectorId: multiStoreUserId,
      dueDate: new Date("2026-01-01T00:00:00.000+07:00"), amount: 1000,
    });
    storeHighOrderId = storeHighChain.orderId; storeHighDeliveryId = storeHighChain.deliveryId; storeHighReceivableId = storeHighChain.receivableId;

    const storeMedChain = await mkChain({
      tag: "MED", storeId: storeMedId, salesmanId: adminUserId, collectorId: multiStoreUserId,
      dueDate: new Date("2026-05-15T00:00:00.000+07:00"), amount: 300,
    });
    storeMedOrderId = storeMedChain.orderId; storeMedDeliveryId = storeMedChain.deliveryId; storeMedReceivableId = storeMedChain.receivableId;

    const storeLowChain = await mkChain({
      tag: "LOW", storeId: storeLowId, salesmanId: adminUserId, collectorId: multiStoreUserId,
      dueDate: new Date("2026-07-01T00:00:00.000+07:00"), amount: 200,
    });
    storeLowOrderId = storeLowChain.orderId; storeLowDeliveryId = storeLowChain.deliveryId; storeLowReceivableId = storeLowChain.receivableId;

    const storeZeroChain = await mkChain({
      tag: "ZERO", storeId: storeZeroId, salesmanId: adminUserId, collectorId: multiStoreUserId,
      dueDate: new Date("2026-08-01T00:00:00.000+07:00"), amount: 150,
    });
    storeZeroOrderId = storeZeroChain.orderId; storeZeroDeliveryId = storeZeroChain.deliveryId; storeZeroReceivableId = storeZeroChain.receivableId;

    /* One partially-drawn retur against collectorStoreId: totalValue 500 - appliedValue 200 =
     * remainingCreditForFixture (300). */
    const uom = await prisma.uOM.create({ data: { code: `TEST-AMP-UOM-${token}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;
    const item = await prisma.item.create({
      data: { sku: `TEST-AMP-ITEM-${token}`, nameId: "Retur item", nameEn: "Retur item", type: "FINISHED_GOOD", uomId, isActive: true },
    });
    itemId = item.id;
    const fieldReturn = await prisma.fieldReturn.create({
      data: {
        docNo: `TEST-AMP-RET-${token}`,
        storeId: collectorStoreId,
        raisedById: collectorUserId,
        status: "APPROVED",
        valuationStatus: "VALUED",
        offsetStatus: "AVAILABLE",
        totalValue: 500,
        appliedValue: 200,
        approvedAt: asOf,
        approvedById: collectorUserId,
        lines: { create: [{ itemId, variantSku: "", qty: 1, reason: "UNSOLD" }] },
      },
    });
    returId = fieldReturn.id;
  });

  afterEach(async () => {
    await prisma.taxInvoice.deleteMany({ where: { id: seededId(submittedTaxInvoiceId) } });
    await prisma.collectionSubmission.deleteMany({ where: { id: seededId(submissionId) } });
    await prisma.fieldReturnLine.deleteMany({ where: { returnId: seededId(returId) } });
    await prisma.fieldReturn.deleteMany({ where: { id: seededId(returId) } });

    const receivableIds = [
      writtenOffReceivableId, paidReceivableId, noFakturReceivableId, submittedReceivableId,
      salesmanReceivableId, bothReceivableId, storeHighReceivableId, storeMedReceivableId, storeLowReceivableId,
      storeZeroReceivableId,
    ].map(seededId);
    await prisma.receivable.deleteMany({ where: { id: { in: receivableIds } } });

    const deliveryIds = [
      writtenOffDeliveryId, paidDeliveryId, noFakturDeliveryId, submittedDeliveryId,
      salesmanDeliveryId, bothDeliveryId, storeHighDeliveryId, storeMedDeliveryId, storeLowDeliveryId,
      storeZeroDeliveryId,
    ].map(seededId);
    await prisma.fieldSalesDelivery.deleteMany({ where: { id: { in: deliveryIds } } });

    const orderIds = [
      writtenOffOrderId, paidOrderId, noFakturOrderId, submittedOrderId,
      salesmanOrderId, bothOrderId, storeHighOrderId, storeMedOrderId, storeLowOrderId,
      storeZeroOrderId,
    ].map(seededId);
    await prisma.fieldSalesOrder.deleteMany({ where: { id: { in: orderIds } } });

    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });

    const storeIds = [collectorStoreId, salesmanStoreId, bothStoreId, storeHighId, storeMedId, storeLowId, storeZeroId].map(seededId);
    await prisma.store.deleteMany({ where: { id: { in: storeIds } } });

    const userIds = [collectorUserId, salesmanUserId, adminUserId, bothRoleUserId, multiStoreUserId, emptyUserId].map(seededId);
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  it("includes a store where the user is the assigned collector", async () => {
    const amplop = await listAmplop(collectorUserId, asOf);
    expect(amplop.stores.map((s) => s.storeId)).toContain(collectorStoreId);
  });

  it("includes a store where the user is the ORDER's salesman but not the collector", async () => {
    const amplop = await listAmplop(salesmanUserId, asOf);
    expect(amplop.stores.map((s) => s.storeId)).toContain(salesmanStoreId);
  });

  it("does NOT key on the delivery's deliveredById", async () => {
    /*
     * The delivery for salesmanStoreId is recorded by adminUserId, which is what an expedition
     * completion actually does. That admin must not see the store in their amplop, and the
     * order's salesman must still see it (asserted above).
     */
    const adminAmplop = await listAmplop(adminUserId, asOf);
    expect(adminAmplop.stores.map((s) => s.storeId)).not.toContain(salesmanStoreId);
    /*
     * Positive control: `not.toContain` alone is satisfied by an empty result too, which would
     * make this test pass vacuously if `listAmplop(adminUserId, ...)` ever returned `[]` for an
     * unrelated reason. adminUserId is genuinely the salesman on every collectorStoreId chain, so
     * it must legitimately reach that store through the salesman arm.
     */
    expect(adminAmplop.stores.map((s) => s.storeId)).toContain(collectorStoreId);
  });

  it("lists a store once when the user is both its collector and its salesman", async () => {
    const amplop = await listAmplop(bothRoleUserId, asOf);
    const matches = amplop.stores.filter((s) => s.storeId === bothStoreId);
    expect(matches).toHaveLength(1);
    /*
     * The store list is unique BY CONSTRUCTION (grouped into a Map keyed on storeId), so the
     * assertion above cannot catch a regression that matches the same receivable via both OR
     * arms and concatenates rather than groups — the Map would still yield one store while
     * `rows` held the same invoice twice and `totalOutstanding` read double. Assert the ROW list
     * and the total instead, which the duplication would actually corrupt.
     */
    expect(matches[0]?.rows).toHaveLength(1);
    expect(matches[0]?.totalOutstanding).toBe(300);
  });

  it("excludes PAID and WRITTEN_OFF receivables", async () => {
    const amplop = await listAmplop(collectorUserId, asOf);
    const card = amplop.stores.find((s) => s.storeId === collectorStoreId);
    expect(card?.rows.map((r) => r.receivableId)).not.toContain(paidReceivableId);
    expect(card?.rows.map((r) => r.receivableId)).not.toContain(writtenOffReceivableId);
  });

  it("orders stores by total overdue descending, tiebreaking by store name ascending", async () => {
    const amplop = await listAmplop(multiStoreUserId, asOf);
    const overdues = amplop.stores.map((s) => s.totalOverdue);
    expect([...overdues].sort((a, b) => b - a)).toEqual(overdues);
    /*
     * storeHigh/storeMed/storeLow give three genuinely distinct figures, so the sort actually had
     * work to do; storeZero ties storeLow at 0, which is what the second assertion below exists
     * to exercise.
     */
    expect(overdues).toEqual([1000, 300, 0, 0]);

    /*
     * F4: storeZero and storeLow tie at totalOverdue 0. storeZero's name ("Toko AAA Zero ...")
     * sorts before storeLow's ("Toko Low ...") — a comparator that returned 0 on this tie (never
     * reaching the storeName tiebreak) would leave their relative order to chance rather than
     * pinning it here.
     */
    const ids = amplop.stores.map((s) => s.storeId);
    expect(ids.indexOf(storeZeroId)).toBeLessThan(ids.indexOf(storeLowId));

    /* F3: the header totals are a free readout of the same fixture — 1000 + 300 + 200 + 150
     * outstanding, and only the first two (storeHigh, storeMed) are actually overdue. */
    expect(amplop.totalOutstanding).toBe(1650);
    expect(amplop.totalOverdue).toBe(1300);
  });

  it("orders rows within a store by due date ascending", async () => {
    /*
     * collectorStoreId's two surviving (non-PAID/WRITTEN_OFF) rows have distinct due dates:
     * submittedReceivableId (2026-05-01) before noFakturReceivableId (2026-07-01). Pins
     * `orderBy: { dueDate: "asc" }` reaching the per-store row list, not just the flat query.
     */
    const amplop = await listAmplop(collectorUserId, asOf);
    const card = amplop.stores.find((s) => s.storeId === collectorStoreId);
    expect(card?.rows.map((r) => r.receivableId)).toEqual([submittedReceivableId, noFakturReceivableId]);
  });

  it("computes daysOverdue and bucket from the row's own dueDate", async () => {
    /*
     * submittedReceivableId's dueDate is 2026-05-01, asOf is 2026-06-01 — May has 31 days, so
     * daysOverdue = 31 (> 30, <= 60 -> D31_60). Note this fixture sets `invoiceDate === dueDate`
     * on every chain, so a bug that fed `invoiceDate` into these instead of `dueDate` would be
     * invisible here — that substitution needs a fixture where the two dates differ.
     */
    const amplop = await listAmplop(collectorUserId, asOf);
    const row = amplop.stores
      .flatMap((s) => s.rows)
      .find((r) => r.receivableId === submittedReceivableId);
    expect(row?.daysOverdue).toBe(31);
    expect(row?.bucket).toBe("D31_60");
  });

  it("reports the store's remaining retur credit, not the retur's full value", async () => {
    const amplop = await listAmplop(collectorUserId, asOf);
    const card = amplop.stores.find((s) => s.storeId === collectorStoreId);
    expect(card?.availableCredit).toBe(remainingCreditForFixture);
  });

  it("nets a PENDING collection submission into the row", async () => {
    const amplop = await listAmplop(collectorUserId, asOf);
    const row = amplop.stores
      .flatMap((s) => s.rows)
      .find((r) => r.receivableId === submittedReceivableId);
    expect(row?.pendingSubmittedAmount).toBe(pendingAmountForFixture);
  });

  it("renders a delivery with no TaxInvoice as a null status rather than throwing", async () => {
    const amplop = await listAmplop(collectorUserId, asOf);
    const row = amplop.stores
      .flatMap((s) => s.rows)
      .find((r) => r.receivableId === noFakturReceivableId);
    expect(row?.taxInvoiceStatus).toBeNull();
    /* The sibling row in the same fixture DOES carry a TaxInvoice, so this null is the real
     * per-row behaviour, not every row coming back null by construction. */
    const taxedRow = amplop.stores
      .flatMap((s) => s.rows)
      .find((r) => r.receivableId === submittedReceivableId);
    expect(taxedRow?.taxInvoiceStatus).toBe("CREATED");
  });

  it("returns an empty amplop for a user with no receivables", async () => {
    const amplop = await listAmplop(emptyUserId, asOf);
    expect(amplop).toEqual({ stores: [], totalOutstanding: 0, totalOverdue: 0 });
  });
});
