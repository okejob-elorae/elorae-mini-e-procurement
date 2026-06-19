/**
 * Cross-app spec: tests apps/web/lib/redis/lock.ts via relative path.
 * Runs under apps/api jest harness (commonjs / node moduleResolution) so the
 * web typecheck/test constraints don't apply. The lock module itself only uses
 * Node built-ins + ioredis, no Next.js APIs, so the api ts-jest context is fine.
 */
import { withSalesReturnLock, SalesReturnLockBusyError } from "../../../../apps/web/lib/redis/lock";
import { getRedis } from "../../../../apps/web/lib/redis/client";

jest.mock("../../../../apps/web/lib/redis/client", () => ({
  getRedis: jest.fn(),
}));

describe("withSalesReturnLock (cross-app spec)", () => {
  function buildRedisMock(setNxBehavior: () => Promise<"OK" | null>) {
    return {
      set: jest.fn().mockImplementation(setNxBehavior),
      eval: jest.fn().mockResolvedValue(1),
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("acquires + releases on success", async () => {
    const redis = buildRedisMock(async () => "OK");
    (getRedis as jest.Mock).mockReturnValue(redis);

    const result = await withSalesReturnLock("r1", async () => "ok");

    expect(result).toBe("ok");
    expect(redis.set).toHaveBeenCalledWith(
      "salesreturn-lock:r1",
      expect.any(String),
      "PX",
      expect.any(Number),
      "NX",
    );
    expect(redis.eval).toHaveBeenCalled();
  });

  it("throws SalesReturnLockBusyError when lock is held", async () => {
    const redis = buildRedisMock(async () => null);
    (getRedis as jest.Mock).mockReturnValue(redis);

    await expect(
      withSalesReturnLock("r1", async () => "should-not-run", { acquireTimeoutMs: 100 }),
    ).rejects.toBeInstanceOf(SalesReturnLockBusyError);
  });

  it("releases the lock even if the callback throws", async () => {
    const redis = buildRedisMock(async () => "OK");
    (getRedis as jest.Mock).mockReturnValue(redis);

    await expect(
      withSalesReturnLock("r1", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(redis.eval).toHaveBeenCalled();
  });

  it("only releases lock when token matches (compare-and-delete)", async () => {
    const redis = buildRedisMock(async () => "OK");
    (getRedis as jest.Mock).mockReturnValue(redis);

    await withSalesReturnLock("r1", async () => "ok");

    // The eval should be a compare-and-delete script with the token as arg
    const evalCall = redis.eval.mock.calls[0];
    expect(evalCall[0]).toContain("redis.call"); // it's a Lua script
    expect(evalCall[3]).toEqual(expect.any(String)); // token argument
  });
});
