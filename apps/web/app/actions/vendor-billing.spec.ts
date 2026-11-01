import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Vendor Billing takes no new payments (owner decision 2026-11-01): the payment action is refused
 * on the server with a code and a message naming where to pay instead, and writes nothing. No
 * database: prisma is stubbed and every call to it is counted.
 */

const state = vi.hoisted(() => ({
  sesi: null as { user: { id: string; permissions: string[] } } | null,
  panggilan: 0,
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => state.sesi) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(async () => {}) }));
vi.mock("@elorae/db", async (importOriginal) => {
  const asli = await importOriginal<typeof import("@elorae/db")>();
  const model = new Proxy(
    {},
    {
      get: () =>
        vi.fn(async () => {
          state.panggilan += 1;
          return null;
        }),
    }
  );
  return { ...asli, prisma: new Proxy({}, { get: () => model }) };
});

const aksi = await import("./vendor-billing");

describe("createVendorPaymentAction", () => {
  beforeEach(() => {
    state.sesi = null;
    state.panggilan = 0;
  });

  it("refuses with VENDOR_PAYMENTS_CLOSED and points to Supplier payments, writing nothing", async () => {
    state.sesi = { user: { id: "u1", permissions: ["supplier_payments:create"] } };
    const res = await aksi.createVendorPaymentAction("u1");
    expect(res).toMatchObject({ ok: false, code: "VENDOR_PAYMENTS_CLOSED" });
    expect(res.ok ? "" : res.error).toContain("Pembayaran pemasok");
    expect(state.panggilan).toBe(0);
  });

  it("still needs a session with the supplier payment permission", async () => {
    await expect(aksi.createVendorPaymentAction("u1")).rejects.toThrow();
    state.sesi = { user: { id: "u1", permissions: ["vendor_bills:view"] } };
    await expect(aksi.createVendorPaymentAction("u1")).rejects.toThrow();
  });
});
