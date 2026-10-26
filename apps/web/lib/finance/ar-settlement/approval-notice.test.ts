import { describe, it, expect, vi, beforeEach } from "vitest";

const { findUnique, send } = vi.hoisted(() => ({ findUnique: vi.fn(), send: vi.fn() }));

vi.mock("@elorae/db", () => ({ prisma: { user: { findUnique } } }));
vi.mock("@/lib/notifications/recipients", () => ({ sendNotificationToUsers: send }));

import { notifySalesmanOfApproval } from "./approval-notice";

const notice = { id: "s1", docNo: "PEL/1", storeId: "st1", salesmanId: "u1" };

describe("notifySalesmanOfApproval", () => {
  beforeEach(() => {
    findUnique.mockReset();
    send.mockReset();
  });

  it("sends a SETTLEMENT_APPROVED push to the salesman", async () => {
    findUnique.mockResolvedValue({ id: "u1", fcmToken: null });
    await notifySalesmanOfApproval(notice);
    expect(send).toHaveBeenCalledTimes(1);
    const [users, payload] = send.mock.calls[0];
    expect(users).toEqual([{ id: "u1", fcmToken: null }]);
    expect(payload).toMatchObject({
      type: "SETTLEMENT_APPROVED",
      data: { settlementId: "s1", docNo: "PEL/1", storeId: "st1" },
    });
  });

  it("sends nothing when the salesman no longer exists", async () => {
    findUnique.mockResolvedValue(null);
    await notifySalesmanOfApproval(notice);
    expect(send).not.toHaveBeenCalled();
  });

  it("swallows a delivery failure", async () => {
    findUnique.mockResolvedValue({ id: "u1", fcmToken: null });
    send.mockRejectedValue(new Error("fcm down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(notifySalesmanOfApproval(notice)).resolves.toBeUndefined();
    } finally {
      spy.mockRestore();
    }
  });
});
