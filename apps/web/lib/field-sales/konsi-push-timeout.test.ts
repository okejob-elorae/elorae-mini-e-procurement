import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@elorae/db";

const { mockRunSerializable } = vi.hoisted(() => ({ mockRunSerializable: vi.fn() }));
vi.mock("@/lib/db/tx-retry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db/tx-retry")>()),
  runSerializable: mockRunSerializable,
}));
vi.mock("@/lib/notifications/recipients", () => ({ sendNotificationToUsers: vi.fn() }));

import { createKonsiPushOrder } from "./konsi-push-writer";
import { KonsiPushError } from "./errors";

const input = {
  storeId: "s1",
  salesmanId: "u1",
  pushedById: "u2",
  lines: [{ itemId: "i1", variantSku: "", qty: 1 }],
  idempotencyKey: "00000000-0000-4000-8000-000000000000",
};

describe("createKonsiPushOrder — transaction expiry", () => {
  it("maps an expired interactive transaction (P2028) to TRANSACTION_TIMEOUT", async () => {
    mockRunSerializable.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("Transaction already closed", { code: "P2028", clientVersion: "test" }));
    await expect(createKonsiPushOrder(input)).rejects.toMatchObject({ name: "KonsiPushError", code: "TRANSACTION_TIMEOUT" });
  });

  it("runs the transaction under an explicit timeout above Prisma's 5s default", async () => {
    mockRunSerializable.mockRejectedValueOnce(new Error("stop"));
    await createKonsiPushOrder(input).catch(() => {});
    const options = mockRunSerializable.mock.calls.at(-1)?.[1];
    expect(options.timeout).toBeGreaterThan(5_000);
    expect(options.maxWait).toBeGreaterThan(0);
  });

  it("lets any other error through untouched", async () => {
    const boom = new Error("boom");
    mockRunSerializable.mockRejectedValueOnce(boom);
    await expect(createKonsiPushOrder(input)).rejects.toBe(boom);
    expect(boom).not.toBeInstanceOf(KonsiPushError);
  });
});
