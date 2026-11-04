import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Gate of the store settlement approval page. Readable by the collections manager OR the payment
 * verifier; the approve/reject controls and the journal retry follow `payments:verify`, the code
 * `approveSettlementAction`/`rejectSettlementAction` enforce (owner, 2026-11-01).
 */

const sesi = vi.hoisted(() => ({ ada: true, permissions: [] as string[] }));
const dibaca = vi.hoisted(() => ({ n: 0 }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => (sesi.ada ? { user: { id: "u", permissions: sesi.permissions } } : null)) }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((ke: string) => {
    throw new Error(`REDIRECT:${ke}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));
vi.mock("@/lib/finance/ar-settlement/queries", () => ({
  getSettlementForApproval: vi.fn(async (id: string) => {
    dibaca.n += 1;
    return { id };
  }),
}));
vi.mock("./SettlementApprovalClient", () => ({ SettlementApprovalClient: () => null }));

const { default: Halaman } = await import("./page");
const buka = () =>
  Halaman({ params: Promise.resolve({ id: "s1" }) }) as Promise<{ props: { canVerify: boolean; canViewAccountMapping: boolean } }>;

beforeEach(() => {
  sesi.ada = true;
  sesi.permissions = [];
  dibaca.n = 0;
});

describe("store settlement approval gate", () => {
  it("signed out → login; neither code → /backoffice before reading the document", async () => {
    sesi.ada = false;
    await expect(buka()).rejects.toThrow("REDIRECT:/login");
    sesi.ada = true;
    for (const izin of [["payments:manage"], ["journals:view", "journals:manage"], ["settlements:submit"]]) {
      sesi.permissions = izin;
      await expect(buka()).rejects.toThrow("REDIRECT:/backoffice");
    }
    expect(dibaca.n).toBe(0);
  });

  it("the payment verifier opens it with the approval controls", async () => {
    sesi.permissions = ["payments:verify"];
    expect((await buka()).props).toMatchObject({ canVerify: true, canViewAccountMapping: false });
  });

  it("the collections manager reads it without the approval controls", async () => {
    sesi.permissions = ["collections:manage", "journals:view"];
    expect((await buka()).props).toMatchObject({ canVerify: false, canViewAccountMapping: true });
  });
});
