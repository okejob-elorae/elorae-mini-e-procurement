import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAuth, mockList } = vi.hoisted(() => ({ mockAuth: vi.fn(), mockList: vi.fn() }));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rbac")>();
  return { ...actual, requirePermission: vi.fn() };
});
vi.mock("@/lib/finance/ar/queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/finance/ar/queries")>();
  return { ...actual, listReceivablesForExport: mockList };
});

import { exportReceivablesReport } from "./piutang";

describe("exportReceivablesReport empty guard", () => {
  beforeEach(() => {
    mockAuth.mockReset();
    mockList.mockReset();
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["*"] } });
  });

  it("reports empty when a bucket filter leaves no rows, even though rows matched before it", async () => {
    mockList.mockResolvedValue({ rows: [], truncated: false, totalRows: 40 });
    expect(await exportReceivablesReport({}, "csv")).toEqual({ empty: true });
  });

  it("does not report empty for a truncated set with no rows after the bucket filter", async () => {
    mockList.mockResolvedValue({ rows: [], truncated: true, totalRows: 99999 });
    const res = await exportReceivablesReport({}, "csv");
    expect(res).toMatchObject({ truncated: true });
    expect("empty" in res).toBe(false);
  });
});
