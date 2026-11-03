import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import {
  alihkanBeban,
  catatHitunganGudang,
  catatHitunganSusulan,
  jadikanSusulan,
  jodohkanRetur,
  laporHasilCekSelisih,
  lepasPasangan,
  lepasSusulan,
  putuskanBeban,
} from "./return-writer";
import { tandaiBebanReturDipotong } from "./potong-beban-retur";
import { JEJAK } from "./jejak";

/**
 * Selisih retur toko sesudah gudang menghitung: salesman pemegang toko menanyakan ke
 * toko dan SPG (P22), barang yang ketemu dikirim balik dan dihitung gudang sebagai
 * SUSULAN (P22a), dan bebannya mengikuti — terhadap basis data sungguhan, karena
 * penjaganya hidup di transaksi serializable (bandingkan-lalu-tukar `updateMany`
 * bukan atomik tanpa itu).
 *
 * Basis data dipakai bersama data dev: pengguna DIPINJAM — kecuali sales penanggung
 * potongan komisi, yang dibuat sendiri: potongan membagi ke SEMUA beban sales orang
 * itu, jadi pengguna pinjaman bisa menyentuh beban sungguhan. Id fixture "" dan
 * direset di awal hook, setiap penghapusan lewat `seededId()`/`seededIds()`. Sebagian
 * besar hitungan di sini tanpa baris barang katalog (stok tidak bergerak); bagian
 * "stok dan buku toko" membuat barang katalognya sendiri.
 */

const tag = `SUS-${Math.random().toString(36).slice(2, 8)}`;
const wib = (t: string) => new Date(`${t}T00:00:00+07:00`);
const hariLalu = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);
const mulai = new Date();

let pemegangId = "";
let gudangId = "";
let keuanganId = "";
let lainId = "";
let tokoId = "";
let tokoLainIds: string[] = [];
let nrtIds: string[] = [];
let nriYatimIds: string[] = [];
let penggunaDibuatIds: string[] = [];
let uomId = "";
let itemId = "";
let urut = 0;

beforeEach(async () => {
  pemegangId = "";
  gudangId = "";
  keuanganId = "";
  lainId = "";
  tokoId = "";
  tokoLainIds = [];
  nrtIds = [];
  nriYatimIds = [];
  penggunaDibuatIds = [];
  uomId = "";
  itemId = "";

  const orang = await prisma.user.findMany({ select: { id: true }, take: 4, orderBy: { createdAt: "asc" } });
  if (orang.length < 4) throw new Error("Basis data uji butuh empat pengguna");
  [pemegangId, gudangId, keuanganId, lainId] = orang.map((o) => o.id);

  urut += 1;
  tokoId = (
    await prisma.store.create({
      data: { code: `${tag}-T${urut}`, name: `${tag} T`, address: "uji", termsType: "PUTUS", isActive: true, salesmanId: pemegangId },
    })
  ).id;
});

afterEach(async () => {
  const semuaToko = [tokoId, ...tokoLainIds].filter(Boolean);
  // Hitungan asli, susulan, dan penerimaan tanpa nota uji — termasuk susulan yang DILEPAS
  // (penunjuk notanya sudah kosong, tapi tokonya tetap toko uji).
  const nri =
    nrtIds.length || nriYatimIds.length || semuaToko.length
      ? await prisma.warehouseReturn.findMany({
          where: {
            OR: [
              { storeReturnId: { in: seededIds(nrtIds) } },
              { followUpOfStoreReturnId: { in: seededIds(nrtIds) } },
              { id: { in: seededIds(nriYatimIds) } },
              { storeId: { in: seededIds(semuaToko) } },
            ],
          },
          select: { id: true },
        })
      : [];
  const beban = nrtIds.length
    ? await prisma.returnCharge.findMany({ where: { storeReturnId: { in: seededIds(nrtIds) } }, select: { id: true } })
    : [];
  const lonceng = nrtIds.length
    ? (
        await prisma.adminNotification.findMany({
          where: { category: "RETUR_SELISIH", createdAt: { gte: mulai } },
          select: { id: true, metadata: true },
        })
      ).filter((x) => nrtIds.includes(String((x.metadata as Record<string, unknown> | null)?.storeReturnId ?? "")))
    : [];
  /*
   * Jejak beban yang barisnya sudah dihapus (beban TERBUKA yang tertutup susulan) tetap
   * ditulis dengan id beban itu — tidak terjangkau lewat beban yang masih ada. Jejak penulis
   * retur membawa `storeReturnId` di metadata-nya: dicocokkan di JS.
   */
  const jejakNota = nrtIds.length
    ? (
        await prisma.auditLog.findMany({
          where: { createdAt: { gte: mulai }, entityType: { in: ["ReturnCharge", "WarehouseReturn", "StoreReturn"] } },
          select: { id: true, metadata: true },
        })
      )
        .filter((x) => nrtIds.includes(String((x.metadata as Record<string, unknown> | null)?.storeReturnId ?? "")))
        .map((x) => x.id)
    : [];
  const gerakRusak = itemId
    ? await prisma.damagedStockMovement.findMany({ where: { itemId: seededId(itemId) }, select: { id: true } })
    : [];
  const entitas = [...nrtIds, ...nri.map((n) => n.id), ...beban.map((b) => b.id), ...gerakRusak.map((g) => g.id)].filter(Boolean);
  if (entitas.length) await prisma.auditLog.deleteMany({ where: { entityId: { in: seededIds(entitas) } } });
  if (jejakNota.length) await prisma.auditLog.deleteMany({ where: { id: { in: seededIds(jejakNota) } } });
  if (lonceng.length) await prisma.adminNotification.deleteMany({ where: { id: { in: seededIds(lonceng.map((x) => x.id)) } } });
  if (beban.length) {
    await prisma.returnChargeDeduction.deleteMany({ where: { chargeId: { in: seededIds(beban.map((b) => b.id)) } } });
    await prisma.returnCharge.deleteMany({ where: { id: { in: seededIds(beban.map((b) => b.id)) } } });
  }
  if (nri.length) await prisma.warehouseReturn.deleteMany({ where: { id: { in: seededIds(nri.map((n) => n.id)) } } });
  if (nrtIds.length) await prisma.storeReturn.deleteMany({ where: { id: { in: seededIds(nrtIds) } } });
  if (semuaToko.length) await prisma.storeStockMovement.deleteMany({ where: { storeId: { in: seededIds(semuaToko) } } });
  if (itemId) {
    await prisma.damagedStockMovement.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.stockLedgerEntry.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.stockAdjustment.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.item.delete({ where: { id: seededId(itemId) } });
  }
  if (uomId) await prisma.uOM.delete({ where: { id: seededId(uomId) } });
  if (semuaToko.length) await prisma.store.deleteMany({ where: { id: { in: seededIds(semuaToko) } } });
  if (penggunaDibuatIds.length) await prisma.user.deleteMany({ where: { id: { in: seededIds(penggunaDibuatIds) } } });
});

