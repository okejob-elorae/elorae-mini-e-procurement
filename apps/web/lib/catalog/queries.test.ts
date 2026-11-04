import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { serializeCatalogItem, listCatalogForPwa, listReturCatalogForPwa } from "./queries";
import { prisma, seededId } from "@elorae/db";
import { katalogPortal } from "@/lib/field-sales/portal-writer";
import { ATURAN_PORTAL_BAWAAN } from "@/lib/field-sales/portal-toko-aturan";

const store = { id: "s1", termsType: "KONSI" as const, markupPercent: 20, priceDiscountPercent: null };

describe("serializeCatalogItem", () => {
  const baseRow = {
    id: "i1",
    sku: "FG-RED-M",
    nameId: "Kaos Merah M",
    categoryId: "c1",
    category: { name: "Kaos" },
    sellingPrice: 10000,
    minOrderQty: null,
    inventoryValues: [
      { qtyOnHand: 8, reservedQty: 3, totalValue: 0 },
      { qtyOnHand: 2, reservedQty: 0, totalValue: 0 },
    ],
  };

  it("maps fields, computes available, and hides price for konsi by default (spec D9, P18a)", () => {
    /* Konsi is a consignment transfer — unless the caller asks (the salesman phone only), the retail price must not even reach the wire, so price/priceLabel are null server-side. */
    expect(serializeCatalogItem(baseRow, store, "https://cdn/x.jpg", true, 6)).toEqual({
      itemId: "i1",
      sku: "FG-RED-M",
      nameId: "Kaos Merah M",
      categoryId: "c1",
      categoryName: "Kaos",
      primaryImageUrl: "https://cdn/x.jpg",
      available: 7, // (8-3) + (2-0)
      price: null,
      priceLabel: null,
      neverSent: true,
      minOrderQty: 6,
      variants: [],
    });
  });

  /* Owner answer P18: the salesman phone shows konsi fully, prices included; P18a keeps every other caller price-free. */
  it("prices a konsi item at the store's retail price only when the salesman phone asks for it", () => {
    const out = serializeCatalogItem(baseRow, store, null, true, 6, { hargaKonsi: true });
    expect(out.price).toBe(12000); // 10000 × (1 + 20/100)
    expect(out.priceLabel).toBe("Harga retail");
    expect(serializeCatalogItem(baseRow, store, null, true, 6, { hargaKonsi: false }).price).toBeNull();
  });

  it("never prices a konsi item whose store markup cannot price it, even when asked", () => {
    for (const markupPercent of [null, -1, 1000]) {
      const out = serializeCatalogItem(baseRow, { ...store, markupPercent }, null, true, 6, { hargaKonsi: true });
      expect(out.price, String(markupPercent)).toBeNull();
      expect(out.priceLabel, String(markupPercent)).toBeNull();
    }
  });

  it("returns the real selling price + label for a putus store", () => {
    const putusStore = { id: "s2", termsType: "PUTUS" as const, markupPercent: null, priceDiscountPercent: null };
    const out = serializeCatalogItem(baseRow, putusStore, null, false, 6);
    expect(out.price).toBe(10000);
    expect(out.priceLabel).toBe("Harga");
    expect(out.available).toBe(7);
    expect(out.neverSent).toBe(false);
    expect(out.minOrderQty).toBe(6);
  });

  it("applies the store's priceDiscountPercent to the putus price", () => {
    const discountedStore = { id: "s3", termsType: "PUTUS" as const, markupPercent: null, priceDiscountPercent: 10 };
    const out = serializeCatalogItem(baseRow, discountedStore, null, false, 6);
    expect(out.price).toBe(9000); // 10000 * (1 - 10/100)
    expect(out.priceLabel).toBe("Harga");
  });

  it("uses the item-level minOrderQty override instead of the global default", () => {
    const putusStore = { id: "s2", termsType: "PUTUS" as const, markupPercent: null, priceDiscountPercent: null };
    const row = { ...baseRow, minOrderQty: 3 };
    const out = serializeCatalogItem(row, putusStore, null, false, 6);
    expect(out.minOrderQty).toBe(3);
  });

  it("null category, no image, no inventory, null price all serialize safely", () => {
    const row = {
      id: "i2",
      sku: "FG-X",
      nameId: "X",
      categoryId: null,
      category: null,
      sellingPrice: null,
      minOrderQty: null,
      inventoryValues: [],
    };
    expect(serializeCatalogItem(row, { termsType: "PUTUS", markupPercent: null, priceDiscountPercent: null }, null, false, 6)).toEqual({
      itemId: "i2",
      sku: "FG-X",
      nameId: "X",
      categoryId: null,
      categoryName: null,
      primaryImageUrl: null,
      available: 0,
      price: null,
      priceLabel: null,
      neverSent: false,
      minOrderQty: 6,
      variants: [],
    });
  });
});

