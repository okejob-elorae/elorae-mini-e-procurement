import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { catatReturToko } from "./return-writer";

/**
 * Nomor nota retur buatan sistem (`TRK/YY/MM/NNNN`) memakai tahun dan bulan
 * WIB, bukan jam server.
 *
 * Tanggal nota disimpan tengah malam WIB — 1 Januari 2027 WIB adalah
 * 31 Desember 2026 17.00 UTC. Server produksi berjalan di UTC, jadi
 * `getFullYear()`/`getMonth()` memberi Desember 2026 dan nota itu ikut deret
 * bulan lalu. Zona proses dipaksa UTC supaya kesalahannya terlihat juga di
 * laptop berzona WIB. Basis data dipakai bersama data dev: setiap penghapusan
 * lewat `seededId()`.
 */

const zonaAsli = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "UTC";
});
afterAll(() => {
  if (zonaAsli === undefined) delete process.env.TZ;
  else process.env.TZ = zonaAsli;
});

const tag = `TRKW-${Math.random().toString(36).slice(2, 8)}`;
const wib = (t: string) => new Date(`${t}T00:00:00+07:00`);

let spgId = "";
let uomId = "";
let itemId = "";
let tokoId = "";
let nrtIds: string[] = [];

beforeEach(async () => {
  spgId = "";
  uomId = "";
  itemId = "";
  tokoId = "";
  nrtIds = [];

  spgId = (await prisma.user.findFirstOrThrow({ select: { id: true }, orderBy: { createdAt: "asc" } })).id;
  uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
  itemId = (
    await prisma.item.create({
      data: {
        sku: tag,
        nameId: `Kemeja ${tag}`,
        nameEn: "Shirt",
        type: "FINISHED_GOOD",
        uomId,
        isActive: true,
        sellingPrice: 80_000,
        variants: [{ sku: `${tag}-M`, size: "M" }],
      },
    })
  ).id;
  tokoId = (
    await prisma.store.create({
      data: { code: `${tag}-K`, name: `${tag} Konsi`, address: "uji", termsType: "KONSI", markupPercent: 20, isActive: true },
    })
  ).id;
});

/** Lonceng kantor "retur SPG dari toko tanpa pemegang" milik nota uji — dicocokkan di JS lewat metadata. */
async function hapusNotifReturTanpaPemegang(notaIds: string[]) {
  if (notaIds.length === 0) return;
  const catatan = await prisma.adminNotification.findMany({
    where: { category: "RETUR_SPG_TANPA_PEMEGANG" },
    select: { id: true, metadata: true },
  });
  const milikUji = catatan
    .filter((c) => {
      const m = c.metadata as Record<string, unknown> | null;
      return typeof m?.storeReturnId === "string" && notaIds.includes(m.storeReturnId);
    })
    .map((c) => c.id);
  if (milikUji.length) await prisma.adminNotification.deleteMany({ where: { id: { in: seededIds(milikUji) } } });
}

afterEach(async () => {
  if (nrtIds.length) await prisma.auditLog.deleteMany({ where: { entityId: { in: nrtIds.filter(Boolean).map(seededId) } } });
  if (tokoId) {
    // Toko uji tanpa pemegang: setiap NRT SPG membunyikan lonceng kantor.
    const notaToko = await prisma.storeReturn.findMany({ where: { storeId: seededId(tokoId) }, select: { id: true } });
    await hapusNotifReturTanpaPemegang(notaToko.map((n) => n.id));
    await prisma.storeStockMovement.deleteMany({ where: { storeId: seededId(tokoId) } });
    await prisma.storeReturn.deleteMany({ where: { storeId: seededId(tokoId) } });
    await prisma.store.delete({ where: { id: seededId(tokoId) } });
  }
  if (itemId) await prisma.item.delete({ where: { id: seededId(itemId) } });
  if (uomId) await prisma.uOM.delete({ where: { id: seededId(uomId) } });
});

describe("nomor TRK memakai bulan WIB", () => {
  it("prasyarat: proses tes benar-benar berjalan di UTC", () => {
    expect(wib("2027-01-01").getFullYear()).toBe(2026);
    expect(wib("2026-11-01").getMonth()).toBe(9);
  });

  it("nota SPG tanpa nomor bertanggal 1 Januari 2027 WIB bernomor TRK/27/01/…", async () => {
    const h = await catatReturToko({
      noNrt: "",
      storeId: tokoId,
      olehUserId: spgId,
      salesmanId: spgId,
      claimDate: wib("2027-01-01"),
      deliveryMethod: "SALES",
      reportedBySpg: true,
      barisSpg: [{ itemId, variantSku: `${tag}-M`, qty: 1, condition: "LAYAK" }],
    });
    if (!h.ok) throw new Error(`gagal: ${h.alasan}`);
    nrtIds.push(h.id);
    expect(h.noNrt).toMatch(/^TRK\/27\/01\/\d{4}$/);
  });

  it("nota SPG tanpa nomor bertanggal 1 November 2026 WIB bernomor TRK/26/11/…", async () => {
    const h = await catatReturToko({
      noNrt: "",
      storeId: tokoId,
      olehUserId: spgId,
      salesmanId: spgId,
      claimDate: wib("2026-11-01"),
      deliveryMethod: "SALES",
      reportedBySpg: true,
      barisSpg: [{ itemId, variantSku: `${tag}-M`, qty: 1, condition: "LAYAK" }],
    });
    if (!h.ok) throw new Error(`gagal: ${h.alasan}`);
    nrtIds.push(h.id);
    expect(h.noNrt).toMatch(/^TRK\/26\/11\/\d{4}$/);
  });
});
