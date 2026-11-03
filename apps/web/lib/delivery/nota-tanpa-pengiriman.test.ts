import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { terimaKiriman } from "@/lib/spg/stok-writer";
import { catatNotaUji } from "@/lib/field-sales/delivery/uji-nota";
import { bersihkanPesananUji, buatPesananUji, JATUH_TEMPO_UJI, type PesananUji } from "./uji-pengiriman";

/* Writes notas, receivables and store stock — never run against the shared prod DB (port 3307 tunnel / VPS host). */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));
/*
 * The post-commit loss of an old-style receipt is fire-and-forget; mocked so the spec can see it
 * was asked for, and so it can never write a StockLoss after the teardown has started.
 */
const catatHilang = vi.hoisted(() => vi.fn());
vi.mock("@/lib/spg/hilang-sumber", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/spg/hilang-sumber")>()),
  catatHilangDariPenerimaan: catatHilang,
}));

/**
 * R24: a putus nota entered by hand before the shipment rule (no `DeliveryShipment`) stays readable
 * and receivable, but gets no new void or correction path. The SPG's receipt of one behaves as it did
 * before this round: no door refusal, the nota is never corrected, and a shortfall is opened as lost
 * goods after commit (`catatHilangDariPenerimaan`) — never in the receipt transaction.
 */
d("SPG receipt of a hand-entered nota (no shipment, R24)", () => {
  let p: PesananUji | null = null;

  afterEach(async () => {
    await bersihkanPesananUji(p);
    p = null;
    catatHilang.mockReset();
  });

  async function notaTangan(qty: number) {
    const { deliveryId } = await catatNotaUji({
      orderId: p!.orderId,
      deliveredById: p!.salesmanId,
      lines: [{ orderLineId: p!.lineIds[0], qty }],
      invoiceDate: new Date(),
      dueDate: JATUH_TEMPO_UJI,
    });
    return prisma.fieldSalesDelivery.findUniqueOrThrow({ where: { id: seededId(deliveryId) }, include: { lines: true, receivable: true } });
  }

  it("refuses a door refusal, and a short receipt leaves the nota uncorrected and opens the loss after commit", async () => {
    p = await buatPesananUji({ termsType: "PUTUS", qty: [10], spg: true });
    const nota = await notaTangan(10);

    const tolak = await terimaKiriman({
      storeId: p.storeId,
      userId: p.spgId,
      sourceType: "PUTUS_DELIVERY",
      sourceId: nota.id,
      diterima: [{ lineId: nota.lines[0].id, qtyReceived: 8, qtyRefused: 2 }],
    });
    expect(tolak).toEqual({ ok: false, alasan: "JUMLAH_TIDAK_VALID" });

    const r = await terimaKiriman({
      storeId: p.storeId,
      userId: p.spgId,
      sourceType: "PUTUS_DELIVERY",
      sourceId: nota.id,
      diterima: [{ lineId: nota.lines[0].id, qtyReceived: 8 }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const sesudah = await prisma.fieldSalesDelivery.findUniqueOrThrow({ where: { id: seededId(nota.id) }, include: { lines: true, receivable: true } });
    expect(sesudah.correctedAt).toBeNull();
    expect(sesudah.voidedAt).toBeNull();
    expect(sesudah.lines[0]).toMatchObject({ qty: 10, returnedQty: 0, lostQty: 0 });
    expect(Number(sesudah.receivable?.amount)).toBe(Number(nota.receivable?.amount));
    /* No StockLoss inside the receipt transaction; the old post-commit path is asked for instead. */
    expect(await prisma.stockLoss.count({ where: { storeId: seededId(p.storeId) } })).toBe(0);
    expect(catatHilang).toHaveBeenCalledWith(r.receiptId, p.spgId);
  });
});
