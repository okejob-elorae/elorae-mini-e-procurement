import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const { mockGetUsers, mockSend } = vi.hoisted(() => ({
  mockGetUsers: vi.fn(),
  mockSend: vi.fn(),
}));

vi.mock("./recipients", () => ({
  getUsersWithPermission: mockGetUsers,
  sendNotificationToUsers: mockSend,
}));

import { fanOutAdminNotification, toFcmData } from "./admin-fanout";

const BASE = {
  id: "notif-1",
  title: "Journal not posted",
  message: "Post it manually from the document.",
};

describe("toFcmData", () => {
  it("passes strings through and stringifies numbers and booleans", () => {
    expect(toFcmData({ a: "x", b: 2, c: true })).toEqual({ a: "x", b: "2", c: "true" });
  });

  it("drops null and undefined rather than sending them as text", () => {
    expect(toFcmData({ a: "x", b: null, c: undefined })).toEqual({ a: "x" });
  });

  it("drops objects and arrays", () => {
    expect(toFcmData({ a: "x", b: { nested: 1 }, c: [1, 2] })).toEqual({ a: "x" });
  });

  it("returns an empty object for a non-object metadata value", () => {
    expect(toFcmData(null)).toEqual({});
    expect(toFcmData("nope")).toEqual({});
  });
});

describe("fanOutAdminNotification", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockGetUsers.mockReset();
    mockSend.mockReset();
    mockGetUsers.mockResolvedValue([{ id: "u1", fcmToken: null }]);
    mockSend.mockResolvedValue(undefined);
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("resolves recipients by the permission that can act on the category", async () => {
    await fanOutAdminNotification({ ...BASE, category: "JOURNAL_PENDING" });
    expect(mockGetUsers).toHaveBeenCalledWith("journals:manage");

    await fanOutAdminNotification({ ...BASE, category: "PENDING_ORDER_APPROVAL" });
    expect(mockGetUsers).toHaveBeenCalledWith("field_sales_orders:approve");

    await fanOutAdminNotification({ ...BASE, category: "STORE_CHANGE_REQUEST" });
    expect(mockGetUsers).toHaveBeenCalledWith("stores:manage");
  });

  it("sends the category as the type and carries the source id in data", async () => {
    await fanOutAdminNotification({
      ...BASE,
      category: "JOURNAL_PENDING",
      metadata: { docId: "doc-9", kind: "van_load" },
    });

    expect(mockSend).toHaveBeenCalledWith(
      [{ id: "u1", fcmToken: null }],
      {
        type: "JOURNAL_PENDING",
        title: BASE.title,
        body: BASE.message,
        data: { adminNotificationId: "notif-1", docId: "doc-9", kind: "van_load" },
      },
    );
  });

  it("does nothing for a category with no mapping", async () => {
    await fanOutAdminNotification({ ...BASE, category: "SOMETHING_NEW" });
    expect(mockGetUsers).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("no permission mapped for category SOMETHING_NEW"),
    );
  });

  it("does not send when the permission resolves to nobody", async () => {
    mockGetUsers.mockResolvedValue([]);
    await fanOutAdminNotification({ ...BASE, category: "JOURNAL_PENDING" });
    expect(mockSend).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("no recipients hold journals:manage"),
    );
  });

  it("never throws when delivery fails", async () => {
    mockSend.mockRejectedValue(new Error("FCM down"));
    await expect(
      fanOutAdminNotification({ ...BASE, category: "JOURNAL_PENDING" }),
    ).resolves.toBeUndefined();
  });

  it("never throws when recipient resolution fails", async () => {
    mockGetUsers.mockRejectedValue(new Error("db down"));
    await expect(
      fanOutAdminNotification({ ...BASE, category: "JOURNAL_PENDING" }),
    ).resolves.toBeUndefined();
  });
});
