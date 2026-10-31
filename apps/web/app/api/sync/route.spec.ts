import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, seededId, seededIds } from "@elorae/db";

/*
 * `/api/sync` memutar ulang operasi luring dari antrean IndexedDB. Rute ini
 * TIDAK ada di `ROUTE_PERMISSIONS`, jadi proxy hanya memastikan ada sesi —
 * setiap operasi harus memeriksa izinnya sendiri, sama dengan aksi biasanya.
 * Dulu `SUPPLIER_UPDATE` menyebar payload mentah ke `prisma.supplier.update`
 * (siapa pun yang masuk bisa menyetel `status: ACTIVE`, `approvedById`,
 * `isActive`), dan `SUPPLIER_CREATE`/`PO_CREATE` melewati izin buat.
 */

const sesi = vi.hoisted(() => ({ ada: true, id: "", permissions: [] as string[] }));
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () =>
    sesi.ada ? { user: { id: sesi.id, email: null, permissions: sesi.permissions } } : null,
  ),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/notifications/actor-name", () => ({ getActorName: async () => "Penguji" }));
vi.mock("@/lib/notifications/events", () => ({
  notifySupplierCreated: async () => {},
  notifyPOCreated: async () => {},
}));

const { POST } = await import("./route");

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

function kirim(body: unknown) {
  return POST(
    new NextRequest("http://localhost/api/sync", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }),
  );
}

