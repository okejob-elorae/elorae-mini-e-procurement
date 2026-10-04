import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { encryptBankAccount } from "@/lib/encryption";

/*
 * Penjaga aksi pemasok yang sensitif (sesi dan PIN ditiru, baris uji nyata).
 *
 * - `decryptSupplierBankAction` dulu hanya memeriksa PIN pemanggil, tanpa
 *   `suppliers:view`: akun sales/SPG yang punya PIN bisa membuka nomor rekening
 *   pemasok mana pun.
 * - `deleteSupplierAction` dulu hanya memeriksa `suppliers:delete`; PIN-nya
 *   diperiksa di browser lewat panggilan terpisah, jadi siapa pun yang memanggil
 *   aksi hapus langsung melewati PIN sama sekali.
 */

/* Kunci uji 32 karakter: `.env` lokal memegang kunci 64 karakter yang ditolak
   `lib/encryption.ts`, dan modul itu membaca kuncinya saat dimuat. */
vi.hoisted(() => {
  process.env.ENCRYPTION_KEY = "kunci-uji-pemasok-32-karakter-xx";
});

const sesi = vi.hoisted(() => ({ ada: true, id: "", permissions: [] as string[] }));
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () =>
    sesi.ada ? { user: { id: sesi.id, email: null, permissions: sesi.permissions } } : null,
  ),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/app/actions/notifications", () => ({
  getActorName: async () => "Penguji",
  notifySupplierCreated: async () => {},
  notifySupplierApproved: async () => {},
}));

const pin = vi.hoisted(() => ({
  hasil: { success: true, messageKey: "ok" } as { success: boolean; messageKey?: string },
  panggilan: [] as unknown[][],
}));
vi.mock("@/app/actions/security/pin-auth", () => ({
  verifyPinForAction: vi.fn(async (...args: unknown[]) => {
    pin.panggilan.push(args);
    return pin.hasil;
  }),
}));

const { decryptSupplierBankAction, deleteSupplierAction } = await import("./suppliers");

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

d("aksi pemasok sensitif (test bed only)", () => {
  const token = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  let userId = "";
  let typeId = "";
  let supplierId = "";
  const supplierIds: string[] = [];

  beforeAll(async () => {
    userId = "";
    typeId = "";
    const user = await prisma.user.create({
      data: { email: `pemasok-izin-${token}@uji.local`, name: "Penguji pemasok" },
      select: { id: true },
    });
    userId = user.id;
    const type = await prisma.supplierType.create({
      data: { code: `TST-${token}`, name: `Jenis uji ${token}` },
      select: { id: true },
    });
    typeId = type.id;
  });

  beforeEach(async () => {
    supplierId = "";
    sesi.ada = true;
    sesi.id = userId;
    sesi.permissions = [];
    pin.hasil = { success: true, messageKey: "ok" };
    pin.panggilan = [];
    const s = await prisma.supplier.create({
      data: {
        code: `SUP-IZN-${token}-${supplierIds.length}`,
        name: `Pemasok uji ${token}`,
        typeId,
        bankName: "BCA",
        bankAccountEnc: encryptBankAccount("1234567890", "DEFAULT_PIN"),
      },
      select: { id: true },
    });
    supplierId = s.id;
    supplierIds.push(s.id);
  });

  afterAll(async () => {
    for (const id of supplierIds) {
      await prisma.auditLog.deleteMany({ where: { entityType: "Supplier", entityId: seededId(id) } });
      await prisma.supplier.deleteMany({ where: { id: seededId(id) } });
    }
    await prisma.supplierType.deleteMany({ where: { id: seededId(typeId) } });
    await prisma.auditLog.deleteMany({ where: { userId: seededId(userId) } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
  });

  describe("decryptSupplierBankAction", () => {
    it("menolak pengguna tanpa suppliers:view, sebelum PIN dicoba", async () => {
      sesi.permissions = ["pwa:access", "spg_sales:record"];
      await expect(decryptSupplierBankAction(supplierId, "1234")).rejects.toThrow(/Forbidden/);
      expect(pin.panggilan).toHaveLength(0);
    });

    it("menolak tanpa sesi", async () => {
      sesi.ada = false;
      await expect(decryptSupplierBankAction(supplierId, "1234")).rejects.toThrow(/Unauthorized/);
      expect(pin.panggilan).toHaveLength(0);
    });

    it("tetap menolak PIN salah walau punya suppliers:view", async () => {
      sesi.permissions = ["suppliers:view"];
      pin.hasil = { success: false, messageKey: "pinIncorrect" };
      await expect(decryptSupplierBankAction(supplierId, "0000")).rejects.toThrow(/pinIncorrect/);
    });

    it("membuka rekening untuk suppliers:view + PIN benar", async () => {
      sesi.permissions = ["suppliers:view"];
      await expect(decryptSupplierBankAction(supplierId, "1234")).resolves.toEqual({ bankAccount: "1234567890" });
      expect(pin.panggilan).toHaveLength(1);
    });

    it("admin wildcard * tetap boleh", async () => {
      sesi.permissions = ["*"];
      await expect(decryptSupplierBankAction(supplierId, "1234")).resolves.toEqual({ bankAccount: "1234567890" });
    });
  });

  describe("deleteSupplierAction", () => {
    async function masihAda(): Promise<boolean> {
      return (await prisma.supplier.count({ where: { id: seededId(supplierId) } })) === 1;
    }

    it("menolak pengguna tanpa suppliers:delete", async () => {
      sesi.permissions = ["suppliers:view", "suppliers:edit"];
      await expect(deleteSupplierAction(supplierId, "1234")).rejects.toThrow(/Forbidden/);
      expect(await masihAda()).toBe(true);
    });

    it("memeriksa PIN di SERVER: PIN salah tidak menghapus", async () => {
      sesi.permissions = ["suppliers:delete"];
      pin.hasil = { success: false, messageKey: "pinIncorrect" };
      await expect(deleteSupplierAction(supplierId, "0000")).resolves.toEqual({
        success: false,
        securityMessageKey: "pinIncorrect",
      });
      expect(await masihAda()).toBe(true);
      expect(pin.panggilan[0]?.[2]).toBe("DELETE_SUPPLIER");
    });

    it("tanpa PIN sama sekali tidak menghapus", async () => {
      sesi.permissions = ["suppliers:delete"];
      pin.hasil = { success: false, messageKey: "pinIncorrect" };
      const tanpaPin = deleteSupplierAction as unknown as (id: string) => Promise<unknown>;
      await expect(tanpaPin(supplierId)).resolves.toMatchObject({ success: false });
      expect(await masihAda()).toBe(true);
    });

    it("menghapus untuk suppliers:delete + PIN benar", async () => {
      sesi.permissions = ["suppliers:delete"];
      await expect(deleteSupplierAction(supplierId, "1234")).resolves.toEqual({ success: true });
      expect(await masihAda()).toBe(false);
    });
  });
});