/** NRT 300 rb dilaporkan pemegang toko, dihitung gudang sebesar `fisik`. */
async function notaBerselisih(fisik = 100_000): Promise<{ nrtId: string; chargeId: string }> {
  const nrtId = await notaBelumDihitung();
  const h = await catatHitunganGudang({
    storeReturnId: nrtId,
    warehouseUserId: gudangId,
    receivedAt: wib("2026-10-25"),
    deliveryMethod: "SALES",
    physicalAmount: fisik,
  });
  if (!h.ok) throw new Error(`hitungan gagal: ${h.alasan}`);
  const beban = await prisma.returnCharge.findFirstOrThrow({ where: { storeReturnId: seededId(nrtId) }, select: { id: true } });
  return { nrtId, chargeId: beban.id };
}

/** NRT 300 rb yang belum dihitung gudang sama sekali. */
async function notaBelumDihitung(): Promise<string> {
  urut += 1;
  const n = await prisma.storeReturn.create({
    data: { noNrt: `${tag}-NRT-${urut}`, storeId: tokoId, salesmanId: pemegangId, claimDate: wib("2026-10-20"), claimedAmount: 300_000 },
  });
  nrtIds.push(n.id);
  return n.id;
}

/** Penerimaan gudang tanpa nota di toko ini (atau toko lain). */
async function yatim(nilai: number, opsi: { storeId?: string; olehId?: string } = {}) {
  const h = await catatHitunganGudang({
    storeId: opsi.storeId ?? tokoId,
    warehouseUserId: opsi.olehId ?? gudangId,
    receivedAt: wib("2026-10-27"),
    deliveryMethod: "EKSPEDISI",
    physicalAmount: nilai,
  });
  if (!h.ok) throw new Error(`hitungan yatim gagal: ${h.alasan}`);
  nriYatimIds.push(h.id);
  return h.id;
}

/** Sales penanggung yang dibuat sendiri, supaya potongan komisinya hanya menyentuh beban uji. */
async function salesBaru(): Promise<string> {
  urut += 1;
  const u = await prisma.user.create({ data: { email: `${tag.toLowerCase()}-${urut}@uji.test`, name: `${tag} sales ${urut}` } });
  penggunaDibuatIds.push(u.id);
  return u.id;
}

const susulan = (nrtId: string, nilai: number, olehId = gudangId) =>
  catatHitunganSusulan({
    storeReturnId: nrtId,
    warehouseUserId: olehId,
    receivedAt: wib("2026-10-28"),
    deliveryMethod: "SALES",
    physicalAmount: nilai,
  });

const bebanNota = (nrtId: string) =>
  prisma.returnCharge.findFirst({
    where: { storeReturnId: seededId(nrtId) },
    select: { id: true, amount: true, status: true, bearer: true, bearerUserId: true, settledAmount: true, checkStatus: true, checkedAt: true, decidedAt: true },
  });

/** Jumlah fisik seluruh susulan final yang terpasang di nota ini. */
const fisikSusulan = async (nrtId: string) =>
  (
    await prisma.warehouseReturn.findMany({
      where: { followUpOfStoreReturnId: seededId(nrtId), status: "FINAL" },
      select: { physicalAmount: true },
    })
  ).reduce((n, x) => n + Number(x.physicalAmount), 0);

const totalPotongan = async (chargeId: string) =>
  (await prisma.returnChargeDeduction.findMany({ where: { chargeId: seededId(chargeId) }, select: { amount: true } })).reduce(
    (n, d) => n + Number(d.amount),
    0,
  );

