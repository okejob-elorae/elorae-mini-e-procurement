import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { JEJAK } from "./jejak";
import { jumlahSelisihPerluDicek, menungguSusulanGudang, selisihReturSaya } from "./pwa-queries";
import { daftarKerjaRetur } from "./return-queries";

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
 * Teardown lewat `seededId()`: jejak penjodohan → beban → hitungan gudang
 * (susulan dulu) → nota toko → toko → pengguna.
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
let jejakIds: string[] = [];

beforeEach(async () => {
  pemegangId = "";
  lainId = "";
  spgId = "";
  tokoId = "";
  nrtId = "";
  nriIds = [];
  bebanId = "";
  jejakIds = [];

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
  if (jejakIds.length) await prisma.auditLog.deleteMany({ where: { id: { in: seededIds(jejakIds) } } });
  if (bebanId) await prisma.returnCharge.delete({ where: { id: seededId(bebanId) } });
  // Susulan dulu (dibuat paling akhir), baru hitungan asli; barisnya ikut terhapus (Cascade).
  if (nriIds.length) await prisma.warehouseReturn.deleteMany({ where: { id: { in: seededIds([...nriIds].reverse()) } } });
  if (nrtId) await prisma.storeReturn.delete({ where: { id: seededId(nrtId) } });
  if (spgId) await prisma.user.delete({ where: { id: seededId(spgId) } });
  if (tokoId) await prisma.store.delete({ where: { id: seededId(tokoId) } });
  const orang = [pemegangId, lainId].filter(Boolean);
  if (orang.length) await prisma.user.deleteMany({ where: { id: { in: seededIds(orang) } } });
});

/**
 * Hitungan susulan. `dicatat` = saat gudang mencatatnya (`createdAt`); tanpa itu basis data
 * mengisinya "sekarang". `diterima` = tanggal datang yang DIKETIK, dan bisa lebih awal dari
 * laporan sales walau barangnya baru dicatat sesudahnya.
 */
async function susulan(qtyKaosA: number, diterima: Date, dicatat?: Date) {
  const n = await prisma.warehouseReturn.create({
    data: {
      noNri: `${tag}-NRI-${nriIds.length + 1}`,
      storeId: tokoId,
      followUpOfStoreReturnId: nrtId,
      warehouseUserId: lainId,
      receivedAt: diterima,
      ...(dicatat ? { createdAt: dicatat } : {}),
      physicalAmount: qtyKaosA * 50_000,
      status: "FINAL",
      items: { create: [{ itemName: "Kaos A", variantSku: "A-M", qty: qtyKaosA, price: 50_000, amount: qtyKaosA * 50_000 }] },
    },
  });
  nriIds.push(n.id);
  return n;
}

/**
 * Penerimaan TANPA nota yang dihitung gudang pada `dicatat`, lalu dijadikan susulan nota ini oleh
 * kantor pada `dijodohkan` — dua hal yang ditinggalkan `jadikanSusulan` dan dibaca kueri: tautan
 * susulannya dan jejak RETUR_SUSULAN_DIJODOHKAN-nya (tidak ada kolom untuk waktu penjodohan).
 */
async function yatimDijodohkan(qtyKaosA: number, dicatat: Date, dijodohkan: Date) {
  const n = await prisma.warehouseReturn.create({
    data: {
      noNri: `${tag}-NRI-${nriIds.length + 1}`,
      storeId: tokoId,
      warehouseUserId: lainId,
      receivedAt: dicatat,
      createdAt: dicatat,
      physicalAmount: qtyKaosA * 50_000,
      status: "FINAL",
      items: { create: [{ itemName: "Kaos A", variantSku: "A-M", qty: qtyKaosA, price: 50_000, amount: qtyKaosA * 50_000 }] },
    },
  });
  nriIds.push(n.id);
  await prisma.warehouseReturn.update({ where: { id: seededId(n.id) }, data: { followUpOfStoreReturnId: nrtId } });
  const jejak = await prisma.auditLog.create({
    data: {
      userId: lainId,
      action: JEJAK.RETUR_SUSULAN_DIJODOHKAN,
      entityType: "WarehouseReturn",
      entityId: n.id,
      metadata: { storeReturnId: nrtId },
      createdAt: dijodohkan,
    },
  });
  jejakIds.push(jejak.id);
  return n;
}

