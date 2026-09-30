import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const { mockCreate, mockUpdate, mockSend } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockUpdate: vi.fn(),
  mockSend: vi.fn(),
}));

/* Both of the helper's side effects are fakes here, so no case can reach the `:3308` bed or FCM whichever way the guard falls. */
vi.mock("@elorae/db", () => ({
  prisma: { notificationQueue: { create: mockCreate, update: mockUpdate } },
}));
vi.mock("@/lib/firebase/admin", () => ({ messaging: { send: mockSend } }));

import { sendNotificationToUsers } from "./recipients";

const PAYLOAD = { type: "AR_OVERDUE", title: "Piutang jatuh tempo", body: "Nota lewat jatuh tempo.", data: { receivableId: "r1" } };

function resetMocks() {
  mockCreate.mockReset();
  mockUpdate.mockReset();
  mockSend.mockReset();
  mockCreate.mockImplementation(async ({ data }: { data: { userId: string } }) => ({ id: `q-${data.userId}` }));
  mockUpdate.mockResolvedValue({});
  mockSend.mockResolvedValue("message-id");
}

describe("sendNotificationToUsers", () => {
  beforeEach(() => {
    resetMocks();
    /**
     * The helper refuses to deliver whenever `VITEST` is set, which is every spec in this suite
     * including this one. These cases are the only place the real path is meant to run, so the
     * flag is cleared per-case — the same escape hatch `admin-fanout.test.ts` uses, and safe for
     * the same reason: both dependencies are mocked above.
     */
    vi.stubEnv("VITEST", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("writes one queue row per user and pushes only to the ones holding a token", async () => {
    await sendNotificationToUsers([{ id: "u1", fcmToken: "tok-1" }, { id: "u2", fcmToken: null }], PAYLOAD);
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ token: "tok-1" }));
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "q-u1" } }));
  });

  it("logs a failed push instead of throwing", async () => {
    mockSend.mockRejectedValue(new Error("fcm down"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(sendNotificationToUsers([{ id: "u1", fcmToken: "tok-1" }], PAYLOAD)).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalled();
      expect(mockUpdate).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  /* Load-bearing for the overdue sweep, which writes its dedup marker only when this call returns. */
  it("lets a queue insert failure reach the caller", async () => {
    mockCreate.mockRejectedValue(new Error("insert failed"));
    await expect(sendNotificationToUsers([{ id: "u1", fcmToken: "tok-1" }], PAYLOAD)).rejects.toThrow("insert failed");
    expect(mockSend).not.toHaveBeenCalled();
  });
});

/**
 * The guard is what keeps a spec that reaches an unguarded caller from writing permanent
 * `NotificationQueue` rows onto the shared dev bed — and, where the Firebase credentials in
 * `apps/web/.env` are live, from pushing to real phones. Asserted directly so it cannot be
 * removed silently.
 */
describe("sendNotificationToUsers test-run guard", () => {
  beforeEach(() => {
    resetMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("writes and pushes nothing while VITEST is set", async () => {
    vi.stubEnv("VITEST", "true");
    await expect(sendNotificationToUsers([{ id: "u1", fcmToken: "tok-1" }], PAYLOAD)).resolves.toBeUndefined();
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("is already set by the runner, so an unguarded caller is covered by default", async () => {
    expect(process.env.VITEST).toBeTruthy();
    await sendNotificationToUsers([{ id: "u1", fcmToken: "tok-1" }], PAYLOAD);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });
});
