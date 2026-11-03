import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { jumlahSelisihPerluDicek, selisihReturSaya } from "./pwa-queries";

/**
 * Tugas "cari barang selisih retur" di HP sales, terhadap basis data sungguhan.
 *
 * Pemilik 2026-11-02: P85 (yang mencari = pemegang toko; rotasi toko memindahkan
 * tugasnya), P88 (sales melapor dulu sebelum selisih boleh dibebankan
 * kepadanya), P18 (HP salesman membawa rupiah, juga untuk toko konsinyasi).
 * Yang dijaga hidup di kueri: siapa yang melihat barisnya, barang kurang yang
 * dihitung dari hitungan asli DAN setiap susulan, dan kapan barisnya masuk
 * hitungan tugas beranda.
 *
 * Teardown lewat `seededId()`: beban → hitungan gudang (susulan dulu) → nota
 * toko → toko → pengguna.
 */

const tag = `SRS-${Math.random().toString(36).slice(2, 8)}`;
const wib = (t: string) => new Date(`${t}T00:00:00+07:00`);

let pemegangId = "";
let lainId = "";
let spgId = "";
let tokoId = "";
let nrtId = "";
let nriIds: string[] = [];
let bebanId = "";

beforeEach(async () => {
  pemegangId = "";
  lainId = "";
  spgId = "";
  tokoId = "";
  nrtId = "";
  nriIds = [];
  bebanId = "";

  pemegangId = (await prisma.user.create({ data: { email: `${tag.toLowerCase()}-a@uji.test`, name: `${tag} pemegang` } })).id;
  lainId = (await prisma.user.create({ data: { email: `${tag.toLowerCase()}-b@uji.test`, name: `${tag} lain` } })).id;
  tokoId = (
    await prisma.store.create({
      data: { code: tag, name: `${tag} Konsi`, address: "uji", termsType: "KONSI", salesmanId: pemegangId },
    })
  ).id;
  spgId = (
    await prisma.user.create({ data: { email: `${tag.toLowerCase()}-spg@uji.test`, name: `${tag} SPG`, assignedStoreId: tokoId } })
  ).id;

  // Nota toko: 5 Kaos A (M) + 2 Kaos B. Gudang menghitung 3 Kaos A + 2 Kaos B → kurang 2 Kaos A.
  nrtId = (
    await prisma.storeReturn.create({
      data: {
        noNrt: `${tag}-NRT`,
        storeId: tokoId,
        salesmanId: pemegangId,
        claimDate: wib("2091-04-01"),
        claimedAmount: 330_000,
        status: "SELISIH",
        items: {
          create: [
            { itemName: "Kaos A", variantSku: "A-M", qty: 5, price: 50_000, amount: 250_000 },
            { itemName: "Kaos B", qty: 2, price: 40_000, amount: 80_000 },
          ],
        },
      },
    })
  ).id;
  const asli = await prisma.warehouseReturn.create({
    data: {
      noNri: `${tag}-NRI-1`,
      storeId: tokoId,
      storeReturnId: nrtId,
      warehouseUserId: lainId,
      receivedAt: wib("2091-04-03"),
      physicalAmount: 230_000,
      claimedAmount: 330_000,
      status: "FINAL",
      items: {
        create: [
          { itemName: "Kaos A", variantSku: "A-M", qty: 3, price: 50_000, amount: 150_000 },
          { itemName: "Kaos B", qty: 2, price: 40_000, amount: 80_000 },
        ],
      },
    },
  });
  nriIds.push(asli.id);
  bebanId = (
    await prisma.returnCharge.create({
      data: { storeReturnId: nrtId, warehouseReturnId: asli.id, storeId: tokoId, amount: 100_000, status: "TERBUKA" },
    })
  ).id;
});

afterEach(async () => {
  if (bebanId) await prisma.returnCharge.delete({ where: { id: seededId(bebanId) } });
  // Susulan dulu (dibuat paling akhir), baru hitungan asli; barisnya ikut terhapus (Cascade).
  if (nriIds.length) await prisma.warehouseReturn.deleteMany({ where: { id: { in: seededIds([...nriIds].reverse()) } } });
  if (nrtId) await prisma.storeReturn.delete({ where: { id: seededId(nrtId) } });
  if (spgId) await prisma.user.delete({ where: { id: seededId(spgId) } });
  if (tokoId) await prisma.store.delete({ where: { id: seededId(tokoId) } });
  const orang = [pemegangId, lainId].filter(Boolean);
  if (orang.length) await prisma.user.deleteMany({ where: { id: { in: seededIds(orang) } } });
});

