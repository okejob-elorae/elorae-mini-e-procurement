import { beforeEach, describe, expect, it, vi } from "vitest";

const { logPrint } = vi.hoisted(() => ({ logPrint: vi.fn() }));
vi.mock("@/app/actions/audit", () => ({ logPrint }));

const { logPrintQuietly } = await import("./log-print-quietly");

describe("logPrintQuietly", () => {
  beforeEach(() => {
    logPrint.mockReset();
  });

  it("forwards the entity type and id to logPrint", () => {
    logPrint.mockResolvedValue(undefined);

    logPrintQuietly("VanSaleNota", "sale-1");

    expect(logPrint).toHaveBeenCalledWith("VanSaleNota", "sale-1");
  });

  it("returns synchronously and swallows a rejected audit write", async () => {
    logPrint.mockRejectedValue(new Error("offline"));

    expect(logPrintQuietly("SpgSaleNota", "sale-2")).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("swallows a synchronous throw from logPrint", () => {
    logPrint.mockImplementation(() => {
      throw new Error("boom");
    });

    expect(() => logPrintQuietly("StoreSettlementBkm", "s-1")).not.toThrow();
  });
});
