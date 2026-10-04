import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Penjaga izin aksi baca kartu stok dan rol kain (sesi ditiru, basis data uji
 * hanya DIBACA). Setiap ekspor `"use server"` adalah titik akhir yang bisa
 * dipanggil siapa pun yang masuk — dulu aksi-aksi ini tidak memeriksa izin sama
 * sekali, jadi akun sales/SPG bisa membaca nilai stok dan HPP seluruh gudang.
 * Yang dibuktikan: tanpa `inventory:view` ditolak, tanpa sesi ditolak, dan
 * pengguna sah (termasuk admin wildcard) tetap boleh.
 */

const sesi = vi.hoisted(() => ({ ada: true, permissions: ["inventory:view"] as string[] }));
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () =>
    sesi.ada ? { user: { id: "penguji-izin-baca", email: null, permissions: sesi.permissions } } : null,
  ),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const kartu = await import("./stock-card");
const grn = await import("./grn");

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

const rentang = { from: new Date("2026-01-01T00:00:00Z"), to: new Date("2026-01-02T00:00:00Z") };
const TIDAK_ADA = "izin-baca-tidak-ada";

/** Semua aksi baca yang dijaga, dengan argumen yang murah untuk dijalankan. */
const aksiBaca: Array<[string, () => Promise<unknown>]> = [
  ["getStockCard", () => kartu.getStockCard(TIDAK_ADA, rentang)],
  ["getItemVariantOptions", () => kartu.getItemVariantOptions(TIDAK_ADA)],
  ["getCurrentStockSummary", () => kartu.getCurrentStockSummary()],
  ["getStockCardByType", () => kartu.getStockCardByType("raw", rentang)],
  ["getStockCardByCategory", () => kartu.getStockCardByCategory(TIDAK_ADA, rentang)],
  ["getFabricRolls", () => grn.getFabricRolls({ page: 1, pageSize: 1, grnId: TIDAK_ADA })],
  ["getFabricRollFilterOptions", () => grn.getFabricRollFilterOptions()],
  ["getRollsByGrnId", () => grn.getRollsByGrnId(TIDAK_ADA)],
];

d("izin baca kartu stok & rol kain (test bed only)", () => {
  beforeEach(() => {
    sesi.ada = true;
    sesi.permissions = ["inventory:view"];
  });

  it.each(aksiBaca)("%s menolak pengguna tanpa inventory:view", async (_nama, panggil) => {
    sesi.permissions = ["pwa:access", "spg_sales:record"];
    await expect(panggil()).rejects.toThrow(/Forbidden/);
  });

  it.each(aksiBaca)("%s menolak tanpa sesi", async (_nama, panggil) => {
    sesi.ada = false;
    await expect(panggil()).rejects.toThrow(/Unauthorized/);
  });

  it.each(aksiBaca)("%s tetap boleh untuk inventory:view", async (_nama, panggil) => {
    sesi.permissions = ["inventory:view"];
    await expect(panggil()).resolves.toBeDefined();
  });

  it("admin wildcard * tetap boleh", async () => {
    sesi.permissions = ["*"];
    await expect(kartu.getItemVariantOptions(TIDAK_ADA)).resolves.toEqual([]);
    await expect(grn.getRollsByGrnId(TIDAK_ADA)).resolves.toEqual([]);
  });
});
