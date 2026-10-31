import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { jodohkanRetur } from "./return-writer";

/**
 * Menjodohkan hitungan gudang yatim (NRI) ke nota retur toko (NRT) memegang
 * aturan dua tangan yang sama dengan `catatHitunganGudang`: yang menghitung
 * fisik bukan orang yang melaporkan nota itu. Tanpanya pelapor bisa menghitung
 * "yatim" lebih dulu lalu menjodohkannya ke notanya sendiri.
 *
 * Terhadap basis data sungguhan. Pengguna DIPINJAM (dua yang sudah ada); setiap
 * penghapusan lewat `seededId()`.
 */

const tag = `JDH-${Math.random().toString(36).slice(2, 8)}`;
let pelaporId = "";
let lainId = "";
let tokoId = "";
let nrtIds: string[] = [];
let nriIds: string[] = [];
let urut = 0;

beforeEach(async () => {
  pelaporId = "";
  lainId = "";
  tokoId = "";
  nrtIds = [];
  nriIds = [];

  const orang = await prisma.user.findMany({ select: { id: true }, take: 2, orderBy: { createdAt: "asc" } });
  if (orang.length < 2) throw new Error("Basis data uji butuh dua pengguna");
  pelaporId = orang[0].id;
  lainId = orang[1].id;
  tokoId = (
    await prisma.store.create({
      data: { code: `${tag}-S`, name: `${tag} Toko`, address: "uji", termsType: "PUTUS", isActive: true },
    })
  ).id;
});

afterEach(async () => {
  const entitas = [...nrtIds, ...nriIds].filter(Boolean).map(seededId);
  if (entitas.length) await prisma.auditLog.deleteMany({ where: { entityId: { in: seededIds(entitas) } } });
  await prisma.returnCharge.deleteMany({
    where: {
      OR: [
        { storeReturnId: { in: nrtIds.filter(Boolean).map(seededId) } },
        { warehouseReturnId: { in: nriIds.filter(Boolean).map(seededId) } },
      ],
    },
  });
  await prisma.warehouseReturn.deleteMany({ where: { id: { in: nriIds.filter(Boolean).map(seededId) } } });
  await prisma.storeReturn.deleteMany({ where: { id: { in: nrtIds.filter(Boolean).map(seededId) } } });
  if (tokoId) await prisma.store.delete({ where: { id: seededId(tokoId) } });
});

async function buatNrt(salesmanId: string) {
  urut += 1;
  const n = await prisma.storeReturn.create({
    data: {
      noNrt: `${tag}-NRT-${urut}`,
      storeId: tokoId,
      salesmanId,
      claimDate: new Date("2026-10-01T00:00:00+07:00"),
      claimedAmount: 300_000,
      status: "MENUNGGU",
    },
  });
  nrtIds.push(n.id);
  return n;
}

async function buatNriYatim(warehouseUserId: string) {
  urut += 1;
  const n = await prisma.warehouseReturn.create({
    data: {
      noNri: `${tag}-NRI-${urut}`,
      storeId: tokoId,
      storeReturnId: null,
      warehouseUserId,
      receivedAt: new Date("2026-10-01T00:00:00+07:00"),
      physicalAmount: 300_000,
      claimedAmount: 0,
      status: "FINAL",
    },
  });
  nriIds.push(n.id);
  return n;
}

describe("jodohkanRetur — penghitung bukan pelapor", () => {
  it("menolak menjodohkan hitungan yang dicatat pelapor nota itu sendiri", async () => {
    const nrt = await buatNrt(pelaporId);
    const nri = await buatNriYatim(pelaporId);

    expect(await jodohkanRetur({ warehouseReturnId: nri.id, storeReturnId: nrt.id, olehUserId: lainId })).toEqual({
      ok: false,
      alasan: "PENGHITUNG_SAMA_PELAPOR",
    });
    const sesudah = await prisma.warehouseReturn.findUniqueOrThrow({ where: { id: seededId(nri.id) } });
    expect(sesudah.storeReturnId).toBeNull();
  });

  it("menjodohkan hitungan yang dicatat orang lain", async () => {
    const nrt = await buatNrt(pelaporId);
    const nri = await buatNriYatim(lainId);

    expect((await jodohkanRetur({ warehouseReturnId: nri.id, storeReturnId: nrt.id, olehUserId: lainId })).ok).toBe(true);
    const sesudah = await prisma.warehouseReturn.findUniqueOrThrow({ where: { id: seededId(nri.id) } });
    expect(sesudah.storeReturnId).toBe(nrt.id);
  });
});
