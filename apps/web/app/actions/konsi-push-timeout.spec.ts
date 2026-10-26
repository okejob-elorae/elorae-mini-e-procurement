import { describe, it, expect, vi } from "vitest";

const { mockAuth, mockCreate } = vi.hoisted(() => ({ mockAuth: vi.fn(), mockCreate: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/field-sales/konsi-push-writer", () => ({ createKonsiPushOrder: mockCreate }));

import { createKonsiPushOrderAction } from "./field-sales-orders";
import { KonsiPushError } from "@/lib/field-sales/errors";

describe("createKonsiPushOrderAction — transaction timeout", () => {
  it("returns the typed TRANSACTION_TIMEOUT reason, not UNEXPECTED", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["field_sales_orders:approve"] } });
    mockCreate.mockRejectedValueOnce(new KonsiPushError("TRANSACTION_TIMEOUT"));
    const res = await createKonsiPushOrderAction({
      storeId: "s1",
      salesmanId: "u2",
      lines: [{ itemId: "i1", variantSku: "", qty: 1 }],
      idempotencyKey: "00000000-0000-4000-8000-000000000000",
    });
    expect(res).toEqual({ ok: false, reason: "TRANSACTION_TIMEOUT" });
  });
});
