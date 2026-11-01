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
import { KONSI_NOTIFICATION_CATEGORIES } from "@/lib/konsi-count-schedule/categories";

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

    // Isolated from the calls above, so a stale toHaveBeenCalledWith cannot pass for it. A held
    // order is approved only with an override reason, which the action accepts only from
    // `field_sales_orders:credit_override` — plain approvers already hear about the order through
    // PENDING_ORDER_APPROVAL.
    mockGetUsers.mockClear();
    await fanOutAdminNotification({ ...BASE, category: "CREDIT_LIMIT_HOLD" });
    expect(mockGetUsers).toHaveBeenCalledWith("field_sales_orders:credit_override");
    expect(mockGetUsers).not.toHaveBeenCalledWith("field_sales_orders:approve");
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining("no permission mapped for category CREDIT_LIMIT_HOLD"));

    mockGetUsers.mockClear();
    await fanOutAdminNotification({ ...BASE, category: "AR_OVERDUE" });
    expect(mockGetUsers).toHaveBeenCalledWith("collections:manage");

    mockGetUsers.mockClear();
    await fanOutAdminNotification({ ...BASE, category: "PO_PAYMENT_DUE" });
    expect(mockGetUsers).toHaveBeenCalledWith("purchase_orders:edit");

    mockGetUsers.mockClear();
    await fanOutAdminNotification({ ...BASE, category: "SALES_RETURN_RECEIVED" });
    expect(mockGetUsers).toHaveBeenCalledWith("sales_returns:decide");
  });

  it("routes every konsi count and report category to stores:manage", async () => {
    expect(KONSI_NOTIFICATION_CATEGORIES).toHaveLength(5);
    for (const category of KONSI_NOTIFICATION_CATEGORIES) {
      mockGetUsers.mockClear();
      await fanOutAdminNotification({ ...BASE, category });
      expect(mockGetUsers).toHaveBeenCalledWith("stores:manage");
    }
  });

  it("tells whoever may verify payment claims about giros falling due", async () => {
    // Only a claim verifier (`payments:verify`, `bolehMemverifikasi`) can mark a giro cleared or
    // bounced; pinging anyone else about it is noise.
    await fanOutAdminNotification({ ...BASE, category: "GIRO_JATUH_TEMPO" });
    expect(mockGetUsers).toHaveBeenCalledWith("payments:verify");
    expect(mockGetUsers).not.toHaveBeenCalledWith("journals:manage");
    expect(mockSend).toHaveBeenCalledWith(
      [{ id: "u1", fcmToken: null }],
      expect.objectContaining({ type: "GIRO_JATUH_TEMPO" }),
    );
  });

  /*
   * The permission split (owner, 2026-10-29 and 2026-11-01) moved these decisions to their own
   * codes. Routing them by the old code tells people who can no longer act and leaves out the ones
   * who now can. Each pair is the category and the code its office action checks.
   */
  it.each([
    ["GIRO_JATUH_TEMPO", "payments:verify"],
    ["KLAIM_DIBATALKAN_SALES", "payments:verify"],
    ["KOREKSI_DIMINTA_BKM", "payments:verify"],
    ["COLLECTION_PENDING_VERIFICATION", "payments:verify"],
    ["STOCK_LOSS_OPEN", "receivables:decide_bearer"],
    ["STORE_TRANSFER_PROPOSED", "store_transfers:approve"],
    ["STORE_TRANSFER_DISCREPANCY", "store_transfers:decide_shortfall"],
    ["CREDIT_LIMIT_HOLD", "field_sales_orders:credit_override"],
    // Unchanged on purpose: retur-toko actions still check receivables:manage, and receiving a
    // transfer on the store's behalf is still stores:manage.
    ["RETUR_DIBATALKAN_SALES", "receivables:manage"],
    ["KOREKSI_DIMINTA_RETUR", "receivables:manage"],
    ["STORE_TRANSFER_TO_RECEIVE", "stores:manage"],
    ["STORE_TRANSFER_STALE", "stores:manage"],
  ])("routes %s to %s, the code its office action checks", async (category, permission) => {
    mockGetUsers.mockClear();
    await fanOutAdminNotification({ ...BASE, category });
    expect(mockGetUsers).toHaveBeenCalledTimes(1);
    expect(mockGetUsers).toHaveBeenCalledWith(permission);
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