const lonceng = async (nrtId: string) =>
  (
    await prisma.adminNotification.findMany({
      where: { category: "RETUR_SELISIH", createdAt: { gte: mulai } },
      select: { title: true, metadata: true },
    })
  ).filter((x) => (x.metadata as Record<string, unknown> | null)?.storeReturnId === nrtId);

/** Penulis yang lebih pendek dimulai sedikit belakangan supaya keduanya benar-benar bertumpang. */
const sebentar = () => new Promise((r) => setTimeout(r, 3));

describe("selisih baru mengabari manager", () => {
  it("hitungan pertama yang kurang membuka beban TERBUKA/DITANYAKAN dan tepat satu lonceng", async () => {
    const { nrtId } = await notaBerselisih();
    const b = await bebanNota(nrtId);
    expect(b).toMatchObject({ status: "TERBUKA", checkStatus: "DITANYAKAN" });
    expect(Number(b?.amount)).toBe(200_000);
    expect(await lonceng(nrtId)).toHaveLength(1);
  });
});

describe("laporHasilCekSelisih — pemegang toko sekarang yang melapor", () => {
  it("hanya pemegang toko; orang lain ditolak BUKAN_PEMEGANG", async () => {
    const { chargeId } = await notaBerselisih();
    for (const olehUserId of [gudangId, keuanganId, lainId]) {
      expect(await laporHasilCekSelisih({ chargeId, hasil: "DITEMUKAN", olehUserId })).toEqual({ ok: false, alasan: "BUKAN_PEMEGANG" });
    }
    expect((await laporHasilCekSelisih({ chargeId, hasil: "DITEMUKAN", olehUserId: pemegangId })).ok).toBe(true);
  });

  it("rotasi toko memindahkan tugasnya ke pemegang baru", async () => {
    const { chargeId } = await notaBerselisih();
    await prisma.store.update({ where: { id: seededId(tokoId) }, data: { salesmanId: lainId } });
    expect(await laporHasilCekSelisih({ chargeId, hasil: "DITEMUKAN", olehUserId: pemegangId })).toEqual({ ok: false, alasan: "BUKAN_PEMEGANG" });
    expect((await laporHasilCekSelisih({ chargeId, hasil: "DITEMUKAN", olehUserId: lainId })).ok).toBe(true);
  });

  it("tidak ditemukan: catatan tersimpan, jejak sebelum/sesudah, dan lonceng kedua untuk manager", async () => {
    const { nrtId, chargeId } = await notaBerselisih();
    const h = await laporHasilCekSelisih({ chargeId, hasil: "TIDAK_DITEMUKAN", catatan: "toko dan SPG tidak tahu", olehUserId: pemegangId });
    expect(h.ok && h.notifikasi?.title).toContain("Sales tidak menemukan barang retur");
    expect(await bebanNota(nrtId)).toMatchObject({ checkStatus: "TIDAK_DITEMUKAN" });
    const jejak = await prisma.auditLog.findMany({
      where: { entityId: seededId(chargeId), action: JEJAK.BEBAN_HASIL_CEK },
      select: { changes: true },
    });
    expect(jejak).toHaveLength(1);
    expect(jejak[0].changes).toMatchObject({ before: { checkStatus: "DITANYAKAN" }, after: { checkStatus: "TIDAK_DITEMUKAN" } });
    expect(await lonceng(nrtId)).toHaveLength(2);
  });

  it("ditolak sesudah bebannya diputuskan", async () => {
    const { chargeId } = await notaBerselisih();
    expect((await putuskanBeban({ chargeId, bearer: "PERUSAHAAN", alasan: "hapus", olehUserId: keuanganId })).ok).toBe(true);
    expect(await laporHasilCekSelisih({ chargeId, hasil: "DITEMUKAN", olehUserId: pemegangId })).toEqual({
      ok: false,
      alasan: "SUDAH_DIPUTUSKAN",
    });
  });
});

