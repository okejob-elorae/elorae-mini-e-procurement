import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@elorae/db", () => ({
  prisma: {
    deliveryShipment: {
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
const mockFindUnique = prisma.deliveryShipment.findUnique as unknown as ReturnType<typeof vi.fn>;

const SHIPMENT_ID = "ship_1";

function formRequest(overrides: { shipmentId?: string } = {}): Request {
  const fd = new FormData();
  fd.set("file", new File([new Uint8Array([1, 2, 3])], "proof.jpg", { type: "image/jpeg" }));
  fd.set("shipmentId", overrides.shipmentId ?? SHIPMENT_ID);
  return new Request("http://localhost/backoffice/api/upload/delivery-proof", { method: "POST", body: fd });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["deliveries:pod"] } });
  mockIsConfigured.mockReturnValue(true);
  mockUpload.mockImplementation(async (key: string) => `https://cdn.example/${key}`);
  mockFindUnique.mockResolvedValue({ id: SHIPMENT_ID });
});

describe("POST /backoffice/api/upload/delivery-proof", () => {
  it("returns 401 without a session, before touching the database", async () => {
    mockAuth.mockResolvedValue(null);

    const res = await POST(formRequest() as never);

    expect(res.status).toBe(401);
    expect(mockFindUnique).not.toHaveBeenCalled();
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("returns 403 without the deliveries:pod permission", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["deliveries:ship"] } });

    const res = await POST(formRequest() as never);

    expect(res.status).toBe(403);
    expect(mockFindUnique).not.toHaveBeenCalled();
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it.each(["../x", "a/b", "a b", "x".repeat(65)])(
    "refuses shipmentId %j with 400 before any database or R2 call",
    async (shipmentId) => {
      const res = await POST(formRequest({ shipmentId }) as never);

      expect(res.status).toBe(400);
      expect(mockFindUnique).not.toHaveBeenCalled();
      expect(mockUpload).not.toHaveBeenCalled();
    },
  );

  it("returns 404 NOT_FOUND for an unknown shipment and writes nothing", async () => {
    mockFindUnique.mockResolvedValue(null);

    const res = await POST(formRequest() as never);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "NOT_FOUND" });
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("uploads for a known shipment under a delivery-proofs key", async () => {
    const res = await POST(formRequest() as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockFindUnique).toHaveBeenCalledWith({ where: { id: SHIPMENT_ID }, select: { id: true } });
    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(mockUpload.mock.calls[0][0]).toMatch(new RegExp(`^delivery-proofs/${SHIPMENT_ID}/\\d+\\.(jpg|png|webp)$`));
    expect(body.key).toBe(mockUpload.mock.calls[0][0]);
  });
});
