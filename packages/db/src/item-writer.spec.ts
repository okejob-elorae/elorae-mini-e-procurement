import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "./index";
import {
  createItemFromIngest,
  markJubelioCreateRequested,
  recordJubelioObservedPrice,
  recordJubelioPriceOnMapping,
} from "./item-writer";
import { seededId } from "./spec-teardown";

// Writes Item rows — never run against the shared prod DB (port 3307 tunnel / VPS host).
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

/*
 * Owner decision 2026-11-02: a price reaches Jubelio only after it is confirmed in the ERP. These
 * three helpers are the only way apps/api touches the confirmation columns, so they are pinned
 * against a real database: what an ingest-created item records, and that the two backstops are
 * single-statement compare-and-swaps that never undo a confirmation.
 */
d("item-writer Jubelio price confirmation (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  let uomId = "";
  let itemIds: string[] = [];
  let mappingIds: string[] = [];

  let putaran = 0;
  beforeEach(async () => {
    uomId = "";
    itemIds = [];
    mappingIds = [];
    putaran += 1;
    uomId = (await prisma.uOM.create({ data: { code: `TEST-UOM-IW-${token}-${putaran}`, nameId: "Pcs", nameEn: "Pcs" } })).id;
  });

  afterEach(async () => {
    await prisma.jubelioProductMapping.deleteMany({ where: { id: { in: mappingIds.map(seededId) } } });
    await prisma.item.deleteMany({ where: { id: { in: itemIds.map(seededId) } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  let urut = 0;
  async function barang(lain: Record<string, unknown> = {}) {
    urut += 1;
    const item = await prisma.item.create({
      data: {
        sku: `TEST-IW-${token}-${urut}`,
        nameId: "Kaos uji",
        nameEn: "Test tee",
        type: "FINISHED_GOOD",
        source: "ERP",
        uomId,
        ...lain,
      },
      select: { id: true },
    });
    itemIds.push(item.id);
    return item.id;
  }

  async function petakan(itemId: string) {
    const angka = Math.floor(Math.random() * 1e9) + 1e9;
    const m = await prisma.jubelioProductMapping.create({
      data: { itemId, jubelioItemGroupId: angka, jubelioItemId: angka, jubelioItemCode: `TEST-IW-${token}-${angka}`, erpVariantSku: "" },
      select: { id: true },
    });
    mappingIds.push(m.id);
  }

  async function keadaan(itemId: string) {
    const b = await prisma.item.findUniqueOrThrow({
      where: { id: seededId(itemId) },
      select: {
        sellingPrice: true,
        jubelioConfirmedPrice: true,
        jubelioConfirmedAt: true,
        jubelioConfirmedById: true,
        jubelioCreateRequestedAt: true,
        jubelioCreateRequestedById: true,
      },
    });
    return {
      harga: b.sellingPrice == null ? null : Number(b.sellingPrice),
      dikonfirmasi: b.jubelioConfirmedPrice == null ? null : Number(b.jubelioConfirmedPrice),
      dikonfirmasiPada: b.jubelioConfirmedAt,
      dikonfirmasiOleh: b.jubelioConfirmedById,
      diajukanPada: b.jubelioCreateRequestedAt,
      diajukanOleh: b.jubelioCreateRequestedById,
    };
  }

  describe("createItemFromIngest", () => {
    it("records Jubelio's sell_price as the confirmed price of a new item", async () => {
      const now = new Date("2026-11-02T03:00:00.000Z");
      urut += 1;
      const item = await prisma.$transaction((tx) =>
        createItemFromIngest(tx, { sku: `TEST-IW-${token}-${urut}`, nameId: "Kaos", nameEn: "Tee", type: "FINISHED_GOOD", uomId, sellingPrice: 150_000 }, now),
      );
      itemIds.push(item.id);
      const k = await keadaan(item.id);
      expect(k).toMatchObject({ harga: 150_000, dikonfirmasi: 150_000, dikonfirmasiOleh: null, diajukanPada: null });
      expect(k.dikonfirmasiPada?.toISOString()).toBe(now.toISOString());
    });

    it.each([
      ["an empty", null],
      ["a zero", 0],
    ])("confirms nothing for %s sell_price", async (_label, harga) => {
      urut += 1;
      const item = await prisma.$transaction((tx) =>
        createItemFromIngest(tx, { sku: `TEST-IW-${token}-${urut}`, nameId: "Kaos", nameEn: "Tee", type: "FINISHED_GOOD", uomId, sellingPrice: harga }),
      );
      itemIds.push(item.id);
      expect(await keadaan(item.id)).toMatchObject({ dikonfirmasi: null, dikonfirmasiPada: null, dikonfirmasiOleh: null });
    });
  });

  describe("markJubelioCreateRequested", () => {
    it("stamps an unmapped ERP finished good with no confirmed price", async () => {
      const id = await barang({ sellingPrice: 120_000 });
      const user = await prisma.user.findFirst({ select: { id: true } });
      const now = new Date("2026-11-02T04:00:00.000Z");
      expect(await markJubelioCreateRequested(prisma, id, user?.id ?? null, now)).toBe(true);
      const k = await keadaan(id);
      expect(k.diajukanPada?.toISOString()).toBe(now.toISOString());
      expect(k.diajukanOleh).toBe(user?.id ?? null);
      expect(k.harga).toBe(120_000);
    });

    it("leaves the row untouched when it has a confirmed price, a mapping, a marker, the ingest source or another type", async () => {
      const dikonfirmasi = await barang({ sellingPrice: 100_000, jubelioConfirmedPrice: 100_000, jubelioConfirmedAt: new Date() });
      const terpetakan = await barang({ sellingPrice: 100_000 });
      await petakan(terpetakan);
      const sudahDiajukan = new Date("2026-10-30T01:00:00.000Z");
      const diajukan = await barang({ sellingPrice: 100_000, jubelioCreateRequestedAt: sudahDiajukan });
      const ingest = await barang({ sellingPrice: 100_000, source: "JUBELIO_INGEST" });
      const kain = await barang({ type: "FABRIC" });
      for (const id of [dikonfirmasi, terpetakan, diajukan, ingest, kain]) {
        expect(await markJubelioCreateRequested(prisma, id, null), id).toBe(false);
      }
      expect((await keadaan(dikonfirmasi)).diajukanPada).toBeNull();
      expect((await keadaan(terpetakan)).diajukanPada).toBeNull();
      expect((await keadaan(diajukan)).diajukanPada?.toISOString()).toBe(sudahDiajukan.toISOString());
      expect((await keadaan(ingest)).diajukanPada).toBeNull();
      expect((await keadaan(kain)).diajukanPada).toBeNull();
    });

    it("racing a confirmation never leaves a stamp on a confirmed item", async () => {
      for (const jedaStempel of [0, 5]) {
        const id = await barang({ sellingPrice: 150_000 });
        const konfirmasi = prisma.item.update({
          where: { id: seededId(id) },
          data: { jubelioConfirmedPrice: 150_000, jubelioConfirmedAt: new Date(), jubelioCreateRequestedAt: null, jubelioCreateRequestedById: null },
        });
        const stempel = new Promise((r) => setTimeout(r, jedaStempel)).then(() => markJubelioCreateRequested(prisma, id, null));
        await Promise.all([konfirmasi, stempel]);
        // Either the stamp ran first and the confirmation cleared it, or it saw the confirmed
        // price and wrote nothing. Never a marker beside a confirmed price.
        const k = await keadaan(id);
        expect(k.dikonfirmasi).toBe(150_000);
        expect(k.diajukanPada).toBeNull();
      }
    });
  });

  describe("recordJubelioPriceOnMapping", () => {
    it("records Jubelio's price on an item with no confirmed price and clears a stale request, leaving sellingPrice alone", async () => {
      const id = await barang({ sellingPrice: 175_000, jubelioCreateRequestedAt: new Date() });
      await petakan(id);
      expect(await recordJubelioPriceOnMapping(prisma, id, "150000")).toBe(true);
      expect(await keadaan(id)).toMatchObject({ harga: 175_000, dikonfirmasi: 150_000, dikonfirmasiOleh: null, diajukanPada: null });
    });

    it("never overwrites a confirmed price", async () => {
      const id = await barang({ sellingPrice: 175_000, jubelioConfirmedPrice: 160_000, jubelioConfirmedAt: new Date() });
      expect(await recordJubelioPriceOnMapping(prisma, id, "150000")).toBe(false);
      expect((await keadaan(id)).dikonfirmasi).toBe(160_000);
    });

    it.each([
      ["empty", null],
      ["blank", ""],
      ["zero", "0"],
    ])("records nothing for an %s Jubelio price", async (_label, harga) => {
      const id = await barang({ sellingPrice: 175_000 });
      expect(await recordJubelioPriceOnMapping(prisma, id, harga)).toBe(false);
      expect((await keadaan(id)).dikonfirmasi).toBeNull();
    });
  });

  /*
   * Owner answers P1/P2/P75 (2026-11-02): what Jubelio shows is OBSERVED on the item, the highest
   * and lowest variant price, through one guarded statement that never touches the selling price,
   * the confirmed price or an admin's price decision.
   */
  async function terbaca(itemId: string) {
    const b = await prisma.item.findUniqueOrThrow({
      where: { id: seededId(itemId) },
      select: {
        sellingPrice: true,
        jubelioConfirmedPrice: true,
        jubelioPriceDecidedAt: true,
        jubelioObservedPriceMax: true,
        jubelioObservedPriceMin: true,
        jubelioObservedAt: true,
        jubelioObservedChangedAt: true,
        salesChannel: true,
      },
    });
    return {
      harga: b.sellingPrice == null ? null : Number(b.sellingPrice),
      dikonfirmasi: b.jubelioConfirmedPrice == null ? null : Number(b.jubelioConfirmedPrice),
      diputuskan: b.jubelioPriceDecidedAt,
      tertinggi: b.jubelioObservedPriceMax == null ? null : Number(b.jubelioObservedPriceMax),
      terendah: b.jubelioObservedPriceMin == null ? null : Number(b.jubelioObservedPriceMin),
      pada: b.jubelioObservedAt?.toISOString() ?? null,
      berubah: b.jubelioObservedChangedAt?.toISOString() ?? null,
      saluran: b.salesChannel,
    };
  }

  describe("recordJubelioObservedPrice", () => {
    const t1 = new Date("2026-11-03T01:00:00.000Z");
    const t2 = new Date("2026-11-03T01:10:00.000Z");
    const t3 = new Date("2026-11-03T01:20:00.000Z");

    it("records the figures and the read time, never the selling, confirmed or decided columns", async () => {
      const decided = new Date("2026-11-01T00:00:00.000Z");
      const id = await barang({ sellingPrice: 175_000, jubelioConfirmedPrice: 160_000, jubelioPriceDecidedAt: decided });
      expect(await recordJubelioObservedPrice(prisma, id, { highest: "110000", lowest: "100000" }, t1)).toBe(true);
      expect(await terbaca(id)).toMatchObject({
        harga: 175_000,
        dikonfirmasi: 160_000,
        tertinggi: 110_000,
        terendah: 100_000,
        pada: t1.toISOString(),
        berubah: t1.toISOString(),
      });
      expect((await terbaca(id)).diputuskan?.toISOString()).toBe(decided.toISOString());
    });

    it("keeps the change time when the same figures are read again, and moves it when one changes", async () => {
      const id = await barang();
      await recordJubelioObservedPrice(prisma, id, { highest: "110000", lowest: "100000" }, t1);
      await recordJubelioObservedPrice(prisma, id, { highest: 110_000, lowest: 100_000 }, t2);
      expect(await terbaca(id)).toMatchObject({ pada: t2.toISOString(), berubah: t1.toISOString() });
      await recordJubelioObservedPrice(prisma, id, { highest: "110000", lowest: "0" }, t3);
      expect(await terbaca(id)).toMatchObject({ terendah: 0, pada: t3.toISOString(), berubah: t3.toISOString() });
    });

    it("stores no highest price as NULL, which is a change from a price", async () => {
      const id = await barang();
      await recordJubelioObservedPrice(prisma, id, { highest: "110000", lowest: "110000" }, t1);
      await recordJubelioObservedPrice(prisma, id, { highest: null, lowest: "0" }, t2);
      expect(await terbaca(id)).toMatchObject({ tertinggi: null, terendah: 0, berubah: t2.toISOString() });
    });

    it("refuses an OLDER read once a later one is recorded", async () => {
      const id = await barang();
      await recordJubelioObservedPrice(prisma, id, { highest: "120000", lowest: "120000" }, t2);
      expect(await recordJubelioObservedPrice(prisma, id, { highest: "90000", lowest: "90000" }, t1)).toBe(false);
      expect(await terbaca(id)).toMatchObject({ tertinggi: 120_000, pada: t2.toISOString() });
    });

    it("racing an older and a newer read always ends on the newer figures", async () => {
      for (const jeda of [0, 5]) {
        const id = await barang();
        const lama = recordJubelioObservedPrice(prisma, id, { highest: "90000", lowest: "90000" }, t1);
        const baru = new Promise((r) => setTimeout(r, jeda)).then(() =>
          recordJubelioObservedPrice(prisma, id, { highest: "120000", lowest: "120000" }, t2),
        );
        await Promise.all([lama, baru]);
        expect(await terbaca(id)).toMatchObject({ tertinggi: 120_000, terendah: 120_000, pada: t2.toISOString() });
      }
    });
  });

  describe("sales channel (P3a, P71)", () => {
    it("an item created by the ingest is Keduanya and records what Jubelio showed", async () => {
      urut += 1;
      const item = await prisma.$transaction((tx) =>
        createItemFromIngest(
          tx,
          { sku: `TEST-IW-${token}-${urut}`, nameId: "Kaos", nameEn: "Tee", type: "FINISHED_GOOD", uomId, sellingPrice: 110_000 },
          t0,
          { highest: "110000", lowest: "100000", readAt: t0 },
        ),
      );
      itemIds.push(item.id);
      expect(await terbaca(item.id)).toMatchObject({
        saluran: "BOTH",
        dikonfirmasi: 110_000,
        tertinggi: 110_000,
        terendah: 100_000,
        pada: t0.toISOString(),
        berubah: t0.toISOString(),
      });
    });

    it("markJubelioCreateRequested never stamps a Toko offline saja item", async () => {
      const id = await barang({ sellingPrice: 120_000, salesChannel: "OFFLINE" });
      expect(await markJubelioCreateRequested(prisma, id, null)).toBe(false);
      expect((await keadaan(id)).diajukanPada).toBeNull();
    });
  });
});

const t0 = new Date("2026-11-03T00:00:00.000Z");
