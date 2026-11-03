import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { tandaiBebanReturDipotong, tandaiKelebihanReturDikembalikan } from "./potong-beban-retur";

/**
 * Potongan beban selisih retur dari komisi sales, terhadap basis data sungguhan
 * (P87: kelebihan potongan dikembalikan bila barangnya ketemu). Idempoten per
 * kunci layar; dua potongan bersamaan tidak pernah memotong melebihi sisanya.
 * Teardown hanya lewat `seededId()`.
 */

const tag = `PBR-${Math.random().toString(36).slice(2, 8)}`;
let tokoId = "";
let salesId = "";
let notaIds: string[] = [];
let bebanIds: string[] = [];

beforeEach(async () => {
  tokoId = "";
  salesId = "";
  notaIds = [];
  bebanIds = [];
  salesId = (await prisma.user.create({ data: { email: `${tag.toLowerCase()}@uji.test`, name: `${tag} sales` } })).id;
  tokoId = (await prisma.store.create({ data: { code: tag, name: `${tag} Toko`, address: "uji", termsType: "PUTUS" } })).id;
  for (const [n, nilai, hari] of [
    [1, 100_000, 1],
    [2, 50_000, 2],
  ] as const) {
    const nota = await prisma.storeReturn.create({
      data: { noNrt: `${tag}-${n}`, storeId: tokoId, salesmanId: salesId, claimDate: new Date(), claimedAmount: nilai },
    });
    notaIds.push(nota.id);
    const beban = await prisma.returnCharge.create({
      data: {
        storeReturnId: nota.id,
        storeId: tokoId,
        amount: nilai,
        bearer: "SALES",
        bearerUserId: salesId,
        status: "DITETAPKAN",
        decidedAt: new Date(Date.UTC(2026, 9, hari)),
      },
    });
    bebanIds.push(beban.id);
  }
});

afterEach(async () => {
  await prisma.auditLog.deleteMany({ where: { entityType: "ReturnCharge", entityId: { in: seededIds(bebanIds) } } });
  await prisma.returnChargeDeduction.deleteMany({ where: { chargeId: { in: seededIds(bebanIds) } } });
  await prisma.returnCharge.deleteMany({ where: { id: { in: seededIds(bebanIds) } } });
  await prisma.storeReturn.deleteMany({ where: { id: { in: seededIds(notaIds) } } });
  if (tokoId) await prisma.store.delete({ where: { id: tokoId } });
  if (salesId) await prisma.user.delete({ where: { id: salesId } });
});

const dasar = (jumlah: number, kunci: string) => ({
  salesmanId: salesId,
  bulan: "2026-10",
  jumlah,
  kunci: `${tag}-${kunci}`,
  olehUserId: salesId,
});

const terpotong = async () =>
  (await prisma.returnCharge.findMany({ where: { id: { in: seededIds(bebanIds) } }, orderBy: { decidedAt: "asc" } })).map((b) => ({
    settled: Number(b.settledAmount),
    status: b.status,
  }));

describe("tandaiBebanReturDipotong", () => {
  it("memotong beban terlama dulu, sebagian ke beban berikutnya; lunas begitu tertutup", async () => {
    expect(await tandaiBebanReturDipotong(dasar(120_000, "potong-1"))).toEqual({ ok: true, nilai: 120_000, ulang: false });
    expect(await terpotong()).toEqual([
      { settled: 100_000, status: "LUNAS" },
      { settled: 20_000, status: "DITETAPKAN" },
    ]);
  });

  it("kiriman ulang dengan kunci yang sama tidak memotong dua kali", async () => {
    await tandaiBebanReturDipotong(dasar(30_000, "potong-2"));
    expect(await tandaiBebanReturDipotong(dasar(30_000, "potong-2"))).toEqual({ ok: true, nilai: 30_000, ulang: true });
    expect((await terpotong())[0].settled).toBe(30_000);
  });

  it("menolak melebihi sisa beban, tanpa menulis apa pun", async () => {
    expect(await tandaiBebanReturDipotong(dasar(150_000.01, "potong-3"))).toEqual({ ok: false, kode: "MELEBIHI_SISA" });
    expect(await terpotong()).toEqual([
      { settled: 0, status: "DITETAPKAN" },
      { settled: 0, status: "DITETAPKAN" },
    ]);
  });

  it("dua potongan bersamaan tidak pernah melebihi sisanya", async () => {
    const [a, b] = await Promise.all([
      tandaiBebanReturDipotong(dasar(100_000, "balap-a")),
      new Promise((r) => setTimeout(r, 5)).then(() => tandaiBebanReturDipotong(dasar(100_000, "balap-b"))),
    ]);
    const berhasil = [a, b].filter((h) => h.ok).length;
    expect(berhasil).toBe(1);
    expect([a, b].find((h) => !h.ok)).toMatchObject({ ok: false });
    const total = (await terpotong()).reduce((n, x) => n + x.settled, 0);
    expect(total).toBe(100_000);
  });
});

describe("tandaiKelebihanReturDikembalikan (P87)", () => {
  it("hanya sebesar kelebihannya sesudah bebannya turun", async () => {
    await tandaiBebanReturDipotong(dasar(100_000, "potong-4"));
    expect(await tandaiKelebihanReturDikembalikan(dasar(10_000, "kembali-0"))).toEqual({ ok: false, kode: "TIDAK_ADA_KELEBIHAN" });
    // Barang susulan menurunkan beban pertama ke 40.000: kelebihan 60.000.
    await prisma.returnCharge.update({ where: { id: seededId(bebanIds[0]) }, data: { amount: 40_000 } });
    expect(await tandaiKelebihanReturDikembalikan(dasar(60_000.01, "kembali-1"))).toEqual({ ok: false, kode: "MELEBIHI_KELEBIHAN" });
    expect(await tandaiKelebihanReturDikembalikan(dasar(60_000, "kembali-2"))).toEqual({ ok: true, nilai: 60_000, ulang: false });
    expect((await terpotong())[0]).toEqual({ settled: 40_000, status: "LUNAS" });
  });
});
