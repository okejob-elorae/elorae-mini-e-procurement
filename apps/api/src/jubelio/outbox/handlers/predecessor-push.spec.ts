import { NonRetryableError } from "../../queue/errors";
import { assertPredecessorSettled } from "./predecessor-push";

describe("assertPredecessorSettled", () => {
  const rowCreatedAt = new Date("2026-10-01T10:00:00Z");
  let prisma: { jubelioOutbox: { findFirst: jest.Mock } };

  const run = () =>
    assertPredecessorSettled(prisma as any, {
      entityId: "so1",
      predecessorType: "salesorder_pick",
      rowCreatedAt,
    });

  beforeEach(() => {
    prisma = { jubelioOutbox: { findFirst: jest.fn() } };
  });

  it("returns when there is no predecessor row", async () => {
    prisma.jubelioOutbox.findFirst.mockResolvedValue(null);
    await expect(run()).resolves.toBeUndefined();
  });

  it.each(["DONE", "SKIPPED"])("returns when the predecessor is %s", async (status) => {
    prisma.jubelioOutbox.findFirst.mockResolvedValue({ id: "p1", status });
    await expect(run()).resolves.toBeUndefined();
  });

  it.each(["PENDING", "PROCESSING"])(
    "throws a retryable error when the predecessor is %s",
    async (status) => {
      prisma.jubelioOutbox.findFirst.mockResolvedValue({ id: "p1", status });
      const err = await run().catch((e) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(NonRetryableError);
      expect(err.message).toBe("salesorder_pick push for this order has not settled yet");
    },
  );

  it("throws NonRetryableError naming the row when the predecessor is DEAD", async () => {
    prisma.jubelioOutbox.findFirst.mockResolvedValue({ id: "p1", status: "DEAD" });
    const err = await run().catch((e) => e);
    expect(err).toBeInstanceOf(NonRetryableError);
    expect(err.message).toBe(
      "salesorder_pick push for this order is DEAD (row p1); settle it before this push can run",
    );
  });

  it("bounds the lookup to rows created at or before this row, newest first", async () => {
    prisma.jubelioOutbox.findFirst.mockResolvedValue(null);
    await run();
    expect(prisma.jubelioOutbox.findFirst).toHaveBeenCalledWith({
      where: {
        entityType: "salesorder_pick",
        entityId: "so1",
        createdAt: { lte: rowCreatedAt },
      },
      orderBy: { createdAt: "desc" },
    });
  });
});
