import { describe, it, afterAll, vi } from "vitest";
import { prisma } from "@elorae/db";
import { NextRequest } from "next/server";
import { createFieldSalesOrder } from "@/lib/field-sales/writer";
import { recordFieldSalesDelivery } from "@/lib/field-sales/delivery/writer";

/*
 * Opt-in edge-case driver for the delivery / POD follow-ups card. Runs only with PODF_E2E=1
 * against the :3308 test bed and leaves its rows in place (every code carries the run token) so
 * the browser checks can open them.
 */
const url = process.env.DATABASE_URL ?? "";
const enabled = process.env.PODF_E2E === "1" && url.includes(":3308");
const d = enabled ? describe : describe.skip;

const { mockAuth, mockUpload } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockUpload: vi.fn(async (key: string) => `https://r2.test/${key}`),
}));
vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn(async () => {}) }));
vi.mock("@/lib/r2", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/r2")>();
  return { ...actual, isConfigured: () => true, uploadToR2: mockUpload };
});

import { approveFieldSalesOrderAction } from "@/app/actions/field-sales-orders";
import { recordDeliveryAction, closeRemainderAction, updateDeliveryDatesAction } from "@/app/actions/field-sales-deliveries";
import {
  createShipmentAction,
  updateShipmentTrackingAction,
  shipShipmentAction,
  completeShipmentAction,
} from "@/app/actions/delivery-shipments";
import { completePodAction, reportStuckDeliveryCompletionAction } from "@/app/pwa/deliveries/actions";
import { POST as uploadPod } from "@/app/pwa/api/upload/delivery-pod-proof/route";
import { listMyDeliveries, getDeliveryShipmentDetail } from "@/lib/delivery/shipment-queries";
import { classifyCompletionResult } from "@/lib/pwa/offline/completion-classify";
import { getSalesmenSalesSummary } from "@/lib/dashboard/queries";
import { listStores } from "@/lib/stores/queries";

type Row = { id: string; result: "PASS" | "FAIL" | "NOTE"; note: string };
const report: Row[] = [];
function check(id: string, ok: boolean, note: string) {
  report.push({ id, result: ok ? "PASS" : "FAIL", note });
}
function note(id: string, text: string) {
  report.push({ id, result: "NOTE", note: text });
}

const run = Date.now().toString(36).slice(-8);
const ids: Record<string, string> = {};
const ADMIN_PERMS = [
  "field_sales_orders:view",
  "field_sales_orders:approve",
  "field_sales_orders:deliver",
  "deliveries:ship",
  "deliveries:pod",
];
let adminId = "";
let salesmanId = "";
let spgId = "";
let uomId = "";

const LAT = -6.2;
const LNG = 106.8;
const INV = "2026-09-30";
const DUE = "2026-10-30";

function asAdmin() {
  mockAuth.mockResolvedValue({ user: { id: adminId, permissions: ADMIN_PERMS } });
}
function asSalesman(perms = ["deliveries:pod"]) {
  mockAuth.mockResolvedValue({ user: { id: salesmanId, permissions: perms } });
}
function asSpg() {
  mockAuth.mockResolvedValue({ user: { id: spgId, permissions: ["deliveries:pod"] } });
}

async function mkItem(tag: string, price: number, onHand: number) {
  const item = await prisma.item.create({
    data: { sku: `PODF-${run}-${tag}`, nameId: `PODF ${tag}`, nameEn: `PODF ${tag}`, type: "FINISHED_GOOD", isActive: true, uomId, sellingPrice: price },
  });
  await prisma.inventoryValue.create({
    data: { itemId: item.id, variantSku: null, qtyOnHand: onHand, reservedQty: 0, avgCost: 40000, totalValue: onHand * 40000 },
  });
  ids[`item_${tag}`] = item.id;
  return item.id;
}

async function mkStore(tag: string, opts: { lat?: number | null; lng?: number | null; radius?: number | null; terms?: "PUTUS" | "KONSI" }) {
  const store = await prisma.store.create({
    data: {
      code: `PODF-${run}-${tag}`,
      name: `PODF ${tag} ${run}`,
      address: "Test",
      termsType: opts.terms ?? "PUTUS",
      paymentTempo: 30,
      isActive: true,
      lat: opts.lat ?? null,
      lng: opts.lng ?? null,
      checkinRadiusMeters: opts.radius ?? null,
    },
  });
  await prisma.storeVisit.create({ data: { storeId: store.id, userId: salesmanId, checkinLat: 0, checkinLng: 0 } });
  ids[`store_${tag}`] = store.id;
  return store.id;
}

