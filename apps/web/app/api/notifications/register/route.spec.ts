import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@elorae/db", () => ({
  prisma: {
    $transaction: vi.fn(),
    user: {
      updateMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { POST } from "./route";

const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;
const mockTransaction = prisma.$transaction as unknown as ReturnType<typeof vi.fn>;
const mockUpdateMany = prisma.user.updateMany as unknown as ReturnType<typeof vi.fn>;
const mockUpdate = prisma.user.update as unknown as ReturnType<typeof vi.fn>;

function request(body: unknown): NextRequest {
  return new Request("http://localhost/api/notifications/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdateMany.mockImplementation((args: unknown) => ({ op: "clearOthers", args }));
  mockUpdate.mockImplementation((args: unknown) => ({ op: "assign", args }));
  mockTransaction.mockResolvedValue([{ count: 0 }, {}]);
});

describe("POST /api/notifications/register", () => {
  it("returns 401 without a session and writes nothing", async () => {
    mockAuth.mockResolvedValue(null);

    const res = await POST(request({ token: "tok-1" }));

    expect(res.status).toBe(401);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("returns 400 for a missing token and writes nothing", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });

    const res = await POST(request({ token: "   " }));

    expect(res.status).toBe(400);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("takes the token off every other user in the same transaction that assigns it", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-2" } });

    const res = await POST(request({ token: " tok-shared " }));

    expect(res.status).toBe(200);
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { fcmToken: "tok-shared", NOT: { id: "user-2" } },
      data: { fcmToken: null },
    });
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "user-2" },
      data: { fcmToken: "tok-shared" },
    });
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    const ops = mockTransaction.mock.calls[0][0] as Array<{ op: string }>;
    expect(ops.map((o) => o.op)).toEqual(["clearOthers", "assign"]);
  });

  it("returns 500 when the transaction fails", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    mockTransaction.mockRejectedValue(new Error("db down"));

    const res = await POST(request({ token: "tok-1" }));

    expect(res.status).toBe(500);
  });
});
