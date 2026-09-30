import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";

vi.mock("@elorae/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@elorae/db")>();
  return {
    ...actual,
    prisma: {
      settlement: {
        findFirst: vi.fn(),
      },
    },
  };
});

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/finance/settlement/parser", () => ({
  parseSettlement: vi.fn(),
  isSupportedMarketplace: (m: string) => m === "SHOPEE" || m === "TIKTOK",
}));
vi.mock("@/lib/finance/settlement/persist", () => ({ persistSettlement: vi.fn() }));
vi.mock("@/lib/finance/settlement/match", () => ({ matchSettlement: vi.fn() }));
vi.mock("@/lib/finance/settlement/start-resync", () => ({ startSettlementResync: vi.fn() }));

import { prisma, Prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { parseSettlement } from "@/lib/finance/settlement/parser";
import { persistSettlement } from "@/lib/finance/settlement/persist";
import { matchSettlement } from "@/lib/finance/settlement/match";
import { startSettlementResync } from "@/lib/finance/settlement/start-resync";
import { POST } from "./route";

const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;
const mockFindFirst = prisma.settlement.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockParse = parseSettlement as unknown as ReturnType<typeof vi.fn>;
const mockPersist = persistSettlement as unknown as ReturnType<typeof vi.fn>;
const mockMatch = matchSettlement as unknown as ReturnType<typeof vi.fn>;
const mockResync = startSettlementResync as unknown as ReturnType<typeof vi.fn>;

const FILE_BYTES = Buffer.from("settlement-file-bytes");
const FILE_SHA = createHash("sha256").update(FILE_BYTES).digest("hex");

/* The route only calls request.formData(), so a plain Request stands in for NextRequest. */
function buildRequest(): Parameters<typeof POST>[0] {
  const formData = new FormData();
  formData.append("file", new File([FILE_BYTES], "report.xlsx"));
  formData.append("marketplace", "SHOPEE");
  return new Request("http://localhost/api/finance/settlements/upload", {
    method: "POST",
    body: formData,
  }) as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
  vi.resetAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "user-1", permissions: ["*"] } });
  mockParse.mockReturnValue({ ok: true, data: { incomeLines: [] } });
  mockMatch.mockResolvedValue({ matched: 0, unmatched: 0 });
  mockResync.mockResolvedValue({ ok: false, code: "NO_TARGETS" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/finance/settlements/upload dedupe", () => {
  it("returns 409 with the existing id for an already-uploaded file, without parsing or persisting", async () => {
    mockFindFirst.mockResolvedValue({ id: "existing-1" });

    const res = await POST(buildRequest());

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "DUPLICATE_FILE", settlementId: "existing-1" });
    expect(mockFindFirst).toHaveBeenCalledWith({
      where: { marketplace: "SHOPEE", fileSha256: FILE_SHA },
      select: { id: true },
    });
    expect(mockParse).not.toHaveBeenCalled();
    expect(mockPersist).not.toHaveBeenCalled();
  });

  it("persists a new file with its SHA-256 hex", async () => {
    mockFindFirst.mockResolvedValue(null);
    mockPersist.mockResolvedValue({
      settlementId: "new-1",
      checksumOk: true,
      checksumVariance: 0,
      lineCount: 0,
    });

    const res = await POST(buildRequest());

    expect(res.status).toBe(200);
    expect(mockPersist).toHaveBeenCalledWith(
      expect.objectContaining({ fileSha256: FILE_SHA, marketplace: "SHOPEE" }),
    );
  });

  it("returns 409 with the winner's id when a racing upload trips the unique on create", async () => {
    mockFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "winner-1" });
    mockPersist.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
      }),
    );

    const res = await POST(buildRequest());

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "DUPLICATE_FILE", settlementId: "winner-1" });
  });

  it("returns 409 with the winner's id when the loser's transaction expires waiting on the winner (P2028)", async () => {
    mockFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "winner-1" });
    mockPersist.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Transaction already closed", {
        code: "P2028",
        clientVersion: "test",
      }),
    );

    const res = await POST(buildRequest());

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "DUPLICATE_FILE", settlementId: "winner-1" });
  });

  it("does not turn any other persist error into a 409", async () => {
    mockFindFirst.mockResolvedValue(null);
    mockPersist.mockRejectedValue(new Error("db down"));

    const res = await POST(buildRequest());

    expect(res.status).toBe(500);
  });
});
