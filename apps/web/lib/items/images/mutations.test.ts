import { describe, it, expect, beforeEach, vi } from "vitest";
import { auth } from "@/lib/auth";
import { prisma } from "@elorae/db";
import { deleteFromR2, keyFromUrl } from "@/lib/r2";
import { enqueueProductPushOnImageChange } from "@/app/actions/jubelio-product-push";
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
vi.mock("@/app/actions/jubelio-product-push", () => ({
  enqueueProductPushOnImageChange: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const session = (perms: string[]) => ({ user: { id: "u1", permissions: perms } });

beforeEach(() => {
  vi.resetAllMocks();
  /* resetAllMocks also wipes the factory's implementations, so re-seed the ones every test relies on. */
  (keyFromUrl as any).mockReturnValue("items/i1/x.jpg");
  (prisma.$transaction as any).mockImplementation(async (fn: any) => fn(prisma));
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

  describe("R2 key scoping", () => {
    const submitNew = async (key: string | null) => {
      (auth as any).mockResolvedValue(session(["items:manage"]));
      (prisma.item.findUnique as any).mockResolvedValue({ id: "i1", variants: null });
      (prisma.itemImage.findMany as any).mockResolvedValue([]);
      (prisma.itemImage.createMany as any).mockResolvedValue({ count: 1 });
      (keyFromUrl as any).mockReturnValue(key);
      return replaceItemImagesAction("i1", [
        { url: "https://pub.r2.example.com/whatever.jpg", variantSku: null, sortOrder: 0 },
      ]);
    };

    it.each([
      ["a key outside items/", "delivery-pod-proofs/s1/goods.jpg"],
      ["a foreign host", null],
      ["a traversal segment", "items/../delivery-pod-proofs/s1/goods.jpg"],
      ["an empty segment", "items//x.jpg"],
      ["another item's folder", "items/other/x.jpg"],
      ["percent-encoded traversal", "items/i1/%2e%2e/%2e%2e/delivery-pod-proofs/s1/goods.jpg"],
      ["backslash traversal", "items/i1\\..\\..\\delivery-pod-proofs\\s1\\goods.jpg"],
      ["a nested folder", "items/i1/sub/x.jpg"],
    ])("refuses a new submission resolving to %s", async (_label, key) => {
      const r = await submitNew(key);
      expect(r).toMatchObject({ ok: false, code: "image_url_untrusted" });
      expect(prisma.itemImage.createMany).not.toHaveBeenCalled();
      expect(enqueueProductPushOnImageChange).not.toHaveBeenCalled();
    });

    it.each([["items/i1/x.jpg"], ["items/_pending/x.jpg"]])(
      "accepts a new submission resolving to %s",
      async (key) => {
        const r = await submitNew(key);
        expect(r).toMatchObject({ ok: true, counts: { inserted: 1 } });
        expect(prisma.itemImage.createMany).toHaveBeenCalled();
      },
    );

    const cleanup = async (key: string | null) => {
      (auth as any).mockResolvedValue(session(["items:manage"]));
      (prisma.item.findUnique as any).mockResolvedValue({ id: "i1", variants: null });
      (prisma.itemImage.findMany as any).mockResolvedValue([
        {
          id: "a",
          itemId: "i1",
          variantSku: null,
          url: "https://pub.r2.example.com/old.jpg",
          sortOrder: 0,
          jubelioImageId: null,
          syncedAt: null,
          source: "ERP_UPLOAD",
        },
      ]);
      (prisma.itemImage.deleteMany as any).mockResolvedValue({ count: 1 });
      (keyFromUrl as any).mockReturnValue(key);
      (deleteFromR2 as any).mockResolvedValue(undefined);
      vi.spyOn(console, "warn").mockImplementation(() => {});
      return replaceItemImagesAction("i1", []);
    };

    it("deletes the row but skips R2 when the stored URL resolves outside items/", async () => {
      const r = await cleanup("delivery-pod-proofs/s1/goods.jpg");
      expect(r).toMatchObject({ ok: true, counts: { deleted: 1 } });
      expect(prisma.itemImage.deleteMany).toHaveBeenCalled();
      expect(deleteFromR2).not.toHaveBeenCalled();
    });

    it("skips R2 for a stored URL that only looks like it is under items/", async () => {
      await cleanup("items/i1/%2e%2e/%2e%2e/delivery-pod-proofs/s1/goods.jpg");
      expect(deleteFromR2).not.toHaveBeenCalled();
    });

    it("deletes from R2 when the stored URL resolves under items/", async () => {
      await cleanup("items/i1/old.jpg");
      expect(deleteFromR2).toHaveBeenCalledWith("items/i1/old.jpg");
    });
  });
});
