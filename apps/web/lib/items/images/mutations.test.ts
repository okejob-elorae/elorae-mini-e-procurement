import { describe, it, expect, beforeEach, vi } from "vitest";
import { auth } from "@/lib/auth";
import { prisma } from "@elorae/db";
import { replaceItemImagesAction } from "./mutations";

// Provide an R2 host so validateNewUploadUrl can resolve
process.env.R2_PUBLIC_URL = "https://pub.r2.example.com";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@elorae/db", () => ({
  prisma: {
    item: { findUnique: vi.fn() },
    itemImage: {
      findMany: vi.fn(),
      createMany: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn().mockImplementation(async (fn) => fn(prisma)),
  },
}));
vi.mock("@/lib/r2", () => ({
  deleteFromR2: vi.fn().mockResolvedValue(undefined),
  keyFromUrl: vi.fn().mockReturnValue("items/i1/x.jpg"),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const session = (perms: string[]) => ({ user: { id: "u1", permissions: perms } });

beforeEach(() => {
  vi.resetAllMocks();
});

describe("replaceItemImagesAction", () => {
  it("rejects without items:manage", async () => {
    (auth as any).mockResolvedValue(session([]));
    const r = await replaceItemImagesAction("i1", []);
    expect(r).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("rejects unknown itemId", async () => {
    (auth as any).mockResolvedValue(session(["items:manage"]));
    (prisma.item.findUnique as any).mockResolvedValue(null);
    const r = await replaceItemImagesAction("missing", []);
    expect(r).toMatchObject({ ok: false, code: "item_not_found" });
  });

  it("rejects when gallery count exceeds 20 in any group", async () => {
    (auth as any).mockResolvedValue(session(["items:manage"]));
    (prisma.item.findUnique as any).mockResolvedValue({ id: "i1", variants: null });
    const submission = Array.from({ length: 21 }, (_, i) => ({
      url: "https://pub.r2.example.com/" + i + ".jpg",
      variantSku: null,
      sortOrder: i,
    }));
    const r = await replaceItemImagesAction("i1", submission as any);
    expect(r).toMatchObject({ ok: false, code: "image_count_exceeded" });
  });

  it("rejects untrusted URL host", async () => {
    (auth as any).mockResolvedValue(session(["items:manage"]));
    (prisma.item.findUnique as any).mockResolvedValue({ id: "i1", variants: null });
    const r = await replaceItemImagesAction("i1", [
      { url: "https://evil.example/x.jpg", variantSku: null, sortOrder: 0 },
    ]);
    expect(r).toMatchObject({ ok: false, code: "image_url_untrusted" });
  });

  it("rejects unknown variant SKU", async () => {
    (auth as any).mockResolvedValue(session(["items:manage"]));
    (prisma.item.findUnique as any).mockResolvedValue({ id: "i1", variants: [{ sku: "RED" }] });
    const r = await replaceItemImagesAction("i1", [
      { url: "https://pub.r2.example.com/x.jpg", variantSku: "BLUE", sortOrder: 0 },
    ]);
    expect(r).toMatchObject({ ok: false, code: "image_variant_unknown" });
  });

  it("rejects deleting JUBELIO_INGEST row", async () => {
    (auth as any).mockResolvedValue(session(["items:manage"]));
    (prisma.item.findUnique as any).mockResolvedValue({ id: "i1", variants: null });
    (prisma.itemImage.findMany as any).mockResolvedValue([
      {
        id: "a",
        itemId: "i1",
        variantSku: null,
        url: "https://static.jubelio.com/x.jpg",
        sortOrder: 0,
        jubelioImageId: "j-1",
        syncedAt: new Date(),
        source: "JUBELIO_INGEST",
      },
    ]);
    const r = await replaceItemImagesAction("i1", []);
    expect(r).toMatchObject({ ok: false, code: "image_jubelio_owned" });
  });

  it("inserts + updates + deletes on a clean diff", async () => {
    (auth as any).mockResolvedValue(session(["items:manage"]));
    (prisma.item.findUnique as any).mockResolvedValue({ id: "i1", variants: null });
    (prisma.itemImage.findMany as any).mockResolvedValue([
      {
        id: "a",
        itemId: "i1",
        variantSku: null,
        url: "https://static.jubelio.com/a.jpg",
        sortOrder: 0,
        jubelioImageId: null,
        syncedAt: null,
        source: "ERP_UPLOAD",
      },
      {
        id: "b",
        itemId: "i1",
        variantSku: null,
        url: "https://static.jubelio.com/b.jpg",
        sortOrder: 1,
        jubelioImageId: null,
        syncedAt: null,
        source: "ERP_UPLOAD",
      },
    ]);
    (prisma.itemImage.createMany as any).mockResolvedValue({ count: 1 });
    (prisma.itemImage.update as any).mockResolvedValue({});
    (prisma.itemImage.deleteMany as any).mockResolvedValue({ count: 1 });

    const r = await replaceItemImagesAction("i1", [
      { id: "a", url: "https://static.jubelio.com/a.jpg", variantSku: null, sortOrder: 2 },
      { url: "https://pub.r2.example.com/new.jpg", variantSku: null, sortOrder: 0 },
    ]);
    expect(r).toEqual({ ok: true, counts: { inserted: 1, updated: 1, deleted: 1 } });
  });
});