async function approvedOrder(tag: string, storeId: string, lines: Array<{ itemId: string; qty: number }>) {
  const r = await createFieldSalesOrder({
    storeId,
    salesmanId,
    skipMinQty: true,
    lines: lines.map((l) => ({ itemId: l.itemId, variantSku: "", productName: "PODF", qty: l.qty, unitPrice: 0, requestedUnitPrice: null, appealReason: null })),
  });
  asAdmin();
  const a = await approveFieldSalesOrderAction(r.orderId);
  if (!a.ok) throw new Error(`approve ${tag}: ${a.reason}`);
  ids[`order_${tag}`] = r.orderId;
  const orderLines = await prisma.fieldSalesOrderLine.findMany({ where: { orderId: r.orderId }, orderBy: { id: "asc" } });
  return { orderId: r.orderId, lines: orderLines };
}

async function shipment(
  tag: string,
  orderId: string,
  method: "EXPEDITION" | "SALESMAN_CARRY",
  lines: Array<{ orderLineId: string; qty: number }>,
  opts: { carrier?: string; ship?: boolean } = {},
) {
  asAdmin();
  const c = await createShipmentAction({ orderId, method, lines });
  if (!c.ok || !c.shipmentId) throw new Error(`create ${tag}: ${c.ok ? "no id" : c.reason}`);
  /* Direct write: the seeded salesman/spg hold no `deliveries:pod`, so the tracking action would refuse them as carriers. */
  if (opts.carrier) {
    await prisma.deliveryShipment.update({ where: { id: c.shipmentId }, data: { carriedById: opts.carrier } });
  }
  const t = await updateShipmentTrackingAction({
    shipmentId: c.shipmentId,
    carrierName: method === "EXPEDITION" ? "JNE" : undefined,
    resiNumber: method === "EXPEDITION" ? `RESI-${run}-${tag}` : undefined,
    invoiceDate: INV,
    dueDate: DUE,
  });
  if (!t.ok) throw new Error(`track ${tag}: ${t.reason}`);
  if (opts.ship !== false) {
    const s = await shipShipmentAction({ shipmentId: c.shipmentId });
    if (!s.ok) throw new Error(`ship ${tag}: ${s.reason}`);
  }
  ids[`ship_${tag}`] = c.shipmentId;
  const shipLines = await prisma.deliveryShipmentLine.findMany({ where: { shipmentId: c.shipmentId }, orderBy: { id: "asc" } });
  return { id: c.shipmentId, lines: shipLines };
}

function podPayload(shipmentId: string, lines: Array<{ shipmentLineId: string; deliveredQty: number }>, over: Record<string, unknown> = {}) {
  return {
    shipmentId,
    proofPhotoUrl: `https://r2.test/delivery-pod-proofs/${shipmentId}/goods.jpg`,
    proofPhotoR2Key: `delivery-pod-proofs/${shipmentId}/goods.jpg`,
    signatureUrl: `https://r2.test/delivery-pod-proofs/${shipmentId}/nota.jpg`,
    signatureR2Key: `delivery-pod-proofs/${shipmentId}/nota.jpg`,
    signedByName: "Budi Penerima",
    gps: { lat: LAT, lng: LNG },
    lines,
    ...over,
  } as Parameters<typeof completePodAction>[0];
}

function uploadReq(fields: { shipmentId?: string; clientId?: string; type?: string; size?: number }) {
  const fd = new FormData();
  const size = fields.size ?? 16;
  fd.append("file", new File([new Uint8Array(size)], "p.jpg", { type: fields.type ?? "image/jpeg" }));
  if (fields.shipmentId !== undefined) fd.append("shipmentId", fields.shipmentId);
  if (fields.clientId !== undefined) fd.append("clientId", fields.clientId);
  return new NextRequest("http://localhost/pwa/api/upload/delivery-pod-proof", { method: "POST", body: fd });
}

async function journalsFor(deliveryId: string) {
  const journals = await prisma.journal.count({ where: { sourceId: deliveryId } });
  const pending = (
    await prisma.adminNotification.findMany({ where: { category: "JOURNAL_PENDING" }, orderBy: { createdAt: "desc" }, take: 200, select: { metadata: true } })
  ).filter((n) => JSON.stringify(n.metadata).includes(deliveryId)).length;
  return { journals, pending };
}

async function stuckCount(shipmentId: string) {
  const rows = await prisma.adminNotification.findMany({
    where: { category: "DELIVERY_COMPLETION_STUCK" },
    orderBy: { createdAt: "desc" },
    take: 500,
    select: { metadata: true },
  });
  return rows.filter((r) => (r.metadata as { shipmentId?: string } | null)?.shipmentId === shipmentId).length;
}

