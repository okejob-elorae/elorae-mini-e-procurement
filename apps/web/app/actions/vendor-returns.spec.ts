import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAuth,
  mockFindFirst,
  mockFindUnique,
  mockVrCreate,
  mockVrUpdate,
  mockVrFindUnique,
  mockTxVrFindUnique,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockFindFirst: vi.fn(),
  mockFindUnique: vi.fn(),
  mockVrCreate: vi.fn(),
  mockVrUpdate: vi.fn(),
  mockVrFindUnique: vi.fn(),
  mockTxVrFindUnique: vi.fn(),
}));

const tx = {
  inventoryValue: { findFirst: mockFindFirst, findUnique: mockFindUnique },
  item: { findUnique: vi.fn() },
  fabricRoll: { findUnique: vi.fn() },
  vendorReturn: { create: mockVrCreate, update: mockVrUpdate, findUnique: mockTxVrFindUnique },
};

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@elorae/db", () => ({
  moveMainStock: vi.fn(),
  prisma: {
    $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
    vendorReturn: { findUnique: mockVrFindUnique },
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/docNumber", () => ({ generateDocNumber: vi.fn().mockResolvedValue("RET-1") }));
vi.mock("@/app/actions/hpp", () => ({ getEffectiveHPPForItem: vi.fn() }));
vi.mock("@/lib/notifications/actor-name", () => ({
  getActorName: vi.fn().mockResolvedValue("actor"),
}));
vi.mock("@/app/actions/notifications", () => ({
  notifyVendorReturnCreated: vi.fn(),
  notifyVendorReturnStatusUpdated: vi.fn(),
}));

import {
  completeReturn,
  createVendorReturn,
  processReturn,
  updateVendorReturn,
} from "./vendor-returns";

const input = {
  vendorId: "v1",
  lines: [
    {
      type: "ACCESSORIES" as const,
      itemId: "i1",
      qty: 4,
      reason: "damaged goods",
      condition: "DAMAGED" as const,
    },
  ],
};

function valuedLines(call: { data: { lines: string; totalValue: number } }) {
  return JSON.parse(call.data.lines) as Array<{ costValue: number }>;
}

describe("vendor return line valuation on a null-spelled variantless inventory row", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["*"] } });
    mockFindUnique.mockResolvedValue(null);
    tx.item.findUnique.mockResolvedValue({ nameId: "Button" });
    mockVrCreate.mockResolvedValue({ id: "r1", docNumber: "RET-1" });
    mockVrUpdate.mockResolvedValue({ id: "r1", docNumber: "RET-1" });
    mockVrFindUnique.mockResolvedValue({ id: "r1", status: "DRAFT", docNumber: "RET-1" });
    mockFindFirst.mockImplementation(async ({ where }: { where: { OR?: unknown[] } }) => {
      const tolerant = JSON.stringify(where.OR) === JSON.stringify([{ variantSku: null }, { variantSku: "" }]);
      return tolerant ? { id: "iv1", avgCost: "2.5", qtyOnHand: "10" } : null;
    });
  });

  it("create values the line at the null row's avgCost", async () => {
    await createVendorReturn(input, "u1");
    const call = mockVrCreate.mock.calls[0][0];
    expect(valuedLines(call)[0].costValue).toBe(10);
    expect(call.data.totalValue).toBe(10);
  });

  it("update values the line at the null row's avgCost", async () => {
    await updateVendorReturn("r1", input, "u1");
    const call = mockVrUpdate.mock.calls[0][0];
    expect(valuedLines(call)[0].costValue).toBe(10);
  });

  it("still values a genuinely missing row at 0", async () => {
    mockFindFirst.mockResolvedValue(null);
    await createVendorReturn(input, "u1");
    expect(valuedLines(mockVrCreate.mock.calls[0][0])[0].costValue).toBe(0);
  });
});

describe("vendor return actor trust", () => {
  const FORBIDDEN = "Forbidden: actor does not match the session";
  const completeInput = {} as never;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["*"] } });
  });

  it.each([
    ["createVendorReturn", () => createVendorReturn(input, "someone-else")],
    ["processReturn", () => processReturn("r1", "someone-else")],
    ["completeReturn", () => completeReturn("r1", "someone-else", completeInput)],
  ] as Array<[string, () => Promise<unknown>]>)(
    "%s refuses a claimed id that is not the session user and writes nothing",
    async (_name, call) => {
      await expect(call()).rejects.toThrow(FORBIDDEN);
      expect(mockVrCreate).not.toHaveBeenCalled();
      expect(mockVrUpdate).not.toHaveBeenCalled();
      expect(mockVrFindUnique).not.toHaveBeenCalled();
      expect(mockTxVrFindUnique).not.toHaveBeenCalled();
    }
  );

  it.each([
    ["processReturn", () => processReturn("r1", "u1")],
    ["completeReturn", () => completeReturn("r1", "u1", completeInput)],
  ] as Array<[string, () => Promise<unknown>]>)(
    "%s rejects an unauthenticated caller",
    async (_name, call) => {
      mockAuth.mockResolvedValue(null);
      await expect(call()).rejects.toThrow("Unauthorized");
      expect(mockVrFindUnique).not.toHaveBeenCalled();
      expect(mockTxVrFindUnique).not.toHaveBeenCalled();
    }
  );

  it.each([
    ["processReturn", () => processReturn("r1", "u1")],
    ["completeReturn", () => completeReturn("r1", "u1", completeInput)],
  ] as Array<[string, () => Promise<unknown>]>)(
    "%s rejects a caller without vendor_returns:manage",
    async (_name, call) => {
      mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["vendor_returns:create"] } });
      await expect(call()).rejects.toThrow("Forbidden: Insufficient permissions");
      expect(mockVrFindUnique).not.toHaveBeenCalled();
      expect(mockTxVrFindUnique).not.toHaveBeenCalled();
    }
  );

  it.each([
    ["processReturn", () => processReturn("r1", "u1"), "Return tidak valid atau sudah diproses"],
    [
      "completeReturn",
      () => completeReturn("r1", "u1", { trackingNumber: "TRK-1", receiptFileUrl: "https://example.com/r.pdf" }),
      "Return must be in PROCESSED status to complete",
    ],
  ] as Array<[string, () => Promise<unknown>, string]>)(
    "%s reads the return inside the transaction once the caller passes (positive control)",
    async (_name, call, message) => {
      mockTxVrFindUnique.mockResolvedValue(null);
      await expect(call()).rejects.toThrow(message);
      expect(mockTxVrFindUnique).toHaveBeenCalledWith({ where: { id: "r1" } });
    }
  );
});
