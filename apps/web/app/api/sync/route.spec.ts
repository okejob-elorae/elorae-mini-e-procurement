import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@elorae/db", () => ({ prisma: {} }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/docNumber", () => ({ generateSupplierCode: vi.fn() }));
vi.mock("@/lib/encryption", () => ({ encryptBankAccount: vi.fn() }));
vi.mock("@/lib/purchase-orders/mutations", () => ({ createPurchaseOrderFromOfflinePayload: vi.fn() }));
vi.mock("@/lib/suppliers/mutations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/suppliers/mutations")>();
  return { ...actual, updateSupplier: vi.fn() };
});

import { auth } from "@/lib/auth";
import { createPurchaseOrderFromOfflinePayload } from "@/lib/purchase-orders/mutations";
import { updateSupplier } from "@/lib/suppliers/mutations";
import { POST } from "./route";

const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;
const mockUpdate = updateSupplier as unknown as ReturnType<typeof vi.fn>;
const mockPoCreate = createPurchaseOrderFromOfflinePayload as unknown as ReturnType<typeof vi.fn>;

function req(body: unknown): never {
  return new Request("http://localhost/api/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["suppliers:edit"] } });
  mockUpdate.mockResolvedValue({ id: "s1", name: "Acme" });
});

describe("POST /api/sync", () => {
  it("answers 401 without a session", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await POST(req({ type: "SUPPLIER_UPDATE", payload: { id: "s1" } }));
    expect(res.status).toBe(401);
  });

  describe("permissions", () => {
    it("refuses SUPPLIER_UPDATE without suppliers:edit", async () => {
      mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["suppliers:create"] } });
      const res = await POST(req({ type: "SUPPLIER_UPDATE", payload: { id: "s1", name: "x" } }));
      expect(res.status).toBe(403);
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it("refuses SUPPLIER_CREATE without suppliers:create", async () => {
      const res = await POST(req({ type: "SUPPLIER_CREATE", payload: { name: "x", typeId: "t" } }));
      expect(res.status).toBe(403);
    });

    it("refuses PO_CREATE without purchase_orders:create", async () => {
      const res = await POST(req({ type: "PO_CREATE", payload: {} }));
      expect(res.status).toBe(403);
      expect(mockPoCreate).not.toHaveBeenCalled();
    });

    it("lets PO_CREATE through for a holder of purchase_orders:create", async () => {
      mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["purchase_orders:create"] } });
      mockPoCreate.mockResolvedValue({ id: "po1" });
      const res = await POST(req({ type: "PO_CREATE", payload: { supplierId: "s1" } }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true, data: { id: "po1" } });
    });

    it("accepts the admin wildcard", async () => {
      mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["*"] } });
      const res = await POST(req({ type: "SUPPLIER_UPDATE", payload: { id: "s1", name: "Acme" } }));
      expect(res.status).toBe(200);
    });
  });

  describe("SUPPLIER_UPDATE", () => {
    it("keeps the success shape and passes only schema fields to the writer", async () => {
      const res = await POST(req({ type: "SUPPLIER_UPDATE", payload: { id: "s1", name: "Acme", paymentTermsDays: 30 } }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true, data: { id: "s1", name: "Acme" } });
      expect(mockUpdate).toHaveBeenCalledWith("s1", { name: "Acme", paymentTermsDays: 30 });
    });

    it("drops mass-assigned columns such as status", async () => {
      await POST(req({ type: "SUPPLIER_UPDATE", payload: { id: "s1", name: "Acme", status: "APPROVED", approvedById: "u9" } }));
      const [, data] = mockUpdate.mock.calls[0];
      expect(data).not.toHaveProperty("status");
      expect(data).not.toHaveProperty("approvedById");
    });

    it("answers 400 for an invalid payment term and writes nothing", async () => {
      const res = await POST(req({ type: "SUPPLIER_UPDATE", payload: { id: "s1", paymentTermsDays: 999 } }));
      expect(res.status).toBe(400);
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it("answers 400 for a missing id", async () => {
      const res = await POST(req({ type: "SUPPLIER_UPDATE", payload: { name: "Acme" } }));
      expect(res.status).toBe(400);
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it("answers 400 for a duplicate supplier code", async () => {
      mockUpdate.mockRejectedValue(new Error("Supplier code already exists"));
      const res = await POST(req({ type: "SUPPLIER_UPDATE", payload: { id: "s1", code: "DUP" } }));
      expect(res.status).toBe(400);
    });
  });
});
