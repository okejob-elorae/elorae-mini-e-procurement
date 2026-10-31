import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { setAccountMapping } from "@/lib/finance/journals/mapping";
import type { PostingRole } from "@/lib/constants/journal-roles";
import type { AccountType } from "@/lib/constants/enums";
import { idBayar, idFee, SUMBER_KOL } from "./jurnal-kol-aturan";
import { postJurnalSampelKol, sinkronJurnalKolaborasi } from "./jurnal-kol";
import { aturTermin, bayarTermin, batalkanBayarTermin, selaraskanTermin } from "./termin-writer";

/*
 * Jurnal Ruang KOL terhadap basis data sungguhan, satu per jenis: pengakuan
 * fee saat tayang, pembayaran termin sesudah tayang, uang muka sebelum tayang
 * lalu reklasifikasi, pembalik pembayaran yang dibatalkan, PPh 23 untuk
 * badan, sampel berangkat, dan kolaborasi di luar buku.
 *
 * Pemetaan akun di basis data bersama TIDAK ditimpa: peran yang sudah
 * dipetakan dipakai apa adanya (beberapa peran boleh menunjuk akun yang sama,
 * jadi baris diperiksa lewat memo perannya, bukan akunnya). Peran yang belum
 * dipetakan diberi akun uji, dan pemetaan itu dihapus lagi HANYA bila masih
 * menunjuk akun uji tersebut.
 */

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3306") || url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

const PERAN: [PostingRole, AccountType][] = [
  ["KOL_EXPENSE", "BEBAN"],
  ["KOL_PAYABLE", "LIABILITAS"],
  ["KOL_PREPAID", "ASET"],
  ["PPH21_PAYABLE", "LIABILITAS"],
  ["PPH23_PAYABLE", "LIABILITAS"],
  ["BANK", "ASET"],
  ["INVENTORY", "ASET"],
  ["INVENTORY_FG", "ASET"],
];

const tag = `JKOL${Math.floor(Math.random() * 1e7)}`;
let userId = "";
let kolId = "";
let uomId = "";
let itemId = "";
let bahanId = "";
let kolabIds: string[] = [];
let pengirimanIds: string[] = [];
const akunUji: Record<string, string> = {};

type Baris = { memo: string | null; debit: number; credit: number };
async function jurnal(sourceType: string, sourceId: string): Promise<{ date: Date; baris: Baris[] } | null> {
  const j = await prisma.journal.findUnique({
    where: { sourceType_sourceId: { sourceType, sourceId } },
    select: { date: true, lines: { select: { memo: true, debit: true, credit: true, chartAccountId: true } } },
  });
  return j ? { date: j.date, baris: j.lines.map((l) => ({ memo: l.memo, debit: Number(l.debit), credit: Number(l.credit) })) } : null;
}
const urut = (b: Baris[]) => [...b].sort((x, y) => `${x.memo}${x.debit}`.localeCompare(`${y.memo}${y.debit}`));