describe("catatHitunganSusulan — barang selisih yang ketemu dan dikirim balik", () => {
  it("sebagian: besar beban mengecil, notanya tetap berselisih", async () => {
    const { nrtId } = await notaBerselisih();
    const h = await susulan(nrtId, 50_000);
    expect(h).toMatchObject({ ok: true, sisaSelisih: 150_000 });
    expect(Number((await bebanNota(nrtId))?.amount)).toBe(150_000);
    const nri = await prisma.warehouseReturn.findFirstOrThrow({
      where: { followUpOfStoreReturnId: seededId(nrtId) },
      select: { storeReturnId: true, status: true, claimedAmount: true },
    });
    expect(nri).toMatchObject({ storeReturnId: null, status: "FINAL" });
    expect(Number(nri.claimedAmount)).toBe(0);
  });

  it("seluruhnya selagi TERBUKA: bebannya dihapus dan notanya COCOK", async () => {
    const { nrtId } = await notaBerselisih();
    expect(await susulan(nrtId, 200_000)).toMatchObject({ ok: true, sisaSelisih: 0 });
    expect(await bebanNota(nrtId)).toBeNull();
    expect((await prisma.storeReturn.findUniqueOrThrow({ where: { id: seededId(nrtId) } })).status).toBe("COCOK");
  });

  it("beban sales yang belum dipotong mengecil, penanggung dan orangnya tetap", async () => {
    const { nrtId, chargeId } = await notaBerselisih();
    expect((await putuskanBeban({ chargeId, bearer: "SALES", bearerUserId: pemegangId, alasan: "tidak ketemu", olehUserId: keuanganId })).ok).toBe(true);
    // Penanggungnya tidak boleh menghitung susulannya sendiri.
    expect(await susulan(nrtId, 50_000, pemegangId)).toEqual({ ok: false, alasan: "PENGHITUNG_SAMA_PELAPOR" });
    expect((await susulan(nrtId, 50_000)).ok).toBe(true);
    expect(await bebanNota(nrtId)).toMatchObject({ status: "DITETAPKAN", bearer: "SALES", bearerUserId: pemegangId });
    expect(Number((await bebanNota(nrtId))?.amount)).toBe(150_000);
  });

  it("seluruhnya sesudah diputuskan: barisnya tetap dengan nilai 0 (keputusan tetap terbaca)", async () => {
    const { nrtId, chargeId } = await notaBerselisih();
    expect((await putuskanBeban({ chargeId, bearer: "GUDANG", alasan: "salah hitung", olehUserId: keuanganId })).ok).toBe(true);
    expect(await susulan(nrtId, 200_000)).toMatchObject({ ok: true, sisaSelisih: 0 });
    const b = await bebanNota(nrtId);
    expect(b).toMatchObject({ status: "DITETAPKAN", bearer: "GUDANG" });
    expect(Number(b?.amount)).toBe(0);
  });

  it("sesudah ada yang dipotong dari penanggungnya, barangnya tidak lagi jadi susulan (P87, bawaan tercatat)", async () => {
    const { nrtId, chargeId } = await notaBerselisih();
    expect((await putuskanBeban({ chargeId, bearer: "SALES", bearerUserId: lainId, alasan: "x", olehUserId: keuanganId })).ok).toBe(true);
    await prisma.returnCharge.update({ where: { id: seededId(chargeId) }, data: { settledAmount: 10_000 } });
    expect(await susulan(nrtId, 50_000)).toEqual({ ok: false, alasan: "SUDAH_DIPOTONG" });
    expect(await prisma.warehouseReturn.count({ where: { followUpOfStoreReturnId: seededId(nrtId) } })).toBe(0);
  });

  it("dua tangan: pelapor nota dan pemegang toko tidak menghitung susulannya", async () => {
    const { nrtId } = await notaBerselisih();
    expect(await susulan(nrtId, 50_000, pemegangId)).toEqual({ ok: false, alasan: "PENGHITUNG_SAMA_PELAPOR" });
  });

  it("nota yang hitungan aslinya belum ada ditolak BELUM_DIHITUNG", async () => {
    const nrtId = await notaBelumDihitung();
    expect(await susulan(nrtId, 50_000)).toEqual({ ok: false, alasan: "BELUM_DIHITUNG" });
  });

  it("lepas pasangan hitungan asli ditolak selama ada susulan", async () => {
    const { nrtId } = await notaBerselisih();
    expect((await susulan(nrtId, 50_000)).ok).toBe(true);
    const asli = await prisma.warehouseReturn.findFirstOrThrow({ where: { storeReturnId: seededId(nrtId) }, select: { id: true } });
    expect(await lepasPasangan({ warehouseReturnId: asli.id, olehUserId: keuanganId })).toEqual({ ok: false, alasan: "ADA_SUSULAN" });
  });
});

