import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId } from "@elorae/db";

/*
 * Penjaga izin aksi pembelian yang dulu terbuka untuk siapa pun yang masuk
 * (sesi ditiru, basis data uji nyata). Setiap ekspor `"use server"` adalah
 * titik akhir sendiri — proxy hanya memeriksa HALAMAN tempat aksi dipanggil.
 *
 * - Aksi baca PO/GRN/retur pemasok tanpa izin; `getPOById`, `getGRNs`,
 *   `getGRNById`, `getVendorReturnById` mengirim `supplier.bankAccountEnc` ke
 *   browser.
 * - `createUOMConversion` tanpa `auth()` sama sekali.
 * - `enqueueProductPush*` tanpa izin: siapa pun bisa mengantre push produk ke
 *   Jubelio.
 */

const sesi = vi.hoisted(() => ({ ada: true, id: "", permissions: [] as string[] }));
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () =>
    sesi.ada ? { user: { id: sesi.id, email: null, permissions: sesi.permissions } } : null,
  ),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/internal-api", () => ({ apiFetch: vi.fn(async () => ({})) }));

const po = await import("./purchase-orders");
const grn = await import("./grn");
const retur = await import("./vendor-returns");
const uom = await import("./uom");
const push = await import("./jubelio-product-push");

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

const TIDAK_ADA = "pembelian-izin-tidak-ada";
const ORANG_LAIN = ["pwa:access", "spg_sales:record", "items:view"];

type Aksi = [string, () => Promise<unknown>, string[]];

/** Aksi baca + izin mana saja yang SAH memanggilnya (dari halaman pemanggilnya). */
const aksiBaca: Aksi[] = [
  [
    "getPOs",
    () => po.getPOs({ status: "DRAFT" }, { page: 1, pageSize: 1 }),
    ["purchase_orders:view", "supplier_payments:view", "inventory:manage", "work_orders:create", "work_orders:manage"],
  ],
  [
    "getPOById",
    () => po.getPOById(TIDAK_ADA),
    ["purchase_orders:view", "supplier_payments:view", "inventory:manage", "work_orders:create", "work_orders:manage"],
  ],
  ["getPOStats", () => po.getPOStats(), ["purchase_orders:view"]],
  ["getGRNs", () => grn.getGRNs({ poId: TIDAK_ADA }, { page: 1, pageSize: 1 }), ["inventory:view", "vendor_returns:view"]],
  ["getGRNById", () => grn.getGRNById(TIDAK_ADA), ["inventory:view", "vendor_returns:view"]],
  ["getGrnJournalState", () => grn.getGrnJournalState(TIDAK_ADA), ["inventory:view"]],
  ["getVendorReturns", () => retur.getVendorReturns({ vendorId: TIDAK_ADA }, { page: 1, pageSize: 1 }), ["vendor_returns:view"]],
  ["getVendorReturnById", () => retur.getVendorReturnById(TIDAK_ADA), ["vendor_returns:view"]],
  ["getReturnableFabricRolls", () => retur.getReturnableFabricRolls(TIDAK_ADA), ["vendor_returns:view", "inventory:view"]],
  ["getAvailableRejectQtyByItem", () => retur.getAvailableRejectQtyByItem(TIDAK_ADA), ["vendor_returns:view", "inventory:view"]],
];

const pasanganSah = aksiBaca.flatMap(([nama, panggil, izin]) =>
  izin.map((i) => [`${nama} ← ${i}`, panggil, i] as const),
);

