import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { hapusPenjualan, simpanPenjualan } from "./penjualan-writer";
import { penjualanKolaborasi } from "./penjualan-queries";

/** Penjualan afiliasi per kolaborasi, terhadap basis data sungguhan. */

const tag = `KPJ-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
let userId = "";
let kolId = "";
let briefId = "";

beforeEach(async () => {
  userId = "";
  kolId = "";
  briefId = "";
  userId = (await prisma.user.findFirstOrThrow({ select: { id: true } })).id;
  kolId = (await prisma.kol.create({ data: { name: `${tag} KOL` }, select: { id: true } })).id;
  briefId = (await prisma.kolBrief.create({ data: { docNo: `${tag}/1`, kolId, tahap: "TAYANG" }, select: { id: true } })).id;
});

afterEach(async () => {
  await prisma.auditLog.deleteMany({ where: { entityId: seededId(briefId) } });
  await prisma.kolSale.deleteMany({ where: { collabId: seededId(briefId) } });
  await prisma.kolBrief.deleteMany({ where: { id: seededId(briefId) } });
  await prisma.kol.deleteMany({ where: { id: seededId(kolId) } });
});

const tgl = (s: string) => new Date(`${s}T17:00:00.000Z`);

describe("simpanPenjualan", () => {
  it("mencatat baris baru dengan jejaknya, uang dibulatkan ke sen", async () => {
    const r = await simpanPenjualan({
      kolaborasiId: briefId,
      date: tgl("2026-10-01"),
      orders: 3,
      gmv: 450_000.555,
      commission: 45_000,
      source: "TikTok Shop",
      note: "minggu pertama",
      olehUserId: userId,
    });
    if (!r.ok) throw new Error(r.kode);
    const b = await prisma.kolSale.findUniqueOrThrow({ where: { id: r.id } });
    expect([b.orders, Number(b.gmv), Number(b.commission), b.source, b.note]).toEqual([3, 450_000.56, 45_000, "TikTok Shop", "minggu pertama"]);
    expect(b.createdById).toBe(userId);
    const jejak = await prisma.auditLog.findFirstOrThrow({ where: { entityId: briefId, action: "KOL_SALE_RECORDED" } });
    expect(jejak.metadata).toMatchObject({ penjualanId: r.id });
  });

  it("mengubah hanya kolom yang dikirim", async () => {
    const r = await simpanPenjualan({ kolaborasiId: briefId, date: tgl("2026-10-01"), orders: 2, gmv: 300_000, commission: 30_000, source: "Shopee", olehUserId: userId });
    if (!r.ok) throw new Error(r.kode);
    const u = await simpanPenjualan({ id: r.id, kolaborasiId: briefId, orders: 5, olehUserId: userId });
    expect(u.ok).toBe(true);
    const b = await prisma.kolSale.findUniqueOrThrow({ where: { id: r.id } });
    expect([b.orders, Number(b.gmv), Number(b.commission), b.source, b.date.toISOString()]).toEqual([5, 300_000, 30_000, "Shopee", tgl("2026-10-01").toISOString()]);
    expect(await prisma.auditLog.count({ where: { entityId: briefId, action: "KOL_SALE_UPDATED" } })).toBe(1);
  });

  it("menolak baris kosong, tanpa tanggal, dan sumber yang tidak dikenal", async () => {
    expect(await simpanPenjualan({ kolaborasiId: briefId, date: tgl("2026-10-01"), orders: 0, gmv: 0, olehUserId: userId })).toEqual({
      ok: false,
      kode: "PENJUALAN_KOSONG",
    });
    expect(await simpanPenjualan({ kolaborasiId: briefId, date: null, orders: 1, olehUserId: userId })).toEqual({ ok: false, kode: "TANGGAL_WAJIB" });
    expect(await simpanPenjualan({ kolaborasiId: briefId, date: tgl("2026-10-01"), orders: 1, source: "Tokopedia", olehUserId: userId })).toEqual({
      ok: false,
      kode: "SUMBER_TIDAK_SAH",
    });
    expect(await prisma.kolSale.count({ where: { collabId: briefId } })).toBe(0);
  });

  it("mengubah baris sampai kosong ditolak", async () => {
    const r = await simpanPenjualan({ kolaborasiId: briefId, date: tgl("2026-10-01"), orders: 1, gmv: 0, olehUserId: userId });
    if (!r.ok) throw new Error(r.kode);
    expect(await simpanPenjualan({ id: r.id, kolaborasiId: briefId, orders: 0, olehUserId: userId })).toEqual({ ok: false, kode: "PENJUALAN_KOSONG" });
  });
});

describe("hapusPenjualan + totalnya", () => {
  it("total mengikuti baris yang tersisa; hapus meninggalkan jejak berisi isi lamanya", async () => {
    const a = await simpanPenjualan({ kolaborasiId: briefId, date: tgl("2026-10-01"), orders: 1, gmv: 100_000.1, commission: 10_000.1, olehUserId: userId });
    const b = await simpanPenjualan({ kolaborasiId: briefId, date: tgl("2026-10-02"), orders: 2, gmv: 200_000.2, commission: 20_000.2, olehUserId: userId });
    if (!a.ok || !b.ok) throw new Error("gagal");

    let data = await penjualanKolaborasi(briefId);
    expect(data.total).toEqual({ orders: 3, gmv: 300_000.3, komisi: 30_000.3 });
    expect(data.baris.map((x) => x.id)).toEqual([b.id, a.id]);

    expect(await hapusPenjualan({ id: a.id, olehUserId: userId })).toMatchObject({ ok: true });
    data = await penjualanKolaborasi(briefId);
    expect(data.total).toEqual({ orders: 2, gmv: 200_000.2, komisi: 20_000.2 });
    const jejak = await prisma.auditLog.findFirstOrThrow({ where: { entityId: briefId, action: "KOL_SALE_DELETED" } });
    expect(jejak.changes).toMatchObject({ before: { orders: 1 } });

    expect(await hapusPenjualan({ id: a.id, olehUserId: userId })).toEqual({ ok: false, kode: "TIDAK_DITEMUKAN" });
  });
});
