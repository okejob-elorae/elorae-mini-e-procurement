import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { JEJAK_SALDO_AWAL, JENIS_SALDO_AWAL, SUMBER_JURNAL_SALDO_AWAL, idSumberBalik, kunciJenis } from "./jenis";
import { hapusDrafSaldoAwal, postingSaldoAwal, simpanDrafSaldoAwal, type OpsiUjiSaldoAwal } from "./writer";
import { bacaKeadaanSaldoAwal } from "./queries";

/*
 * Penulis saldo awal terhadap basis data uji. Pemetaan peran TIDAK disentuh:
 * `resolveAccount` dipalsukan ke akun milik tes, jadi 32 peran baru tidak
 * pernah tertinggal terpetakan. Jenis memakai ruang nama tes (`kunciJenis`),
 * jadi saldo awal sungguhan (bila ada) tidak pernah ikut dibalik. Tanggal di
 * 2091 — tidak ada periode tertutup di sana; tes kunci periode memakai 2002.
 */

const peta = vi.hoisted(() => new Map<string, string>());
vi.mock("@/lib/finance/journals/mapping", async (asli) => {
  const m = await asli<typeof import("@/lib/finance/journals/mapping")>();
  return {
    ...m,
    resolveAccount: vi.fn(async (role: string) => {
      const id = peta.get(role);
      if (!id) throw new m.UnmappedRoleError(role);
      return id;
    }),
  };
});

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3306") || url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const MULAI = new Date("2091-03-01T00:00:00.000+07:00");