async function mine() {
  const s = await getSalesmenSalesSummary();
  const row = s.rows.find((r) => r.salesmanId === salesmanId);
  return {
    awaitCount: row?.awaitingDelivery.count ?? 0,
    awaitAmount: row?.awaitingDelivery.amount ?? 0,
    realisedCount: row?.realised.count ?? 0,
    realisedAmount: row?.realised.amount ?? 0,
  };
}

d("delivery / POD follow-ups — end to end (opt-in)", () => {
  let O1: Awaited<ReturnType<typeof approvedOrder>>;
  let S1: Awaited<ReturnType<typeof shipment>>;

  it("setup", async () => {
    adminId = (await prisma.user.findFirstOrThrow({ where: { email: "admin@elorae.com" } })).id;
    salesmanId = (await prisma.user.findFirstOrThrow({ where: { email: "salesman@elorae.com" } })).id;
    spgId = (await prisma.user.findFirstOrThrow({ where: { email: "spg@elorae.com" } })).id;
    uomId = (await prisma.uOM.create({ data: { code: `PODF-${run}`, nameId: "pcs", nameEn: "pcs" } })).id;
    await mkItem("A", 100000, 200);
    await mkItem("B", 50000, 200);
    await mkStore("P", { lat: LAT, lng: LNG, radius: 100 });
    await mkStore("NG", {});
    await mkStore("DEF", { lat: LAT, lng: LNG });
    await mkStore("CUSTNOCOORD", { radius: 50 });
    O1 = await approvedOrder("O1", ids.store_P, [
      { itemId: ids.item_A, qty: 30 },
      { itemId: ids.item_B, qty: 30 },
    ]);
    S1 = await shipment("S1", O1.orderId, "SALESMAN_CARRY", [
      { orderLineId: O1.lines[0].id, qty: 5 },
      { orderLineId: O1.lines[1].id, qty: 5 },
    ], { carrier: salesmanId });
  });

  it("A — POD proof upload route", async () => {
    const S0 = await shipment("S0", O1.orderId, "SALESMAN_CARRY", [{ orderLineId: O1.lines[0].id, qty: 1 }], { carrier: salesmanId, ship: false });
    const SX = await shipment("SX", O1.orderId, "EXPEDITION", [{ orderLineId: O1.lines[0].id, qty: 1 }], { carrier: salesmanId });
    const SO = await shipment("SO", O1.orderId, "SALESMAN_CARRY", [{ orderLineId: O1.lines[0].id, qty: 1 }], { carrier: spgId });

    mockAuth.mockResolvedValue(null);
    const a1 = await uploadPod(uploadReq({ shipmentId: S1.id, clientId: "goods" }));
    check("A-01", a1.status === 401, `no session → ${a1.status}`);

    asSalesman(["field_sales_orders:view"]);
    const a2 = await uploadPod(uploadReq({ shipmentId: S1.id, clientId: "goods" }));
    check("A-02", a2.status === 403, `no deliveries:pod → ${a2.status}`);

    asSalesman();
    mockUpload.mockClear();
    const bad = ["../x", "a/b", "x".repeat(65), "a.b"];
    const a3 = await Promise.all(bad.map((s) => uploadPod(uploadReq({ shipmentId: s, clientId: "goods" }))));
    check("A-03", a3.every((r) => r.status === 400) && mockUpload.mock.calls.length === 0, `unsafe ids → ${a3.map((r) => r.status).join(",")}; uploads ${mockUpload.mock.calls.length}`);

    const a4 = await Promise.all(["signature", "../goods"].map((c) => uploadPod(uploadReq({ shipmentId: S1.id, clientId: c }))));
    check("A-04", a4.every((r) => r.status === 400), `bad clientId → ${a4.map((r) => r.status).join(",")}`);

    const a5a = await uploadPod(uploadReq({ shipmentId: S1.id, clientId: "goods", type: "text/plain" }));
    const a5b = await uploadPod(uploadReq({ shipmentId: S1.id, clientId: "goods", size: 10 * 1024 * 1024 + 1 }));
    check("A-05", a5a.status === 400 && a5b.status === 400, `text/plain ${a5a.status}, 10MB+1 ${a5b.status}`);

    const a6 = await uploadPod(uploadReq({ shipmentId: "doesnotexist123", clientId: "goods" }));
    const a7 = await uploadPod(uploadReq({ shipmentId: SX.id, clientId: "goods" }));
    const a8 = await uploadPod(uploadReq({ shipmentId: SO.id, clientId: "goods" }));
    const bodies = await Promise.all([a6.json(), a7.json(), a8.json()]);
    check("A-06", a6.status === 404, `unknown → ${a6.status}`);
    check("A-07", a7.status === 404 && JSON.stringify(bodies[1]) === JSON.stringify(bodies[0]), `EXPEDITION naming salesman → ${a7.status} ${JSON.stringify(bodies[1])}`);
    check("A-08", a8.status === 404 && JSON.stringify(bodies[2]) === JSON.stringify(bodies[0]), `other carrier → ${a8.status} ${JSON.stringify(bodies[2])}`);

    const a9 = await uploadPod(uploadReq({ shipmentId: S0.id, clientId: "goods" }));
    check("A-09", a9.status === 409, `own PACKED → ${a9.status}`);

    mockUpload.mockClear();
    const a10 = await uploadPod(uploadReq({ shipmentId: S1.id, clientId: "goods" }));
    const a10b = (await a10.json()) as { key?: string };
    const a10n = await uploadPod(uploadReq({ shipmentId: S1.id, clientId: "nota", type: "image/png" }));
    const a10nb = (await a10n.json()) as { key?: string };
    check(
      "A-10",
      a10.status === 200 && a10b.key === `delivery-pod-proofs/${S1.id}/goods.jpg` && a10nb.key === `delivery-pod-proofs/${S1.id}/nota.png`,
      `IN_TRANSIT → ${a10.status} ${a10b.key}, nota ${a10nb.key}`,
    );
    ids.ship_S0 = S0.id;
    ids.ship_SX = SX.id;
    ids.ship_SO = SO.id;
  });

  it("B — salesman-carry completion", async () => {
    const all = (qA: number, qB: number) => [
      { shipmentLineId: S1.lines[0].id, deliveredQty: qA },
      { shipmentLineId: S1.lines[1].id, deliveredQty: qB },
    ];

    asSpg();
    const b1 = await completePodAction(podPayload(S1.id, all(5, 5)));
    check("B-01", !b1.ok && b1.reason === "NOT_CARRIER", `other POD holder → ${b1.ok ? "ok" : b1.reason}`);

    asSalesman();
    const gpsCases = [
      { lat: null, lng: null },
      { lat: Number.NaN, lng: LNG },
      { lat: 91, lng: LNG },
    ];
    const b2 = [];
    for (const gps of gpsCases) b2.push(await completePodAction(podPayload(S1.id, all(5, 5), { gps })));
    check("B-02", b2.every((r) => !r.ok && r.reason === "MISSING_GPS"), `null/NaN/91 → ${b2.map((r) => (r.ok ? "ok" : r.reason)).join(",")}`);

    const b3 = await completePodAction(podPayload(S1.id, all(5, 5), { gps: { lat: LAT + 0.01, lng: LNG } }));
    check("B-03", !b3.ok && b3.reason === "GPS_OUT_OF_RADIUS", `~1.1 km → ${b3.ok ? "ok" : b3.reason}`);

    const O2 = await approvedOrder("O2", ids.store_NG, [{ itemId: ids.item_A, qty: 2 }]);
    const S2 = await shipment("S2", O2.orderId, "SALESMAN_CARRY", [{ orderLineId: O2.lines[0].id, qty: 2 }], { carrier: salesmanId });
    asSalesman();
    const b4 = await completePodAction(podPayload(S2.id, [{ shipmentLineId: S2.lines[0].id, deliveredQty: 2 }]));
    check("B-04", !b4.ok && b4.reason === "STORE_NOT_GEOCODED", `ungeocoded store → ${b4.ok ? "ok" : b4.reason}`);

    const b5a = await completePodAction(podPayload(S1.id, all(5, 5), { proofPhotoR2Key: `delivery-pod-proofs/${S2.id}/goods.jpg` }));
    const b5b = await completePodAction(podPayload(S1.id, all(5, 5), { proofPhotoR2Key: `delivery-pod-proofs/${S1.id}/x/../goods.jpg` }));
    check("B-05", !b5a.ok && b5a.reason === "MISSING_PROOF" && !b5b.ok && b5b.reason === "MISSING_PROOF", `foreign ${b5a.ok ? "ok" : b5a.reason}, traversal ${b5b.ok ? "ok" : b5b.reason}`);

    const b6a = await completePodAction(podPayload(S1.id, all(5, 5), { signatureR2Key: `delivery-pod-proofs/${S1.id}/goods.jpg` }));
    const b6b = await completePodAction(podPayload(S1.id, all(5, 5), { signatureR2Key: `delivery-proofs/${S1.id}/nota.jpg` }));
    check("B-06", !b6a.ok && b6a.reason === "MISSING_NOTA_PHOTO" && !b6b.ok && b6b.reason === "MISSING_NOTA_PHOTO", `same key ${b6a.ok ? "ok" : b6a.reason}, other folder ${b6b.ok ? "ok" : b6b.reason}`);

    const b7a = await completePodAction(podPayload(S1.id, all(5, 5), { signedByName: "   " }));
    const b7b = await completePodAction(podPayload(S1.id, all(5, 5), { signedByName: "x".repeat(121) }));
    check("B-07", !b7a.ok && b7a.reason === "MISSING_SIGNED_BY" && !b7b.ok && b7b.reason === "MISSING_SIGNED_BY", `blank ${b7a.ok ? "ok" : b7a.reason}, 121 ${b7b.ok ? "ok" : b7b.reason}`);

    const b8a = await completePodAction(podPayload(S1.id, [...all(5, 5), { shipmentLineId: S1.lines[0].id, deliveredQty: 0 }]));
    const b8b = await completePodAction(podPayload(S1.id, [{ shipmentLineId: S1.lines[0].id, deliveredQty: 5 }]));
    const s1mid = await prisma.deliveryShipment.findUniqueOrThrow({ where: { id: S1.id } });
    check("B-08", !b8a.ok && b8a.reason === "LINE_MISMATCH" && !b8b.ok && b8b.reason === "LINE_MISMATCH" && s1mid.status === "IN_TRANSIT", `duplicate ${b8a.ok ? "ok" : b8a.reason}, omitted ${b8b.ok ? "ok" : b8b.reason}, status ${s1mid.status}`);

    const stale = new Date(Date.now() - 5 * 24 * 3600 * 1000);
    const before = Date.now();
    const b9 = await completePodAction(podPayload(S1.id, all(5, 3), { deliveredAt: stale, completedOffline: true }));
    const s1 = await prisma.deliveryShipment.findUniqueOrThrow({ where: { id: S1.id } });
    const deliveries = await prisma.fieldSalesDelivery.findMany({ where: { idempotencyKey: `shipment-${S1.id}` } });
    const deliveryId = deliveries[0]?.id ?? "";
    ids.delivery_S1 = deliveryId;
    const recv = await prisma.receivable.count({ where: { deliveryId } });
    const fak = await prisma.taxInvoice.count({ where: { deliveryId } });
    const j = await journalsFor(deliveryId);
    check(
      "B-09",
      b9.ok && s1.status === "PARTIALLY_DELIVERED" && deliveries.length === 1 && recv === 1 && fak === 1 && s1.deliveryId === deliveryId && s1.gpsDistanceMeters === 0 && s1.signedByName === "Budi Penerima",
      `${b9.ok ? "ok" : b9.reason}; status ${s1.status}; deliveries ${deliveries.length}, receivable ${recv}, faktur ${fak}; journals ${j.journals} (pending flags ${j.pending})`,
    );
    check("B-12", !!s1.deliveredAt && s1.deliveredAt.getTime() >= before - 1000 && !!s1.completedOfflineAt, `deliveredAt 5d old → ${s1.deliveredAt?.toISOString()}; completedOfflineAt ${s1.completedOfflineAt ? "set" : "null"}`);

    const b10 = await completePodAction({ shipmentId: S1.id, proofPhotoUrl: "", proofPhotoR2Key: "", gps: { lat: 0, lng: 0 }, lines: [] });
    const deliveriesAfter = await prisma.fieldSalesDelivery.count({ where: { idempotencyKey: `shipment-${S1.id}` } });
    check("B-10", b10.ok && deliveriesAfter === 1, `same-carrier empty replay → ${b10.ok ? "ok" : b10.reason}; deliveries ${deliveriesAfter}`);

    asSpg();
    const b11 = await completePodAction(podPayload(S1.id, all(5, 3)));
    check("B-11", !b11.ok && b11.reason === "INVALID_STATE", `other actor on delivered → ${b11.ok ? "ok" : b11.reason}`);

    asSalesman();
    mockUpload.mockClear();
    const a11 = await uploadPod(uploadReq({ shipmentId: S1.id, clientId: "goods", type: "image/webp" }));
    const a11b = (await a11.json()) as { key?: string };
    check("A-11", a11.status === 200 && a11b.key === s1.proofPhotoR2Key && mockUpload.mock.calls.length === 0, `replay upload → ${a11.status} ${a11b.key}; R2 writes ${mockUpload.mock.calls.length}`);

    const detail = await getDeliveryShipmentDetail(S1.id);
    check(
      "E-01",
      !!detail && !!detail.goodsPhoto.url && !!detail.notaPhoto.url && detail.gpsDistanceMeters === 0 && detail.signedByName === "Budi Penerima" && detail.accountingDocNo === deliveries[0]?.docNo,
      `goods ${detail?.goodsPhoto.url}, nota ${detail?.notaPhoto.url}, doc ${detail?.accountingDocNo}`,
    );
  });

  it("C — replay after a lost response", async () => {
    const O3 = await approvedOrder("O3", ids.store_P, [{ itemId: ids.item_A, qty: 10 }]);
    const S3 = await shipment("S3", O3.orderId, "SALESMAN_CARRY", [{ orderLineId: O3.lines[0].id, qty: 3 }], { carrier: salesmanId });
    const s3row = await prisma.deliveryShipment.findUniqueOrThrow({ where: { id: S3.id } });
    const recorded = await recordFieldSalesDelivery({
      orderId: O3.orderId,
      deliveredById: salesmanId,
      lines: [{ orderLineId: O3.lines[0].id, qty: 2 }],
      invoiceDate: s3row.invoiceDate!,
      dueDate: s3row.dueDate!,
      idempotencyKey: `shipment-${S3.id}`,
      replayCompare: "linesOnly",
    });
    ids.delivery_S3 = recorded.deliveryId;
    const j0 = await journalsFor(recorded.deliveryId);

    asSalesman();
    const c1 = await completePodAction(podPayload(S3.id, [{ shipmentLineId: S3.lines[0].id, deliveredQty: 3 }]));
    const s3a = await prisma.deliveryShipment.findUniqueOrThrow({ where: { id: S3.id } });
    const j1 = await journalsFor(recorded.deliveryId);
    check(
      "C-01",
      !c1.ok && c1.reason === "REPLAY_MISMATCH" && c1.replay?.lines[0]?.qty === 2 && s3a.status === "IN_TRANSIT" && j1.journals + j1.pending > j0.journals + j0.pending,
      `${c1.ok ? "ok" : c1.reason} recorded ${JSON.stringify(c1.ok ? null : c1.replay?.lines)}; status ${s3a.status}; journals ${j0.journals}→${j1.journals} (pending ${j0.pending}→${j1.pending})`,
    );

    const c3 = await completePodAction(podPayload(S3.id, [{ shipmentLineId: S3.lines[0].id, deliveredQty: 0 }]));
    const s3b = await prisma.deliveryShipment.findUniqueOrThrow({ where: { id: S3.id } });
    check("C-03", !c3.ok && c3.reason === "REPLAY_MISMATCH" && s3b.status === "IN_TRANSIT", `all-zero → ${c3.ok ? "ok" : c3.reason}; status ${s3b.status}`);

    asAdmin();
    const fix = await updateDeliveryDatesAction({ deliveryId: recorded.deliveryId, invoiceDate: "2026-10-02", dueDate: "2026-11-02", reason: "PODF corrected" });
    asSalesman();
    const c2 = await completePodAction(podPayload(S3.id, [{ shipmentLineId: S3.lines[0].id, deliveredQty: 2 }]));
    const s3c = await prisma.deliveryShipment.findUniqueOrThrow({ where: { id: S3.id } });
    check(
      "C-02",
      fix.ok && c2.ok && s3c.status === "PARTIALLY_DELIVERED" && s3c.deliveryId === recorded.deliveryId,
      `date fix ${fix.ok ? "ok" : fix.reason}; retry ${c2.ok ? "ok" : c2.reason}; status ${s3c.status}; deliveryId matches ${s3c.deliveryId === recorded.deliveryId}`,
    );

    const S4 = await shipment("S4", O3.orderId, "EXPEDITION", [{ orderLineId: O3.lines[0].id, qty: 2 }]);
    const inv = new Date(`${INV}T00:00:00.000+07:00`);
    const due = new Date(`${DUE}T00:00:00.000+07:00`);
    await recordFieldSalesDelivery({
      orderId: O3.orderId,
      deliveredById: adminId,
      lines: [{ orderLineId: O3.lines[0].id, qty: 2 }],
      invoiceDate: inv,
      dueDate: due,
      idempotencyKey: `shipment-${S4.id}`,
    });
    asAdmin();
    const c4 = await completeShipmentAction({
      shipmentId: S4.id,
      proofPhotoUrl: `https://r2.test/delivery-proofs/${S4.id}/1.jpg`,
      proofPhotoR2Key: `delivery-proofs/${S4.id}/1.jpg`,
      invoiceDate: "2026-10-01",
      dueDate: DUE,
      lines: [{ shipmentLineId: S4.lines[0].id, deliveredQty: 2 }],
    });
    check("C-04", !c4.ok && c4.reason === "REPLAY_MISMATCH" && !!c4.replay?.invoiceDate, `EXPEDITION re-typed date → ${c4.ok ? "ok" : c4.reason}, recorded ${c4.ok ? "-" : c4.replay?.invoiceDate}`);

    const key = `podf-${run}-hand`;
    const c5a = await recordDeliveryAction({ orderId: O3.orderId, lines: [{ orderLineId: O3.lines[0].id, qty: 1 }], invoiceDate: INV, dueDate: DUE, idempotencyKey: key });
    const c5b = await recordDeliveryAction({ orderId: O3.orderId, lines: [{ orderLineId: O3.lines[0].id, qty: 1 }], invoiceDate: "2026-10-03", dueDate: DUE, idempotencyKey: key });
    check("C-05", c5a.ok && !c5b.ok && c5b.reason === "REPLAY_MISMATCH", `first ${c5a.ok ? "ok" : c5a.reason}; changed-date retry ${c5b.ok ? "ok" : c5b.reason}`);

    const O6 = await approvedOrder("O6", ids.store_P, [{ itemId: ids.item_B, qty: 4 }]);
    await prisma.stockReservation.updateMany({ where: { fieldSalesLineId: O6.lines[0].id }, data: { state: "RELEASED" } });
    asAdmin();
    const c6 = await recordDeliveryAction({ orderId: O6.orderId, lines: [{ orderLineId: O6.lines[0].id, qty: 1 }], invoiceDate: INV, dueDate: DUE, idempotencyKey: `podf-${run}-c6` });
    check("C-06", !c6.ok && c6.reason === "RESERVATION_MISMATCH", `released reservation → ${c6.ok ? "ok" : c6.reason}`);
  });

  it("D — queue, classifier, stuck report", async () => {
    const mineList = await listMyDeliveries(salesmanId);
    const mineIds = new Set(mineList.map((r) => r.id));
    const ok1 = !mineIds.has(ids.ship_SX) && !mineIds.has(ids.ship_S0) && !mineIds.has(ids.ship_SO) && !mineIds.has(ids.ship_S1);
    check("D-01", ok1, `EXPEDITION-naming-salesman ${mineIds.has(ids.ship_SX)}, PACKED ${mineIds.has(ids.ship_S0)}, other carrier ${mineIds.has(ids.ship_SO)}, delivered ${mineIds.has(ids.ship_S1)} (all should be false)`);

    const codes = [
      "NOT_FOUND", "INVALID_STATE", "NO_LINES", "OVER_PLANNED", "MISSING_RESI", "MISSING_PROOF", "INVALID_QTY", "LINE_MISMATCH",
      "MISSING_CARRIER", "MISSING_DATES", "NOT_CARRIER", "MISSING_GPS", "STORE_NOT_GEOCODED", "GPS_OUT_OF_RADIUS", "MISSING_NOTA_PHOTO",
      "MISSING_SIGNED_BY", "KONSI_NOT_RESERVED", "NO_INVENTORY_ROW", "OVER_DELIVER", "INSUFFICIENT_STOCK", "INVALID_DATES",
      "SHIPMENT_IN_FLIGHT", "REPLAY_MISMATCH", "RESERVATION_MISMATCH", "INVALID_REQUEST",
    ];
    const retried = codes.filter((c) => classifyCompletionResult({ ok: false, reason: c }) !== "terminal");
    check("D-02", retried.length === 0 && classifyCompletionResult({ ok: false, reason: "FORBIDDEN" }) === "retry", `non-terminal permanent codes: ${retried.join(",") || "none"}`);

    const fakeId = `podf${run}nope`;
    asSpg();
    const s3Before = await stuckCount(ids.ship_S3);
    const d3a = await reportStuckDeliveryCompletionAction(ids.ship_S3, "NOT_CARRIER").then(() => "resolved", (e) => `threw ${String(e).slice(0, 60)}`);
    const s3After = await stuckCount(ids.ship_S3);
    const d3b = await reportStuckDeliveryCompletionAction(fakeId, "UNEXPECTED").then(() => "resolved", (e) => `threw ${String(e).slice(0, 60)}`);
    const fakeAfter = await stuckCount(fakeId);
    check("D-03", s3After === s3Before && fakeAfter === 0, `non-carrier report on another's shipment: ${s3Before}→${s3After} (${d3a}); unknown id: ${fakeAfter} notification(s) (${d3b})`);

    asSalesman();
    const S5 = await shipment("S5", ids.order_O1, "SALESMAN_CARRY", [{ orderLineId: O1.lines[1].id, qty: 1 }], { carrier: salesmanId });
    asSalesman();
    const long = "Z".repeat(5000);
    await reportStuckDeliveryCompletionAction(S5.id, long).catch(() => {});
    const d4rows = (
      await prisma.adminNotification.findMany({ where: { category: "DELIVERY_COMPLETION_STUCK" }, orderBy: { createdAt: "desc" }, take: 50 })
    ).filter((n) => (n.metadata as { shipmentId?: string } | null)?.shipmentId === S5.id);
    const d4len = d4rows[0]?.message.length ?? 0;
    check("D-04", d4rows.length === 0 || d4len < 1000, `5000-char reason → ${d4rows.length} notification(s), message length ${d4len}`);

    await reportStuckDeliveryCompletionAction(S5.id, "GPS_OUT_OF_RADIUS").catch(() => {});
    const legit = await stuckCount(S5.id);
    check("D-04b", legit >= 1, `carrier's own report with a real code → ${legit} notification(s)`);
    ids.ship_S5 = S5.id;
  });

  it("E — proof photo derivation on tampered rows", async () => {
    const S7 = await shipment("S7", ids.order_O1, "SALESMAN_CARRY", [{ orderLineId: O1.lines[1].id, qty: 1 }], { carrier: salesmanId, ship: false });
    await prisma.deliveryShipment.update({
      where: { id: S7.id },
      data: { proofPhotoR2Key: `delivery-pod-proofs/${ids.ship_S1}/goods.jpg`, proofPhotoUrl: "https://evil.test/a.jpg", signatureUrl: "https://evil.test/b.jpg", signatureR2Key: null },
    });
    const det = await getDeliveryShipmentDetail(S7.id);
    check(
      "E-02",
      !!det && det.goodsPhoto.unavailable && det.goodsPhoto.url === null && det.notaPhoto.unavailable && det.notaPhoto.url === null,
      `foreign key → ${JSON.stringify(det?.goodsPhoto)}; url without key → ${JSON.stringify(det?.notaPhoto)}`,
    );
    ids.ship_S7 = S7.id;
  });

  it("F — dashboard awaiting-delivery bucket", async () => {
    const base = await mine();
    const OF = await approvedOrder("OF", ids.store_DEF, [{ itemId: ids.item_A, qty: 2 }]);
    const orderTotal = Number((await prisma.fieldSalesOrder.findUniqueOrThrow({ where: { id: OF.orderId } })).total);
    const f1 = await mine();
    check("F-01", f1.awaitCount === base.awaitCount + 1 && Math.abs(f1.awaitAmount - base.awaitAmount - orderTotal) < 0.01, `awaiting ${base.awaitCount}→${f1.awaitCount}, +${f1.awaitAmount - base.awaitAmount} (order total ${orderTotal})`);

    asAdmin();
    const dl = await recordDeliveryAction({ orderId: OF.orderId, lines: [{ orderLineId: OF.lines[0].id, qty: 1 }], invoiceDate: INV, dueDate: DUE, idempotencyKey: `podf-${run}-f` });
    const delTotal = dl.ok ? Number((await prisma.fieldSalesDelivery.findUniqueOrThrow({ where: { idempotencyKey: `podf-${run}-f` } })).total) : 0;
    const f2 = await mine();
    check(
      "F-02",
      dl.ok && f2.awaitCount === base.awaitCount + 1 && Math.abs(f2.awaitAmount - base.awaitAmount - (orderTotal - delTotal)) < 0.01 && f2.realisedCount === f1.realisedCount + 1 && Math.abs(f2.realisedAmount - f1.realisedAmount - delTotal) < 0.01,
      `residual +${f2.awaitAmount - base.awaitAmount} (expect ${orderTotal - delTotal}); realised +${f2.realisedCount - f1.realisedCount}/+${f2.realisedAmount - f1.realisedAmount}`,
    );

    const cl = await closeRemainderAction(OF.orderId, "PODF close");
    const f3 = await mine();
    check("F-03", cl.ok && f3.awaitCount === base.awaitCount && Math.abs(f3.awaitAmount - base.awaitAmount) < 0.01, `close ${cl.ok ? "ok" : cl.reason}; awaiting back to ${f3.awaitCount} (+${f3.awaitAmount - base.awaitAmount})`);
  });

  it("G — store coordinate filter", async () => {
    const search = `PODF-${run}`;
    const codes = async (location?: "missing" | "defaultRadius" | "customRadius") =>
      (await listStores({ activeOnly: true, search, location })).items.map((s) => s.code.replace(`${search}-`, "")).sort();
    const missing = await codes("missing");
    const def = await codes("defaultRadius");
    const custom = await codes("customRadius");
    const none = await codes(undefined);
    check(
      "G-03",
      missing.includes("NG") && !missing.includes("P") && JSON.stringify(def) === JSON.stringify(["DEF"]) && custom.includes("P") && none.length === 4,
      `missing [${missing}], defaultRadius [${def}], customRadius [${custom}], all ${none.length}`,
    );
    const both = missing.includes("CUSTNOCOORD") && custom.includes("CUSTNOCOORD");
    if (both) note("G-04", "store with a custom radius but no coordinates appears under BOTH 'missing' and 'customRadius'");
    else check("G-04", true, `custom radius without coordinates → missing ${missing.includes("CUSTNOCOORD")}, custom ${custom.includes("CUSTNOCOORD")}`);
  });

  afterAll(() => {
    if (!enabled) return;
    console.log(`PODF_REPORT ${JSON.stringify({ run, ids, report }, null, 2)}`);
  });
});
