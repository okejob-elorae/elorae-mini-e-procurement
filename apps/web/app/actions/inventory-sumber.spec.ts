import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma, seededId } from "@elorae/db";

/*
 * Daftar penyesuaian: saringan sumber dan pencarian dijalankan di SERVER
 * (basis data uji sungguhan, sesi ditiru).
 *
 * Yang dibuktikan:
 *  - bawaan menyembunyikan sumber otomatis (webhook Jubelio, penjualan
 *    marketplace, van, …) tapi tetap menampilkan manual, opname, dan sumber
 *    baru yang belum dikenal;
 *  - "semua", "otomatis", dan satu kode sumber menyaring dengan benar;
 *  - totalCount dan halaman mengikuti saringan (bukan menyaring satu halaman di klien);
 *  - setiap baris membawa `source` untuk labelnya.
 */

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: "penguji-sumber", email: null, permissions: ["inventory:view"] } })),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/app/actions/security/pin-auth", () => ({ verifyPinForAction: vi.fn() }));
vi.mock("@/app/actions/notifications", () => ({
  getActorName: vi.fn(async () => "Penguji"),
  notifyStockAdjustmentCreated: vi.fn(async () => {}),
}));

const { getStockAdjustments } = await import("./inventory");

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

const tag = `ASRC-${Math.random().toString(36).slice(2, 9)}`;

d("daftar penyesuaian: saringan sumber di server (test bed only)", () => {
  let uomId = "";
  let itemId = "";
  const idPerSumber = new Map<string, string>();

  beforeAll(async () => {
    uomId = "";
    itemId = "";
    idPerSumber.clear();
    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    itemId = (
      await prisma.item.create({
        data: { sku: tag, nameId: `Barang ${tag}`, nameEn: "Test", type: "FINISHED_GOOD", uomId, isActive: true },
      })
    ).id;
    const sumber = ["ERP", "ERP_OPNAME", "JUBELIO_WEBHOOK", "FULFILLMENT_CONSUME", "VAN_LOAD", "SUMBER_BARU_UJI"];
    for (const [i, s] of sumber.entries()) {
      const r = await prisma.stockAdjustment.create({
        data: {
          docNumber: `${tag}-${i}`,
          itemId,
          type: s === "ERP" ? "POSITIVE" : "NEGATIVE",
          qtyChange: s === "ERP" ? 2 : -1,
          reason: s === "VAN_LOAD" ? `Van load ${tag}-kanvas-pagi` : `uji ${tag} ${s}`,
          prevQty: 0,
          newQty: 0,
          prevAvgCost: 1000,
          newAvgCost: 1000,
          source: s,
          createdAt: new Date(Date.UTC(2026, 8, 1, i)),
        },
      });
      idPerSumber.set(s, r.id);
    }
  });

  afterAll(async () => {
    if (itemId) {
      await prisma.stockAdjustment.deleteMany({ where: { itemId: seededId(itemId) } });
      await prisma.item.delete({ where: { id: seededId(itemId) } });
    }
    if (uomId) await prisma.uOM.delete({ where: { id: seededId(uomId) } });
  });

  async function halaman(opts: { sumber?: string; cari?: string; pageSize?: number } = {}) {
    const h = await getStockAdjustments(itemId, { page: 1, pageSize: opts.pageSize ?? 50, sumber: opts.sumber, cari: opts.cari });
    if (Array.isArray(h)) throw new Error("bentuk halaman salah");
    return h;
  }
  const sumberDari = (h: Awaited<ReturnType<typeof halaman>>) => h.items.map((r) => r.source).sort();

  it("bawaan: sumber otomatis disembunyikan, manual/opname/sumber baru tetap tampil", async () => {
    const h = await halaman();
    expect(sumberDari(h)).toEqual(["ERP", "ERP_OPNAME", "SUMBER_BARU_UJI"]);
    expect(h.totalCount).toBe(3);
  });

  it("'semua', 'otomatis', dan satu kode sumber", async () => {
    expect((await halaman({ sumber: "semua" })).totalCount).toBe(6);
    expect(sumberDari(await halaman({ sumber: "otomatis" }))).toEqual(["FULFILLMENT_CONSUME", "JUBELIO_WEBHOOK", "VAN_LOAD"]);
    const satu = await halaman({ sumber: "FULFILLMENT_CONSUME" });
    expect(satu.items.map((r) => r.id)).toEqual([idPerSumber.get("FULFILLMENT_CONSUME")]);
  });

  it("halaman dan totalCount mengikuti saringan (bukan saring satu halaman di klien)", async () => {
    const h = await halaman({ pageSize: 2 });
    expect(h.items).toHaveLength(2);
    expect(h.totalCount).toBe(3);
    // Terbaru dulu: sumber baru (jam 5) lalu opname (jam 1).
    expect(h.items.map((r) => r.source)).toEqual(["SUMBER_BARU_UJI", "ERP_OPNAME"]);
  });

  it("pencarian teks juga di server, abai huruf, menembus saringan 'semua'", async () => {
    const h = await halaman({ sumber: "semua", cari: `${tag}-KANVAS-PAGI`.toLowerCase() });
    expect(h.items.map((r) => r.id)).toEqual([idPerSumber.get("VAN_LOAD")]);
    expect(h.totalCount).toBe(1);
    // Saringan bawaan tetap berlaku bersama pencarian.
    expect((await halaman({ cari: `${tag}-kanvas-pagi` })).totalCount).toBe(0);
  });
});