describe("jadikanSusulan / lepasSusulan", () => {
  it("penerimaan tanpa nota menjadi susulan: selisihnya mengecil, tidak bisa dijodohkan lagi", async () => {
    const { nrtId } = await notaBerselisih();
    const nriId = await yatim(80_000);
    const h = await jadikanSusulan({ warehouseReturnId: nriId, storeReturnId: nrtId, olehUserId: keuanganId });
    expect(h).toMatchObject({ ok: true });
    expect(Number((await bebanNota(nrtId))?.amount)).toBe(120_000);
    expect(await jadikanSusulan({ warehouseReturnId: nriId, storeReturnId: nrtId, olehUserId: keuanganId })).toEqual({
      ok: false,
      alasan: "BUKAN_YATIM",
    });
  });

  it("penerimaan toko lain ditolak BEDA_TOKO, penerimaannya tetap yatim", async () => {
    const { nrtId } = await notaBerselisih();
    urut += 1;
    const lain = await prisma.store.create({
      data: { code: `${tag}-L${urut}`, name: `${tag} L`, address: "uji", termsType: "PUTUS", isActive: true },
    });
    tokoLainIds.push(lain.id);
    const nriId = await yatim(80_000, { storeId: lain.id });
    expect(await jadikanSusulan({ warehouseReturnId: nriId, storeReturnId: nrtId, olehUserId: keuanganId })).toEqual({
      ok: false,
      alasan: "BEDA_TOKO",
    });
    expect(
      await prisma.warehouseReturn.findUniqueOrThrow({ where: { id: seededId(nriId) }, select: { followUpOfStoreReturnId: true } }),
    ).toEqual({ followUpOfStoreReturnId: null });
    expect(Number((await bebanNota(nrtId))?.amount)).toBe(200_000);
  });

  it("dua tangan: penerimaan yang dihitung pemegang toko (juga pelapor notanya) ditolak PENGHITUNG_SAMA_PELAPOR", async () => {
    const { nrtId } = await notaBerselisih();
    const nriId = await yatim(80_000, { olehId: pemegangId });
    expect(await jadikanSusulan({ warehouseReturnId: nriId, storeReturnId: nrtId, olehUserId: keuanganId })).toEqual({
      ok: false,
      alasan: "PENGHITUNG_SAMA_PELAPOR",
    });
    expect(Number((await bebanNota(nrtId))?.amount)).toBe(200_000);
  });

  it("nota yang belum dihitung gudang ditolak BELUM_DIHITUNG", async () => {
    const nrtId = await notaBelumDihitung();
    const nriId = await yatim(80_000);
    expect(await jadikanSusulan({ warehouseReturnId: nriId, storeReturnId: nrtId, olehUserId: keuanganId })).toEqual({
      ok: false,
      alasan: "BELUM_DIHITUNG",
    });
  });

  it("lepas susulan yang menutup selisih melahirkan selisihnya lagi, dengan lonceng", async () => {
    const { nrtId } = await notaBerselisih();
    const h = await susulan(nrtId, 200_000);
    if (!h.ok) throw new Error("susulan harus tercatat");
    expect(await bebanNota(nrtId)).toBeNull();
    const lepas = await lepasSusulan({ warehouseReturnId: h.id, olehUserId: keuanganId });
    expect(lepas).toMatchObject({ ok: true, selaras: { kejadian: "BARU" } });
    expect(lepas.ok && lepas.notifikasi?.category).toBe("RETUR_SELISIH");
    expect(Number((await bebanNota(nrtId))?.amount)).toBe(200_000);
  });

  it("lepas susulan ditolak sesudah bebannya diputuskan", async () => {
    const { nrtId, chargeId } = await notaBerselisih();
    const h = await susulan(nrtId, 50_000);
    if (!h.ok) throw new Error("susulan harus tercatat");
    expect((await putuskanBeban({ chargeId, bearer: "PERUSAHAAN", alasan: "x", olehUserId: keuanganId })).ok).toBe(true);
    expect(await lepasSusulan({ warehouseReturnId: h.id, olehUserId: keuanganId })).toEqual({
      ok: false,
      alasan: "BEBAN_SUDAH_DIPUTUSKAN",
    });
  });
});