d("jurnal Ruang KOL (basis data uji)", () => {
  beforeAll(async () => {
    for (const [i, [peran, tipe]] of PERAN.entries()) {
      const ada = await prisma.journalAccountMapping.findUnique({ where: { role: peran }, select: { id: true } });
      if (ada) continue;
      const akun = await prisma.chartAccount.create({ data: { code: `9${tag.slice(4)}${i}`, name: `${peran} (uji KOL)`, type: tipe, depth: 1, isActive: true } });
      akunUji[peran] = akun.id;
      await setAccountMapping(peran, akun.id);
    }
    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    itemId = (
      await prisma.item.create({ data: { sku: `${tag}-SKU`, nameId: "Kaos uji KOL", nameEn: "Test tee", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 150_000 } })
    ).id;
    bahanId = (await prisma.item.create({ data: { sku: `${tag}-KAIN`, nameId: "Kain uji KOL", nameEn: "Test fabric", type: "FABRIC", uomId, isActive: true } })).id;
  }, 60_000);

  afterAll(async () => {
    for (const [peran, akun] of Object.entries(akunUji)) {
      // Hanya pemetaan buatan tes ini — bila orang lain sudah memetakannya ulang, biarkan.
      await prisma.journalAccountMapping.deleteMany({ where: { role: seededId(peran), chartAccountId: seededId(akun) } });
    }
    await prisma.chartAccount.deleteMany({ where: { id: { in: seededIds(Object.values(akunUji)) } } });
    await prisma.item.deleteMany({ where: { id: { in: seededIds([itemId, bahanId].filter(Boolean)) } } });
    if (uomId) await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  beforeEach(async () => {
    userId = "";
    kolId = "";
    kolabIds = [];
    pengirimanIds = [];
    userId = (await prisma.user.findFirstOrThrow({ select: { id: true } })).id;
    kolId = (await prisma.kol.create({ data: { name: `${tag} KOL`, adaNpwp: true }, select: { id: true } })).id;
  });

  afterEach(async () => {
    const jurnalIds = (
      await prisma.journal.findMany({
        where: {
          OR: [
            ...seededIds(kolabIds).map((id) => ({ sourceType: { in: [SUMBER_KOL.FEE, SUMBER_KOL.BAYAR, SUMBER_KOL.BALIK] }, sourceId: { startsWith: `${id}#` } })),
            { sourceType: SUMBER_KOL.SAMPEL, sourceId: { in: seededIds(pengirimanIds) } },
          ],
        },
        select: { id: true },
      })
    ).map((j) => j.id);
    await prisma.journalLine.deleteMany({ where: { journalId: { in: seededIds(jurnalIds) } } });
    await prisma.journal.deleteMany({ where: { id: { in: seededIds(jurnalIds) } } });
    await prisma.kolShipmentLine.deleteMany({ where: { shipmentId: { in: seededIds(pengirimanIds) } } });
    await prisma.kolShipment.deleteMany({ where: { id: { in: seededIds(pengirimanIds) } } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: seededIds([...kolabIds, kolId].filter(Boolean)) } } });
    await prisma.kolPaymentTerm.deleteMany({ where: { collabId: { in: seededIds(kolabIds) } } });
    await prisma.kolBrief.deleteMany({ where: { id: { in: seededIds(kolabIds) } } });
    if (kolId) await prisma.kol.delete({ where: { id: seededId(kolId) } });
  });

  async function kolaborasi(akhiran: string, data: { fee: number; tahap: "DEAL" | "TAYANG"; jurnalOtomatis?: boolean }) {
    const c = await prisma.kolBrief.create({
      data: {
        docNo: `${tag}/${akhiran}`,
        kolId,
        fee: data.fee,
        tahap: data.tahap,
        dealAt: new Date(),
        liveAt: data.tahap === "TAYANG" ? new Date("2026-10-01T03:00:00Z") : null,
        payStatus: "BELUM",
        jurnalOtomatis: data.jurnalOtomatis ?? true,
      },
      select: { id: true },
    });
    kolabIds.push(c.id);
    await runSerializable((tx) => selaraskanTermin(tx, { kolaborasiId: c.id, olehUserId: userId, sebab: "uji" }));
    return c.id;
  }

  it("pengakuan fee saat tayang lalu pembayaran sesudah tayang (PPh 21)", async () => {
    const id = await kolaborasi("tayang", { fee: 10_000_000, tahap: "TAYANG" });
    const r1 = await sinkronJurnalKolaborasi(id, userId);
    expect(r1).toMatchObject({ ok: true, diposting: 1, gagal: [] });
    const fee = await jurnal(SUMBER_KOL.FEE, idFee(id, 1));
    expect(urut(fee!.baris)).toEqual(
      urut([
        { memo: "KOL_EXPENSE", debit: 10_000_000, credit: 0 },
        { memo: "KOL_PAYABLE", debit: 0, credit: 10_000_000 },
      ]),
    );
    expect(fee!.date.toISOString()).toBe("2026-10-01T03:00:00.000Z");

    const [t] = await prisma.kolPaymentTerm.findMany({ where: { collabId: id } });
    await bayarTermin({ terminId: t.id, tanggal: "2026-10-05", olehUserId: userId });
    expect(await sinkronJurnalKolaborasi(id, userId)).toMatchObject({ ok: true, diposting: 1 });
    const bayar = await jurnal(SUMBER_KOL.BAYAR, idBayar(id, t.id, 1));
    expect(urut(bayar!.baris)).toEqual(
      urut([
        { memo: "KOL_PAYABLE", debit: 10_000_000, credit: 0 },
        { memo: "BANK", debit: 0, credit: 9_750_000 },
        { memo: "PPH21_PAYABLE", debit: 0, credit: 250_000 },
      ]),
    );
    // Idempoten: sinkron ulang tidak memposting apa pun.
    expect(await sinkronJurnalKolaborasi(id, userId)).toMatchObject({ ok: true, diposting: 0 });
  });

  it("termin dibayar sebelum tayang = uang muka, direklasifikasi saat fee diakui", async () => {
    const id = await kolaborasi("dp", { fee: 10_000_000, tahap: "DEAL" });
    await aturTermin({
      kolaborasiId: id,
      dasar: "PERSEN",
      rencana: [
        { label: "DP", persen: 50, pemicu: "DEAL" },
        { label: "Pelunasan", persen: 50, pemicu: "TAYANG", hariSesudah: 14 },
      ],
      olehUserId: userId,
    });
    const [dp] = await prisma.kolPaymentTerm.findMany({ where: { collabId: id }, orderBy: { urutan: "asc" } });
    await bayarTermin({ terminId: dp.id, tanggal: "2026-10-02", olehUserId: userId });
    expect(await sinkronJurnalKolaborasi(id, userId)).toMatchObject({ ok: true, diposting: 1 });
    expect(urut((await jurnal(SUMBER_KOL.BAYAR, idBayar(id, dp.id, 1)))!.baris)).toEqual(
      urut([
        { memo: "KOL_PREPAID", debit: 5_000_000, credit: 0 },
        { memo: "BANK", debit: 0, credit: 4_875_000 },
        { memo: "PPH21_PAYABLE", debit: 0, credit: 125_000 },
      ]),
    );
    expect(await jurnal(SUMBER_KOL.FEE, idFee(id, 1))).toBeNull();

    await prisma.kolBrief.update({ where: { id }, data: { tahap: "TAYANG", liveAt: new Date() } });
    expect(await sinkronJurnalKolaborasi(id, userId)).toMatchObject({ ok: true, diposting: 1 });
    expect(urut((await jurnal(SUMBER_KOL.FEE, idFee(id, 1)))!.baris)).toEqual(
      urut([
        { memo: "KOL_EXPENSE", debit: 10_000_000, credit: 0 },
        { memo: "KOL_PAYABLE", debit: 0, credit: 10_000_000 },
        { memo: "KOL_PAYABLE", debit: 5_000_000, credit: 0 },
        { memo: "KOL_PREPAID", debit: 0, credit: 5_000_000 },
      ]),
    );

    // Dimundurkan dari tayang: pengakuan dibalik dan uang muka dikembalikan (penyesuaian #2).
    await prisma.kolBrief.update({ where: { id }, data: { tahap: "DRAF" } });
    await sinkronJurnalKolaborasi(id, userId);
    expect(urut((await jurnal(SUMBER_KOL.FEE, idFee(id, 2)))!.baris)).toEqual(
      urut([
        { memo: "KOL_PAYABLE", debit: 10_000_000, credit: 0 },
        { memo: "KOL_EXPENSE", debit: 0, credit: 10_000_000 },
        { memo: "KOL_PREPAID", debit: 5_000_000, credit: 0 },
        { memo: "KOL_PAYABLE", debit: 0, credit: 5_000_000 },
      ]),
    );
  });

  it("pembayaran yang dibatalkan dibalik dengan cermin jurnal aslinya, bertanggal sama", async () => {
    const id = await kolaborasi("balik", { fee: 2_000_000, tahap: "TAYANG" });
    const [t] = await prisma.kolPaymentTerm.findMany({ where: { collabId: id } });
    await bayarTermin({ terminId: t.id, tanggal: "2026-10-03", olehUserId: userId });
    await sinkronJurnalKolaborasi(id, userId);
    await batalkanBayarTermin({ terminId: t.id, alasan: "Salah catat", olehUserId: userId });
    expect(await sinkronJurnalKolaborasi(id, userId)).toMatchObject({ ok: true, diposting: 1 });
    const asli = await jurnal(SUMBER_KOL.BAYAR, idBayar(id, t.id, 1));
    const balik = await jurnal(SUMBER_KOL.BALIK, idBayar(id, t.id, 1));
    expect(balik!.date.toISOString()).toBe(asli!.date.toISOString());
    expect(urut(balik!.baris)).toEqual(urut(asli!.baris.map((b) => ({ memo: b.memo, debit: b.credit, credit: b.debit }))));

    // Dibayar lagi: instans kedua berjurnal sendiri.
    await bayarTermin({ terminId: t.id, tanggal: "2026-10-04", olehUserId: userId });
    await sinkronJurnalKolaborasi(id, userId);
    expect(await jurnal(SUMBER_KOL.BAYAR, idBayar(id, t.id, 2))).not.toBeNull();
  });

  it("KOL berbadan: PPh 23 ke Hutang PPh 23", async () => {
    await prisma.kol.update({ where: { id: kolId }, data: { jenisPajak: "BADAN" } });
    const id = await kolaborasi("badan", { fee: 5_000_000, tahap: "TAYANG" });
    const [t] = await prisma.kolPaymentTerm.findMany({ where: { collabId: id } });
    await bayarTermin({ terminId: t.id, tanggal: "2026-10-03", olehUserId: userId });
    await sinkronJurnalKolaborasi(id, userId);
    expect(urut((await jurnal(SUMBER_KOL.BAYAR, idBayar(id, t.id, 1)))!.baris)).toEqual(
      urut([
        { memo: "KOL_PAYABLE", debit: 5_000_000, credit: 0 },
        { memo: "BANK", debit: 0, credit: 4_900_000 },
        { memo: "PPH23_PAYABLE", debit: 0, credit: 100_000 },
      ]),
    );
  });

  it("kolaborasi di luar buku (jurnalOtomatis = false) tidak dijurnal", async () => {
    const id = await kolaborasi("luar", { fee: 1_000_000, tahap: "TAYANG", jurnalOtomatis: false });
    expect(await sinkronJurnalKolaborasi(id, userId)).toEqual({ ok: true, dilewati: "TANPA_JURNAL_OTOMATIS", diposting: 0, gagal: [] });
    expect(await jurnal(SUMBER_KOL.FEE, idFee(id, 1))).toBeNull();
  });

  it("sampel barang jadi berangkat: DR Beban KOL / CR Persediaan barang jadi sebesar Σ HPP × qty", async () => {
    const id = await kolaborasi("sampel", { fee: 0, tahap: "DEAL" });
    const p = await prisma.kolShipment.create({
      data: {
        collabId: id,
        trackingNo: `${tag}RESI`,
        sentAt: new Date("2026-10-04T02:00:00Z"),
        stockIssuedAt: new Date("2026-10-04T02:00:00Z"),
        lines: {
          create: [
            { itemId, itemName: "Kaos uji", variantSku: `${tag}-S`, qty: 2, unitCost: 45_000.5 },
            { itemId, itemName: "Kaos uji", variantSku: `${tag}-M`, qty: 1, unitCost: 50_000 },
          ],
        },
      },
      select: { id: true },
    });
    pengirimanIds.push(p.id);
    expect(await postJurnalSampelKol(p.id, userId)).toMatchObject({ ok: true, diposting: 1 });
    const j = await jurnal(SUMBER_KOL.SAMPEL, p.id);
    expect(urut(j!.baris)).toEqual(
      urut([
        { memo: "KOL_EXPENSE", debit: 140_001, credit: 0 },
        { memo: "INVENTORY_FG", debit: 0, credit: 140_001 },
      ]),
    );
    expect(j!.date.toISOString()).toBe("2026-10-04T02:00:00.000Z");
    expect(await postJurnalSampelKol(p.id, userId)).toMatchObject({ ok: true, diposting: 0 });
  });

  it("sampel campuran: barang jadi ke Persediaan barang jadi, bahan ke Persediaan", async () => {
    const id = await kolaborasi("campur", { fee: 0, tahap: "DEAL" });
    const p = await prisma.kolShipment.create({
      data: {
        collabId: id,
        sentAt: new Date("2026-10-04T02:00:00Z"),
        stockIssuedAt: new Date("2026-10-04T02:00:00Z"),
        lines: {
          create: [
            { itemId, itemName: "Kaos uji", variantSku: `${tag}-L`, qty: 1, unitCost: 60_000 },
            { itemId: bahanId, itemName: "Kain uji", qty: 2, unitCost: 12_500 },
          ],
        },
      },
      select: { id: true },
    });
    pengirimanIds.push(p.id);
    await postJurnalSampelKol(p.id, userId);
    expect(urut((await jurnal(SUMBER_KOL.SAMPEL, p.id))!.baris)).toEqual(
      urut([
        { memo: "KOL_EXPENSE", debit: 85_000, credit: 0 },
        { memo: "INVENTORY_FG", debit: 0, credit: 60_000 },
        { memo: "INVENTORY", debit: 0, credit: 25_000 },
      ]),
    );
  });
});
