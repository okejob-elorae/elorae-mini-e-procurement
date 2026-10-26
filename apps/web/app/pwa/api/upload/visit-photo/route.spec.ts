import { describe, it, expect, vi, beforeEach } from "vitest";

const uploadToR2 = vi.fn();

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/pwa/guard", () => ({ pwaAccessGuard: () => "render" }));
vi.mock("@/lib/r2", () => ({ uploadToR2: (...a: unknown[]) => uploadToR2(...a), isConfigured: () => true }));
vi.mock("@elorae/db", () => ({
  prisma: {
    visitPhoto: { findUnique: vi.fn(), count: vi.fn() },
    storeVisit: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { POST } from "./route";
import { MAX_PHOTOS_PER_VISIT, VisitPhotoCapError } from "@/lib/field-sales/visit-photo-writer";

const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;
const db = prisma as unknown as {
  visitPhoto: { findUnique: ReturnType<typeof vi.fn>; count: ReturnType<typeof vi.fn> };
  storeVisit: { findFirst: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

function upload() {
  const form = new FormData();
  form.set("file", new File([new Uint8Array([1, 2, 3])], "a.jpg", { type: "image/jpeg" }));
  form.set("visitId", "visit1");
  form.set("clientId", "client1");
  return new Request("http://localhost/pwa/api/upload/visit-photo", { method: "POST", body: form }) as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "u1", permissions: [] } });
  db.visitPhoto.findUnique.mockResolvedValue(null);
  db.storeVisit.findFirst.mockResolvedValue({ id: "visit1" });
  uploadToR2.mockResolvedValue("https://r2/x.jpg");
});

describe("POST /pwa/api/upload/visit-photo cap", () => {
  it("refuses the upload past the cap with a typed 409 and writes nothing to R2", async () => {
    db.visitPhoto.count.mockResolvedValue(MAX_PHOTOS_PER_VISIT);
    const res = await POST(upload());
    expect(res.status).toBe(409);
    expect(db.visitPhoto.count).toHaveBeenCalledWith({ where: { visitId: "visit1" } });
    expect(await res.json()).toMatchObject({ code: "PHOTO_CAP_REACHED" });
    expect(uploadToR2).not.toHaveBeenCalled();
  });

  it("maps the writer's in-transaction cap refusal to the same 409", async () => {
    db.visitPhoto.count.mockResolvedValue(MAX_PHOTOS_PER_VISIT - 1);
    db.$transaction.mockRejectedValue(new VisitPhotoCapError("visit1"));
    const res = await POST(upload());
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "PHOTO_CAP_REACHED" });
  });

  it("uploads when under the cap", async () => {
    db.visitPhoto.count.mockResolvedValue(MAX_PHOTOS_PER_VISIT - 1);
    db.$transaction.mockResolvedValue({ id: "p1", url: "https://r2/x.jpg" });
    const res = await POST(upload());
    expect(res.status).toBe(200);
    expect(uploadToR2).toHaveBeenCalledTimes(1);
  });
});