d("postingSaldoAwal (basis data uji)", () => {
  let token = "";
  let ruang = "";
  let userId = "";
  let akun: Record<string, string> = {};
  let indukId = "";
  let uomId = "";
  let itemFgId = "";
  let itemKainId = "";
  let periodeId = "";

  const uji = (lain: Partial<OpsiUjiSaldoAwal> = {}): OpsiUjiSaldoAwal => ({ ruang, tanggalMulai: MULAI, ...lain });

  async function saldo(akunId: string): Promise<number> {
    const a = await prisma.journalLine.aggregate({
      where: { chartAccountId: akunId, journal: { postedById: userId } },
      _sum: { debit: true, credit: true },
    });
    return Math.round((Number(a._sum.debit ?? 0) - Number(a._sum.credit ?? 0)) * 100) / 100;
  }

  beforeEach(async () => {
    token = "";
    ruang = "";
    userId = "";
    akun = {};
    indukId = "";
    uomId = "";
    itemFgId = "";
    itemKainId = "";
    periodeId = "";
    peta.clear();

    token = Math.floor(Math.random() * 1e6).toString().padStart(6, "0");
    ruang = `uji-saldo-awal-${token}`;
    userId = (await prisma.user.create({ data: { email: `saldo-awal-${token}@test.local`, name: "Uji saldo awal" } })).id;
    const buat = async (n: string, nama: string, type: "ASET" | "LIABILITAS" | "EKUITAS" | "BEBAN") =>
      (await prisma.chartAccount.create({ data: { code: `95${token}${n}`, name: `${nama} (uji)`, type, depth: 1 } })).id;
    akun = {
      kas: await buat("01", "Kas", "ASET"),
      alat: await buat("02", "Peralatan", "ASET"),
      modal: await buat("03", "Modal", "EKUITAS"),
      ekuitasAwal: await buat("04", "Ekuitas saldo awal", "EKUITAS"),
      bahan: await buat("05", "Persediaan bahan", "ASET"),
      fg: await buat("06", "Persediaan barang jadi", "ASET"),
      beban: await buat("07", "Beban", "BEBAN"),
    };
    indukId = await buat("08", "Induk", "ASET");
    akun.anak = (
      await prisma.chartAccount.create({ data: { code: `95${token}0801`, name: "Anak (uji)", type: "ASET", depth: 2, parentId: indukId } })
    ).id;
    peta.set("OPENING_EQUITY", akun.ekuitasAwal);
    peta.set("INVENTORY", akun.bahan);
    peta.set("INVENTORY_FG", akun.fg);

    uomId = (await prisma.uOM.create({ data: { code: `U-SA-${token}`, nameId: "pcs", nameEn: "pcs" } })).id;
    itemFgId = (await prisma.item.create({ data: { sku: `SA-${token}-GMS`, nameId: "Gamis uji", nameEn: "Gamis", type: "FINISHED_GOOD", uomId } })).id;
    itemKainId = (await prisma.item.create({ data: { sku: `SA-${token}-KN`, nameId: "Kain uji", nameEn: "Fabric", type: "FABRIC", uomId } })).id;
    await prisma.inventoryValue.create({ data: { itemId: itemFgId, variantSku: `SA-${token}-GMS-S`, qtyOnHand: 10 } });
    await prisma.inventoryValue.create({ data: { itemId: itemFgId, variantSku: `SA-${token}-GMS-M`, qtyOnHand: 4, avgCost: 1000, totalValue: 4000 } });
    await prisma.inventoryValue.create({ data: { itemId: itemKainId, variantSku: null, qtyOnHand: 2.5 } });
  });

  afterEach(async () => {
    const kinds = JENIS_SALDO_AWAL.map((j) => kunciJenis(j, ruang || "tanpa-ruang"));
    const jurnal = await prisma.journal.findMany({ where: { postedById: seededId(userId) }, select: { id: true } });
    await prisma.journal.deleteMany({ where: { id: { in: seededIds(jurnal.map((j) => j.id)) } } });
    await prisma.openingBalanceImport.deleteMany({ where: { kind: { in: seededIds(kinds) } } });
    await prisma.auditLog.deleteMany({ where: { userId: seededId(userId) } });
    if (periodeId) await prisma.accountingPeriod.delete({ where: { id: seededId(periodeId) } });
    await prisma.stockLedgerEntry.deleteMany({ where: { itemId: { in: [seededId(itemFgId), seededId(itemKainId)] } } });
    await prisma.inventoryValue.deleteMany({ where: { itemId: { in: [seededId(itemFgId), seededId(itemKainId)] } } });
    await prisma.item.deleteMany({ where: { id: { in: [seededId(itemFgId), seededId(itemKainId)] } } });
    if (uomId) await prisma.uOM.delete({ where: { id: seededId(uomId) } });
    if (akun.anak) await prisma.chartAccount.delete({ where: { id: seededId(akun.anak) } });
    await prisma.chartAccount.deleteMany({ where: { id: { in: seededIds([...Object.values(akun), indukId].filter(Boolean)) } } });
    if (userId) await prisma.user.delete({ where: { id: seededId(userId) } });
  });

  it("saldo akun: jurnal OPENING sehari sebelum tanggal mulai, lawan Ekuitas saldo awal, berjejak", async () => {
    const r = await postingSaldoAwal({
      jenis: "ACCOUNTS",
      baris: [
        { akunId: akun.kas, debit: 5_000_000, kredit: 0 },
        { akunId: akun.alat, debit: 12_000_000, kredit: 0 },
        { akunId: akun.modal, debit: 0, kredit: 10_000_000 },
      ],
      olehUserId: userId,
      uji: uji(),
    });
    expect(r).toMatchObject({ ok: true, ekuitas: 7_000_000, jurnalBalikId: null });
    if (!r.ok) return;
    const j = await prisma.journal.findUniqueOrThrow({ where: { id: r.journalId! }, include: { lines: true } });
    expect(j.sourceType).toBe(SUMBER_JURNAL_SALDO_AWAL);
    expect(j.sourceId).toBe(r.importId);
    expect(j.date.toISOString()).toBe(new Date("2091-02-28T00:00:00.000+07:00").toISOString());
    expect(j.description).toContain("OPENING/AKUN/2091-03-01");
    expect(await saldo(akun.ekuitasAwal)).toBe(-7_000_000);
    expect(await saldo(akun.kas)).toBe(5_000_000);
    const rec = await prisma.openingBalanceImport.findUniqueOrThrow({ where: { id: r.importId } });
    expect(rec).toMatchObject({ status: "POSTED", journalId: j.id, kind: kunciJenis("ACCOUNTS", ruang), postedById: userId });
    expect(Number(rec.totalAmount)).toBe(7_000_000);
    expect(await prisma.auditLog.count({ where: { userId, action: JEJAK_SALDO_AWAL.DIPOSTING, entityId: r.importId } })).toBe(1);
  });

  it("posting ulang membalik jurnal lama (tanggal sama, reversalOfId) lalu memposting yang baru — saldo bersih = posting terakhir", async () => {
    const r1 = await postingSaldoAwal({
      jenis: "ACCOUNTS",
      baris: [
        { akunId: akun.kas, debit: 5_000_000, kredit: 0 },
        { akunId: akun.alat, debit: 12_000_000, kredit: 0 },
      ],
      olehUserId: userId,
      uji: uji(),
    });
    const r2 = await postingSaldoAwal({
      jenis: "ACCOUNTS",
      baris: [{ akunId: akun.kas, debit: 6_000_000, kredit: 0 }],
      catatan: "Kas fisik dihitung ulang",
      olehUserId: userId,
      uji: uji(),
    });
    expect(r1.ok && r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    const balik = await prisma.journal.findUniqueOrThrow({ where: { id: r2.jurnalBalikId! }, include: { lines: true } });
    expect(balik.reversalOfId).toBe(r1.journalId);
    expect(balik.sourceType).toBe(SUMBER_JURNAL_SALDO_AWAL);
    expect(balik.sourceId).toBe(idSumberBalik(r1.importId));
    expect(balik.date.toISOString()).toBe(new Date("2091-02-28T00:00:00.000+07:00").toISOString());
    expect(await saldo(akun.kas)).toBe(6_000_000);
    expect(await saldo(akun.alat)).toBe(0);
    expect(await saldo(akun.ekuitasAwal)).toBe(-6_000_000);
    expect((await prisma.openingBalanceImport.findUniqueOrThrow({ where: { id: r1.importId } })).status).toBe("REVERSED");
    expect(await prisma.openingBalanceImport.count({ where: { kind: kunciJenis("ACCOUNTS", ruang), status: "POSTED" } })).toBe(1);
    const jejak = await prisma.auditLog.findFirstOrThrow({ where: { userId, action: JEJAK_SALDO_AWAL.DIBALIK, entityId: r1.importId } });
    expect(jejak.reason).toBe("Kas fisik dihitung ulang");
  });

  it("saldo akun menolak akun lawan sendiri, akun berturunan, dan akun laba rugi", async () => {
    const coba = (akunId: string) =>
      postingSaldoAwal({ jenis: "ACCOUNTS", baris: [{ akunId, debit: 1000, kredit: 0 }], olehUserId: userId, uji: uji() });
    expect(await coba(akun.ekuitasAwal)).toMatchObject({ ok: false, kode: "AKUN_MILIK_JENIS_LAIN", peran: "OPENING_EQUITY" });
    expect(await coba(indukId)).toMatchObject({ ok: false, kode: "AKUN_TIDAK_SAH" });
    expect(await coba(akun.beban)).toMatchObject({ ok: false, kode: "AKUN_TIDAK_SAH" });
    expect(await prisma.journal.count({ where: { postedById: userId } })).toBe(0);
  });

  it("peran lawan belum dipetakan → PERAN_BELUM_DIPETAKAN, tidak ada yang tertulis", async () => {
    peta.delete("OPENING_EQUITY");
    const r = await postingSaldoAwal({ jenis: "ACCOUNTS", baris: [{ akunId: akun.kas, debit: 1, kredit: 0 }], olehUserId: userId, uji: uji() });
    expect(r).toEqual({ ok: false, kode: "PERAN_BELUM_DIPETAKAN", peran: "OPENING_EQUITY" });
    expect(await prisma.openingBalanceImport.count({ where: { kind: kunciJenis("ACCOUNTS", ruang) } })).toBe(0);
  });

  it("persediaan: mengisi avgCost tanpa mengubah qty; jurnal = selisih nilai stok per peran; posting ulang kumulatif", async () => {
    const r1 = await postingSaldoAwal({
      jenis: "INVENTORY",
      baris: [
        { itemId: itemFgId, variantSku: `SA-${token}-GMS-S`, hpp: 120000 },
        { itemId: itemFgId, variantSku: `SA-${token}-GMS-M`, hpp: 125000 },
        { itemId: itemKainId, variantSku: null, hpp: 27000 },
      ],
      namaBerkas: "hpp.xlsx",
      olehUserId: userId,
      uji: uji(),
    });
    expect(r1).toMatchObject({ ok: true });
    const iv = await prisma.inventoryValue.findMany({ where: { itemId: { in: [itemFgId, itemKainId] } }, orderBy: { variantSku: "asc" } });
    const per = Object.fromEntries(iv.map((v) => [v.variantSku ?? "kain", [Number(v.qtyOnHand), Number(v.avgCost), Number(v.totalValue)]]));
    expect(per).toEqual({
      [`SA-${token}-GMS-M`]: [4, 125000, 500000],
      [`SA-${token}-GMS-S`]: [10, 120000, 1200000],
      kain: [2.5, 27000, 67500],
    });
    // M sudah bernilai 4.000 (dianggap sudah di buku besar) → yang dijurnal hanya selisihnya.
    expect(await saldo(akun.fg)).toBe(1_200_000 + 500_000 - 4_000);
    expect(await saldo(akun.bahan)).toBe(67_500);
    expect(await saldo(akun.ekuitasAwal)).toBe(-(1_696_000 + 67_500));

    const r2 = await postingSaldoAwal({
      jenis: "INVENTORY",
      baris: [{ itemId: itemFgId, variantSku: `SA-${token}-GMS-M`, hpp: 130000 }],
      olehUserId: userId,
      uji: uji(),
    });
    expect(r2).toMatchObject({ ok: true });
    expect(Number((await prisma.inventoryValue.findFirstOrThrow({ where: { itemId: itemFgId, variantSku: `SA-${token}-GMS-M` } })).totalValue)).toBe(520000);
    expect(await saldo(akun.fg)).toBe(1_696_000 + 20_000);
    expect(await saldo(akun.bahan)).toBe(67_500);
    if (r2.ok) {
      const rec = await prisma.openingBalanceImport.findUniqueOrThrow({ where: { id: r2.importId } });
      expect((rec.entries as { ringkasan: { nilaiPerPeran: unknown } }).ringkasan.nilaiPerPeran).toEqual({ INVENTORY: 67500, INVENTORY_FG: 1716000 });
    }

    // Kartu stok ikut dinilai ulang: satu entri qty 0 per baris yang berubah, saldo nilainya
    // sama dengan InventoryValue; baris yang tidak disebut posting ulang tidak mendapat entri.
    const kartu = await prisma.stockLedgerEntry.findMany({
      where: { itemId: { in: [seededId(itemFgId), seededId(itemKainId)] }, locationType: "MAIN" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { variantSku: true, type: true, qty: true, balanceQty: true, totalCost: true, balanceValue: true, refType: true, refId: true },
    });
    const entri = (varian: string) =>
      kartu
        .filter((e) => e.variantSku === varian)
        .map((e) => [e.type, Number(e.qty), Number(e.balanceQty), Number(e.totalCost), Number(e.balanceValue), e.refType, e.refId]);
    expect(kartu).toHaveLength(4);
    if (r1.ok && r2.ok) {
      expect(entri(`SA-${token}-GMS-S`)).toEqual([["ADJUSTMENT", 0, 10, 1_200_000, 1_200_000, "OpeningBalance", r1.importId]]);
      expect(entri(`SA-${token}-GMS-M`)).toEqual([
        ["ADJUSTMENT", 0, 4, 496_000, 500_000, "OpeningBalance", r1.importId],
        ["ADJUSTMENT", 0, 4, 20_000, 520_000, "OpeningBalance", r2.importId],
      ]);
      expect(entri("")).toEqual([["ADJUSTMENT", 0, 2.5, 67_500, 67_500, "OpeningBalance", r1.importId]]);
    }
  });

  it("persediaan: barang yang tidak punya baris stok ditolak tanpa menulis apa pun", async () => {
    const r = await postingSaldoAwal({
      jenis: "INVENTORY",
      baris: [
        { itemId: itemFgId, variantSku: `SA-${token}-GMS-S`, hpp: 1 },
        { itemId: itemFgId, variantSku: `SA-${token}-GMS-XXL`, hpp: 1 },
      ],
      olehUserId: userId,
      uji: uji(),
    });
    expect(r).toMatchObject({ ok: false, kode: "BARANG_TIDAK_DIKENAL" });
    expect(Number((await prisma.inventoryValue.findFirstOrThrow({ where: { itemId: itemFgId, variantSku: `SA-${token}-GMS-S` } })).avgCost)).toBe(0);
  });

  it("draf disimpan lalu menjadi catatan posting yang sama; hapus draf", async () => {
    const draf = await simpanDrafSaldoAwal({
      jenis: "ACCOUNTS",
      baris: [{ akunId: akun.kas, debit: 1000, kredit: 0 }],
      olehUserId: userId,
      uji: uji(),
    });
    expect(draf.ok).toBe(true);
    const lagi = await simpanDrafSaldoAwal({ jenis: "ACCOUNTS", baris: [{ akunId: akun.kas, debit: 2000, kredit: 0 }], olehUserId: userId, uji: uji() });
    expect(lagi).toEqual(draf); // satu draf per jenis
    const r = await postingSaldoAwal({ jenis: "ACCOUNTS", baris: [{ akunId: akun.kas, debit: 2000, kredit: 0 }], olehUserId: userId, uji: uji() });
    expect(r.ok && draf.ok && r.importId === draf.importId).toBe(true);
    expect(await hapusDrafSaldoAwal({ jenis: "ACCOUNTS", olehUserId: userId, uji: { ruang } })).toEqual({ ok: false, kode: "TANPA_DRAF" });
    await simpanDrafSaldoAwal({ jenis: "ACCOUNTS", baris: [], olehUserId: userId, uji: uji() });
    expect(await hapusDrafSaldoAwal({ jenis: "ACCOUNTS", olehUserId: userId, uji: { ruang } })).toEqual({ ok: true, dihapus: 1 });
  });

  it("dua posting bersamaan: tepat satu yang berlaku, yang lain terbalik — tidak pernah dua saldo awal hidup", async () => {
    const satu = (n: number) =>
      postingSaldoAwal({ jenis: "ACCOUNTS", baris: [{ akunId: akun.kas, debit: n, kredit: 0 }], olehUserId: userId, uji: uji() });
    const hasil = await Promise.all([satu(1_000), satu(2_000)]);
    expect(hasil.every((h) => h.ok)).toBe(true);
    const hidup = await prisma.openingBalanceImport.findMany({ where: { kind: kunciJenis("ACCOUNTS", ruang), status: "POSTED" } });
    expect(hidup).toHaveLength(1);
    expect(await prisma.openingBalanceImport.count({ where: { kind: kunciJenis("ACCOUNTS", ruang), status: "REVERSED" } })).toBe(1);
    expect(await saldo(akun.kas)).toBe(Number(hidup[0].totalAmount));
  }, 60_000);

  it("keadaan halaman: status per jenis, posting terakhir, draf, dan jumlah yang dibalik", async () => {
    await postingSaldoAwal({ jenis: "ACCOUNTS", baris: [{ akunId: akun.kas, debit: 1000, kredit: 0 }], olehUserId: userId, uji: uji() });
    await postingSaldoAwal({ jenis: "ACCOUNTS", baris: [{ akunId: akun.kas, debit: 2500, kredit: 0 }], olehUserId: userId, uji: uji() });
    await simpanDrafSaldoAwal({ jenis: "INVENTORY", baris: [], olehUserId: userId, uji: uji() });
    const k = await bacaKeadaanSaldoAwal("2091-03-01", ruang);
    expect(k.ACCOUNTS).toMatchObject({ status: "DIPOSTING", jumlahDibalik: 1, draf: null });
    expect(k.ACCOUNTS.posting).toMatchObject({ ekuitas: 2500, tanggalMulai: "2091-03-01", olehNama: "Uji saldo awal" });
    expect(k.INVENTORY.status).toBe("DRAF");
    expect(k.AP.status).toBe("BELUM");
    expect((await bacaKeadaanSaldoAwal("2091-04-01", ruang)).ACCOUNTS.status).toBe("BEDA_TANGGAL");
  });

  it("ditolak bila periode jurnalnya (atau sesudahnya) sudah ditutup", async () => {
    // Bulan bebas di 2002 (bersama tes tutup buku lain: jangan memakai bulan yang sudah ada).
    let bulan = 0;
    for (let m = 1; m <= 12 && !periodeId; m++) {
      if (await prisma.accountingPeriod.findUnique({ where: { year_month: { year: 2002, month: m } } })) continue;
      periodeId = (await prisma.accountingPeriod.create({ data: { year: 2002, month: m, status: "CLOSED", closedAt: new Date() } })).id;
      bulan = m;
    }
    expect(periodeId).not.toBe("");
    const mulai = new Date(`2002-${String(bulan).padStart(2, "0")}-15T00:00:00.000+07:00`);
    const r = await postingSaldoAwal({
      jenis: "ACCOUNTS",
      baris: [{ akunId: akun.kas, debit: 1000, kredit: 0 }],
      olehUserId: userId,
      uji: uji({ tanggalMulai: mulai }),
    });
    expect(r).toEqual({ ok: false, kode: "PERIODE_TERTUTUP", periode: `2002-${String(bulan).padStart(2, "0")}` });
    expect(await prisma.journal.count({ where: { postedById: userId } })).toBe(0);
  });
});
