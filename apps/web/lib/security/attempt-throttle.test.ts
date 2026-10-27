import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { throttledCompare, MAX_FAILED_ATTEMPTS } from "./attempt-throttle";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("throttledCompare", () => {
  let userId = "";

  beforeEach(async () => {
    userId = "";
    const user = await prisma.user.create({
      data: { email: `test-throttle-${Math.random().toString(36).slice(2)}@test.local`, name: "Throttle" },
    });
    userId = user.id;
  });

  afterEach(async () => {
    await prisma.pinAttempt.deleteMany({ where: { userId: seededId(userId) } });
    if (userId) await prisma.user.delete({ where: { id: userId } });
  });

  const wrong = async () => false;

  it("lets at most MAX wrong guesses past the count under concurrency", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        throttledCompare({ userId, action: "STOCK_ADJUSTMENT", kind: "pin", compare: wrong })
      )
    );
    const passed = results.filter((r) => r === "mismatch").length;
    expect(passed).toBeLessThanOrEqual(MAX_FAILED_ATTEMPTS);
    expect(passed + results.filter((r) => r === "blocked").length).toBe(8);
    const kept = await prisma.pinAttempt.count({ where: { userId: seededId(userId) } });
    expect(kept).toBe(passed);
  });

  it("blocks after three failures and does not extend the lockout with the refused row", async () => {
    for (let i = 0; i < 3; i++) {
      expect(await throttledCompare({ userId, action: "A", kind: "pin", compare: wrong })).toBe("mismatch");
    }
    expect(await throttledCompare({ userId, action: "A", kind: "pin", compare: wrong })).toBe("blocked");
    expect(await prisma.pinAttempt.count({ where: { userId: seededId(userId) } })).toBe(3);
  });

  it("marks the reserved row successful on a match", async () => {
    const r = await throttledCompare({ userId, action: "A", kind: "pin", compare: async () => true });
    expect(r).toBe("match");
    const rows = await prisma.pinAttempt.findMany({ where: { userId: seededId(userId) } });
    expect(rows).toHaveLength(1);
    expect(rows[0].success).toBe(true);
  });

  it("keeps PIN and password failures in separate budgets", async () => {
    for (let i = 0; i < 3; i++) {
      await throttledCompare({ userId, action: "CHANGE_PASSWORD", kind: "password", compare: wrong });
    }
    expect(
      await throttledCompare({ userId, action: "CHANGE_PASSWORD", kind: "password", compare: wrong })
    ).toBe("blocked");
    expect(await throttledCompare({ userId, action: "A", kind: "pin", compare: wrong })).toBe("mismatch");
    for (let i = 0; i < 2; i++) {
      await throttledCompare({ userId, action: "A", kind: "pin", compare: wrong });
    }
    expect(await throttledCompare({ userId, action: "A", kind: "pin", compare: wrong })).toBe("blocked");
  });
});
