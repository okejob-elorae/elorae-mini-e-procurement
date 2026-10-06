import { Test } from "@nestjs/testing";
import { ALASAN_GEMA_PUSH, JENDELA_GEMA_PUSH_MS, StockWebhookHandler } from "./stock.handler";
import { PRISMA } from "../../db/prisma.module";
import { JubelioHttpService } from "../http.service";
import { SKIP_REASONS } from "../queue/webhook-status";

jest.mock("@elorae/db", () => ({
  applyJubelioStockAdjustment: jest.fn(),
}));

import { applyJubelioStockAdjustment } from "@elorae/db";

function row(payload: unknown, overrides: Record<string, unknown> = {}) {
  return {
    id: "evt_1",
    event: "stock",
    eventId: null,
    signature: "sig",
    payloadHash: "hash",
    rawPayload: payload,
    status: "PROCESSING",
    attempts: 1,
    lastError: null,
    receivedAt: new Date(),
    processedAt: null,
    skipReason: null,
    deadAt: null,
    lastEnqueuedAt: null,
    ...overrides,
  };
}

const NEW_SHAPE = {
  action: "update-qty",
  item_group_id: 115,
  item_group_name: "Some Group",
  item_ids: [1974, 2125],
  location_id: null,
};

const DETAIL_RESPONSE = {
  item_group_id: 115,
  product_skus: [
    { item_id: 1974, item_code: "SKU-A-RED", end_qty: 7 },
    { item_id: 2125, item_code: "SKU-A-BLU", end_qty: 3 },
  ],
};

