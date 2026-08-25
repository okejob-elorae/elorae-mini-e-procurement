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
    /**
     * The seam refuses to deliver whenever `VITEST` is set, which is every spec in this suite
     * including this one. These cases are the only place the real path is meant to run, so the
     * flag is cleared per-case — safely, because `./recipients` is mocked above, so nothing here
     * can reach the database or FCM whichever way the guard falls. The guard itself is asserted
     * in its own describe below, with the flag left in place.
     */
    vi.stubEnv("VITEST", "");
  });

  afterEach(() => {
    warnSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  it("resolves recipients by the permission that can act on the category", async () => {
    await fanOutAdminNotification({ ...BASE, category: "JOURNAL_PENDING" });
    expect(mockGetUsers).toHaveBeenCalledWith("journals:manage");

    await fanOutAdminNotification({ ...BASE, category: "PENDING_ORDER_APPROVAL" });
    expect(mockGetUsers).toHaveBeenCalledWith("field_sales_orders:approve");

    await fanOutAdminNotification({ ...BASE, category: "STORE_CHANGE_REQUEST" });
    expect(mockGetUsers).toHaveBeenCalledWith("stores:manage");

    await fanOutAdminNotification({ ...BASE, category: "TAX_INVOICE_PENDING" });
    expect(mockGetUsers).toHaveBeenCalledWith("tax_invoices:manage");

    await fanOutAdminNotification({ ...BASE, category: "FIELD_RETURN_MISMATCH" });
    expect(mockGetUsers).toHaveBeenCalledWith("field_returns:manage");
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

/**
 * The guard is what keeps a spec that never imports this module from writing permanent
 * `NotificationQueue` rows onto the shared dev bed — and, where the Firebase credentials in
 * `apps/web/.env` are live, from pushing to real phones. Asserted directly so it cannot be
 * removed silently.
 */
describe("fanOutAdminNotification test-run guard", () => {
  beforeEach(() => {
    mockGetUsers.mockReset();
    mockSend.mockReset();
    mockGetUsers.mockResolvedValue([{ id: "u1", fcmToken: null }]);
    mockSend.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("delivers nothing while VITEST is set, without resolving recipients", async () => {
    vi.stubEnv("VITEST", "true");
    await expect(
      fanOutAdminNotification({ ...BASE, category: "JOURNAL_PENDING" }),
    ).resolves.toBeUndefined();
    expect(mockGetUsers).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("is already set by the runner, so an unmocked caller is covered by default", async () => {
    expect(process.env.VITEST).toBeTruthy();
    await fanOutAdminNotification({ ...BASE, category: "STORE_CHANGE_REQUEST" });
    expect(mockGetUsers).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });
});
