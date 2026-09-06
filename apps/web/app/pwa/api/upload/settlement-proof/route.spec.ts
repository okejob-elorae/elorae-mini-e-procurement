import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@elorae/db", () => ({
  prisma: {
    storeSettlement: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/r2", () => ({
  isConfigured: vi.fn(),
  uploadToR2: vi.fn(),
  deleteFromR2: vi.fn(),
}));

import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { isConfigured, uploadToR2, deleteFromR2 } from "@/lib/r2";
import { POST } from "./route";

const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;
const mockIsConfigured = isConfigured as unknown as ReturnType<typeof vi.fn>;
const mockUpload = uploadToR2 as unknown as ReturnType<typeof vi.fn>;
const mockDelete = deleteFromR2 as unknown as ReturnType<typeof vi.fn>;
const mockFindUnique = prisma.storeSettlement.findUnique as unknown as ReturnType<typeof vi.fn>;

const DRAFT_ID = "11111111-2222-4333-8444-555555555555";

function formRequest(overrides: { draftId?: string; slot?: string } = {}): Request {
  const fd = new FormData();
  fd.set("file", new File([new Uint8Array([1, 2, 3])], "proof.jpg", { type: "image/jpeg" }));
  fd.set("draftId", overrides.draftId ?? DRAFT_ID);
  fd.set("slot", overrides.slot ?? "program-0");
  return new Request("http://localhost/pwa/api/upload/settlement-proof", { method: "POST", body: fd });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["settlements:submit"] } });
  mockIsConfigured.mockReturnValue(true);
  mockUpload.mockResolvedValue("https://cdn.example/settlement-proofs/a/program-0.jpg");
  mockDelete.mockResolvedValue(undefined);
  mockFindUnique.mockResolvedValue(null);
});

describe("POST /pwa/api/upload/settlement-proof", () => {
  /**
   * The finding this spec pins: a draftId that already belongs to a submitted (PENDING or
   * otherwise) settlement must refuse the upload with 409 rather than silently overwrite the
   * evidence an approver is about to review. Without the `findUnique` guard, this request would
   * fall straight through to `uploadToR2` and succeed.
   */
  it("refuses with 409 when the draftId already belongs to a submitted settlement", async () => {
    mockFindUnique.mockResolvedValue({ id: "settlement-1" });

    const res = await POST(formRequest() as never);

    expect(res.status).toBe(409);
    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { idempotencyKey: DRAFT_ID },
      select: { id: true },
    });
  });

  it("does not leak which settlement the draftId belongs to", async () => {
    mockFindUnique.mockResolvedValue({ id: "settlement-1" });

    const res = await POST(formRequest() as never);
    const body = await res.json();

    expect(JSON.stringify(body)).not.toContain("settlement-1");
  });

  it("still uploads when the draftId has not been submitted yet", async () => {
    mockFindUnique.mockResolvedValue(null);

    const res = await POST(formRequest() as never);

    expect(res.status).toBe(200);
    expect(mockUpload).toHaveBeenCalledTimes(1);
  });

  it("returns 401 without a session, before checking the draft", async () => {
    mockAuth.mockResolvedValue(null);

    const res = await POST(formRequest() as never);

    expect(res.status).toBe(401);
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  /**
   * B2: the pre-upload `findUnique` above is not the only guard — it leaves a window open for
   * exactly as long as `uploadToR2` takes. This pins the compensating check: a submit that lands
   * WHILE the upload is in flight (first `findUnique` call sees nothing, the second sees the
   * settlement that was created in between) must still delete the object this request just wrote
   * and return the same 409, not report success on evidence about to be treated as audited.
   */
  it("deletes the just-uploaded object and returns 409 when the draftId is submitted while the upload is in flight", async () => {
    mockFindUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "settlement-1" });

    const res = await POST(formRequest() as never);

    expect(res.status).toBe(409);
    expect(mockFindUnique).toHaveBeenCalledTimes(2);
    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(mockDelete).toHaveBeenCalledWith(`settlement-proofs/${DRAFT_ID}/program-0.jpg`);
  });

  it("still returns 409 (not 500) when the compensating delete itself fails", async () => {
    mockFindUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "settlement-1" });
    mockDelete.mockRejectedValue(new Error("r2 unavailable"));

    const res = await POST(formRequest() as never);

    expect(res.status).toBe(409);
  });
});