describe("serializeCatalogItem variants", () => {
  const variantRow = (
    variants: unknown,
    inv: Array<{ variantSku: string | null; qtyOnHand: number; reservedQty: number }>,
  ) => ({
    id: "i1",
    sku: "SKU1",
    nameId: "Item 1",
    categoryId: null,
    category: null,
    sellingPrice: 10000,
    minOrderQty: null,
    variants,
    inventoryValues: inv.map((r) => ({ variantSku: r.variantSku, qtyOnHand: r.qtyOnHand, reservedQty: r.reservedQty, totalValue: 0 })),
  });
  const putusStore = { termsType: "PUTUS" as const, markupPercent: null, priceDiscountPercent: null };

  it("variant item → per-variant available list, aggregate on the card", () => {
    const c = serializeCatalogItem(
      variantRow(
        [{ Size: "S", sku: "SKU1-S" }, { Size: "L", sku: "SKU1-L" }],
        [{ variantSku: "SKU1-S", qtyOnHand: 10, reservedQty: 2 }, { variantSku: "SKU1-L", qtyOnHand: 5, reservedQty: 0 }],
      ),
      putusStore, null, false, 6,
    );
    expect(c.variants).toHaveLength(2);
    expect(c.variants.find((v) => v.variantSku === "SKU1-S")).toMatchObject({ variantLabel: expect.stringContaining("S"), available: 8 });
    expect(c.available).toBe(13); // aggregate 8 + 5
  });

  it("simple item (null bucket) → variants: []", () => {
    const c = serializeCatalogItem(variantRow(null, [{ variantSku: null, qtyOnHand: 20, reservedQty: 0 }]), putusStore, null, false, 6);
    expect(c.variants).toEqual([]);
    expect(c.available).toBe(20);
  });
});

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("listCatalogForPwa — konsi neverSent (test bed only)", () => {
  const sku = `TEST-CQ-${Math.random().toString(36).slice(2, 10)}`;
  let uomId = "";
  let sentItemId = "";
  let freshItemId = "";
  let storeId = "";
  let salesmanId = "";
  let visitId = "";

  beforeEach(async () => {
    uomId = "";
    sentItemId = "";
    freshItemId = "";
    storeId = "";
    salesmanId = "";
    visitId = "";
    const uom = await prisma.uOM.create({ data: { code: `U-${sku}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;

    const sentItem = await prisma.item.create({
      data: { sku: `${sku}-SENT`, nameId: "Sent Item", nameEn: "Sent Item", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 20000 },
    });
    sentItemId = sentItem.id;
    await prisma.inventoryValue.create({ data: { itemId: sentItemId, variantSku: "", qtyOnHand: 10, reservedQty: 0, avgCost: 1000, totalValue: 10000 } });

    const freshItem = await prisma.item.create({
      data: { sku: `${sku}-FRESH`, nameId: "Fresh Item", nameEn: "Fresh Item", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 20000 },
    });
    freshItemId = freshItem.id;
    await prisma.inventoryValue.create({ data: { itemId: freshItemId, variantSku: "", qtyOnHand: 10, reservedQty: 0, avgCost: 1000, totalValue: 10000 } });

    const konsiStore = await prisma.store.create({ data: { code: `S-${sku}`, name: "Toko Konsi Test", address: "T", termsType: "KONSI", isActive: true } });
    storeId = konsiStore.id;

    const user = await prisma.user.findFirst({ where: { email: "salesman@elorae.com" } });
    salesmanId = user!.id;
    const visit = await prisma.storeVisit.create({ data: { storeId, userId: salesmanId, checkinLat: 0, checkinLng: 0 } });
    visitId = visit.id;

    await prisma.fieldSalesOrder.create({
      data: {
        orderNo: `KONSI/TEST/${Math.random().toString(36).slice(2, 10)}`,
        storeId,
        salesmanId,
        visitId,
        status: "PENDING_APPROVAL",
        orderType: "KONSI",
        subtotal: 0,
        total: 0,
        lines: {
          create: [{ itemId: sentItemId, variantSku: "", productName: "Sent Item", qty: 1, unitPrice: 0, lineTotal: 0 }],
        },
      },
    });
  });

  afterEach(async () => {
    await prisma.fieldSalesOrderLine.deleteMany({ where: { itemId: { in: [sentItemId, freshItemId].map(seededId) } } });
    await prisma.fieldSalesOrder.deleteMany({ where: { storeId: seededId(storeId) } });
    await prisma.storeVisit.deleteMany({ where: { id: seededId(visitId) } });
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
    await prisma.stockReservation.deleteMany({ where: { itemId: { in: [sentItemId, freshItemId].map(seededId) } } });
    await prisma.stockAdjustment.deleteMany({ where: { itemId: { in: [sentItemId, freshItemId].map(seededId) } } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: { in: [sentItemId, freshItemId].map(seededId) } } });
    await prisma.item.deleteMany({ where: { id: { in: [sentItemId, freshItemId].map(seededId) } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  it("marks the sent item neverSent:false and the untouched item neverSent:true", async () => {
    const payload = await listCatalogForPwa(storeId);
    expect(payload).not.toBeNull();
    const bySku = new Map(payload!.items.map((i) => [i.itemId, i]));
    expect(bySku.get(sentItemId)!.neverSent).toBe(false);
    expect(bySku.get(freshItemId)!.neverSent).toBe(true);
  });
});

d("listCatalogForPwa — effective min-qty (test bed only)", () => {
  const sku = `TEST-CQ-MINQTY-${Math.random().toString(36).slice(2, 10)}`;
  let uomId = "";
  let globalItemId = "";
  let overrideItemId = "";
  let storeId = "";

  beforeEach(async () => {
    uomId = "";
    globalItemId = "";
    overrideItemId = "";
    storeId = "";
    await prisma.systemSetting.upsert({
      where: { key: "putus.minOrderQty" },
      create: { key: "putus.minOrderQty", value: "6" },
      update: { value: "6" },
    });

    const uom = await prisma.uOM.create({ data: { code: `U-${sku}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;

    const globalItem = await prisma.item.create({
      data: { sku: `${sku}-GLOBAL`, nameId: "Global Min Item", nameEn: "Global Min Item", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 20000, minOrderQty: null },
    });
    globalItemId = globalItem.id;
    await prisma.inventoryValue.create({ data: { itemId: globalItemId, variantSku: "", qtyOnHand: 10, reservedQty: 0, avgCost: 1000, totalValue: 10000 } });

    const overrideItem = await prisma.item.create({
      data: { sku: `${sku}-OVERRIDE`, nameId: "Override Min Item", nameEn: "Override Min Item", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 20000, minOrderQty: 3 },
    });
    overrideItemId = overrideItem.id;
    await prisma.inventoryValue.create({ data: { itemId: overrideItemId, variantSku: "", qtyOnHand: 10, reservedQty: 0, avgCost: 1000, totalValue: 10000 } });

    const putusStore = await prisma.store.create({ data: { code: `S-${sku}`, name: "Toko Putus Test", address: "T", termsType: "PUTUS", isActive: true } });
    storeId = putusStore.id;
  });

  afterEach(async () => {
    await prisma.store.deleteMany({ where: { id: seededId(storeId) } });
    await prisma.stockReservation.deleteMany({ where: { itemId: { in: [globalItemId, overrideItemId].map(seededId) } } });
    await prisma.stockAdjustment.deleteMany({ where: { itemId: { in: [globalItemId, overrideItemId].map(seededId) } } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: { in: [globalItemId, overrideItemId].map(seededId) } } });
    await prisma.item.deleteMany({ where: { id: { in: [globalItemId, overrideItemId].map(seededId) } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  it("catalog payload carries effective min-qty per item", async () => {
    const payload = await listCatalogForPwa(storeId);
    expect(payload).not.toBeNull();
    const byId = new Map(payload!.items.map((i) => [i.itemId, i]));
    expect(byId.get(globalItemId)!.minOrderQty).toBe(6); // global default
    expect(byId.get(overrideItemId)!.minOrderQty).toBe(3); // item override
  });
});

d("listCatalogForPwa — store price discount (test bed only)", () => {
  const sku = `TEST-CQ-DISC-${Math.random().toString(36).slice(2, 10)}`;
  let uomId = "";
  let itemId = "";
  let discountStoreId = "";
  let plainStoreId = "";

  beforeEach(async () => {
    uomId = ""; itemId = ""; discountStoreId = ""; plainStoreId = "";

    const uom = await prisma.uOM.create({ data: { code: `U-${sku}`, nameId: "pcs", nameEn: "pcs" } });
    uomId = uom.id;

    const item = await prisma.item.create({
      data: { sku, nameId: "Disc Item", nameEn: "Disc Item", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 5000 },
    });
    itemId = item.id;
    await prisma.inventoryValue.create({ data: { itemId, variantSku: "", qtyOnHand: 10, reservedQty: 0, avgCost: 1000, totalValue: 10000 } });

    const discountStore = await prisma.store.create({
      data: { code: `S-${sku}-D`, name: "Toko Diskon Test", address: "T", termsType: "PUTUS", priceDiscountPercent: 20, isActive: true },
    });
    discountStoreId = discountStore.id;

    const plainStore = await prisma.store.create({
      data: { code: `S-${sku}-P`, name: "Toko Biasa Test", address: "T", termsType: "PUTUS", isActive: true },
    });
    plainStoreId = plainStore.id;
  });

  afterEach(async () => {
    await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.store.deleteMany({ where: { id: { in: [seededId(discountStoreId), seededId(plainStoreId)] } } });
  });

  /*
   * Goes through the real query end to end — `listCatalogForPwa`'s own `select` (queries.ts
   * ~line 96) and its Prisma.Decimal → number coercion (~line 104), not just the pure
   * `serializeCatalogItem` mapper with a hand-built store object. Reverting either the select or
   * the coercion (e.g. dropping `priceDiscountPercent` from the select, or passing the raw
   * Decimal instead of `.toNumber()`) must fail this, not just the unit-level discount tests.
   */
  it("prices the catalog off the queried store's priceDiscountPercent", async () => {
    const payload = await listCatalogForPwa(discountStoreId);
    expect(payload).not.toBeNull();
    const item = payload!.items.find((i) => i.itemId === itemId);
    expect(item?.price).toBe(4000); // 5000 * (1 - 20/100)
    expect(item?.priceLabel).toBe("Harga");
  });

  it("prices at list for a store with no discount", async () => {
    const payload = await listCatalogForPwa(plainStoreId);
    expect(payload).not.toBeNull();
    const item = payload!.items.find((i) => i.itemId === itemId);
    expect(item?.price).toBe(5000);
  });
});

/*
 * Owner answers 2026-11-02:
 * - P3a: a "Marketplace saja" item is never offered in an offline sale picker — this catalog feeds
 *   the salesman phone, the store portal and the WhatsApp catalogue at once. The retur catalog is
 *   not filtered: goods already at the store stay returnable (P73).
 * - P18: the salesman phone shows a konsi store's prices (`hargaKonsi`).
 * - P18a: every other caller, the store portal included, stays konsi-price-free.
 */
d("listCatalogForPwa — sales channel and konsi price (test bed only)", () => {
  const sku = `TEST-CQ-SAL-${Math.random().toString(36).slice(2, 10)}`;
  let uomId = "";
  let marketplaceId = "";
  let offlineId = "";
  let keduanyaId = "";
  let marketplaceNonaktifId = "";
  let konsiId = "";
  let putusId = "";

  beforeEach(async () => {
    uomId = ""; marketplaceId = ""; offlineId = ""; keduanyaId = ""; marketplaceNonaktifId = ""; konsiId = ""; putusId = "";
    uomId = (await prisma.uOM.create({ data: { code: `U-${sku}`, nameId: "pcs", nameEn: "pcs" } })).id;
    const barang = async (akhiran: string, salesChannel: "MARKETPLACE" | "OFFLINE" | "BOTH", isActive = true) =>
      (
        await prisma.item.create({
          data: { sku: `${sku}-${akhiran}`, nameId: `Saluran ${akhiran}`, nameEn: `Channel ${akhiran}`, type: "FINISHED_GOOD", uomId, isActive, sellingPrice: 100_000, salesChannel },
        })
      ).id;
    marketplaceId = await barang("MP", "MARKETPLACE");
    offlineId = await barang("OFF", "OFFLINE");
    keduanyaId = await barang("BOTH", "BOTH");
    marketplaceNonaktifId = await barang("MPX", "MARKETPLACE", false);
    konsiId = (await prisma.store.create({ data: { code: `S-${sku}-K`, name: "Toko Konsi Saluran", address: "T", termsType: "KONSI", markupPercent: 20, isActive: true } })).id;
    putusId = (await prisma.store.create({ data: { code: `S-${sku}-P`, name: "Toko Putus Saluran", address: "T", termsType: "PUTUS", isActive: true } })).id;
  });

  afterEach(async () => {
    await prisma.item.deleteMany({ where: { id: { in: [marketplaceId, offlineId, keduanyaId, marketplaceNonaktifId].map(seededId) } } });
    await prisma.store.deleteMany({ where: { id: { in: [konsiId, putusId].map(seededId) } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  const milikUji = (items: { itemId: string }[]) =>
    items
      .map((i) => i.itemId)
      .filter((id) => [marketplaceId, offlineId, keduanyaId, marketplaceNonaktifId].includes(id))
      .sort();

  it("leaves a Marketplace saja item out and keeps Toko offline saja and Keduanya", async () => {
    const payload = await listCatalogForPwa(putusId);
    expect(payload).not.toBeNull();
    expect(milikUji(payload!.items)).toEqual([offlineId, keduanyaId].sort());
  });

  /*
   * P73: an order already made is honoured. "Ubah pesanan" rebuilds the cart from this catalog,
   * so the edit route passes the items of the salesman's own PENDING order (`tetapTampilkan`);
   * without them a line whose item became "Marketplace saja" is dropped from the rebuilt order.
   */
  it("an edit keeps the Marketplace saja line of the order being edited, priced like any other row", async () => {
    const payload = await listCatalogForPwa(putusId, { tetapTampilkan: [marketplaceId] });
    expect(milikUji(payload!.items)).toEqual([marketplaceId, offlineId, keduanyaId].sort());
    expect(payload!.items.find((i) => i.itemId === marketplaceId)?.price).toBe(100_000);
  });

  it("a fresh cart does not offer the Marketplace saja item (P3a)", async () => {
    for (const opsi of [undefined, {}, { tetapTampilkan: [] }, { tetapTampilkan: [""] }]) {
      const payload = await listCatalogForPwa(putusId, opsi);
      expect(milikUji(payload!.items)).not.toContain(marketplaceId);
    }
  });

  it("tetapTampilkan still never lists an inactive item", async () => {
    const payload = await listCatalogForPwa(putusId, { tetapTampilkan: [marketplaceNonaktifId, marketplaceNonaktifId] });
    expect(milikUji(payload!.items)).toEqual([offlineId, keduanyaId].sort());
  });

  it("the retur catalog still lists the Marketplace saja item", async () => {
    const retur = await listReturCatalogForPwa(putusId);
    expect(retur).not.toBeNull();
    // The retur catalog also keeps discontinued items, the inactive one included.
    expect(milikUji(retur!.items)).toEqual([marketplaceId, offlineId, keduanyaId, marketplaceNonaktifId].sort());
  });

  it("a putus store's catalog is always priced", async () => {
    const payload = await listCatalogForPwa(putusId);
    expect(payload!.hargaKonsiTampil).toBe(true);
    expect(payload!.items.find((i) => i.itemId === offlineId)?.price).toBe(100_000);
  });

  it("a konsi store's catalog carries no price unless the salesman phone asks for it", async () => {
    const tanpa = await listCatalogForPwa(konsiId);
    expect(tanpa!.hargaKonsiTampil).toBe(false);
    for (const b of tanpa!.items.filter((i) => [offlineId, keduanyaId].includes(i.itemId))) {
      expect(b.price).toBeNull();
      expect(b.priceLabel).toBeNull();
    }

    const salesman = await listCatalogForPwa(konsiId, { hargaKonsi: true });
    expect(salesman!.hargaKonsiTampil).toBe(true);
    const baris = salesman!.items.find((i) => i.itemId === keduanyaId);
    expect(baris?.price).toBe(120_000); // 100.000 × (1 + 20/100)
    expect(baris?.priceLabel).toBe("Harga retail");
  });

  it("the store portal of a konsi store carries no price key at all", async () => {
    const kat = await katalogPortal({
      linkId: "uji-saluran",
      toko: { id: konsiId, name: "Toko Konsi Saluran", termsType: "KONSI", salesmanId: "uji-pemegang", namaSalesman: null },
      aturan: ATURAN_PORTAL_BAWAAN,
    });
    expect(kat).not.toBeNull();
    expect(kat!.barang.some((b) => b.itemId === keduanyaId)).toBe(true);
    expect(kat!.barang.some((b) => b.itemId === marketplaceId)).toBe(false);
    const json = JSON.stringify(kat);
    expect(json).not.toContain("\"harga\"");
    expect(json).not.toContain("\"price\"");
  });
});