describe("StockWebhookHandler", () => {
  let handler: StockWebhookHandler;
  let prisma: {
    jubelioProductMapping: { findMany: jest.Mock };
    jubelioOutbox: { findMany: jest.Mock };
    stockAdjustment: { findMany: jest.Mock };
  };
  let http: { get: jest.Mock };

  beforeEach(async () => {
    prisma = {
      jubelioProductMapping: { findMany: jest.fn() },
      // Tanpa push stok baru-baru ini: penekan gema tidak menahan apa pun.
      jubelioOutbox: { findMany: jest.fn().mockResolvedValue([]) },
      stockAdjustment: { findMany: jest.fn().mockResolvedValue([]) },
    };
    http = { get: jest.fn() };
    const mod = await Test.createTestingModule({
      providers: [
        StockWebhookHandler,
        { provide: PRISMA, useValue: prisma },
        { provide: JubelioHttpService, useValue: http },
      ],
    }).compile();
    handler = mod.get(StockWebhookHandler);
    (applyJubelioStockAdjustment as jest.Mock).mockReset();
  });

  it("SKIPs old-shape payload (item_code + end_qty)", async () => {
    const result = await handler.handle(row({ item_code: "SKU-A", end_qty: 5 }) as never);
    expect(result).toEqual({
      kind: "skipped",
      reason: SKIP_REASONS.UNSUPPORTED_PAYLOAD_SHAPE,
    });
    expect(http.get).not.toHaveBeenCalled();
    expect(applyJubelioStockAdjustment).not.toHaveBeenCalled();
  });

  it("SKIPs when item_group_id missing", async () => {
    const result = await handler.handle(row({ action: "update-qty", item_ids: [1] }) as never);
    expect(result).toEqual({
      kind: "skipped",
      reason: SKIP_REASONS.MISSING_ITEM_GROUP_ID,
    });
  });

  it("SKIPs when item_ids missing or empty", async () => {
    const r1 = await handler.handle(row({ action: "update-qty", item_group_id: 1 }) as never);
    expect(r1).toEqual({ kind: "skipped", reason: SKIP_REASONS.MISSING_ITEM_IDS });

    const r2 = await handler.handle(row({ action: "update-qty", item_group_id: 1, item_ids: [] }) as never);
    expect(r2).toEqual({ kind: "skipped", reason: SKIP_REASONS.MISSING_ITEM_IDS });
  });

  it("SKIPs orphan_group when no local mappings match item_ids", async () => {
    prisma.jubelioProductMapping.findMany.mockResolvedValue([]);
    http.get.mockResolvedValue(DETAIL_RESPONSE);

    const result = await handler.handle(row(NEW_SHAPE) as never);

    expect(result).toEqual({
      kind: "skipped",
      reason: `${SKIP_REASONS.ORPHAN_GROUP}:115`,
    });
    expect(applyJubelioStockAdjustment).not.toHaveBeenCalled();
  });

  it("fetches group detail and applies stock adjustment per matched item_id", async () => {
    http.get.mockResolvedValue(DETAIL_RESPONSE);
    prisma.jubelioProductMapping.findMany.mockResolvedValue([
      { itemId: "item_1", erpVariantSku: "ERP-A-RED", jubelioItemId: 1974, jubelioItemCode: "SKU-A-RED" },
      { itemId: "item_1", erpVariantSku: "ERP-A-BLU", jubelioItemId: 2125, jubelioItemCode: "SKU-A-BLU" },
    ]);
    (applyJubelioStockAdjustment as jest.Mock).mockResolvedValue({ adjustmentId: "adj", skipped: false });

    const result = await handler.handle(row(NEW_SHAPE) as never);

    expect(http.get).toHaveBeenCalledWith("/inventory/items/group/115");
    expect(applyJubelioStockAdjustment).toHaveBeenCalledTimes(2);
    expect(applyJubelioStockAdjustment).toHaveBeenCalledWith(prisma, {
      itemId: "item_1",
      variantSku: "ERP-A-RED",
      newQty: 7,
      idempotencyKey: "evt_1:1974",
      externalRef: "115/SKU-A-RED",
      reason: "Jubelio stock webhook evt_1 item_id=1974",
    });
    expect(applyJubelioStockAdjustment).toHaveBeenCalledWith(prisma, {
      itemId: "item_1",
      variantSku: "ERP-A-BLU",
      newQty: 3,
      idempotencyKey: "evt_1:2125",
      externalRef: "115/SKU-A-BLU",
      reason: "Jubelio stock webhook evt_1 item_id=2125",
    });
    expect(result).toEqual({ kind: "processed" });
  });

  it("partial match: applies adjustment for mapped item_ids only, still processed", async () => {
    http.get.mockResolvedValue({
      item_group_id: 115,
      product_skus: [
        { item_id: 1974, item_code: "SKU-A-RED", end_qty: 7 },
        // item_id 2125 absent from detail response — Jubelio inconsistency
      ],
    });
    prisma.jubelioProductMapping.findMany.mockResolvedValue([
      { itemId: "item_1", erpVariantSku: "ERP-A-RED", jubelioItemId: 1974, jubelioItemCode: "SKU-A-RED" },
      { itemId: "item_1", erpVariantSku: "ERP-A-BLU", jubelioItemId: 2125, jubelioItemCode: "SKU-A-BLU" },
    ]);
    (applyJubelioStockAdjustment as jest.Mock).mockResolvedValue({ adjustmentId: "adj", skipped: false });

    const result = await handler.handle(row(NEW_SHAPE) as never);

    expect(applyJubelioStockAdjustment).toHaveBeenCalledTimes(1);
    expect(applyJubelioStockAdjustment).toHaveBeenCalledWith(prisma, expect.objectContaining({
      variantSku: "ERP-A-RED", newQty: 7,
    }));
    expect(result).toEqual({ kind: "processed" });
  });

  it("throws when http.get fails (queue retries)", async () => {
    http.get.mockRejectedValue(new Error("network"));
    await expect(handler.handle(row(NEW_SHAPE) as never)).rejects.toThrow(/network/);
    expect(applyJubelioStockAdjustment).not.toHaveBeenCalled();
  });

  it("throws when applyJubelioStockAdjustment fails", async () => {
    http.get.mockResolvedValue(DETAIL_RESPONSE);
    prisma.jubelioProductMapping.findMany.mockResolvedValue([
      { itemId: "item_1", erpVariantSku: "ERP-A-RED", jubelioItemId: 1974, jubelioItemCode: "SKU-A-RED" },
    ]);
    (applyJubelioStockAdjustment as jest.Mock).mockRejectedValue(new Error("InventoryValue not found"));

    await expect(handler.handle(row(NEW_SHAPE) as never)).rejects.toThrow(/InventoryValue not found/);
  });
});