/** Giliran nota ini di daftar kerja kantor — harus sejalan dengan `perluDicek` di HP. */
const giliranKantor = async () => (await daftarKerjaRetur({ storeReturnIds: [nrtId] }))[0]?.giliran;

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

    // Susulan yang DICATAT sesudah laporannya membangunkan tugas.
    await susulan(1, wib("2091-04-05"), wib("2091-04-05"));
    expect((await selisihReturSaya(pemegangId))[0].perluDicek).toBe(true);
    expect(await jumlahSelisihPerluDicek(pemegangId)).toBe(1);
  });

  it("susulan yang dicatat SEBELUM laporan DITEMUKAN tidak membangunkan tugas, walau tanggal datangnya diketik sesudahnya", async () => {
    await prisma.returnCharge.update({
      where: { id: seededId(bebanId) },
      data: { checkStatus: "DITEMUKAN", checkedAt: wib("2091-04-04"), checkedById: pemegangId, checkNote: "di gudang toko" },
    });
    await susulan(1, wib("2091-04-05"), wib("2091-04-03"));
    expect((await selisihReturSaya(pemegangId))[0].perluDicek).toBe(false);
    expect(await jumlahSelisihPerluDicek(pemegangId)).toBe(0);
  });

  it("tanggal datang yang diketik lebih awal dari laporan, tetapi dicatat sesudahnya, tetap membangunkan tugas", async () => {
    // Yang dibandingkan saat gudang MENCATAT susulan, bukan tanggal datang ketikan orang.
    await prisma.returnCharge.update({
      where: { id: seededId(bebanId) },
      data: { checkStatus: "DITEMUKAN", checkedAt: wib("2091-04-04"), checkedById: pemegangId, checkNote: "di gudang toko" },
    });
    await susulan(1, wib("2091-04-02"), wib("2091-04-05"));
    expect((await selisihReturSaya(pemegangId))[0].perluDicek).toBe(true);
    expect(await jumlahSelisihPerluDicek(pemegangId)).toBe(1);
  });

  it("penerimaan tanpa nota yang dihitung SEBELUM laporan tetapi dijadikan susulan SESUDAHNYA membangunkan tugas — sama dengan daftar kerja kantor", async () => {
    // Satu aturan untuk HP pemegang dan daftar kantor (`adaSusulanSesudahLapor`): yang dibandingkan
    // saat dicatat ATAU dijodohkan, mana yang lebih akhir.
    await prisma.returnCharge.update({
      where: { id: seededId(bebanId) },
      data: { checkStatus: "DITEMUKAN", checkedAt: wib("2091-04-04"), checkedById: pemegangId, checkNote: "di gudang toko" },
    });
    await yatimDijodohkan(1, wib("2091-04-03"), wib("2091-04-05"));
    expect((await selisihReturSaya(pemegangId))[0].perluDicek).toBe(true);
    expect(await jumlahSelisihPerluDicek(pemegangId)).toBe(1);
    expect(await giliranKantor()).toBe("sales");
  });

  it("penerimaan tanpa nota yang dihitung DAN dijadikan susulan sebelum laporan tidak membangunkan tugas — kantor pun menunggu gudang", async () => {
    await prisma.returnCharge.update({
      where: { id: seededId(bebanId) },
      data: { checkStatus: "DITEMUKAN", checkedAt: wib("2091-04-04"), checkedById: pemegangId, checkNote: "di gudang toko" },
    });
    await yatimDijodohkan(1, wib("2091-04-02"), wib("2091-04-03"));
    expect((await selisihReturSaya(pemegangId))[0].perluDicek).toBe(false);
    expect(await jumlahSelisihPerluDicek(pemegangId)).toBe(0);
    expect(await giliranKantor()).toBe("gudang");
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

describe("menungguSusulanGudang — beban yang sudah dipotong tidak ditawarkan ke gudang (P87)", () => {
  // Penulis menolak susulan begitu sebagian beban dipotong (`SUDAH_DIPOTONG`, P87 bawaan yang
  // disetujui pemilik), jadi layar gudang tidak boleh menawarkan nota itu untuk dihitung.
  const ditawarkan = async () => (await menungguSusulanGudang()).some((m) => m.chargeId === bebanId);

  it("beban terbuka yang belum dipotong ditawarkan", async () => {
    expect(await ditawarkan()).toBe(true);
  });

  it("beban yang sudah dibebankan ke sales tetapi belum dipotong masih ditawarkan", async () => {
    await prisma.returnCharge.update({
      where: { id: seededId(bebanId) },
      data: { status: "DITETAPKAN", bearer: "SALES", bearerUserId: pemegangId, decidedById: lainId, decidedAt: new Date() },
    });
    expect(await ditawarkan()).toBe(true);
  });

  it("begitu sebagian dipotong, tidak lagi ditawarkan", async () => {
    await prisma.returnCharge.update({
      where: { id: seededId(bebanId) },
      data: {
        status: "DITETAPKAN",
        bearer: "SALES",
        bearerUserId: pemegangId,
        decidedById: lainId,
        decidedAt: new Date(),
        settledAmount: 50_000,
      },
    });
    expect(await ditawarkan()).toBe(false);
  });
});