d("/api/sync — izin per operasi (test bed only)", () => {
  const token = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  let userId = "";
  let typeId = "";
  let supplierId = "";
  let otherSupplierId = "";
  let uomId = "";
  let itemId = "";
  const kodeBaru = `SUP-SYNC-${token}`;

  beforeAll(async () => {
    userId = "";
    typeId = "";
    supplierId = "";
    otherSupplierId = "";
    uomId = "";
    itemId = "";
    userId = (
      await prisma.user.create({
        data: { email: `sync-izin-${token}@uji.local`, name: "Penguji sinkron" },
        select: { id: true },
      })
    ).id;
    typeId = (
      await prisma.supplierType.create({
        data: { code: `TSY-${token}`, name: `Jenis sinkron ${token}` },
        select: { id: true },
      })
    ).id;
    supplierId = (
      await prisma.supplier.create({
        data: { code: `SUP-SYO-${token}`, name: "Pemasok sinkron", typeId, phone: "0800" },
        select: { id: true },
      })
    ).id;
    otherSupplierId = (
      await prisma.supplier.create({
        data: { code: `SUP-SYD-${token}`, name: "Pemasok sinkron lain", typeId },
        select: { id: true },
      })
    ).id;
    uomId = (
      await prisma.uOM.create({
        data: { code: `S${token}`.slice(0, 10), nameId: "Uji", nameEn: "Test" },
        select: { id: true },
      })
    ).id;
    itemId = (
      await prisma.item.create({
        data: { sku: `SYNC-${token}`, nameId: "Kain uji", nameEn: "Test fabric", type: "ACCESSORIES", uomId },
        select: { id: true },
      })
    ).id;
  });

  beforeEach(() => {
    sesi.ada = true;
    sesi.id = userId;
    sesi.permissions = [];
  });

  afterAll(async () => {
    // Semua pemasok berjenis uji ini milik spec ini — termasuk yang dibuat rute
    // dengan kode yang tidak kita pilih.
    const supplierIds = (
      await prisma.supplier.findMany({ where: { typeId: seededId(typeId) }, select: { id: true } })
    ).map((s) => s.id);
    const poIds = (
      await prisma.purchaseOrder.findMany({ where: { supplierId: { in: seededIds(supplierIds) } }, select: { id: true } })
    ).map((p) => p.id);
    await prisma.pOStatusHistory.deleteMany({ where: { poId: { in: seededIds(poIds) } } });
    await prisma.pOItem.deleteMany({ where: { poId: { in: seededIds(poIds) } } });
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: seededIds(poIds) } } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.supplier.deleteMany({ where: { id: { in: seededIds(supplierIds) } } });
    await prisma.supplierType.deleteMany({ where: { id: seededId(typeId) } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
  });

  async function pemasok() {
    return prisma.supplier.findUniqueOrThrow({
      where: { id: seededId(supplierId) },
      select: { status: true, approvedById: true, isActive: true, phone: true, bankAccountEnc: true },
    });
  }

  it("tanpa sesi: 401", async () => {
    sesi.ada = false;
    const res = await kirim({ type: "SUPPLIER_UPDATE", payload: { id: supplierId, phone: "1" } });
    expect(res.status).toBe(401);
  });

  describe("SUPPLIER_UPDATE", () => {
    it("tanpa suppliers:edit: 403 dan pemasok tidak berubah", async () => {
      sesi.permissions = ["pwa:access"];
      const res = await kirim({ type: "SUPPLIER_UPDATE", payload: { id: supplierId, phone: "0811" } });
      expect(res.status).toBe(403);
      expect((await pemasok()).phone).toBe("0800");
    });

    it.each([
      ["status", { status: "ACTIVE" }],
      ["approvedById", { approvedById: "siapa-saja" }],
      ["isActive", { isActive: false }],
      ["approvedAt", { approvedAt: "2026-01-01T00:00:00Z" }],
      ["rejectionReason", { rejectionReason: "x" }],
      ["bankAccountEnc", { bankAccountEnc: "mentah" }],
    ])("menolak field %s walau punya suppliers:edit (400, tidak berubah)", async (_nama, tambahan) => {
      sesi.permissions = ["suppliers:edit"];
      const res = await kirim({ type: "SUPPLIER_UPDATE", payload: { id: supplierId, phone: "0812", ...tambahan } });
      expect(res.status).toBe(400);
      const p = await pemasok();
      expect(p).toMatchObject({ status: "PENDING_APPROVAL", approvedById: null, isActive: true, phone: "0800" });
    });

    it("field formulir biasa tetap boleh untuk suppliers:edit, tanpa membocorkan rekening terenkripsi", async () => {
      sesi.permissions = ["suppliers:edit"];
      const res = await kirim({ type: "SUPPLIER_UPDATE", payload: { id: supplierId, phone: "0813" } });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data?: Record<string, unknown> };
      expect(body.data).not.toHaveProperty("bankAccountEnc");
      expect((await pemasok()).phone).toBe("0813");
    });

    it("accepts the admin wildcard", async () => {
      sesi.permissions = ["*"];
      const res = await kirim({ type: "SUPPLIER_UPDATE", payload: { id: supplierId, phone: "0814" } });
      expect(res.status).toBe(200);
    });

    it("keeps the success shape and writes the schema fields, payment terms included", async () => {
      sesi.permissions = ["suppliers:edit"];
      const res = await kirim({
        type: "SUPPLIER_UPDATE",
        payload: { id: supplierId, name: "Pemasok sinkron", paymentTermsDays: 30 },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { success?: boolean; data?: { id?: string } };
      expect(body.success).toBe(true);
      expect(body.data?.id).toBe(supplierId);
      const p = await prisma.supplier.findUniqueOrThrow({
        where: { id: seededId(supplierId) },
        select: { paymentTermsDays: true },
      });
      expect(p.paymentTermsDays).toBe(30);
    });

    it("never writes mass-assigned columns such as status", async () => {
      sesi.permissions = ["suppliers:edit"];
      const res = await kirim({
        type: "SUPPLIER_UPDATE",
        payload: { id: supplierId, name: "Pemasok sinkron", status: "APPROVED", approvedById: "u9" },
      });
      expect(res.status).toBe(400);
      expect(await pemasok()).toMatchObject({ status: "PENDING_APPROVAL", approvedById: null });
    });

    it("answers 400 for an invalid payment term and writes nothing", async () => {
      sesi.permissions = ["suppliers:edit"];
      const res = await kirim({ type: "SUPPLIER_UPDATE", payload: { id: supplierId, paymentTermsDays: 999 } });
      expect(res.status).toBe(400);
      const p = await prisma.supplier.findUniqueOrThrow({
        where: { id: seededId(supplierId) },
        select: { paymentTermsDays: true },
      });
      expect(p.paymentTermsDays).not.toBe(999);
    });

    it("answers 400 for a missing id", async () => {
      sesi.permissions = ["suppliers:edit"];
      const res = await kirim({ type: "SUPPLIER_UPDATE", payload: { name: "Acme" } });
      expect(res.status).toBe(400);
    });

    it("answers 409 for a duplicate supplier code", async () => {
      sesi.permissions = ["suppliers:edit"];
      expect(otherSupplierId).not.toBe("");
      const res = await kirim({ type: "SUPPLIER_UPDATE", payload: { id: supplierId, code: `SUP-SYD-${token}` } });
      expect(res.status).toBe(409);
      const p = await prisma.supplier.findUniqueOrThrow({ where: { id: seededId(supplierId) }, select: { code: true } });
      expect(p.code).toBe(`SUP-SYO-${token}`);
    });
  });

  describe("SUPPLIER_CREATE", () => {
    const payload = { code: kodeBaru, name: "Pemasok baru luring", typeId: "" };

    // Dihitung per jenis uji, bukan per kode: rute lama mengabaikan kode kiriman.
    async function jumlahBaru() {
      return prisma.supplier.count({ where: { typeId: seededId(typeId), name: payload.name } });
    }

    it("tanpa suppliers:create: 403 dan tidak ada pemasok baru", async () => {
      sesi.permissions = ["suppliers:view", "suppliers:edit"];
      const res = await kirim({ type: "SUPPLIER_CREATE", payload: { ...payload, typeId } });
      expect(res.status).toBe(403);
      expect(await jumlahBaru()).toBe(0);
    });

    it("menolak status yang diselundupkan (400)", async () => {
      sesi.permissions = ["suppliers:create"];
      const res = await kirim({ type: "SUPPLIER_CREATE", payload: { ...payload, typeId, status: "ACTIVE" } });
      expect(res.status).toBe(400);
      expect(await jumlahBaru()).toBe(0);
    });

    it("suppliers:create boleh, dan pemasoknya tetap menunggu persetujuan", async () => {
      sesi.permissions = ["suppliers:create"];
      const res = await kirim({ type: "SUPPLIER_CREATE", payload: { ...payload, typeId } });
      expect(res.status).toBe(200);
      const baru = await prisma.supplier.findUniqueOrThrow({ where: { code: kodeBaru }, select: { status: true } });
      expect(baru.status).toBe("PENDING_APPROVAL");
    });
  });

  describe("PO_CREATE", () => {
    function payloadPo() {
      return { supplierId, items: [{ itemId, qty: 2, price: 1000, uomId }] };
    }

    async function jumlahPo() {
      return prisma.purchaseOrder.count({ where: { supplierId: seededId(supplierId) } });
    }

    it("tanpa purchase_orders:create: 403 dan tidak ada PO", async () => {
      sesi.permissions = ["purchase_orders:view", "inventory:manage"];
      const res = await kirim({ type: "PO_CREATE", payload: payloadPo() });
      expect(res.status).toBe(403);
      expect(await jumlahPo()).toBe(0);
    });

    it("payload rusak: 400, bukan 500", async () => {
      sesi.permissions = ["purchase_orders:create"];
      const res = await kirim({ type: "PO_CREATE", payload: { supplierId } });
      expect(res.status).toBe(400);
      expect(await jumlahPo()).toBe(0);
    });

    it("purchase_orders:create boleh", async () => {
      sesi.permissions = ["purchase_orders:create"];
      const res = await kirim({ type: "PO_CREATE", payload: payloadPo() });
      expect(res.status).toBe(200);
      expect(await jumlahPo()).toBe(1);
      const po = await prisma.purchaseOrder.findFirstOrThrow({
        where: { supplierId: seededId(supplierId) },
        select: { createdById: true },
      });
      expect(po.createdById).toBe(userId);
    });
  });

  it("operasi tak dikenal: 400", async () => {
    sesi.permissions = ["*"];
    const res = await kirim({ type: "GRN_CREATE", payload: {} });
    expect(res.status).toBe(400);
  });
});
