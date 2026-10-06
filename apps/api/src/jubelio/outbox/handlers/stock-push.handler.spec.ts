import { Test } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { StockPushHandler, bacaStokTerkirim } from "./stock-push.handler";
import { PRISMA } from "../../../db/prisma.module";
import { JubelioHttpService } from "../../http.service";
import { OUTBOX_SKIP_REASONS } from "../outbox-status";

function row(overrides: any = {}) {
  return {
    id: "out_1",
    entityType: "stock_push",
    entityId: "item_1",
    payload: {},
    status: "PROCESSING",
    attempts: 1,
    lastError: null,
    skipReason: null,
    enqueuedById: "user_1",
    createdAt: new Date(),
    lastEnqueuedAt: new Date(),
    processedAt: null,
    deadAt: null,
    ...overrides,
  };
}

/** Satu pemetaan Jubelio. `erpVariantSku` "" = barang sederhana (tanpa varian). */
function peta(erpVariantSku: string, jubelioItemCode: string, jubelioItemGroupId = 42) {
  return { itemId: "item_1", jubelioItemGroupId, jubelioItemCode, erpVariantSku };
}

describe("StockPushHandler", () => {
  let handler: StockPushHandler;
  let prisma: any;
  let http: { put: jest.Mock };
  let warn: jest.SpyInstance;

  beforeEach(async () => {
    prisma = {
      jubelioProductMapping: { findMany: jest.fn() },
      inventoryValue: { findMany: jest.fn() },
      jubelioOutbox: { update: jest.fn().mockResolvedValue({}) },
    };
    http = { put: jest.fn() };
    const mod = await Test.createTestingModule({
      providers: [
        StockPushHandler,
        { provide: PRISMA, useValue: prisma },
        { provide: JubelioHttpService, useValue: http },
      ],
    }).compile();
    handler = mod.get(StockPushHandler);
    warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => warn.mockRestore());

  it("returns SKIPPED missing_mapping when item has no Jubelio mapping", async () => {
    prisma.jubelioProductMapping.findMany.mockResolvedValue([]);

    const result = await handler.handle(row() as any);

    expect(result).toEqual({ kind: "skipped", reason: OUTBOX_SKIP_REASONS.MISSING_MAPPING });
    expect(http.put).not.toHaveBeenCalled();
  });

  it("returns SKIPPED no_inventory when item has no InventoryValue rows", async () => {
    prisma.jubelioProductMapping.findMany.mockResolvedValue([peta("", "SKU-PARENT")]);
    prisma.inventoryValue.findMany.mockResolvedValue([]);

    const result = await handler.handle(row() as any);

    expect(result).toEqual({ kind: "skipped", reason: OUTBOX_SKIP_REASONS.NO_INVENTORY });
    expect(http.put).not.toHaveBeenCalled();
  });

  it("PUTs available per variant to the variant's own Jubelio code and returns processed", async () => {
    prisma.jubelioProductMapping.findMany.mockResolvedValue([peta("SKU-A", "SKU-A"), peta("SKU-B", "SKU-B")]);
    prisma.inventoryValue.findMany.mockResolvedValue([
      { variantSku: "SKU-A", qtyOnHand: 5, reservedQty: 2 },
      { variantSku: "SKU-B", qtyOnHand: 12, reservedQty: 0 },
    ]);
    http.put.mockResolvedValue({});

    const result = await handler.handle(row() as any);

    expect(result).toEqual({ kind: "processed" });
    expect(http.put).toHaveBeenCalledTimes(1);
    const [path, body] = http.put.mock.calls[0];
    expect(path).toBe("/inventory/items/42/stock");
    expect(body).toEqual({
      items: [
        { item_code: "SKU-A", end_qty: 3 },
        { item_code: "SKU-B", end_qty: 12 },
      ],
    });
  });

  it("sends the Jubelio item code, not the ERP variant key, when the two differ (colour segment)", async () => {
    // Ingest katalog: kode Jubelio "27000101P-BLK-XL", kunci stok ERP "27000101P-XL".
    prisma.jubelioProductMapping.findMany.mockResolvedValue([
      peta("27000101P-XL", "27000101P-BLK-XL"),
      peta("27000101P-L", "27000101P-BLK-L"),
    ]);
    prisma.inventoryValue.findMany.mockResolvedValue([
      { variantSku: "27000101P-XL", qtyOnHand: 7, reservedQty: 1 },
      { variantSku: "27000101P-L", qtyOnHand: 4, reservedQty: 0 },
    ]);
    http.put.mockResolvedValue({});

    await handler.handle(row() as any);

    expect(http.put.mock.calls[0][1].items).toEqual([
      { item_code: "27000101P-BLK-XL", end_qty: 6 },
      { item_code: "27000101P-BLK-L", end_qty: 4 },
    ]);
  });

  it("clamps end_qty at 0 when reserved exceeds on-hand", async () => {
    prisma.jubelioProductMapping.findMany.mockResolvedValue([peta("SKU-A", "SKU-A")]);
    prisma.inventoryValue.findMany.mockResolvedValue([{ variantSku: "SKU-A", qtyOnHand: 1, reservedQty: 4 }]);
    http.put.mockResolvedValue({});

    const result = await handler.handle(row() as any);

    expect(result).toEqual({ kind: "processed" });
    expect(http.put.mock.calls[0][1].items[0]).toEqual({ item_code: "SKU-A", end_qty: 0 });
  });

  it("simple item: the pooled row (variantSku \"\" or null) goes to its only mapping", async () => {
    prisma.jubelioProductMapping.findMany.mockResolvedValue([peta("", "SKU-PARENT")]);
    prisma.inventoryValue.findMany.mockResolvedValue([{ variantSku: null, qtyOnHand: 8, reservedQty: 0 }]);
    http.put.mockResolvedValue({});

    const result = await handler.handle(row() as any);

    expect(result).toEqual({ kind: "processed" });
    expect(http.put.mock.calls[0][1].items).toEqual([{ item_code: "SKU-PARENT", end_qty: 8 }]);
  });

  it("simple item with twin pooled rows (null and \"\"): ONE entry carrying the summed available", async () => {
    // null: 5 di rak; "": 0 di rak tapi 2 ditahan (pencarian cadangan memilih baris pertama).
    // Dua entri ber-kode sama dalam satu PUT = yang terakhir menang (0, atau 5) — keduanya salah.
    prisma.jubelioProductMapping.findMany.mockResolvedValue([peta("", "SKU-PARENT")]);
    prisma.inventoryValue.findMany.mockResolvedValue([
      { variantSku: null, qtyOnHand: 5, reservedQty: 0 },
      { variantSku: "", qtyOnHand: 0, reservedQty: 2 },
    ]);
    http.put.mockResolvedValue({});

    await handler.handle(row() as any);

    expect(http.put.mock.calls[0][1].items).toEqual([{ item_code: "SKU-PARENT", end_qty: 3 }]);
  });

  it("clamps the SUM at 0, not each twin row (5 on one row, 7 held on the other → 0, not 5)", async () => {
    prisma.jubelioProductMapping.findMany.mockResolvedValue([peta("", "SKU-PARENT")]);
    prisma.inventoryValue.findMany.mockResolvedValue([
      { variantSku: null, qtyOnHand: 5, reservedQty: 0 },
      { variantSku: "", qtyOnHand: 0, reservedQty: 7 },
    ]);
    http.put.mockResolvedValue({});

    await handler.handle(row() as any);

    expect(http.put.mock.calls[0][1].items).toEqual([{ item_code: "SKU-PARENT", end_qty: 0 }]);
  });

  it("variant item: an EMPTY pooled row (0 on hand, 0 held) is dropped without a warning", async () => {
    prisma.jubelioProductMapping.findMany.mockResolvedValue([peta("SKU-S", "SKU-S"), peta("SKU-M", "SKU-M")]);
    prisma.inventoryValue.findMany.mockResolvedValue([
      { variantSku: null, qtyOnHand: 0, reservedQty: 0 },
      { variantSku: "SKU-S", qtyOnHand: 2, reservedQty: 0 },
    ]);
    http.put.mockResolvedValue({});

    const result = await handler.handle(row() as any);

    expect(result).toEqual({ kind: "processed" });
    expect(http.put.mock.calls[0][1].items).toEqual([{ item_code: "SKU-S", end_qty: 2 }]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("variant rows in two Jubelio groups get one PUT per group", async () => {
    prisma.jubelioProductMapping.findMany.mockResolvedValue([peta("SKU-S", "SKU-S", 42), peta("SKU-M", "SKU-M", 43)]);
    prisma.inventoryValue.findMany.mockResolvedValue([
      { variantSku: "SKU-S", qtyOnHand: 2, reservedQty: 0 },
      { variantSku: "SKU-M", qtyOnHand: 6, reservedQty: 1 },
    ]);
    http.put.mockResolvedValue({});

    await handler.handle(row() as any);

    expect(http.put.mock.calls).toEqual([
      ["/inventory/items/42/stock", { items: [{ item_code: "SKU-S", end_qty: 2 }] }],
      ["/inventory/items/43/stock", { items: [{ item_code: "SKU-M", end_qty: 5 }] }],
    ]);
  });

  it("variant item: the pooled row is skipped and logged, never sent to an arbitrary variant code", async () => {
    prisma.jubelioProductMapping.findMany.mockResolvedValue([peta("SKU-S", "SKU-S"), peta("SKU-M", "SKU-M")]);
    prisma.inventoryValue.findMany.mockResolvedValue([
      { variantSku: null, qtyOnHand: 30, reservedQty: 0 },
      { variantSku: "", qtyOnHand: 5, reservedQty: 0 },
      { variantSku: "SKU-S", qtyOnHand: 2, reservedQty: 0 },
      { variantSku: "SKU-M", qtyOnHand: 3, reservedQty: 1 },
    ]);
    http.put.mockResolvedValue({});

    const result = await handler.handle(row() as any);

    expect(result).toEqual({ kind: "processed" });
    expect(http.put.mock.calls[0][1].items).toEqual([
      { item_code: "SKU-S", end_qty: 2 },
      { item_code: "SKU-M", end_qty: 2 },
    ]);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/\(tanpa varian\)/));
  });

  it("variant item whose only stock row is pooled: SKIPPED, nothing sent", async () => {
    prisma.jubelioProductMapping.findMany.mockResolvedValue([peta("SKU-S", "SKU-S"), peta("SKU-M", "SKU-M")]);
    prisma.inventoryValue.findMany.mockResolvedValue([{ variantSku: null, qtyOnHand: 30, reservedQty: 0 }]);

    const result = await handler.handle(row() as any);

    expect(result).toEqual({ kind: "skipped", reason: `${OUTBOX_SKIP_REASONS.MISSING_MAPPING}:stock_rows` });
    expect(http.put).not.toHaveBeenCalled();
  });

  it("skips a variant row with no mapping instead of sending an unknown code", async () => {
    prisma.jubelioProductMapping.findMany.mockResolvedValue([peta("SKU-S", "SKU-S")]);
    prisma.inventoryValue.findMany.mockResolvedValue([
      { variantSku: "SKU-S", qtyOnHand: 2, reservedQty: 0 },
      { variantSku: "SKU-XXL", qtyOnHand: 9, reservedQty: 0 },
    ]);
    http.put.mockResolvedValue({});

    await handler.handle(row() as any);

    expect(http.put.mock.calls[0][1].items).toEqual([{ item_code: "SKU-S", end_qty: 2 }]);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/SKU-XXL/));
  });

  it("skips a row whose ERP key matches two Jubelio codes (two colours, one size key)", async () => {
    prisma.jubelioProductMapping.findMany.mockResolvedValue([
      peta("27000101P-XL", "27000101P-BLK-XL"),
      peta("27000101P-XL", "27000101P-WHT-XL"),
      peta("27000101P-L", "27000101P-BLK-L"),
    ]);
    prisma.inventoryValue.findMany.mockResolvedValue([
      { variantSku: "27000101P-XL", qtyOnHand: 7, reservedQty: 0 },
      { variantSku: "27000101P-L", qtyOnHand: 4, reservedQty: 0 },
    ]);
    http.put.mockResolvedValue({});

    await handler.handle(row() as any);

    expect(http.put.mock.calls[0][1].items).toEqual([{ item_code: "27000101P-BLK-L", end_qty: 4 }]);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/27000101P-XL/));
  });

  it("rethrows when Jubelio call fails", async () => {
    prisma.jubelioProductMapping.findMany.mockResolvedValue([peta("SKU-A", "SKU-A")]);
    prisma.inventoryValue.findMany.mockResolvedValue([{ variantSku: "SKU-A", qtyOnHand: 1, reservedQty: 0 }]);
    http.put.mockRejectedValue(new Error("Jubelio 500"));

    await expect(handler.handle(row() as any)).rejects.toThrow(/Jubelio 500/);
  });

  /*
   * Catatan angka yang DITERIMA Jubelio (`payload.terkirim`) — bahan penekan gema di
   * penangan webhook stok. Ditulis sesudah setiap PUT yang berhasil, per kode Jubelio.
   */
  describe("catatan angka terkirim untuk penekan gema", () => {
    const catatan = () => prisma.jubelioOutbox.update.mock.calls.map((c: any[]) => c[0]);

    it("onHand 10, ditahan 3 → PUT 7, lalu payload mencatat { item_code, end_qty: 7, pada } tanpa membuang isi lama", async () => {
      prisma.jubelioProductMapping.findMany.mockResolvedValue([peta("SKU-A", "SKU-A")]);
      prisma.inventoryValue.findMany.mockResolvedValue([{ variantSku: "SKU-A", qtyOnHand: 10, reservedQty: 3 }]);
      http.put.mockResolvedValue({});
      const sebelum = Date.now();

      const result = await handler.handle(row({ payload: { sumber: "GRN", ref: "GRN/2026/0001" } }) as any);

      expect(result).toEqual({ kind: "processed" });
      expect(http.put.mock.calls[0][1].items).toEqual([{ item_code: "SKU-A", end_qty: 7 }]);
      const [tulis] = catatan();
      expect(tulis.where).toEqual({ id: "out_1" });
      expect(tulis.data.payload).toEqual({
        sumber: "GRN",
        ref: "GRN/2026/0001",
        terkirim: [{ item_code: "SKU-A", end_qty: 7, pada: expect.any(String) }],
      });
      const pada = Date.parse(tulis.data.payload.terkirim[0].pada);
      expect(pada).toBeGreaterThanOrEqual(sebelum);
      expect(pada).toBeLessThanOrEqual(Date.now());
      // Yang dicatat persis yang terbaca kembali oleh penangan webhook.
      expect(bacaStokTerkirim(tulis.data.payload)).toEqual(tulis.data.payload.terkirim);
    });

    it("mencatat angka SESUDAH clamp (oversell 1 − 4 → 0), sama dengan yang dikirim", async () => {
      prisma.jubelioProductMapping.findMany.mockResolvedValue([peta("SKU-A", "SKU-A")]);
      prisma.inventoryValue.findMany.mockResolvedValue([{ variantSku: "SKU-A", qtyOnHand: 1, reservedQty: 4 }]);
      http.put.mockResolvedValue({});

      await handler.handle(row() as any);

      expect(catatan()[0].data.payload.terkirim).toEqual([{ item_code: "SKU-A", end_qty: 0, pada: expect.any(String) }]);
    });

    it("PUT gagal → tidak ada catatan (Jubelio tidak menerima apa pun)", async () => {
      prisma.jubelioProductMapping.findMany.mockResolvedValue([peta("SKU-A", "SKU-A")]);
      prisma.inventoryValue.findMany.mockResolvedValue([{ variantSku: "SKU-A", qtyOnHand: 1, reservedQty: 0 }]);
      http.put.mockRejectedValue(new Error("Jubelio 500"));

      await expect(handler.handle(row() as any)).rejects.toThrow(/Jubelio 500/);
      expect(prisma.jubelioOutbox.update).not.toHaveBeenCalled();
    });

    it("dua grup: grup pertama tercatat walau PUT grup kedua gagal (angkanya sudah diterima Jubelio)", async () => {
      prisma.jubelioProductMapping.findMany.mockResolvedValue([peta("SKU-S", "SKU-S", 42), peta("SKU-M", "SKU-M", 43)]);
      prisma.inventoryValue.findMany.mockResolvedValue([
        { variantSku: "SKU-S", qtyOnHand: 2, reservedQty: 0 },
        { variantSku: "SKU-M", qtyOnHand: 6, reservedQty: 1 },
      ]);
      http.put.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("Jubelio 502"));

      await expect(handler.handle(row() as any)).rejects.toThrow(/Jubelio 502/);
      expect(catatan()).toHaveLength(1);
      expect(catatan()[0].data.payload.terkirim).toEqual([{ item_code: "SKU-S", end_qty: 2, pada: expect.any(String) }]);
    });

    it("dua grup berhasil: catatan terakhir memuat kedua kode", async () => {
      prisma.jubelioProductMapping.findMany.mockResolvedValue([peta("SKU-S", "SKU-S", 42), peta("SKU-M", "SKU-M", 43)]);
      prisma.inventoryValue.findMany.mockResolvedValue([
        { variantSku: "SKU-S", qtyOnHand: 2, reservedQty: 0 },
        { variantSku: "SKU-M", qtyOnHand: 6, reservedQty: 1 },
      ]);
      http.put.mockResolvedValue({});

      await handler.handle(row() as any);

      const terakhir = catatan().at(-1);
      expect(terakhir.data.payload.terkirim.map((e: any) => [e.item_code, e.end_qty])).toEqual([
        ["SKU-S", 2],
        ["SKU-M", 5],
      ]);
    });

    it("percobaan ulang: angka baru menggantikan catatan lama untuk kode yang sama, kode lain dipertahankan", async () => {
      prisma.jubelioProductMapping.findMany.mockResolvedValue([peta("SKU-A", "SKU-A")]);
      prisma.inventoryValue.findMany.mockResolvedValue([{ variantSku: "SKU-A", qtyOnHand: 10, reservedQty: 4 }]);
      http.put.mockResolvedValue({});
      const lama = new Date(Date.now() - 60_000).toISOString();

      await handler.handle(
        row({
          payload: {
            sumber: "GRN",
            terkirim: [
              { item_code: "SKU-A", end_qty: 7, pada: lama },
              { item_code: "SKU-Z", end_qty: 1, pada: lama },
            ],
          },
        }) as any,
      );

      const terkirim = catatan()[0].data.payload.terkirim;
      expect(terkirim).toHaveLength(2);
      expect(terkirim).toEqual(
        expect.arrayContaining([
          { item_code: "SKU-Z", end_qty: 1, pada: lama },
          { item_code: "SKU-A", end_qty: 6, pada: expect.any(String) },
        ]),
      );
      expect(terkirim.find((e: any) => e.item_code === "SKU-A").pada).not.toBe(lama);
    });

    it("gagal menyimpan catatan tidak menggagalkan push (sudah diterima Jubelio) — dicatat ke log", async () => {
      prisma.jubelioProductMapping.findMany.mockResolvedValue([peta("SKU-A", "SKU-A")]);
      prisma.inventoryValue.findMany.mockResolvedValue([{ variantSku: "SKU-A", qtyOnHand: 10, reservedQty: 3 }]);
      http.put.mockResolvedValue({});
      prisma.jubelioOutbox.update.mockRejectedValue(new Error("db putus"));

      const result = await handler.handle(row() as any);

      expect(result).toEqual({ kind: "processed" });
      expect(http.put).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/db putus/));
    });

    it("bacaStokTerkirim: payload lama/rusak → hanya entri sah", () => {
      const pada = new Date().toISOString();
      expect(bacaStokTerkirim({})).toEqual([]);
      expect(bacaStokTerkirim(null)).toEqual([]);
      expect(bacaStokTerkirim("teks")).toEqual([]);
      expect(bacaStokTerkirim({ terkirim: "bukan daftar" })).toEqual([]);
      expect(
        bacaStokTerkirim({
          terkirim: [
            { item_code: "A", end_qty: 7, pada },
            { item_code: "B", end_qty: "7", pada },
            { item_code: "C", end_qty: 7, pada: "kemarin" },
            { end_qty: 7, pada },
            null,
          ],
        }),
      ).toEqual([{ item_code: "A", end_qty: 7, pada }]);
    });
  });
});