d("izin aksi pembelian (test bed only)", () => {
  beforeEach(() => {
    sesi.ada = true;
    sesi.id = "penguji-pembelian";
    sesi.permissions = [];
  });

  describe("aksi baca", () => {
    it.each(aksiBaca)("%s menolak pengguna tanpa izin", async (_nama, panggil) => {
      sesi.permissions = ORANG_LAIN;
      await expect(panggil()).rejects.toThrow(/Forbidden/);
    });

    it.each(aksiBaca)("%s menolak tanpa sesi", async (_nama, panggil) => {
      sesi.ada = false;
      await expect(panggil()).rejects.toThrow(/Unauthorized/);
    });

    it.each(pasanganSah)("%s tetap boleh", async (_nama, panggil, izin) => {
      sesi.permissions = [izin];
      await expect(panggil()).resolves.toBeDefined();
    });

    it("admin wildcard * tetap boleh", async () => {
      sesi.permissions = ["*"];
      await expect(po.getPOById(TIDAK_ADA)).resolves.toBeNull();
      await expect(grn.getGRNById(TIDAK_ADA)).resolves.toBeNull();
      await expect(retur.getVendorReturnById(TIDAK_ADA)).resolves.toBeNull();
    });
  });

  describe("UOM", () => {
    it.each([
      ["getUOMs", () => uom.getUOMs()],
      ["getUOMConversions", () => uom.getUOMConversions()],
      ["getItemUomAndConversions", () => uom.getItemUomAndConversions(TIDAK_ADA)],
    ] as Array<[string, () => Promise<unknown>]>)("%s butuh sesi", async (_nama, panggil) => {
      sesi.ada = false;
      await expect(panggil()).rejects.toThrow(/Unauthorized/);
      sesi.ada = true;
      sesi.permissions = ORANG_LAIN;
      await expect(panggil()).resolves.toBeDefined();
    });
  });

  describe("data yang dikirim ke browser & tulis UOM/push", () => {
    const token = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
    let userId = "";
    let typeId = "";
    let supplierId = "";
    let poId = "";
    let grnId = "";
    let returId = "";
    let uomA = "";
    let uomB = "";
    let itemFgId = "";

    beforeAll(async () => {
      userId = "";
      typeId = "";
      supplierId = "";
      poId = "";
      grnId = "";
      returId = "";
      uomA = "";
      uomB = "";
      itemFgId = "";
      userId = (await prisma.user.create({ data: { email: `beli-izin-${token}@uji.local` }, select: { id: true } })).id;
      typeId = (
        await prisma.supplierType.create({ data: { code: `TBI-${token}`, name: `Jenis beli ${token}` }, select: { id: true } })
      ).id;
      supplierId = (
        await prisma.supplier.create({
          data: { code: `SUP-BI-${token}`, name: "Pemasok bocor", typeId, bankAccountEnc: "RAHASIA-TERENKRIPSI" },
          select: { id: true },
        })
      ).id;
      poId = (
        await prisma.purchaseOrder.create({
          data: { docNumber: `PO-BI-${token}`, supplierId, createdById: userId },
          select: { id: true },
        })
      ).id;
      grnId = (
        await prisma.gRN.create({
          data: { docNumber: `GRN-BI-${token}`, poId, supplierId, receivedBy: userId, totalAmount: 0, items: "[]" },
          select: { id: true },
        })
      ).id;
      returId = (
        await prisma.vendorReturn.create({
          data: { docNumber: `RET-BI-${token}`, vendorId: supplierId, lines: [], totalItems: 0, totalValue: 0, createdById: userId },
          select: { id: true },
        })
      ).id;
      uomA = (
        await prisma.uOM.create({ data: { code: `A${token}`.slice(0, 10), nameId: "A", nameEn: "A" }, select: { id: true } })
      ).id;
      uomB = (
        await prisma.uOM.create({ data: { code: `B${token}`.slice(0, 10), nameId: "B", nameEn: "B" }, select: { id: true } })
      ).id;
      itemFgId = (
        await prisma.item.create({
          data: { sku: `BI-FG-${token}`, nameId: "Barang jadi uji", nameEn: "Test FG", type: "FINISHED_GOOD", uomId: uomA },
          select: { id: true },
        })
      ).id;
    });

    afterAll(async () => {
      await prisma.jubelioOutbox.deleteMany({ where: { entityId: seededId(itemFgId) } });
      await prisma.item.deleteMany({ where: { id: seededId(itemFgId) } });
      await prisma.uOMConversion.deleteMany({ where: { fromUomId: seededId(uomA) } });
      await prisma.uOMConversion.deleteMany({ where: { fromUomId: seededId(uomB) } });
      await prisma.uOM.deleteMany({ where: { id: seededId(uomA) } });
      await prisma.uOM.deleteMany({ where: { id: seededId(uomB) } });
      await prisma.vendorReturn.deleteMany({ where: { id: seededId(returId) } });
      await prisma.gRN.deleteMany({ where: { id: seededId(grnId) } });
      await prisma.purchaseOrder.deleteMany({ where: { id: seededId(poId) } });
      await prisma.supplier.deleteMany({ where: { id: seededId(supplierId) } });
      await prisma.supplierType.deleteMany({ where: { id: seededId(typeId) } });
      await prisma.user.deleteMany({ where: { id: seededId(userId) } });
    });

    function tanpaRekening(nilai: unknown) {
      expect(JSON.stringify(nilai)).not.toContain("RAHASIA-TERENKRIPSI");
      expect(JSON.stringify(nilai)).not.toContain("bankAccountEnc");
    }

    it("getPOById tidak mengirim rekening terenkripsi pemasok", async () => {
      sesi.permissions = ["purchase_orders:view"];
      const hasil = await po.getPOById(poId);
      expect(hasil?.id).toBe(poId);
      expect((hasil?.supplier as { name?: string } | undefined)?.name).toBe("Pemasok bocor");
      tanpaRekening(hasil);
    });

    it("getGRNs / getGRNById tidak mengirim rekening terenkripsi pemasok", async () => {
      sesi.permissions = ["inventory:view"];
      const daftar = await grn.getGRNs({ poId }, { page: 1, pageSize: 5 });
      expect(JSON.stringify(daftar)).toContain("Pemasok bocor");
      tanpaRekening(daftar);
      const satu = await grn.getGRNById(grnId);
      expect(satu?.supplier.name).toBe("Pemasok bocor");
      tanpaRekening(satu);
    });

    it("getVendorReturnById tidak mengirim rekening terenkripsi pemasok", async () => {
      sesi.permissions = ["vendor_returns:view"];
      const satu = await retur.getVendorReturnById(returId);
      expect(satu?.vendor.name).toBe("Pemasok bocor");
      tanpaRekening(satu);
    });

    describe("createUOMConversion", () => {
      async function jumlahKonversi() {
        return prisma.uOMConversion.count({ where: { fromUomId: seededId(uomA), toUomId: seededId(uomB) } });
      }

      it("menolak tanpa settings_uom:manage", async () => {
        sesi.permissions = ["settings_uom:view", "items:edit"];
        await expect(uom.createUOMConversion({ fromUomId: uomA, toUomId: uomB, factor: 12 })).rejects.toThrow(/Forbidden/);
        expect(await jumlahKonversi()).toBe(0);
      });

      it("menolak tanpa sesi", async () => {
        sesi.ada = false;
        await expect(uom.createUOMConversion({ fromUomId: uomA, toUomId: uomB, factor: 12 })).rejects.toThrow(/Unauthorized/);
        expect(await jumlahKonversi()).toBe(0);
      });

      it("settings_uom:manage boleh", async () => {
        sesi.permissions = ["settings_uom:manage"];
        await uom.createUOMConversion({ fromUomId: uomA, toUomId: uomB, factor: 12 });
        expect(await jumlahKonversi()).toBe(1);
      });
    });

    describe("enqueueProductPush*", () => {
      const sebelum = {
        nameId: "Barang jadi uji",
        nameEn: "Test FG",
        description: null,
        sellingPrice: null,
        targetMarginPercent: null,
        additionalCost: null,
        variants: null,
        isActive: true,
      };
      const sesudah = { ...sebelum, nameId: "Barang jadi uji (ubah)" };

      async function jumlahAntrean() {
        return prisma.jubelioOutbox.count({ where: { entityId: seededId(itemFgId), entityType: "product_push" } });
      }

      beforeEach(async () => {
        await prisma.jubelioOutbox.deleteMany({ where: { entityId: seededId(itemFgId) } });
        sesi.id = userId;
      });

      it.each([
        ["OnCreate", () => push.enqueueProductPushOnCreate(itemFgId)],
        ["OnUpdate", () => push.enqueueProductPushOnUpdate(itemFgId, sebelum, sesudah)],
        ["OnImageChange", () => push.enqueueProductPushOnImageChange(itemFgId)],
      ] as Array<[string, () => Promise<void>]>)("%s tidak mengantre untuk pengguna tanpa izin barang", async (_n, panggil) => {
        sesi.permissions = ORANG_LAIN;
        await panggil();
        sesi.ada = false;
        await panggil();
        expect(await jumlahAntrean()).toBe(0);
      });

      it.each([
        ["OnCreate ← items:create", () => push.enqueueProductPushOnCreate(itemFgId), "items:create"],
        ["OnUpdate ← items:edit", () => push.enqueueProductPushOnUpdate(itemFgId, sebelum, sesudah), "items:edit"],
        ["OnImageChange ← items:manage", () => push.enqueueProductPushOnImageChange(itemFgId), "items:manage"],
      ] as Array<[string, () => Promise<void>, string]>)("%s tetap mengantre", async (_n, panggil, izin) => {
        sesi.permissions = [izin];
        await panggil();
        expect(await jumlahAntrean()).toBe(1);
      });
    });
  });
});
