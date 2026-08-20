import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/r2", () => ({
  isConfigured: vi.fn(),
  uploadToR2: vi.fn(),
}));
vi.mock("@/lib/field-sales/retur/writer", () => ({
  createFieldReturn: vi.fn(),
}));

import { auth } from "@/lib/auth";
import { isConfigured, uploadToR2 } from "@/lib/r2";
import { createFieldReturn } from "@/lib/field-sales/retur/writer";
import { FieldReturnError, type FieldReturnErrorCode } from "@/lib/field-sales/retur/errors";
import { POST } from "./route";

const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;
const mockIsConfigured = isConfigured as unknown as ReturnType<typeof vi.fn>;
const mockUpload = uploadToR2 as unknown as ReturnType<typeof vi.fn>;
const mockCreate = createFieldReturn as unknown as ReturnType<typeof vi.fn>;

function formRequest(
  opts: { omitFile?: boolean; fileType?: string; lines?: unknown } = {}
): Request {
  const fd = new FormData();
  fd.set("storeId", "store-1");
  fd.set("visitId", "visit-1");
  fd.set("transport", "SELF_CARRY");
  fd.set(
    "lines",
    JSON.stringify(
      opts.lines ?? [{ itemId: "item-1", variantSku: "SKU-1", qty: 1, reason: "DAMAGED" }]
    )
  );
  if (!opts.omitFile) {
    const type = opts.fileType ?? "image/jpeg";
    fd.set("file", new File([new Uint8Array([1, 2, 3])], "nota.jpg", { type }));
  }
  return new Request("http://localhost/pwa/api/retur", { method: "POST", body: fd });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["pwa:access"] } });
  mockIsConfigured.mockReturnValue(true);
  mockUpload.mockResolvedValue("https://cdn.example/field-returns/a/b.jpg");
  mockCreate.mockResolvedValue({ returnId: "r1", docNo: "FRET/2026/08/0001" });
});

describe("POST /pwa/api/retur", () => {
  it("returns 401 without a session", async () => {
    mockAuth.mockResolvedValue(null);

    const res = await POST(formRequest() as never);

    expect(res.status).toBe(401);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns 403 without pwa access", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["*"] } });

    const res = await POST(formRequest() as never);

    expect(res.status).toBe(403);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns 503 when R2 is unconfigured", async () => {
    mockIsConfigured.mockReturnValue(false);

    const res = await POST(formRequest() as never);

    expect(res.status).toBe(503);
    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns 400 for a disallowed MIME type and never uploads", async () => {
    const res = await POST(formRequest({ fileType: "application/pdf" }) as never);

    expect(res.status).toBe(400);
    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns 400 when the photo is missing", async () => {
    const res = await POST(formRequest({ omitFile: true }) as never);

    expect(res.status).toBe(400);
    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it.each([
    ["a missing itemId", [{ variantSku: "", qty: 1, reason: "DAMAGED" }]],
    ["a blank itemId", [{ itemId: "   ", variantSku: "", qty: 1, reason: "DAMAGED" }]],
    ["a non-string variantSku", [{ itemId: "item-1", variantSku: 7, qty: 1, reason: "DAMAGED" }]],
    ["a fractional qty", [{ itemId: "item-1", variantSku: "", qty: 1.5, reason: "DAMAGED" }]],
    ["a zero qty", [{ itemId: "item-1", variantSku: "", qty: 0, reason: "DAMAGED" }]],
    ["an unknown reason", [{ itemId: "item-1", variantSku: "", qty: 1, reason: "BROKEN" }]],
    ["a non-object line", ["nope"]],
  ])(
    "rejects %s with 400 BEFORE uploading, so no orphan R2 object is left",
    async (_label, lines) => {
      const res = await POST(formRequest({ lines }) as never);

      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: "BAD_LINE_SHAPE" });
      expect(mockUpload).not.toHaveBeenCalled();
      expect(mockCreate).not.toHaveBeenCalled();
    }
  );

  it("forwards the parsed lines to the writer instead of an untyped cast", async () => {
    await POST(formRequest() as never);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        lines: [{ itemId: "item-1", variantSku: "SKU-1", qty: 1, reason: "DAMAGED" }],
      })
    );
  });

  it("returns 502 and creates nothing when the upload fails", async () => {
    mockUpload.mockRejectedValue(new Error("r2 down"));

    const res = await POST(formRequest() as never);

    expect(res.status).toBe(502);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("maps MISSING_RESI onto 400", async () => {
    mockCreate.mockRejectedValue(new FieldReturnError("MISSING_RESI"));

    const res = await POST(formRequest() as never);

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "MISSING_RESI" });
    expect(mockUpload).toHaveBeenCalledTimes(1);
  });

  it("maps STORE_NOT_FOUND onto 404", async () => {
    mockCreate.mockRejectedValue(new FieldReturnError("STORE_NOT_FOUND"));

    const res = await POST(formRequest() as never);

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "STORE_NOT_FOUND" });
  });

  it.each<FieldReturnErrorCode>([
    "NO_LINES",
    "BAD_QTY",
    "BAD_LINE_SHAPE",
    "ITEM_NOT_FOUND",
    "VISIT_NOT_OWNED",
    "MISSING_RESI",
    "MISSING_EXPEDITION_NAME",
    "MISSING_REASON_NOTE",
  ])(
    "maps %s onto 400",
    async (code) => {
      mockCreate.mockRejectedValue(new FieldReturnError(code));

      const res = await POST(formRequest() as never);

      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code });
    }
  );

  it("returns 500 and logs when the writer throws an unmapped error", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockCreate.mockRejectedValue(new Error("db exploded"));

    const res = await POST(formRequest() as never);

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).not.toHaveProperty("message", "db exploded");
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("uploads then creates, and returns the docNo", async () => {
    mockUpload.mockResolvedValue("https://cdn.example/field-returns/a/b.jpg");
    mockCreate.mockResolvedValue({ returnId: "r1", docNo: "FRET/2026/08/0001" });

    const res = await POST(formRequest() as never);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ docNo: "FRET/2026/08/0001" });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        notaPhotoUrl: "https://cdn.example/field-returns/a/b.jpg",
        raisedById: "u1",
      })
    );
  });
});
