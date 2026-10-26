import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = { id: string; userId: string; createdAt: Date };

const store: { rows: Row[] } = { rows: [] };

type Where = {
  userId: string;
  readAt?: null;
  OR?: Array<{ createdAt: Date | { lt: Date }; id?: { lt: string } }>;
};

/* Minimal in-memory stand-in for the two queries the route issues, honouring where/orderBy/take. */
function matches(row: Row, where: Where): boolean {
  if (row.userId !== where.userId) return false;
  if (!where.OR) return true;
  return where.OR.some((arm) => {
    if (arm.createdAt instanceof Date) {
      return row.createdAt.getTime() === arm.createdAt.getTime() && row.id < (arm.id?.lt ?? "");
    }
    return row.createdAt.getTime() < arm.createdAt.lt.getTime();
  });
}

vi.mock("@elorae/db", () => ({
  prisma: {
    notificationQueue: {
      findMany: vi.fn(async (args: { where: Where; take: number }) =>
        store.rows
          .filter((r) => matches(r, args.where))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1))
          .slice(0, args.take),
      ),
      count: vi.fn(async () => 0),
    },
  },
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { auth } from "@/lib/auth";
import { GET } from "./route";
import { decodeNotificationCursor, encodeNotificationCursor } from "@/lib/notifications/page";

const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;

function request(cursor?: string) {
  const url = new URL("http://localhost/api/notifications");
  if (cursor !== undefined) url.searchParams.set("cursor", cursor);
  return new Request(url);
}

async function readPage(cursor?: string) {
  const res = await GET(request(cursor));
  return { res, json: await res.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "user-1" } });
  /* 120 rows; every 3 consecutive rows share a createdAt so ties straddle page edges. */
  store.rows = Array.from({ length: 120 }, (_, i) => ({
    id: `n${String(i).padStart(3, "0")}`,
    userId: "user-1",
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, Math.floor(i / 3))),
  }));
  store.rows.push({ id: "other", userId: "user-2", createdAt: new Date(Date.UTC(2027, 0, 1)) });
});

describe("GET /api/notifications", () => {
  it("returns 401 without a session", async () => {
    mockAuth.mockResolvedValue(null);
    const { res } = await readPage();
    expect(res.status).toBe(401);
  });

  it("returns a first page of 50 with a nextCursor and the unread count", async () => {
    const { res, json } = await readPage();
    expect(res.status).toBe(200);
    expect(json.items).toHaveLength(50);
    expect(json.nextCursor).toEqual(expect.any(String));
    expect(json.unreadCount).toBe(0);
    expect(json.items.every((i: { id: string }) => i.id !== "other")).toBe(true);
  });

  it("pages with no overlap and no gap, breaking createdAt ties by id, until nextCursor is null", async () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    for (;;) {
      const { json } = await readPage(cursor);
      seen.push(...json.items.map((i: { id: string }) => i.id));
      pages += 1;
      if (json.nextCursor === null) {
        expect(json.items.length).toBeLessThanOrEqual(50);
        break;
      }
      cursor = json.nextCursor;
    }
    expect(pages).toBe(3);
    expect(seen).toHaveLength(120);
    expect(new Set(seen).size).toBe(120);
    const expected = store.rows
      .filter((r) => r.userId === "user-1")
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1))
      .map((r) => r.id);
    expect(seen).toEqual(expected);
  });

  it("returns nextCursor null when the rows fit exactly on one page", async () => {
    store.rows = store.rows.filter((r) => r.userId === "user-1").slice(0, 50);
    const { json } = await readPage();
    expect(json.items).toHaveLength(50);
    expect(json.nextCursor).toBeNull();
  });

  it.each(["!!!", "", "bm8tc2VwYXJhdG9y", Buffer.from("not-a-date|abc").toString("base64url")])(
    "rejects the malformed cursor %j with 400",
    async (bad) => {
      const { res } = await readPage(bad);
      expect(res.status).toBe(400);
    },
  );
});

describe("notification cursor codec", () => {
  it("round-trips", () => {
    const row = { createdAt: new Date("2026-03-04T05:06:07.089Z"), id: "abc123" };
    expect(decodeNotificationCursor(encodeNotificationCursor(row))).toEqual(row);
  });
});
