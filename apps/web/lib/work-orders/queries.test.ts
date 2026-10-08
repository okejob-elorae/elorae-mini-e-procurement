import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { listWorkOrders } from "./queries";

/*
 * Daftar perintah kerja: pencarian di server (seluruh data, bukan halaman yang
 * tampil) dan saringan "terlambat" — basis data uji nyata.
 */

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

d("listWorkOrders: cari dan terlambat (test bed only)", () => {
  const token = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  let userId = "";
  let typeId = "";
  let vendorId = "";
  let uomId = "";
  let kemejaId = "";
  let kaosId = "";
  const woIds: string[] = [];
  let receiptId = "";

  const kemarin = new Date(Date.now() - 3 * 86_400_000);
  const besok = new Date(Date.now() + 3 * 86_400_000);

  beforeAll(async () => {
    userId = "";
    typeId = "";
    vendorId = "";
    uomId = "";
    kemejaId = "";
    kaosId = "";
    userId = (await prisma.user.create({ data: { email: `daftar-wo-${token}@uji.local`, name: "Daftar WO uji" }, select: { id: true } })).id;
    typeId = (await prisma.supplierType.create({ data: { code: `TDW-${token}`, name: `Jenis ${token}` }, select: { id: true } })).id;
    vendorId = (await prisma.supplier.create({ data: { code: `CMT-DW-${token}`, name: `Penjahit ${token}`, typeId }, select: { id: true } })).id;
    uomId = (await prisma.uOM.create({ data: { code: `D${token}`.slice(0, 10), nameId: "Pcs", nameEn: "Pcs" }, select: { id: true } })).id;
    kemejaId = (
      await prisma.item.create({
        data: { sku: `KMJ-${token}`, nameId: `Kemeja Linen ${token}`, nameEn: "Shirt", type: "FINISHED_GOOD", uomId },
        select: { id: true },
      })
    ).id;
    kaosId = (
      await prisma.item.create({
        data: { sku: `KAOS-${token}`, nameId: `Kaos Basic ${token}`, nameEn: "Tee", type: "FINISHED_GOOD", uomId },
        select: { id: true },
      })
    ).id;
    const buat = async (n: number, fg: string, status: "IN_PRODUCTION" | "COMPLETED" | "DRAFT", targetDate: Date | null) => {
      const wo = await prisma.workOrder.create({
        data: {
          docNumber: `WO-DW-${token}-${n}`,
          vendorId,
          finishedGoodId: fg,
          plannedQty: 10,
          consumptionPlan: [],
          createdById: userId,
          status,
          targetDate,
        },
        select: { id: true },
      });
      woIds.push(wo.id);
    };
    await buat(1, kemejaId, "IN_PRODUCTION", kemarin); // terlambat
    await buat(2, kemejaId, "IN_PRODUCTION", besok); // belum
    await buat(3, kaosId, "COMPLETED", kemarin); // selesai: tidak terlambat
    await buat(4, kaosId, "DRAFT", kemarin); // draf: tidak terlambat
    // WO 2 punya satu penerimaan dengan cacat: 6 disetor, 1 cacat, 5 masuk stok.
    receiptId = (
      await prisma.fGReceipt.create({
        data: {
          docNumber: `RCV-DW-${token}`,
          woId: woIds[1],
          receiptType: "GENERIC",
          qtyReceived: 6,
          qtyRejected: 1,
          qtyAccepted: 5,
          receivedById: userId,
        },
        select: { id: true },
      })
    ).id;
    await prisma.workOrder.update({ where: { id: woIds[1] }, data: { actualQty: 5, status: "PARTIAL" } });
  });

  afterAll(async () => {
    await prisma.fGReceipt.deleteMany({ where: { id: seededId(receiptId) } });
    await prisma.workOrder.deleteMany({ where: { id: { in: seededIds(woIds) } } });
    await prisma.item.deleteMany({ where: { id: { in: seededIds([kemejaId, kaosId]) } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.supplier.deleteMany({ where: { id: seededId(vendorId) } });
    await prisma.supplierType.deleteMany({ where: { id: seededId(typeId) } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
  });

  const nomor = (hasil: unknown) =>
    ((hasil as { items: Array<{ docNumber: string }> }).items ?? []).map((w) => w.docNumber.split("-").pop()).sort();

  it("cari nama barang jadi (huruf kecil) → hanya WO barang itu, beserta nama & SKU barangnya", async () => {
    const hasil = await listWorkOrders({ vendorId, q: `kaos basic ${token}`.toLowerCase() }, { page: 1, pageSize: 50 });
    expect(nomor(hasil)).toEqual(["3", "4"]);
    expect((hasil as { items: Array<{ finishedGood: { sku: string } }> }).items[0].finishedGood.sku).toBe(`KAOS-${token}`);
  });

  it("cari SKU dan nomor WO", async () => {
    expect(nomor(await listWorkOrders({ vendorId, q: `KMJ-${token}` }, { page: 1, pageSize: 50 }))).toEqual(["1", "2"]);
    expect(nomor(await listWorkOrders({ q: `WO-DW-${token}-2` }, { page: 1, pageSize: 50 }))).toEqual(["2"]);
  });

  it("terlambat → hanya WO aktif yang lewat target; dengan status SELESAI → kosong", async () => {
    expect(nomor(await listWorkOrders({ vendorId, terlambat: true }, { page: 1, pageSize: 50 }))).toEqual(["1"]);
    expect(nomor(await listWorkOrders({ vendorId, terlambat: true, status: "COMPLETED" }, { page: 1, pageSize: 50 }))).toEqual([]);
    expect(nomor(await listWorkOrders({ vendorId, terlambat: true, status: "IN_PRODUCTION" }, { page: 1, pageSize: 50 }))).toEqual(["1"]);
  });

  it("setoran di daftar dihitung dari dokumen penerimaan (satu definisi dengan rincian)", async () => {
    const hasil = (await listWorkOrders({ q: `WO-DW-${token}-2` }, { page: 1, pageSize: 50 })) as {
      items: Array<{ setoran: { target: number; disetor: number; cacat: number; masukStok: number; kurang: number; persen: number } }>;
    };
    expect(hasil.items[0].setoran).toMatchObject({ target: 10, disetor: 6, cacat: 1, masukStok: 5, kurang: 5, persen: 50 });
    const tanpa = (await listWorkOrders({ q: `WO-DW-${token}-1` }, { page: 1, pageSize: 50 })) as {
      items: Array<{ setoran: { masukStok: number; kurang: number } }>;
    };
    expect(tanpa.items[0].setoran).toMatchObject({ masukStok: 0, kurang: 10 });
  });
});