/*
 * Penekan gema push stok (Usulan B, analisis-webhook-stok §5).
 * ERP mendorong AVAILABLE (onHand − ditahan) ke Jubelio; webhook stok menulis end_qty
 * MUTLAK ke onHand. Bila Jubelio menggema push kita, setiap putaran menghapus `ditahan`
 * dari onHand. Model di bawah meniru penulis sungguhan: end_qty → onHand + satu
 * StockAdjustment JUBELIO_WEBHOOK per penerapan.
 */
describe("StockWebhookHandler — penekan gema push stok", () => {
  const KODE = "SKU-A-RED";
  const PETA = { itemId: "item_1", erpVariantSku: "ERP-A-RED", jubelioItemId: 1974, jubelioItemCode: KODE };
  const WEBHOOK = { action: "update-qty", item_group_id: 115, item_ids: [1974], location_id: null };

  let handler: StockWebhookHandler;
  let prisma: any;
  let http: { get: jest.Mock };
  let stok: { onHand: number; ditahan: number };
  let penyesuaian: { itemId: string; externalRef: string; qtyChange: number; createdAt: Date; source: string }[];
  let outbox: { status: string; processedAt: Date | null; deadAt?: Date | null; payload: unknown }[];

  const menitLalu = (n: number) => new Date(Date.now() - n * 60_000);
  /** Baris outbox stock_push yang sudah DONE dan mencatat angka yang diterima Jubelio. */
  const pushSelesai = (endQty: number, pada: Date, kode = KODE) => ({
    status: "DONE",
    processedAt: pada,
    payload: { sumber: "GRN", terkirim: [{ item_code: kode, end_qty: endQty, pada: pada.toISOString() }] },
  });
  const detail = (endQty: number) => ({ item_group_id: 115, product_skus: [{ item_id: 1974, item_code: KODE, end_qty: endQty }] });
  const kirimWebhook = (id: string) => handler.handle(row(WEBHOOK, { id }) as never);

  beforeEach(async () => {
    stok = { onHand: 10, ditahan: 3 };
    penyesuaian = [];
    outbox = [];
    prisma = {
      jubelioProductMapping: { findMany: jest.fn().mockResolvedValue([PETA]) },
      // Meniru filter status/processedAt basis data (klausa OR); jendela berdasarkan waktu PUT
      // tetap ditegakkan penangan untuk baris yang lolos (mis. PROCESSING yang macet).
      jubelioOutbox: {
        findMany: jest.fn(async ({ where }: any) =>
          outbox.filter((b) =>
            (where?.OR ?? [{}]).some((k: any) => {
              const status = k.status === undefined || (typeof k.status === "string" ? b.status === k.status : k.status.in.includes(b.status));
              const waktu = !k.processedAt?.gte || (b.processedAt != null && b.processedAt >= k.processedAt.gte);
              const mati = !k.deadAt?.gte || (b.deadAt != null && b.deadAt >= k.deadAt.gte);
              return status && waktu && mati;
            }),
          ),
        ),
      },
      stockAdjustment: {
        findMany: jest.fn(async ({ where }: any) =>
          penyesuaian.filter(
            (a) =>
              a.source === where?.source &&
              a.createdAt >= (where?.createdAt?.gte ?? new Date(0)) &&
              (where?.itemId?.in ?? []).includes(a.itemId),
          ),
        ),
      },
    };
    http = { get: jest.fn() };
    const mod = await Test.createTestingModule({
      providers: [
        StockWebhookHandler,
        { provide: PRISMA, useValue: prisma },
        { provide: JubelioHttpService, useValue: http },
      ],
    }).compile();
    handler = mod.get(StockWebhookHandler);
    (applyJubelioStockAdjustment as jest.Mock).mockReset().mockImplementation(async (_c: unknown, input: any) => {
      penyesuaian.push({
        itemId: input.itemId,
        externalRef: input.externalRef,
        qtyChange: input.newQty - stok.onHand,
        createdAt: new Date(),
        source: "JUBELIO_WEBHOOK",
      });
      stok.onHand = input.newQty;
      return { adjustmentId: `adj_${penyesuaian.length}`, skipped: false };
    });
  });

  it("konstanta: jendela 10 menit, alasan echo_of_push", () => {
    expect(JENDELA_GEMA_PUSH_MS).toBe(10 * 60_000);
    expect(ALASAN_GEMA_PUSH).toBe("echo_of_push");
  });

  it("onHand 10, ditahan 3, push 7, webhook end_qty 7 → dilewati echo_of_push; onHand tetap 10 tanpa penyesuaian", async () => {
    outbox = [pushSelesai(stok.onHand - stok.ditahan, menitLalu(1))];
    http.get.mockResolvedValue(detail(7));

    const hasil = await kirimWebhook("evt_gema");

    expect(hasil).toEqual({ kind: "skipped", reason: ALASAN_GEMA_PUSH });
    expect(applyJubelioStockAdjustment).not.toHaveBeenCalled();
    expect(stok.onHand).toBe(10);
    expect(penyesuaian).toHaveLength(0);
    expect(prisma.jubelioOutbox.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ entityType: "stock_push", entityId: { in: ["item_1"] } }) }),
    );
  });

  it("dua gema berturut-turut tidak menumpuk: onHand tetap 10", async () => {
    outbox = [pushSelesai(7, menitLalu(2))];
    http.get.mockResolvedValue(detail(7));

    expect(await kirimWebhook("evt_gema_1")).toEqual({ kind: "skipped", reason: ALASAN_GEMA_PUSH });
    expect(await kirimWebhook("evt_gema_2")).toEqual({ kind: "skipped", reason: ALASAN_GEMA_PUSH });

    expect(stok.onHand).toBe(10);
    expect(penyesuaian).toHaveLength(0);
  });

  it("balapan: dua gema serentak (Promise.all) → keduanya dilewati, onHand tetap 10", async () => {
    outbox = [pushSelesai(7, menitLalu(1))];
    http.get.mockResolvedValue(detail(7));

    const hasil = await Promise.all([kirimWebhook("evt_a"), kirimWebhook("evt_b")]);

    expect(hasil).toEqual([
      { kind: "skipped", reason: ALASAN_GEMA_PUSH },
      { kind: "skipped", reason: ALASAN_GEMA_PUSH },
    ]);
    expect(stok.onHand).toBe(10);
    expect(penyesuaian).toHaveLength(0);
  });

  it("baris PROCESSING yang macet dengan PUT 15 menit lalu tidak menekan apa pun (jendela dari waktu PUT)", async () => {
    outbox = [{ ...pushSelesai(7, menitLalu(15)), status: "PROCESSING", processedAt: null }];
    http.get.mockResolvedValue(detail(7));

    expect(await kirimWebhook("evt_macet")).toEqual({ kind: "processed" });
    expect(stok.onHand).toBe(7);
  });

  it("webhook end_qty 5 sesudah push 7 → tetap ditulis seperti dulu (onHand 5, satu penyesuaian −5)", async () => {
    outbox = [pushSelesai(7, menitLalu(1))];
    http.get.mockResolvedValue(detail(5));

    const hasil = await kirimWebhook("evt_sah");

    expect(hasil).toEqual({ kind: "processed" });
    expect(applyJubelioStockAdjustment).toHaveBeenCalledWith(prisma, expect.objectContaining({ newQty: 5, variantSku: "ERP-A-RED" }));
    expect(stok.onHand).toBe(5);
    expect(penyesuaian.map((a) => a.qtyChange)).toEqual([-5]);
  });

  it("push 15 menit lalu tidak menekan apa pun: end_qty 7 ditulis (perilaku lama, onHand 7)", async () => {
    outbox = [pushSelesai(7, menitLalu(15))];
    http.get.mockResolvedValue(detail(7));

    const hasil = await kirimWebhook("evt_basi");

    expect(hasil).toEqual({ kind: "processed" });
    expect(stok.onHand).toBe(7);
    expect(penyesuaian).toHaveLength(1);
  });

  it("push yang menentukan adalah yang TERAKHIR: push 7 lalu push 9 → end_qty 9 dilewati, end_qty 7 ditulis", async () => {
    outbox = [pushSelesai(7, menitLalu(5)), pushSelesai(9, menitLalu(2))];

    http.get.mockResolvedValue(detail(9));
    expect(await kirimWebhook("evt_9")).toEqual({ kind: "skipped", reason: ALASAN_GEMA_PUSH });
    expect(stok.onHand).toBe(10);

    http.get.mockResolvedValue(detail(7));
    expect(await kirimWebhook("evt_7")).toEqual({ kind: "processed" });
    expect(stok.onHand).toBe(7);
  });

  it("webhook sah yang sudah diterapkan sesudah push membatalkan tekanan: push 7, Jubelio 5, lalu kembali 7 → keduanya ditulis", async () => {
    outbox = [pushSelesai(7, menitLalu(3))];

    http.get.mockResolvedValue(detail(5));
    expect(await kirimWebhook("evt_turun")).toEqual({ kind: "processed" });
    expect(stok.onHand).toBe(5);

    http.get.mockResolvedValue(detail(7));
    expect(await kirimWebhook("evt_naik")).toEqual({ kind: "processed" });
    expect(stok.onHand).toBe(7);
    expect(penyesuaian.map((a) => a.qtyChange)).toEqual([-5, 2]);
  });

  it("penyesuaian kode LAIN sesudah push tidak membatalkan tekanan kode ini", async () => {
    outbox = [pushSelesai(7, menitLalu(3))];
    penyesuaian.push({ itemId: "item_1", externalRef: "115/SKU-A-BLU", qtyChange: -1, createdAt: menitLalu(1), source: "JUBELIO_WEBHOOK" });
    http.get.mockResolvedValue(detail(7));

    expect(await kirimWebhook("evt_gema")).toEqual({ kind: "skipped", reason: ALASAN_GEMA_PUSH });
    expect(stok.onHand).toBe(10);
  });

  it("baris outbox lama tanpa `terkirim` (sebelum penekan ada) tidak menekan apa pun", async () => {
    outbox = [{ status: "DONE", processedAt: menitLalu(1), payload: { sumber: "GRN" } }];
    http.get.mockResolvedValue(detail(7));

    expect(await kirimWebhook("evt_lama")).toEqual({ kind: "processed" });
    expect(stok.onHand).toBe(7);
  });

  it("push yang masih PROCESSING tapi sudah diterima Jubelio tetap menekan gemanya (balapan dengan markDone)", async () => {
    outbox = [{ ...pushSelesai(7, menitLalu(0)), status: "PROCESSING", processedAt: null }];
    http.get.mockResolvedValue(detail(7));

    expect(await kirimWebhook("evt_cepat")).toEqual({ kind: "skipped", reason: ALASAN_GEMA_PUSH });
    expect(stok.onHand).toBe(10);
  });

  it("satu varian gema, varian lain berubah → processed; hanya varian yang berubah ditulis", async () => {
    prisma.jubelioProductMapping.findMany.mockResolvedValue([
      PETA,
      { itemId: "item_1", erpVariantSku: "ERP-A-BLU", jubelioItemId: 2125, jubelioItemCode: "SKU-A-BLU" },
    ]);
    const pada = menitLalu(1);
    outbox = [
      {
        status: "DONE",
        processedAt: pada,
        payload: {
          terkirim: [
            { item_code: KODE, end_qty: 7, pada: pada.toISOString() },
            { item_code: "SKU-A-BLU", end_qty: 3, pada: pada.toISOString() },
          ],
        },
      },
    ];
    http.get.mockResolvedValue({
      item_group_id: 115,
      product_skus: [
        { item_id: 1974, item_code: KODE, end_qty: 7 },
        { item_id: 2125, item_code: "SKU-A-BLU", end_qty: 1 },
      ],
    });

    const hasil = await handler.handle(row({ ...WEBHOOK, item_ids: [1974, 2125] }, { id: "evt_campur" }) as never);

    expect(hasil).toEqual({ kind: "processed" });
    expect(applyJubelioStockAdjustment).toHaveBeenCalledTimes(1);
    expect(applyJubelioStockAdjustment).toHaveBeenCalledWith(prisma, expect.objectContaining({ variantSku: "ERP-A-BLU", newQty: 1 }));
  });

  it("isi `terkirim` yang rusak (tanggal tak terbaca, angka bukan bilangan) diabaikan, bukan dilempar", async () => {
    outbox = [
      { status: "DONE", processedAt: menitLalu(1), payload: { terkirim: [{ item_code: KODE, end_qty: 7, pada: "kemarin" }] } },
      { status: "DONE", processedAt: menitLalu(1), payload: { terkirim: [{ item_code: KODE, end_qty: "tujuh", pada: menitLalu(1).toISOString() }] } },
      { status: "DONE", processedAt: menitLalu(1), payload: { terkirim: "bukan daftar" } },
    ];
    http.get.mockResolvedValue(detail(7));

    expect(await kirimWebhook("evt_rusak")).toEqual({ kind: "processed" });
    expect(stok.onHand).toBe(7);
  });

  it("webhook sah yang diterapkan SEBELUM push tidak membatalkan tekanan gema push itu (onHand 15 tetap, bukan 12)", async () => {
    // 4 menit lalu Jubelio sah turun ke 5 (diterapkan); lalu GRN +10 → onHand 15, ditahan 3 → push 12.
    stok = { onHand: 15, ditahan: 3 };
    penyesuaian.push({ itemId: "item_1", externalRef: `115/${KODE}`, qtyChange: -5, createdAt: menitLalu(4), source: "JUBELIO_WEBHOOK" });
    outbox = [pushSelesai(stok.onHand - stok.ditahan, menitLalu(1))];
    http.get.mockResolvedValue(detail(12));

    expect(await kirimWebhook("evt_gema_sesudah_sah")).toEqual({ kind: "skipped", reason: ALASAN_GEMA_PUSH });
    expect(stok.onHand).toBe(15);
    expect(penyesuaian).toHaveLength(1);
  });

  it("gema yang tertahan di antrean (diterima 1 menit sesudah push, diproses 14 menit sesudahnya) tetap ditekan", async () => {
    outbox = [pushSelesai(7, menitLalu(14))];
    http.get.mockResolvedValue(detail(7));

    const hasil = await handler.handle(row(WEBHOOK, { id: "evt_antre", receivedAt: menitLalu(13) }) as never);

    expect(hasil).toEqual({ kind: "skipped", reason: ALASAN_GEMA_PUSH });
    expect(stok.onHand).toBe(10);
    expect(penyesuaian).toHaveLength(0);
  });

  it("jendela tetap terbatas dari waktu webhook DITERIMA: push 11 menit sebelum diterima → tidak menekan (onHand 7)", async () => {
    outbox = [pushSelesai(7, menitLalu(13))];
    http.get.mockResolvedValue(detail(7));

    const hasil = await handler.handle(row(WEBHOOK, { id: "evt_jauh", receivedAt: menitLalu(2) }) as never);

    expect(hasil).toEqual({ kind: "processed" });
    expect(stok.onHand).toBe(7);
  });

  it("baris push yang berakhir DEAD (grup lain gagal) tetap menekan gema angka yang sudah diterima Jubelio", async () => {
    const pada = menitLalu(1);
    outbox = [
      {
        status: "DEAD",
        processedAt: null,
        deadAt: pada,
        payload: { sumber: "GRN", terkirim: [{ item_code: KODE, end_qty: 7, pada: pada.toISOString() }] },
      },
    ];
    http.get.mockResolvedValue(detail(7));

    expect(await kirimWebhook("evt_gema_dead")).toEqual({ kind: "skipped", reason: ALASAN_GEMA_PUSH });
    expect(stok.onHand).toBe(10);
  });
});