async function susulan(qtyKaosA: number, diterima: Date) {
  const n = await prisma.warehouseReturn.create({
    data: {
      noNri: `${tag}-NRI-${nriIds.length + 1}`,
      storeId: tokoId,
      followUpOfStoreReturnId: nrtId,
      warehouseUserId: lainId,
      receivedAt: diterima,
      physicalAmount: qtyKaosA * 50_000,
      status: "FINAL",
      items: { create: [{ itemName: "Kaos A", variantSku: "A-M", qty: qtyKaosA, price: 50_000, amount: qtyKaosA * 50_000 }] },
    },
  });
  nriIds.push(n.id);
  return n;
}

describe("selisihReturSaya — tugas cari barang selisih retur (P85/P88)", () => {
  it("pemegang toko melihatnya: barang yang kurang, SPG tokonya, dan nilainya — juga di toko konsinyasi (P18)", async () => {
    const baris = (await selisihReturSaya(pemegangId)).filter((b) => b.storeId === tokoId);
    expect(baris).toHaveLength(1);
    expect(baris[0]).toMatchObject({
      chargeId: bebanId,
      noNrt: `${tag}-NRT`,
      noNri: `${tag}-NRI-1`,
      nilai: 100_000,
      cek: "DITANYAKAN",
      perluDicek: true,
      spg: [`${tag} SPG`],
    });
    expect(baris[0].barang).toEqual([{ itemName: "Kaos A", variantSku: "A-M", qtyKurang: 2 }]);
    expect(JSON.stringify(baris)).toContain("100000");
    expect(await jumlahSelisihPerluDicek(pemegangId)).toBe(1);
  });

  it("sales yang bukan pemegang tidak melihatnya; rotasi toko memindahkan tugasnya", async () => {
    expect(await selisihReturSaya(lainId)).toEqual([]);
    await prisma.store.update({ where: { id: seededId(tokoId) }, data: { salesmanId: lainId } });
    expect((await selisihReturSaya(lainId)).map((b) => b.chargeId)).toEqual([bebanId]);
    expect((await selisihReturSaya(pemegangId)).some((b) => b.chargeId === bebanId)).toBe(false);
  });

  it("barang yang kurang dihitung sesudah setiap hitungan susulan", async () => {
    await susulan(1, wib("2091-04-05"));
    const [b] = await selisihReturSaya(pemegangId);
    expect(b.barang).toEqual([{ itemName: "Kaos A", variantSku: "A-M", qtyKurang: 1 }]);
    await susulan(1, wib("2091-04-06"));
    expect((await selisihReturSaya(pemegangId))[0].barang).toEqual([]);
  });

  it("sudah dilaporkan DITEMUKAN: keluar dari tugas beranda, dan masuk lagi begitu susulannya datang tetapi masih bersisa", async () => {
    await prisma.returnCharge.update({
      where: { id: seededId(bebanId) },
      data: { checkStatus: "DITEMUKAN", checkedAt: wib("2091-04-04"), checkedById: pemegangId, checkNote: "di gudang toko" },
    });
    expect((await selisihReturSaya(pemegangId))[0]).toMatchObject({ cek: "DITEMUKAN", perluDicek: false, cekCatatan: "di gudang toko" });
    expect(await jumlahSelisihPerluDicek(pemegangId)).toBe(0);

    // Susulan SEBELUM laporannya tidak membangunkan tugas; yang SESUDAH-nya membangunkan.
    await susulan(1, wib("2091-04-05"));
    expect((await selisihReturSaya(pemegangId))[0].perluDicek).toBe(true);
    expect(await jumlahSelisihPerluDicek(pemegangId)).toBe(1);
  });

  it("dilaporkan TIDAK_DITEMUKAN: tidak lagi menunggu laporan sales", async () => {
    await prisma.returnCharge.update({
      where: { id: seededId(bebanId) },
      data: { checkStatus: "TIDAK_DITEMUKAN", checkedAt: wib("2091-04-04"), checkedById: pemegangId, checkNote: "sudah dicari" },
    });
    expect((await selisihReturSaya(pemegangId))[0].perluDicek).toBe(false);
    expect(await jumlahSelisihPerluDicek(pemegangId)).toBe(0);
  });

  it("beban yang sudah diputuskan kantor tidak lagi menjadi tugas sales", async () => {
    await prisma.returnCharge.update({
      where: { id: seededId(bebanId) },
      data: { status: "DITETAPKAN", bearer: "GUDANG", decidedById: lainId, decidedAt: new Date() },
    });
    expect(await selisihReturSaya(pemegangId)).toEqual([]);
  });
});