describe("stok dan buku toko barang susulan", () => {
  const HARGA = 100_000;

  async function barangKatalog() {
    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}-${urut}`, nameId: "pcs", nameEn: "pcs" } })).id;
    itemId = (
      await prisma.item.create({
        data: { sku: `${tag}-${urut}`, nameId: `Kaos ${tag}`, nameEn: "Tee", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: HARGA },
      })
    ).id;
  }

  /**
   * NRT `qtyKlaim` potong barang katalog (100 rb/potong), dihitung gudang `qtyDihitung`
   * potong LAYAK. Dengan `bukuKeluarHari`, klaimnya sudah keluar dari buku stok toko
   * (`RETUR_KELUAR`, seperti nota SPG) sekian hari lalu.
   */
  async function notaBerbarang(qtyKlaim: number, qtyDihitung: number, bukuKeluarHari: number | null = null) {
    urut += 1;
    const n = await prisma.storeReturn.create({
      data: {
        noNrt: `${tag}-NRT-${urut}`,
        storeId: tokoId,
        salesmanId: pemegangId,
        claimDate: wib("2026-10-20"),
        claimedAmount: qtyKlaim * HARGA,
        items: { create: [{ itemId, itemName: `Kaos ${tag}`, qty: qtyKlaim, price: HARGA, amount: qtyKlaim * HARGA }] },
      },
    });
    nrtIds.push(n.id);
    if (bukuKeluarHari !== null) {
      await prisma.storeStockMovement.create({
        data: {
          storeId: tokoId,
          itemId,
          qty: -qtyKlaim,
          kind: "RETUR_KELUAR",
          refType: "StoreReturn",
          refId: n.id,
          createdById: pemegangId,
          createdAt: hariLalu(bukuKeluarHari),
        },
      });
    }
    const h = await catatHitunganGudang({
      storeReturnId: n.id,
      warehouseUserId: gudangId,
      receivedAt: wib("2026-10-25"),
      deliveryMethod: "SALES",
      items: [{ itemId, itemName: `Kaos ${tag}`, qty: qtyDihitung, price: HARGA }],
    });
    if (!h.ok) throw new Error(`hitungan gagal: ${h.alasan}`);
    return n.id;
  }

  /** Opname toko yang disetujui menemukan barang lebih (`OPNAME`, +qty) sekian hari lalu. */
  const opnameTambah = (qty: number, hari: number) =>
    prisma.storeStockMovement.create({
      data: { storeId: tokoId, itemId, qty, kind: "OPNAME", createdById: keuanganId, createdAt: hariLalu(hari) },
    });

  const susulanBarang = (nrtId: string, baris: { qty: number; condition?: "LAYAK" | "RUSAK" }[]) =>
    catatHitunganSusulan({
      storeReturnId: nrtId,
      warehouseUserId: gudangId,
      receivedAt: wib("2026-10-28"),
      deliveryMethod: "SALES",
      items: baris.map((b) => ({ itemId, itemName: `Kaos ${tag}`, qty: b.qty, price: HARGA, condition: b.condition ?? "LAYAK" })),
    });

  /** Koreksi buku toko yang ditulis sebuah hitungan susulan. */
  const bukuSusulan = (susulanId: string) =>
    prisma.storeStockMovement.findMany({
      where: { refType: "WarehouseReturn", refId: seededId(susulanId), kind: "RETUR_KELUAR" },
      select: { qty: true },
    });

  it("baris LAYAK masuk stok jual lewat penggerak stok (buku stok tercatat); baris RUSAK ke gudang barang rusak", async () => {
    await barangKatalog();
    const nrtId = await notaBerbarang(4, 1);
    const h = await susulanBarang(nrtId, [{ qty: 1 }, { qty: 1, condition: "RUSAK" }]);
    if (!h.ok) throw new Error(`susulan gagal: ${h.alasan}`);
    expect(h).toMatchObject({ barisStok: 1, barisGudangRusak: 1, barisBukuToko: 0, sisaSelisih: 100_000 });

    // Stok jual: 1 dari hitungan asli + 1 LAYAK dari susulan; yang rusak tidak.
    const stok = await prisma.inventoryValue.findMany({ where: { itemId: seededId(itemId) }, select: { qtyOnHand: true } });
    expect(stok.reduce((n, s) => n + Number(s.qtyOnHand), 0)).toBe(2);

    const adj = await prisma.stockAdjustment.findMany({
      where: { itemId: seededId(itemId), reason: { contains: `${h.noNri} —` } },
      select: { id: true, docNumber: true, qtyChange: true, source: true, type: true },
    });
    expect(adj).toHaveLength(1);
    expect(adj[0]).toMatchObject({ source: "STORE_RETURN_RECEIVE", type: "POSITIVE" });
    expect(Number(adj[0].qtyChange)).toBe(1);
    const buku = await prisma.stockLedgerEntry.findMany({ where: { itemId: seededId(itemId), refId: seededId(adj[0].id) } });
    expect(buku).toHaveLength(1);
    expect(buku[0]).toMatchObject({ locationType: "MAIN", type: "IN", refType: "StockAdjustment", refDocNumber: adj[0].docNumber });
    expect(Number(buku[0].qty)).toBe(1);

    const baris = await prisma.warehouseReturnItem.findMany({
      where: { warehouseReturnId: seededId(h.id) },
      select: { id: true, condition: true },
    });
    const rusak = await prisma.damagedStockMovement.findMany({
      where: { refType: "WarehouseReturnItem", refId: { in: seededIds(baris.map((b) => b.id)) } },
      select: { refId: true, kind: true, qty: true },
    });
    expect(rusak).toHaveLength(1);
    expect(rusak[0]).toMatchObject({ refId: baris.find((b) => b.condition === "RUSAK")?.id, kind: "MASUK_RETUR", qty: 1 });
  });

  it("tanpa opname sesudah nota keluar dari buku toko, susulan tidak menulis buku toko", async () => {
    await barangKatalog();
    const nrtId = await notaBerbarang(4, 1, 3);
    const h = await susulanBarang(nrtId, [{ qty: 2 }]);
    if (!h.ok) throw new Error(`susulan gagal: ${h.alasan}`);
    expect(h.barisBukuToko).toBe(0);
    expect(await bukuSusulan(h.id)).toHaveLength(0);
  });

  it("opname tambah sesudah nota keluar: susulan dikeluarkan lagi sebatas kelebihannya, susulan kedua hanya sisanya, opname sebelumnya diabaikan", async () => {
    await barangKatalog();
    // Kelebihan opname SEBELUM nota keluar dari buku bukan barang ini.
    await opnameTambah(5, 4);
    const nrtId = await notaBerbarang(4, 1, 3);
    await opnameTambah(2, 1);

    const a = await susulanBarang(nrtId, [{ qty: 1 }]);
    if (!a.ok) throw new Error(`susulan pertama gagal: ${a.alasan}`);
    expect(a.barisBukuToko).toBe(1);
    expect((await bukuSusulan(a.id)).map((m) => m.qty)).toEqual([-1]);

    // Kelebihannya 2 dan susulan pertama sudah memakai 1: yang kedua (2 potong) hanya boleh 1.
    const b = await susulanBarang(nrtId, [{ qty: 2 }]);
    if (!b.ok) throw new Error(`susulan kedua gagal: ${b.alasan}`);
    expect((await bukuSusulan(b.id)).map((m) => m.qty)).toEqual([-1]);
    expect(b.sisaSelisih).toBe(0);
  });

  it("lepas susulan membalik koreksi buku tokonya tanpa menghapus barisnya", async () => {
    await barangKatalog();
    const nrtId = await notaBerbarang(4, 1, 3);
    await opnameTambah(2, 1);
    const a = await susulanBarang(nrtId, [{ qty: 1 }]);
    if (!a.ok) throw new Error(`susulan gagal: ${a.alasan}`);
    expect((await lepasSusulan({ warehouseReturnId: a.id, olehUserId: keuanganId })).ok).toBe(true);
    expect((await bukuSusulan(a.id)).map((m) => m.qty).sort((x, y) => x - y)).toEqual([-1, 1]);
    // Selisihnya kembali utuh: 4 diklaim, 1 dihitung.
    expect(Number((await bebanNota(nrtId))?.amount)).toBe(300_000);
  });
});

describe("balapan — penjaganya di dalam runSerializable", () => {
  it("laporan sales dan keputusan beban bersamaan: laporan tidak pernah tercatat sesudah keputusan", async () => {
    for (let putaran = 0; putaran < 3; putaran += 1) {
      const { nrtId, chargeId } = await notaBerselisih();
      const [lapor] = await Promise.all([
        laporHasilCekSelisih({ chargeId, hasil: "DITEMUKAN", olehUserId: pemegangId }),
        sebentar().then(() => putuskanBeban({ chargeId, bearer: "PERUSAHAAN", alasan: "balapan", olehUserId: keuanganId })),
      ]);
      const b = await bebanNota(nrtId);
      expect(b?.status).toBe("DITETAPKAN");
      if (lapor.ok) expect((b?.checkedAt as Date).getTime()).toBeLessThanOrEqual((b?.decidedAt as Date).getTime());
      else expect(lapor).toEqual({ ok: false, alasan: "SUDAH_DIPUTUSKAN" });
    }
  });

  it("dua susulan bersamaan pada satu nota: besar beban = klaim − seluruh fisik yang tercatat", async () => {
    for (let putaran = 0; putaran < 3; putaran += 1) {
      const { nrtId } = await notaBerselisih();
      await Promise.all([susulan(nrtId, 30_000), sebentar().then(() => susulan(nrtId, 40_000))]);
      expect(Number((await bebanNota(nrtId))?.amount)).toBe(300_000 - 100_000 - (await fisikSusulan(nrtId)));
    }
  });

  it("susulan dan keputusan beban bersamaan: besarnya tetap klaim − fisik, siapa pun yang menang", async () => {
    for (let putaran = 0; putaran < 3; putaran += 1) {
      const { nrtId, chargeId } = await notaBerselisih();
      await Promise.all([
        susulan(nrtId, 60_000),
        sebentar().then(() => putuskanBeban({ chargeId, bearer: "GUDANG", alasan: "balapan", olehUserId: keuanganId })),
      ]);
      const tercatat = await prisma.warehouseReturn.count({ where: { followUpOfStoreReturnId: seededId(nrtId), status: "FINAL" } });
      expect(Number((await bebanNota(nrtId))?.amount)).toBe(tercatat > 0 ? 140_000 : 200_000);
    }
  });

  it("jadikanSusulan dan catatHitunganSusulan bersamaan pada satu nota: besar beban = klaim − seluruh fisik yang terpasang", async () => {
    for (let putaran = 0; putaran < 3; putaran += 1) {
      const { nrtId } = await notaBerselisih();
      const nriId = await yatim(80_000);
      const [, jadi] = await Promise.all([
        susulan(nrtId, 60_000),
        // `jadikanSusulan` tidak menulis NRI dan stok — lebih pendek, dimulai belakangan.
        sebentar().then(() => jadikanSusulan({ warehouseReturnId: nriId, storeReturnId: nrtId, olehUserId: keuanganId })),
      ]);
      const sesudah = await prisma.warehouseReturn.findUniqueOrThrow({
        where: { id: seededId(nriId) },
        select: { followUpOfStoreReturnId: true, storeReturnId: true },
      });
      expect(sesudah).toEqual({ followUpOfStoreReturnId: jadi.ok ? nrtId : null, storeReturnId: null });
      expect(Number((await bebanNota(nrtId))?.amount)).toBe(300_000 - 100_000 - (await fisikSusulan(nrtId)));
    }
  });

  it("jadikanSusulan dan jodohkanRetur atas penerimaan tanpa nota yang sama: tepat satu yang menang", async () => {
    for (let putaran = 0; putaran < 3; putaran += 1) {
      const { nrtId: berselisih } = await notaBerselisih();
      const belum = await notaBelumDihitung();
      const nriId = await yatim(80_000);
      const [jadi, jodoh] = await Promise.all([
        jadikanSusulan({ warehouseReturnId: nriId, storeReturnId: berselisih, olehUserId: keuanganId }),
        sebentar().then(() => jodohkanRetur({ warehouseReturnId: nriId, storeReturnId: belum, olehUserId: keuanganId })),
      ]);
      expect([jadi.ok, jodoh.ok].filter(Boolean)).toHaveLength(1);
      expect(jadi.ok ? jodoh : jadi).toEqual({ ok: false, alasan: "BUKAN_YATIM" });
      const nri = await prisma.warehouseReturn.findUniqueOrThrow({
        where: { id: seededId(nriId) },
        select: { followUpOfStoreReturnId: true, storeReturnId: true },
      });
      // Penerimaannya terpasang di tepat satu nota, dengan satu cara.
      expect(nri).toEqual(
        jadi.ok ? { followUpOfStoreReturnId: berselisih, storeReturnId: null } : { followUpOfStoreReturnId: null, storeReturnId: belum },
      );
      expect(Number((await bebanNota(berselisih))?.amount)).toBe(jadi.ok ? 120_000 : 200_000);
    }
  });

  it("lepasSusulan dan keputusan beban bersamaan: susulan terlepas hanya kalau bebannya belum diputuskan saat itu", async () => {
    for (let putaran = 0; putaran < 3; putaran += 1) {
      const { nrtId, chargeId } = await notaBerselisih();
      const h = await susulan(nrtId, 50_000);
      if (!h.ok) throw new Error("susulan harus tercatat");
      const [lepas, putus] = await Promise.all([
        lepasSusulan({ warehouseReturnId: h.id, olehUserId: keuanganId }),
        sebentar().then(() => putuskanBeban({ chargeId, bearer: "PERUSAHAAN", alasan: "balapan", olehUserId: keuanganId })),
      ]);
      expect(putus.ok).toBe(true);
      if (!lepas.ok) expect(["BEBAN_SUDAH_DIPUTUSKAN", "BEBAN_BERUBAH"]).toContain(lepas.alasan);
      const terpasang = await prisma.warehouseReturn.count({ where: { followUpOfStoreReturnId: seededId(nrtId), status: "FINAL" } });
      expect(terpasang).toBe(lepas.ok ? 0 : 1);
      const b = await bebanNota(nrtId);
      expect(b?.status).toBe("DITETAPKAN");
      expect(Number(b?.amount)).toBe(lepas.ok ? 200_000 : 150_000);
    }
  });

  it("dua lepasSusulan bersamaan atas susulan yang sama: tepat satu yang melepas", async () => {
    for (let putaran = 0; putaran < 3; putaran += 1) {
      const { nrtId } = await notaBerselisih();
      const h = await susulan(nrtId, 50_000);
      if (!h.ok) throw new Error("susulan harus tercatat");
      const hasil = await Promise.all([
        lepasSusulan({ warehouseReturnId: h.id, olehUserId: keuanganId }),
        sebentar().then(() => lepasSusulan({ warehouseReturnId: h.id, olehUserId: keuanganId })),
      ]);
      expect(hasil.filter((x) => x.ok)).toHaveLength(1);
      expect(hasil.find((x) => !x.ok)).toEqual({ ok: false, alasan: "BUKAN_YATIM" });
      expect(Number((await bebanNota(nrtId))?.amount)).toBe(200_000);
    }
  });

  it("alihkanBeban dan potongan komisi bersamaan: tepat satu yang menang, tidak ada potongan pada beban yang bukan lagi milik sales", async () => {
    for (let putaran = 0; putaran < 3; putaran += 1) {
      const salesId = await salesBaru();
      const { nrtId, chargeId } = await notaBerselisih();
      expect(
        (await putuskanBeban({ chargeId, bearer: "SALES", bearerUserId: salesId, alasan: "tidak ketemu", olehUserId: keuanganId })).ok,
      ).toBe(true);
      const [alih, potong] = await Promise.all([
        alihkanBeban({ chargeId, bearer: "PERUSAHAAN", alasan: "balapan", olehUserId: keuanganId }),
        sebentar().then(() =>
          tandaiBebanReturDipotong({ salesmanId: salesId, bulan: "2026-10", jumlah: 50_000, kunci: `${tag}-alih-${putaran}`, olehUserId: keuanganId }),
        ),
      ]);
      expect([alih.ok, potong.ok].filter(Boolean)).toHaveLength(1);
      const b = await bebanNota(nrtId);
      expect(Number(b?.settledAmount)).toBe(await totalPotongan(chargeId));
      if (alih.ok) {
        expect(b).toMatchObject({ bearer: "PERUSAHAAN" });
        expect(Number(b?.settledAmount)).toBe(0);
        expect(["TIDAK_ADA_BEBAN", "BERUBAH"]).toContain(potong.ok ? "" : potong.kode);
      } else {
        expect(b).toMatchObject({ bearer: "SALES", bearerUserId: salesId });
        expect(Number(b?.settledAmount)).toBe(50_000);
        expect(["SUDAH_DIPOTONG", "BEBAN_BERUBAH"]).toContain(alih.alasan);
      }
    }
  });

  it("susulan dan potongan komisi bersamaan: yang dipotong tidak pernah melebihi bebannya, dan susulan ditolak sesudah ada potongan", async () => {
    for (let putaran = 0; putaran < 3; putaran += 1) {
      const salesId = await salesBaru();
      const { nrtId, chargeId } = await notaBerselisih();
      expect(
        (await putuskanBeban({ chargeId, bearer: "SALES", bearerUserId: salesId, alasan: "tidak ketemu", olehUserId: keuanganId })).ok,
      ).toBe(true);
      const [sus, potong] = await Promise.all([
        susulan(nrtId, 60_000),
        // Potongannya lebih pendek dari hitungan susulan: dimulai belakangan.
        sebentar().then(() =>
          tandaiBebanReturDipotong({ salesmanId: salesId, bulan: "2026-10", jumlah: 50_000, kunci: `${tag}-sus-${putaran}`, olehUserId: keuanganId }),
        ),
      ]);
      expect(potong.ok).toBe(true);
      const b = await bebanNota(nrtId);
      const amount = Number(b?.amount);
      const settled = Number(b?.settledAmount);
      expect(settled).toBe(await totalPotongan(chargeId));
      expect(settled).toBe(50_000);
      expect(settled).toBeLessThanOrEqual(amount);
      expect(amount).toBe(300_000 - 100_000 - (await fisikSusulan(nrtId)));
      if (sus.ok) expect(amount).toBe(140_000);
      else expect(["SUDAH_DIPOTONG", "BEBAN_BERUBAH"]).toContain(sus.alasan);
    }
  });
});
