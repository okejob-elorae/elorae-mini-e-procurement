import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { putuskanGrnTanpaPo } from "./grn-tanpa-po-writer";
import { createVendorBill, VendorBillError } from "@/lib/vendor-billing/bill-writer";

/*
 * GRN tanpa PO menunggu konfirmasi admin (keputusan pemilik 2026-11-02, P51a) terhadap basis data uji:
 * konfirmasi menjalankan pemrosesan GRN yang sama persis (harga rata-rata, kartu stok ber-ref GRN), satu
 * kali saja walau dua konfirmasi balapan, dan baris yang variannya tidak lagi sesuai definisi barang
 * ditolak SEBELUM apa pun tertulis.
 */

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

d("putuskanGrnTanpaPo (test bed only)", () => {
  let tag = "";
  const ids = { user: "", supplierType: "", supplier: "", uom: "", item: "" };
  const grnIds: string[] = [];

  beforeEach(async () => {
    tag = `GTP${Math.floor(Math.random() * 10_000_000)}`;
    ids.user = (await prisma.user.create({ data: { email: `${tag}@test.local`, name: "Uji Gudang" } })).id;
    ids.supplierType = (await prisma.supplierType.create({ data: { code: `ST-${tag}`, name: "Uji" } })).id;
    ids.supplier = (await prisma.supplier.create({ data: { code: `SUP-${tag}`, name: "Pemasok uji", typeId: ids.supplierType } })).id;
    ids.uom = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    ids.item = (await prisma.item.create({ data: { sku: `${tag}-KAOS`, nameId: `Kaos ${tag}`, nameEn: "Tee", type: "FINISHED_GOOD", uomId: ids.uom, isActive: true } })).id;
  });

  afterEach(async () => {
    if (ids.supplier) {
      const bills = (await prisma.vendorBill.findMany({ where: { supplierId: seededId(ids.supplier) }, select: { id: true } })).map((b) => b.id);
      await prisma.supplierPayableCorrection.deleteMany({ where: { billId: { in: seededIds(bills) } } });
      await prisma.vendorBillLine.deleteMany({ where: { billId: { in: seededIds(bills) } } });
      await prisma.vendorBill.deleteMany({ where: { id: { in: seededIds(bills) } } });
    }
    if (ids.item) {
      await prisma.stockLedgerEntry.deleteMany({ where: { itemId: seededId(ids.item) } });
      await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(ids.item) } });
    }
    if (grnIds.length > 0) await prisma.gRN.deleteMany({ where: { id: { in: seededIds(grnIds) } } });
    grnIds.length = 0;
    if (ids.user) await prisma.auditLog.deleteMany({ where: { userId: seededId(ids.user) } });
    if (ids.item) await prisma.item.deleteMany({ where: { id: seededId(ids.item) } });
    if (ids.uom) await prisma.uOM.deleteMany({ where: { id: seededId(ids.uom) } });
    if (ids.supplier) await prisma.supplier.deleteMany({ where: { id: seededId(ids.supplier) } });
    if (ids.supplierType) await prisma.supplierType.deleteMany({ where: { id: seededId(ids.supplierType) } });
    if (ids.user) await prisma.user.deleteMany({ where: { id: seededId(ids.user) } });
    Object.keys(ids).forEach((k) => (ids[k as keyof typeof ids] = ""));
  });

  /** A no-PO GRN as `createGRN` stores it while it waits: the base lines, nothing moved. */
  const grnMenunggu = async (variantSku: string | null = null) => {
    const g = await prisma.gRN.create({
      data: {
        docNumber: `GRN-${tag}-${grnIds.length}`,
        supplierId: ids.supplier,
        receivedBy: ids.user,
        totalAmount: 800_000,
        requiresNoPoConfirmation: true,
        items: [
          {
            itemId: ids.item,
            variantKey: variantSku,
            variantSku,
            qty: 100,
            unitCost: 8_000,
            itemType: "FINISHED_GOOD",
            uomId: ids.uom,
            overReceiveThreshold: null,
            rolls: [],
            totalCost: 800_000,
          },
        ],
      },
      select: { id: true, docNumber: true },
    });
    grnIds.push(g.id);
    return g;
  };

  it("moves nothing while waiting, then processes exactly like a GRN with a PO on confirmation", async () => {
    const g = await grnMenunggu();
    expect(await prisma.stockLedgerEntry.count({ where: { refType: "GRN", refId: g.id } })).toBe(0);
    expect(await prisma.inventoryValue.count({ where: { itemId: ids.item } })).toBe(0);

    const r = await putuskanGrnTanpaPo({ grnId: g.id, keputusan: "KONFIRMASI", olehUserId: ids.user });
    expect(r).toEqual({ ok: true, barang: [ids.item], docNumber: g.docNumber });
    const iv = await prisma.inventoryValue.findFirstOrThrow({ where: { itemId: ids.item } });
    expect([Number(iv.qtyOnHand), Number(iv.avgCost)]).toEqual([100, 8_000]);
    expect(await prisma.stockLedgerEntry.count({ where: { refType: "GRN", refId: g.id, locationType: "MAIN" } })).toBe(1);
    const saved = await prisma.gRN.findUniqueOrThrow({ where: { id: g.id } });
    expect(saved.noPoConfirmedAt).not.toBeNull();
    expect(saved.noPoConfirmedById).toBe(ids.user);
    expect(await prisma.auditLog.count({ where: { entityType: "GRN", entityId: g.id, action: "GRN_NO_PO_CONFIRMED" } })).toBe(1);

    expect(await putuskanGrnTanpaPo({ grnId: g.id, keputusan: "KONFIRMASI", olehUserId: ids.user })).toEqual({ ok: false, kode: "SUDAH_DIPUTUSKAN" });
  });

  it("refuses a line whose variant no longer matches the item, before writing anything", async () => {
    const g = await grnMenunggu("TIDAK-ADA");
    const r = await putuskanGrnTanpaPo({ grnId: g.id, keputusan: "KONFIRMASI", olehUserId: ids.user });
    expect(r).toMatchObject({ ok: false, kode: "VARIANT_NOT_ALLOWED" });
    expect((await prisma.gRN.findUniqueOrThrow({ where: { id: g.id } })).noPoConfirmedAt).toBeNull();
    expect(await prisma.inventoryValue.count({ where: { itemId: ids.item } })).toBe(0);
  });

  it("refuses an unknown decision (declining is not built yet)", async () => {
    const g = await grnMenunggu();
    expect(await putuskanGrnTanpaPo({ grnId: g.id, keputusan: "TOLAK", olehUserId: ids.user })).toEqual({ ok: false, kode: "KEPUTUSAN_TIDAK_SAH" });
  });

  it("RACE: two confirmations at once move the stock once", async () => {
    const g = await grnMenunggu();
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const hasil = await Promise.all([
      putuskanGrnTanpaPo({ grnId: g.id, keputusan: "KONFIRMASI", olehUserId: ids.user }),
      sleep(5).then(() => putuskanGrnTanpaPo({ grnId: g.id, keputusan: "KONFIRMASI", olehUserId: ids.user })),
    ]);
    expect(hasil.filter((h) => h.ok)).toHaveLength(1);
    expect(hasil.filter((h) => !h.ok).map((h) => (h.ok ? null : h.kode))).toEqual(["SUDAH_DIPUTUSKAN"]);
    expect(await prisma.stockLedgerEntry.count({ where: { refType: "GRN", refId: g.id } })).toBe(1);
    expect(Number((await prisma.inventoryValue.findFirstOrThrow({ where: { itemId: ids.item } })).qtyOnHand)).toBe(100);
  });

  it.each([
    ["the confirmation starts a few ms later", 0, 5],
    ["the bill starts a few ms later", 5, 0],
  ])("RACE: a bill naming the GRN × the confirmation (%s) — never a bill on an unconfirmed GRN", async (_n, tundaTagih, tundaKonfirmasi) => {
    const g = await grnMenunggu();
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const [tagih, konfirmasi] = await Promise.allSettled([
      sleep(tundaTagih).then(() =>
        createVendorBill(
          {
            supplierId: ids.supplier,
            vendorInvoiceNo: `INV-${tag}-${tundaTagih}`,
            billDate: new Date("2026-11-03"),
            lines: [{ type: "GRN_ITEM", grnId: g.id, itemId: ids.item, variantSku: null, qty: 100, price: 8_000 }],
          },
          ids.user,
        ),
      ),
      sleep(tundaKonfirmasi).then(() => putuskanGrnTanpaPo({ grnId: g.id, keputusan: "KONFIRMASI", olehUserId: ids.user })),
    ]);
    // Konfirmasi selalu berhasil: tagihan tidak mengubah keadaan konfirmasinya.
    expect(konfirmasi.status === "fulfilled" && konfirmasi.value.ok).toBe(true);
    const saved = await prisma.gRN.findUniqueOrThrow({ where: { id: g.id } });
    if (tagih.status === "rejected") {
      expect(tagih.reason).toBeInstanceOf(VendorBillError);
      expect((tagih.reason as VendorBillError).code).toBe("GRN_MENUNGGU_KONFIRMASI");
      expect(await prisma.vendorBillLine.count({ where: { grnId: g.id } })).toBe(0);
    } else {
      // Tagihan yang lolos ditulis SESUDAH konfirmasinya commit.
      const bill = await prisma.vendorBill.findUniqueOrThrow({ where: { id: tagih.value.id } });
      expect(saved.noPoConfirmedAt).not.toBeNull();
      expect(bill.createdAt.getTime()).toBeGreaterThanOrEqual(saved.noPoConfirmedAt!.getTime());
    }
    expect(await prisma.stockLedgerEntry.count({ where: { refType: "GRN", refId: g.id } })).toBe(1);
  });
});
