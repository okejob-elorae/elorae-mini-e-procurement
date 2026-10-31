import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Aksi ganti galeri barang untuk `ItemGalleryEditor`.
 *
 * Penjaga `items:manage` tetap di pustaka (`lib/items/images/mutations.ts`),
 * yang tidak lagi ber-"use server"; aksi ini satu-satunya pintu klien. Yang
 * dibuktikan: aksi meneruskan argumen apa adanya ke pustaka yang berpenjaga,
 * dan isian yang bukan daftar ditolak sebelum sampai ke sana.
 */

const pustaka = vi.hoisted(() => ({
  replaceItemImagesAction: vi.fn(async () => ({ ok: true, counts: { inserted: 1, updated: 0, deleted: 0 } })),
}));
vi.mock("@/lib/items/images/mutations", () => pustaka);

const { replaceItemImagesAction } = await import("./item-images");

describe("replaceItemImagesAction (aksi)", () => {
  beforeEach(() => pustaka.replaceItemImagesAction.mockClear());

  it("meneruskan ke pustaka berpenjaga dengan argumen yang sama", async () => {
    const isian = [{ url: "https://pub.r2.example.com/items/b1/a.jpg", variantSku: null, sortOrder: 0 }];
    const hasil = await replaceItemImagesAction("b1", isian);
    expect(hasil).toEqual({ ok: true, counts: { inserted: 1, updated: 0, deleted: 0 } });
    expect(pustaka.replaceItemImagesAction).toHaveBeenCalledWith("b1", isian);
  });

  it("isian bukan daftar ditolak tanpa memanggil pustaka", async () => {
    const hasil = await replaceItemImagesAction("b1", "bukan-daftar" as never);
    expect(hasil).toMatchObject({ ok: false, code: "invalid_request" });
    expect(pustaka.replaceItemImagesAction).not.toHaveBeenCalled();
  });

  it("butir daftar yang bukan objek berurl ditolak tanpa memanggil pustaka (tidak jadi galat 500)", async () => {
    for (const butir of [null, "teks", { sortOrder: 0 }]) {
      const hasil = await replaceItemImagesAction("b1", [butir] as never);
      expect(hasil).toMatchObject({ ok: false, code: "invalid_request" });
    }
    expect(pustaka.replaceItemImagesAction).not.toHaveBeenCalled();
  });

  it("id barang bukan teks ditolak tanpa memanggil pustaka", async () => {
    const hasil = await replaceItemImagesAction({} as never, []);
    expect(hasil).toMatchObject({ ok: false, code: "invalid_request" });
    expect(pustaka.replaceItemImagesAction).not.toHaveBeenCalled();
  });
});
