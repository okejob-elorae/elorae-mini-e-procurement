import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAuth, mockCard } = vi.hoisted(() => ({ mockAuth: vi.fn(), mockCard: vi.fn() }));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/inventory/stock-ledger-card", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/inventory/stock-ledger-card")>();
  return { ...actual, getItemMovementCard: mockCard };
});

import { getItemMovementsAction } from "./stock-movements";

describe("getItemMovementsAction date bounds", () => {
  beforeEach(() => {
    mockAuth.mockReset();
    mockCard.mockReset();
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["*"] } });
    mockCard.mockResolvedValue({ sections: [] });
  });

  it("refuses a malformed from instead of dropping the bound", async () => {
    await expect(getItemMovementsAction({ itemId: "i1", from: "not-a-date" })).rejects.toThrow("INVALID_DATE");
    expect(mockCard).not.toHaveBeenCalled();
  });

  it("refuses a malformed to instead of dropping the bound", async () => {
    await expect(getItemMovementsAction({ itemId: "i1", to: "2026-13-99" })).rejects.toThrow("INVALID_DATE");
    expect(mockCard).not.toHaveBeenCalled();
  });

  it("passes valid bounds through and leaves absent ones undefined", async () => {
    await getItemMovementsAction({ itemId: "i1", from: "2026-10-01" });
    const arg = mockCard.mock.calls[0][0];
    expect(arg.from).toBeInstanceOf(Date);
    expect(arg.to).toBeUndefined();
  });
});
