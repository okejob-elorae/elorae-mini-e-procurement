import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@elorae/db", () => ({
  prisma: {
    receivable: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/r2", () => ({
  isConfigured: vi.fn(),
  uploadToR2: vi.fn(),
}));

import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { isConfigured, uploadToR2 } from "@/lib/r2";
import { POST } from "./route";

const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;
const mockIsConfigured = isConfigured as unknown as ReturnType<typeof vi.fn>;
const mockUpload = uploadToR2 as unknown as ReturnType<typeof vi.fn>;
const mockFindUnique = prisma.receivable.findUnique as unknown as ReturnType<typeof vi.fn>;

const RECEIVABLE_ID = "rec_1";
const USER_ID = "u1";

function formRequest(overrides: { receivableId?: string } = {}): Request {
  const fd = new FormData();
  fd.set("file", new File([new Uint8Array([1, 2, 3])], "proof.jpg", { type: "image/jpeg" }));
  fd.set("receivableId", overrides.receivableId ?? RECEIVABLE_ID);
  fd.set("clientId", "client1");
  return new Request("http://localhost/pwa/api/upload/collection-proof", { method: "POST", body: fd });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: USER_ID, permissions: ["collections:collect"] } });
  mockIsConfigured.mockReturnValue(true);
  mockUpload.mockImplementation(async (key: string) => `https://cdn.example/${key}`);
  mockFindUnique.mockResolvedValue({ collectorId: USER_ID });
});

describe("POST /pwa/api/upload/collection-proof", () => {
  it("uploads under the receivable's prefix for its assigned collector", async () => {
    const res = await POST(formRequest() as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.key).toBe(`collection-proofs/${RECEIVABLE_ID}/client1.jpg`);
    expect(mockUpload).toHaveBeenCalledTimes(1);
  });

  it("returns 404 and writes nothing when the receivable does not exist", async () => {
    mockFindUnique.mockResolvedValue(null);

    const res = await POST(formRequest() as never);

    expect(res.status).toBe(404);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("returns the same 404 body when the receivable belongs to another collector", async () => {
    const missing = await (async () => {
      mockFindUnique.mockResolvedValueOnce(null);
      return (await POST(formRequest() as never)).json();
    })();
    mockFindUnique.mockResolvedValue({ collectorId: "someone-else" });

    const res = await POST(formRequest() as never);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(missing);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("returns 404 for an unassigned receivable", async () => {
    mockFindUnique.mockResolvedValue({ collectorId: null });

    const res = await POST(formRequest() as never);

    expect(res.status).toBe(404);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("returns 403 without the collect permission before touching the database", async () => {
    mockAuth.mockResolvedValue({ user: { id: USER_ID, permissions: [] } });

    const res = await POST(formRequest() as never);

    expect(res.status).toBe(403);
    expect(mockFindUnique).not.toHaveBeenCalled();
  });
});
