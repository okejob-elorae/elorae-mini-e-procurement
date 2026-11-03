import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { tandaiBebanReturDipotong, tandaiKelebihanReturDikembalikan } from "./potong-beban-retur";
import { potonganReturSalesBulan } from "./return-queries";

/**
 * Kolom "Selisih retur" di Laporan → Komisi salesman, terhadap basis data
 * sungguhan — pembaca tunggal yang dipakai halaman laporan dan ekspor Excel-nya
 * (aturan murninya diuji di `potongan-retur.spec.ts` folder laporan). Sisanya
 * harus sama dengan yang dibaca penulis potongannya — kalau berbeda, tombol
 * "Tandai dipotong" menawarkan angka yang ditolak (`MELEBIHI_SISA`).
 * Penanggungnya selalu salesman yang dibuat tes ini sendiri: beban milik
 * pengguna dev pinjaman ikut terjumlah. Teardown hanya lewat `seededId()`.
 */

const tag = `RQP-${Math.random().toString(36).slice(2, 8)}`;
let tokoId = "";
let salesId = "";
let lainId = "";
let notaIds: string[] = [];
let bebanIds: string[] = [];

beforeEach(async () => {
  tokoId = "";
  salesId = "";
  lainId = "";
  notaIds = [];
  bebanIds = [];
  salesId = (await prisma.user.create({ data: { email: `${tag.toLowerCase()}@uji.test`, name: `${tag} sales` } })).id;
  lainId = (await prisma.user.create({ data: { email: `${tag.toLowerCase()}-lain@uji.test`, name: `${tag} lain` } })).id;
  tokoId = (await prisma.store.create({ data: { code: tag, name: `${tag} Toko`, address: "uji", termsType: "PUTUS" } })).id;
  for (const [n, nilai, hari, bearer, status] of [
    [1, 100_000, 1, "SALES", "DITETAPKAN"],
    [2, 50_000, 2, "SALES", "DITETAPKAN"],
    // Beban milik orang yang sama tapi bukan bagian sales, dan beban yang belum diputuskan:
    // tidak pernah masuk kolom komisi.
    [3, 70_000, 3, "GUDANG", "DITETAPKAN"],
    [4, 40_000, 4, null, "TERBUKA"],
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
        bearer,
        bearerUserId: bearer ? salesId : null,
        status,
        decidedAt: status === "TERBUKA" ? null : new Date(Date.UTC(2026, 9, hari)),
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
  if (lainId) await prisma.user.delete({ where: { id: lainId } });
  if (salesId) await prisma.user.delete({ where: { id: salesId } });
});

const dasar = (bulan: string, jumlah: number, kunci: string) => ({
  salesmanId: salesId,
  bulan,
  jumlah,
  kunci: `${tag}-${kunci}`,
  olehUserId: salesId,
});

describe("potonganReturSalesBulan", () => {
  it("sisa = beban SALES yang diputuskan, belum dipotong; beban gudang dan yang terbuka tidak ikut", async () => {
    const r = await potonganReturSalesBulan([salesId, lainId], "2026-10");
    expect(r[salesId]).toEqual({ sisa: 150_000, dipotongBulanIni: 0, kelebihan: 0, dikembalikanBulanIni: 0 });
    expect(r[lainId]).toEqual({ sisa: 0, dipotongBulanIni: 0, kelebihan: 0, dikembalikanBulanIni: 0 });
  });

  it("potongan dibagi per bulannya sendiri, dan sisanya sama dengan yang diterima penulisnya", async () => {
    await tandaiBebanReturDipotong(dasar("2026-10", 120_000, "okt"));
    await tandaiBebanReturDipotong(dasar("2026-11", 10_000, "nov"));
    const okt = await potonganReturSalesBulan([salesId], "2026-10");
    const nov = await potonganReturSalesBulan([salesId], "2026-11");
    expect(okt[salesId]).toEqual({ sisa: 20_000, dipotongBulanIni: 120_000, kelebihan: 0, dikembalikanBulanIni: 0 });
    expect(nov[salesId]).toEqual({ sisa: 20_000, dipotongBulanIni: 10_000, kelebihan: 0, dikembalikanBulanIni: 0 });
    // Tepat sebesar sisa yang dilaporkan diterima; satu sen lebih ditolak.
    expect(await tandaiBebanReturDipotong(dasar("2026-11", 20_000.01, "lebih"))).toEqual({ ok: false, kode: "MELEBIHI_SISA" });
    expect(await tandaiBebanReturDipotong(dasar("2026-11", 20_000, "pas"))).toMatchObject({ ok: true });
    expect((await potonganReturSalesBulan([salesId], "2026-11"))[salesId].sisa).toBe(0);
  });

  it("kelebihan potongan dan pengembaliannya terbaca per bulan pengembalian", async () => {
    await tandaiBebanReturDipotong(dasar("2026-10", 100_000, "okt"));
    // Beban pertama turun ke 40.000 sesudah dipotong 100.000: kelebihan 60.000.
    await prisma.returnCharge.update({ where: { id: seededId(bebanIds[0]) }, data: { amount: 40_000 } });
    expect((await potonganReturSalesBulan([salesId], "2026-10"))[salesId]).toEqual({
      sisa: 50_000,
      dipotongBulanIni: 100_000,
      kelebihan: 60_000,
      dikembalikanBulanIni: 0,
    });
    await tandaiKelebihanReturDikembalikan(dasar("2026-11", 60_000, "kembali"));
    expect((await potonganReturSalesBulan([salesId], "2026-11"))[salesId]).toEqual({
      sisa: 50_000,
      dipotongBulanIni: 0,
      kelebihan: 0,
      dikembalikanBulanIni: 60_000,
    });
  });

  it("kiriman ulang dengan kunci yang sama terbaca sekali, dan tidak pernah jatuh ke orang lain", async () => {
    expect(await tandaiBebanReturDipotong(dasar("2026-10", 30_000, "ulang"))).toMatchObject({ ok: true, ulang: false });
    expect(await tandaiBebanReturDipotong(dasar("2026-10", 30_000, "ulang"))).toMatchObject({ ok: true, ulang: true });
    const r = await potonganReturSalesBulan([salesId, lainId], "2026-10");
    expect(r[salesId]).toEqual({ sisa: 120_000, dipotongBulanIni: 30_000, kelebihan: 0, dikembalikanBulanIni: 0 });
    expect(r[lainId]).toEqual({ sisa: 0, dipotongBulanIni: 0, kelebihan: 0, dikembalikanBulanIni: 0 });
  });

  it("daftar kosong tidak menyentuh basis data", async () => {
    expect(await potonganReturSalesBulan([], "2026-10")).toEqual({});
  });
});
