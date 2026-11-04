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
import { isR2KeyInFolder } from "@/lib/r2-key";
import { POST } from "./route";

const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;
const mockIsConfigured = isConfigured as unknown as ReturnType<typeof vi.fn>;
const mockUpload = uploadToR2 as unknown as ReturnType<typeof vi.fn>;
const mockFindUnique = prisma.deliveryShipment.findUnique as unknown as ReturnType<typeof vi.fn>;

const SHIPMENT_ID = "ship_1";
const URL_ROUTE = "http://localhost/backoffice/api/upload/delivery-handover";

function formRequest(overrides: { shipmentId?: string; type?: string; name?: string } = {}): Request {
  const fd = new FormData();
  fd.set(
    "file",
    new File([new Uint8Array([1, 2, 3])], overrides.name ?? "serah.jpg", { type: overrides.type ?? "image/jpeg" }),
  );
  fd.set("shipmentId", overrides.shipmentId ?? SHIPMENT_ID);
  return new Request(URL_ROUTE, { method: "POST", body: fd });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["deliveries:ship"] } });
  mockIsConfigured.mockReturnValue(true);
  mockUpload.mockImplementation(async (key: string) => `https://cdn.example/${key}`);
  mockFindUnique.mockResolvedValue({ status: "PACKED" });
});

describe("POST /backoffice/api/upload/delivery-handover", () => {
  it("returns 401 without a session, before touching the database", async () => {
    mockAuth.mockResolvedValue(null);

    const res = await POST(formRequest() as never);

    expect(res.status).toBe(401);
    expect(mockFindUnique).not.toHaveBeenCalled();
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("returns 403 without deliveries:ship — the permission the tracking save enforces", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["deliveries:pod"] } });

    const res = await POST(formRequest() as never);

    expect(res.status).toBe(403);
    expect(mockFindUnique).not.toHaveBeenCalled();
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("returns 503 when R2 is not configured", async () => {
    mockIsConfigured.mockReturnValue(false);

    const res = await POST(formRequest() as never);

    expect(res.status).toBe(503);
    expect(mockFindUnique).not.toHaveBeenCalled();
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("returns 413 when the declared body is over 10 MB, before parsing the multipart", async () => {
    const formDataSpy = vi.spyOn(Request.prototype, "formData");
    try {
      const req = new Request(URL_ROUTE, {
        method: "POST",
        headers: { "content-length": String(10 * 1024 * 1024 + 64 * 1024 + 1) },
        body: "x",
      });

      const res = await POST(req as never);

      expect(res.status).toBe(413);
      expect(formDataSpy).not.toHaveBeenCalled();
      expect(mockFindUnique).not.toHaveBeenCalled();
      expect(mockUpload).not.toHaveBeenCalled();
    } finally {
      formDataSpy.mockRestore();
    }
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

  it("refuses a non-image type with 400", async () => {
    const res = await POST(formRequest({ type: "image/gif", name: "serah.gif" }) as never);

    expect(res.status).toBe(400);
    expect(mockFindUnique).not.toHaveBeenCalled();
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("returns 404 NOT_FOUND for an unknown shipment and uploads nothing", async () => {
    mockFindUnique.mockResolvedValue(null);

    const res = await POST(formRequest() as never);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "NOT_FOUND" });
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it.each(["IN_TRANSIT", "DELIVERED", "CANCELLED"])(
    "returns 409 INVALID_STATE for a %s shipment and uploads nothing",
    async (status) => {
      mockFindUnique.mockResolvedValue({ status });

      const res = await POST(formRequest() as never);

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "INVALID_STATE" });
      expect(mockUpload).not.toHaveBeenCalled();
    },
  );

  it("uploads for a PACKED shipment under a key the tracking writer accepts", async () => {
    const res = await POST(formRequest() as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockFindUnique).toHaveBeenCalledWith({ where: { id: SHIPMENT_ID }, select: { status: true } });
    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(body.key).toMatch(new RegExp(`^delivery-handover/${SHIPMENT_ID}/\\d+\\.jpg$`));
    expect(isR2KeyInFolder(body.key, `delivery-handover/${SHIPMENT_ID}`)).toBe(true);
    expect(body.key).toBe(mockUpload.mock.calls[0][0]);
    expect(body.url).toBe(`https://cdn.example/${body.key}`);
  });

  it("keeps the png extension for a png photo", async () => {
    const res = await POST(formRequest({ type: "image/png", name: "serah.png" }) as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.key).toMatch(new RegExp(`^delivery-handover/${SHIPMENT_ID}/\\d+\\.png$`));
  });
});
