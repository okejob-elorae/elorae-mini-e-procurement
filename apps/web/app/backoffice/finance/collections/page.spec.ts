import { beforeEach, describe, expect, it, vi } from "vitest";
import { getRequiredPermission } from "@/lib/rbac";

/*
 * Gate of Finance → Collections (the collector-deposit verification queue). Opened by the
 * collections manager OR the payment verifier (owner, 2026-11-01); the Verify/Reject buttons follow
 * `payments:verify`, the code `verifyCollectionAction`/`rejectCollectionAction` enforce. Recording
 * office payments (`payments:manage`) is not verifying, so it neither opens the page nor verifies.
 */

const sesi = vi.hoisted(() => ({ ada: true, permissions: [] as string[] }));
const dibaca = vi.hoisted(() => ({ n: 0 }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => (sesi.ada ? { user: { id: "u", permissions: sesi.permissions } } : null)) }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((ke: string) => {
    throw new Error(`REDIRECT:${ke}`);
  }),
}));
vi.mock("@/lib/finance/collections/queries", () => ({
  listPendingCollections: vi.fn(async () => {
    dibaca.n += 1;
    return { rows: [], total: 0 };
  }),
  getCollectionSubmission: vi.fn(async () => null),
  listCollectorCandidates: vi.fn(async () => []),
}));
vi.mock("@/lib/stores/queries", () => ({ listStoreOptions: vi.fn(async () => []) }));
vi.mock("./CollectionsQueuePageClient", () => ({ CollectionsQueuePageClient: () => null }));

const { default: Halaman } = await import("./page");
const buka = () => Halaman({ searchParams: Promise.resolve({}) }) as Promise<{ props: { canVerify: boolean } }>;

beforeEach(() => {
  sesi.ada = true;
  sesi.permissions = [];
  dibaca.n = 0;
});

describe("Finance → Collections gate", () => {
  it("signed out → login; neither code (payments:manage alone, journals:manage alone) → /backoffice, no query", async () => {
    sesi.ada = false;
    await expect(buka()).rejects.toThrow("REDIRECT:/login");
    sesi.ada = true;
    for (const izin of [["payments:manage"], ["journals:view", "journals:manage"], ["collections:collect"]]) {
      sesi.permissions = izin;
      await expect(buka()).rejects.toThrow("REDIRECT:/backoffice");
    }
    expect(dibaca.n).toBe(0);
  });

  it("the payment verifier opens it and may verify", async () => {
    sesi.permissions = ["payments:verify"];
    expect((await buka()).props.canVerify).toBe(true);
  });

  it("the collections manager opens it but may not verify", async () => {
    sesi.permissions = ["collections:manage", "payments:manage"];
    expect((await buka()).props.canVerify).toBe(false);
  });

  it("admin wildcard opens and verifies", async () => {
    sesi.permissions = ["*"];
    expect((await buka()).props.canVerify).toBe(true);
  });

  it("is not gated by the proxy on one code, so the payment verifier reaches the page's own gate", () => {
    expect(getRequiredPermission("/backoffice/finance/collections")).toBeNull();
  });
});
