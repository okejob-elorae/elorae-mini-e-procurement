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
const USER_ID = "u1";

function formRequest(overrides: { shipmentId?: string; clientId?: string } = {}): Request {
  const fd = new FormData();
  fd.set("file", new File([new Uint8Array([1, 2, 3])], "proof.jpg", { type: "image/jpeg" }));
  fd.set("shipmentId", overrides.shipmentId ?? SHIPMENT_ID);
  fd.set("clientId", overrides.clientId ?? "goods");
  return new Request("http://localhost/pwa/api/upload/delivery-pod-proof", { method: "POST", body: fd });
}

function shipmentRow(overrides: Record<string, unknown> = {}) {
  return {
    method: "SALESMAN_CARRY",
    status: "IN_TRANSIT",
    carriedById: USER_ID,
    deliveredById: null,
    proofPhotoUrl: null,
    proofPhotoR2Key: null,
    signatureUrl: null,
    signatureR2Key: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: USER_ID, permissions: ["deliveries:pod"] } });
  mockIsConfigured.mockReturnValue(true);
  mockUpload.mockImplementation(async (key: string) => `https://cdn.example/${key}`);
  mockFindUnique.mockResolvedValue(shipmentRow());
});

describe("POST /pwa/api/upload/delivery-pod-proof", () => {
  it.each(["thumb", "GOODS", "goods/../x", "", "nota2"])(
    "refuses clientId %j with 400 before any database or R2 call",
    async (clientId) => {
      const res = await POST(formRequest({ clientId }) as never);

      expect(res.status).toBe(400);
      expect(mockFindUnique).not.toHaveBeenCalled();
      expect(mockUpload).not.toHaveBeenCalled();
    },
  );

  it("returns 404 for an unknown shipment", async () => {
    mockFindUnique.mockResolvedValue(null);

    const res = await POST(formRequest() as never);

    expect(res.status).toBe(404);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("returns 404 for an EXPEDITION shipment", async () => {
    mockFindUnique.mockResolvedValue(shipmentRow({ method: "EXPEDITION" }));

    const res = await POST(formRequest() as never);

    expect(res.status).toBe(404);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("returns 404 for a shipment carried by someone else, with the same body as an unknown one", async () => {
    mockFindUnique.mockResolvedValue(shipmentRow({ carriedById: "someone-else" }));
    const foreign = await POST(formRequest() as never);
    const foreignBody = await foreign.json();

    mockFindUnique.mockResolvedValue(null);
    const missing = await POST(formRequest() as never);
    const missingBody = await missing.json();

    expect(foreign.status).toBe(404);
    expect(foreignBody).toEqual(missingBody);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("looks the shipment up by id with the fields the decision needs", async () => {
    await POST(formRequest() as never);

    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { id: SHIPMENT_ID },
      select: {
        method: true,
        status: true,
        carriedById: true,
        deliveredById: true,
        proofPhotoUrl: true,
        proofPhotoR2Key: true,
        signatureUrl: true,
        signatureR2Key: true,
      },
    });
  });

  it("uploads for the carrier of an IN_TRANSIT shipment under the deterministic key", async () => {
    const res = await POST(formRequest() as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(mockUpload.mock.calls[0][0]).toBe(`delivery-pod-proofs/${SHIPMENT_ID}/goods.jpg`);
    expect(body).toEqual({
      url: `https://cdn.example/delivery-pod-proofs/${SHIPMENT_ID}/goods.jpg`,
      key: `delivery-pod-proofs/${SHIPMENT_ID}/goods.jpg`,
    });
  });

  it("uploads the nota kind under its own key", async () => {
    const res = await POST(formRequest({ clientId: "nota" }) as never);

    expect(res.status).toBe(200);
    expect(mockUpload.mock.calls[0][0]).toBe(`delivery-pod-proofs/${SHIPMENT_ID}/nota.jpg`);
  });

  describe("same-actor replay against a delivered shipment", () => {
    const stored = {
      proofPhotoUrl: "https://cdn.example/stored/goods.jpg",
      proofPhotoR2Key: `delivery-pod-proofs/${SHIPMENT_ID}/goods.jpg`,
      signatureUrl: "https://cdn.example/stored/nota.png",
      signatureR2Key: `delivery-pod-proofs/${SHIPMENT_ID}/nota.png`,
    };

    it.each(["DELIVERED", "PARTIALLY_DELIVERED"])(
      "returns the stored goods object for %s and writes nothing",
      async (status) => {
        mockFindUnique.mockResolvedValue(shipmentRow({ status, deliveredById: USER_ID, ...stored }));

        const res = await POST(formRequest({ clientId: "goods" }) as never);

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ url: stored.proofPhotoUrl, key: stored.proofPhotoR2Key });
        expect(mockUpload).not.toHaveBeenCalled();
      },
    );

    it("returns the stored nota object and writes nothing", async () => {
      mockFindUnique.mockResolvedValue(shipmentRow({ status: "DELIVERED", deliveredById: USER_ID, ...stored }));

      const res = await POST(formRequest({ clientId: "nota" }) as never);

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ url: stored.signatureUrl, key: stored.signatureR2Key });
      expect(mockUpload).not.toHaveBeenCalled();
    });

    it("returns 409 when the stored pair for that kind is null", async () => {
      mockFindUnique.mockResolvedValue(
        shipmentRow({ status: "DELIVERED", deliveredById: USER_ID, ...stored, signatureUrl: null, signatureR2Key: null }),
      );

      const res = await POST(formRequest({ clientId: "nota" }) as never);

      expect(res.status).toBe(409);
      expect(mockUpload).not.toHaveBeenCalled();
    });
  });

  it("returns 409 and writes nothing for a shipment delivered by a different actor", async () => {
    mockFindUnique.mockResolvedValue(
      shipmentRow({
        status: "DELIVERED",
        deliveredById: "someone-else",
        proofPhotoUrl: "https://cdn.example/stored/goods.jpg",
        proofPhotoR2Key: `delivery-pod-proofs/${SHIPMENT_ID}/goods.jpg`,
      }),
    );

    const res = await POST(formRequest() as never);

    expect(res.status).toBe(409);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it.each(["PACKED", "CANCELLED"])("returns 409 and writes nothing for a %s shipment", async (status) => {
    mockFindUnique.mockResolvedValue(shipmentRow({ status }));

    const res = await POST(formRequest() as never);

    expect(res.status).toBe(409);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("returns 401 without a session, before touching the database", async () => {
    mockAuth.mockResolvedValue(null);

    const res = await POST(formRequest() as never);

    expect(res.status).toBe(401);
    expect(mockFindUnique).not.toHaveBeenCalled();
  });
});
