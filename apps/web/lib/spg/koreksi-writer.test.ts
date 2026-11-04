import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { bayarKomisi } from "@/lib/konsinyasi/writer";
import { bulanWib } from "@/lib/salesman/pengaturan";
import { konsiReportKey, putusReportKey } from "@/lib/spg-commission/payout";
import { getCommissionRecap } from "@/lib/spg-commission/queries";
import { REF_KOMISI_KONSI, REF_KOMISI_SPG_PUTUS } from "./hilang";
import { bulanSebelum, DASAR_TARIF_KATEGORI, ENTITAS_KOREKSI_KOMISI, JEJAK_KOMISI_SPG } from "./komisi";
import { daftarKomisiKantor, ringkasGajiSaya } from "./komisi-queries";
import { payloadGajiHp } from "./komisi-hp";
import { batalkanTandaDicek, tandaiKomisiDibayar, tandaiLaporanDicek, tetapkanKomisiToko } from "./komisi-writer";
import { awalJendelaKoreksi, rencanaBayarKomisi, selisihMenunggu, selisihUnit, type UnitKomisiSpg } from "./koreksi";
import { hapusGajiUji, siapkanGajiUji } from "./gaji-pokok-uji";
import {
  daftarTunggakanKomisi,
  jumlahKomisiSpgTertunggak,
  pemegangKomisiSpg,
  unitKomisiSpg,
} from "./koreksi-queries";
import { setujuiReturPembeli, tolakReturPembeli } from "./retur-pembeli";
import { ENTITAS_BAYAR_TAMBAHAN_SPG, ENTITAS_UTANG_SPG, REF_BAYAR_TAMBAHAN_SPG, REF_UTANG_SPG } from "./utang";
import { catatSisaSpgBerhenti, terapkanKoreksiPlusSesudahAkhir } from "./utang-writer";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

/**
 * Koreksi komisi SPG terhadap basis data sungguhan (keputusan pemilik 2026-11-02): tidak ada bagi
 * rata. Baris yang belum dibayar dibayar dengan komisi per SPG sekarang; yang dulu dibayar bagi rata
 * dikoreksi SEKALI, di pembayaran SPG itu berikutnya (`SpgCommissionCorrection`), ditulis di
 * transaksi pembayarannya. Contoh pemilik: September dibayar Rp 22.500 masing-masing, padahal
 * per SPG Ani Rp 40.000 dan Sari Rp 20.000 → Ani +Rp 17.500, Sari −Rp 2.500.
 *
 * Tarif kategori Rp 2.000 per potong (kaos, topi, sejak lama — supaya contoh pemilik bisa dihitung);
 * jaket bertarif Rp 2.000 baru SEJAK "Oktober", seperti di produksi (tabel tarif ada sejak 2026-10
 * dan bulan lewat tidak bisa diberi tarif); tas tanpa tarif sama sekali. Penjualan disisipkan
 * langsung, baris aturan lama diseed langsung (`BAGI_RATA`, Rp 22.500, ditetapkan di bulan lalu).
 * Semua baris diseed di sini; penghapusan lewat `seededId(s)`, jejak dicocokkan di JS lewat metadata.
 */
d("koreksi komisi SPG (test bed only)", () => {
  const tag = `KKS${Math.random().toString(36).slice(2, 8)}`;
  const BULAN_INI = bulanWib(new Date());
  /** "Oktober": bulan lalu — dicek sekarang, dibayar bulan ini. */
  const OKT = bulanSebelum(BULAN_INI);
  /** "September": dua bulan lalu — dulu dibayar bagi rata di bulan "Oktober". */
  const SEP = bulanSebelum(OKT);
  let uomId = "";
  let katKaos = "";
  let katTopi = "";
  let katTas = "";
  let katJaket = "";
  let kaos = "";
  let topi = "";
  let tas = "";
  let jaket = "";
  let putus = "";
  let konsi = "";
  let ani = "";
  let sari = "";
  let dewi = "";
  let kantor = "";
  const nota: string[] = [];
  const siklus: string[] = [];
  const retur: string[] = [];
  let nomor = 0;

  const tokoIds = () => seededIds([putus, konsi].filter(Boolean));
  const orangIds = () => [ani, sari, dewi, kantor].filter(Boolean);
  const kategoriIds = () => seededIds([katKaos, katTopi, katTas, katJaket].filter(Boolean));
  const wib = (s: string) => new Date(`${s}+07:00`);

  beforeAll(async () => {
    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    const kategori = async (kode: string) => {
      const id = (await prisma.itemCategory.create({ data: { code: `${tag}-${kode}`, name: `${kode} ${tag}`, isActive: true } })).id;
      await prisma.spgCommissionRate.create({ data: { itemCategoryId: id, amountPerPiece: 2_000, effectiveFrom: "2020-01", createdById: "uji" } });
      return id;
    };
    katKaos = await kategori("KAOS");
    katTopi = await kategori("TOPI");
    // Kategori tanpa tarif: potongnya terbaca "tanpa tarif" (Rp 0), seperti bulan sebelum tabel tarif ada.
    katTas = (await prisma.itemCategory.create({ data: { code: `${tag}-TAS`, name: `TAS ${tag}`, isActive: true } })).id;
    // Tarif pertama baru berlaku "Oktober": penjualan September terbaca tanpa tarif, seperti di produksi.
    katJaket = (await prisma.itemCategory.create({ data: { code: `${tag}-JAKET`, name: `JAKET ${tag}`, isActive: true } })).id;
    await prisma.spgCommissionRate.create({ data: { itemCategoryId: katJaket, amountPerPiece: 2_000, effectiveFrom: OKT, createdById: "uji" } });
    const barang = async (kode: string, categoryId: string) =>
      (
        await prisma.item.create({
          data: { sku: `${tag}-${kode}`, nameId: `${kode} ${tag}`, nameEn: kode, type: "FINISHED_GOOD", uomId, categoryId, sellingPrice: 50_000 },
        })
      ).id;
    kaos = await barang("KAOS", katKaos);
    topi = await barang("TOPI", katTopi);
    tas = await barang("TAS", katTas);
    jaket = await barang("JAKET", katJaket);
    const toko = async (kode: string, termsType: "PUTUS" | "KONSI") =>
      (await prisma.store.create({ data: { code: `${tag}-${kode}`, name: `Toko ${kode} ${tag}`, address: "uji", termsType } })).id;
    putus = await toko("PUTUS", "PUTUS");
    konsi = await toko("KONSI", "KONSI");
    const orang = async (nama: string, storeId: string | null) =>
      (await prisma.user.create({ data: { email: `${tag}-${nama}@test.local`.toLowerCase(), name: `${nama} ${tag}`, assignedStoreId: storeId } })).id;
    ani = await orang("Ani", putus);
    sari = await orang("Sari", putus);
    dewi = await orang("Dewi", konsi);
    kantor = await orang("Kantor", null);
    // Gaji pokok Rp 0 dengan dasar hari yang pasti: tes ini tentang KOMISI dan koreksinya, jadi
    // gaji pokok tidak boleh menahan pembayaran (P60) maupun menyumbang selisih.
    for (const bulan of [SEP, OKT, BULAN_INI]) {
      for (const [userId, storeId] of [[ani, putus], [sari, putus], [dewi, konsi]] as const) {
        await siapkanGajiUji({ userId, storeId, bulan, jumlah: 0, olehUserId: kantor });
      }
    }
  });

  beforeEach(() => {
    nota.length = 0;
    siklus.length = 0;
    retur.length = 0;
  });

  afterEach(async () => {
    await prisma.spgCommissionCorrection.deleteMany({ where: { spgUserId: { in: seededIds(orangIds()) } } });
    const utangUji = await prisma.spgDebt.findMany({ where: { spgUserId: { in: seededIds(orangIds()) } }, select: { id: true } });
    await prisma.spgDebtSettlement.deleteMany({ where: { debtId: { in: seededIds(utangUji.map((u) => u.id)) } } });
    await prisma.spgDebt.deleteMany({ where: { spgUserId: { in: seededIds(orangIds()) } } });
    await prisma.spgExtraPayout.deleteMany({ where: { spgUserId: { in: seededIds(orangIds()) } } });
    // Ani dan Sari kembali bertugas kalau sebuah tes menandainya berhenti.
    for (const id of [ani, sari].filter(Boolean)) {
      await prisma.user.update({ where: { id: seededId(id) }, data: { assignedStoreId: putus, spgEndedOn: null, spgEndedStoreId: null } });
    }
    const audit = await prisma.auditLog.findMany({
      where: {
        entityType: { in: ["SpgCommission", "SpgSalesCheck", "ConsignmentCommission", "SpgSaleReturn", ENTITAS_KOREKSI_KOMISI, ENTITAS_UTANG_SPG, ENTITAS_BAYAR_TAMBAHAN_SPG] },
      },
      select: { id: true, metadata: true },
    });
    const milikUji = audit
      .filter((a) => {
        const m = a.metadata as Record<string, unknown> | null;
        return (
          (typeof m?.storeId === "string" && tokoIds().includes(m.storeId)) ||
          (typeof m?.spgUserId === "string" && orangIds().includes(m.spgUserId)) ||
          (typeof m?.cycleId === "string" && siklus.includes(m.cycleId))
        );
      })
      .map((a) => a.id);
    await prisma.auditLog.deleteMany({ where: { id: { in: seededIds(milikUji) } } });
    await prisma.spgCommission.deleteMany({ where: { storeId: { in: tokoIds() } } });
    await prisma.consignmentCommission.deleteMany({ where: { cycleId: { in: seededIds(siklus) } } });
    await prisma.consignmentSold.deleteMany({ where: { cycleId: { in: seededIds(siklus) } } });
    await prisma.consignmentCycle.deleteMany({ where: { id: { in: seededIds(siklus) } } });
    await prisma.spgSalesCheck.deleteMany({ where: { storeId: { in: tokoIds() } } });
    await prisma.spgSaleReturnLine.deleteMany({ where: { returnId: { in: seededIds(retur) } } });
    await prisma.spgSaleReturn.deleteMany({ where: { id: { in: seededIds(retur) } } });
    await prisma.spgSaleLine.deleteMany({ where: { spgSaleId: { in: seededIds(nota) } } });
    await prisma.spgSale.deleteMany({ where: { id: { in: seededIds(nota) } } });
  });

  afterAll(async () => {
    await hapusGajiUji([ani, sari, dewi]);
    await prisma.user.deleteMany({ where: { id: { in: seededIds(orangIds()) } } });
    await prisma.store.deleteMany({ where: { id: { in: tokoIds() } } });
    await prisma.item.deleteMany({ where: { id: { in: seededIds([kaos, topi, tas, jaket].filter(Boolean)) } } });
    await prisma.spgCommissionRate.deleteMany({ where: { itemCategoryId: { in: kategoriIds() } } });
    await prisma.itemCategory.deleteMany({ where: { id: { in: kategoriIds() } } });
    if (uomId) await prisma.uOM.delete({ where: { id: seededId(uomId) } });
  });

  // ---------------------------------------------------------------- penyiap

  async function jual(salesmanId: string, storeId: string, waktu: Date, itemId: string, qty: number) {
    // Kategori komisi dibaca dari BARIS nota (P8/P69), seperti yang ditulis kasir saat menjual.
    const kat = (await prisma.item.findUnique({ where: { id: itemId }, select: { categoryId: true } }))?.categoryId ?? null;
    const s = await prisma.spgSale.create({
      data: {
        docNo: `${tag}-${nomor++}`,
        salesmanId,
        storeId,
        subtotal: 0,
        total: 0,
        cashReceived: 0,
        changeGiven: 0,
        createdById: salesmanId,
        createdAt: waktu,
        lines: { create: [{ itemId, categoryId: kat, categoryAt: waktu, productName: "uji", qty, unitPrice: 50_000, lineTotal: 50_000 * qty }] },
      },
      select: { id: true, lines: { select: { id: true, itemId: true } } },
    });
    nota.push(s.id);
    return s;
  }

  /**
   * September toko putus: Ani menjual 20 kaos (Rp 40.000), Sari 10 (Rp 20.000), dan keduanya dulu
   * ditetapkan bagi rata Rp 22.500 tanpa tanda dicek, di bulan "Oktober".
   */
  async function septemberBagiRata(dibayar: { ani: boolean; sari: boolean }) {
    await jual(ani, putus, wib(`${SEP}-10T10:00:00`), kaos, 20);
    await jual(sari, putus, wib(`${SEP}-11T10:00:00`), kaos, 10);
    return barisBagiRata(dibayar);
  }

  /** Baris September toko putus Ani dan Sari, ditetapkan bagi rata Rp 22.500 tanpa tanda dicek di bulan "Oktober". */
  async function barisBagiRata(dibayar: { ani: boolean; sari: boolean }) {
    const ditetapkan = wib(`${OKT}-05T10:00:00`);
    const buat = (userId: string, sudah: boolean) =>
      prisma.spgCommission.create({
        data: {
          userId,
          storeId: putus,
          period: SEP,
          unitsSold: 15,
          commission: 22_500,
          basis: "BAGI_RATA",
          lockedById: kantor,
          lockedAt: ditetapkan,
          ...(sudah ? { paidAt: wib(`${OKT}-06T10:00:00`), paidById: kantor } : {}),
        },
        select: { id: true, lockedAt: true },
      });
    return { ani: await buat(ani, dibayar.ani), sari: await buat(sari, dibayar.sari) };
  }

  /** Oktober toko putus dicek dan ditetapkan sekarang (dibayar bulan ini). */
  async function oktoberDitetapkan(potong: { ani?: number; sari?: number }) {
    if (potong.ani) await jual(ani, putus, wib(`${OKT}-10T10:00:00`), kaos, potong.ani);
    if (potong.sari) await jual(sari, putus, wib(`${OKT}-11T10:00:00`), kaos, potong.sari);
    expect((await tandaiLaporanDicek({ storeId: putus, periode: OKT, olehUserId: kantor })).ok).toBe(true);
    expect((await tetapkanKomisiToko({ storeId: putus, periode: OKT, olehUserId: kantor })).ok).toBe(true);
  }

  const barisPutus = (userId: string, periode: string) =>
    prisma.spgCommission.findUniqueOrThrow({
      where: { userId_storeId_period: { userId, storeId: putus, period: periode } },
      select: { id: true, commission: true, unitsSold: true, basis: true, lockedAt: true, paidAt: true },
    });

  /** Siklus konsinyasi toko konsi, dengan angka resmi terjualnya (`itemId` null = baris diketik tanpa barang). */
  async function buatSiklus(periode: string, terkunci: Date | null, resmi: { itemId: string | null; qty: number }[]) {
    const [periodYear, periodMonth] = periode.split("-").map(Number);
    const c = await prisma.consignmentCycle.create({
      data: {
        noKonsi: `${tag}-K${nomor++}`,
        storeId: konsi,
        periodYear,
        periodMonth,
        lockedAt: terkunci,
        lockedById: terkunci ? kantor : null,
        sold: { create: resmi.map((r) => ({ itemId: r.itemId, itemName: "uji", qty: r.qty, price: 50_000, amount: 50_000 * r.qty })) },
      },
      select: { id: true },
    });
    siklus.push(c.id);
    return c.id;
  }

  const gajiKonsi = (cycleId: string, spgUserId: string, isi: { pokok: number; komisi: number; dibayar?: Date }) =>
    prisma.consignmentCommission.create({
      data: {
        cycleId,
        spgUserId,
        baseSalary: isi.pokok,
        commission: isi.komisi,
        total: isi.pokok + isi.komisi,
        ...(isi.dibayar ? { paidAt: isi.dibayar, paidById: kantor } : {}),
      },
      select: { id: true },
    });

  /** Siklus Oktober terkunci sekarang: SPG itu menjual `topi` potong topi, angka resminya sama. */
  async function konsiOktober(spgUserId: string, potongTopi: number) {
    await jual(spgUserId, konsi, wib(`${OKT}-15T10:00:00`), topi, potongTopi);
    const c = await buatSiklus(OKT, new Date(), [{ itemId: topi, qty: potongTopi }]);
    const g = await gajiKonsi(c, spgUserId, { pokok: 0, komisi: potongTopi * 2_000 });
    return { cycleId: c, id: g.id, kunci: konsiReportKey(c) };
  }

  const koreksiMilik = (userId: string) =>
    prisma.spgCommissionCorrection.findMany({
      where: { spgUserId: seededId(userId) },
      orderBy: [{ appliedAt: "asc" }, { id: "asc" }],
      select: { id: true, sourceKey: true, sourceKind: true, amount: true, difference: true, paidRefType: true, paidRefId: true, payoutMonth: true, note: true },
    });

  const jejakKoreksi = async (userId: string) =>
    (
      await prisma.auditLog.findMany({
        where: { action: JEJAK_KOMISI_SPG.KOREKSI_DITERAPKAN, entityType: ENTITAS_KOREKSI_KOMISI },
        select: { entityId: true, metadata: true },
      })
    ).filter((a) => (a.metadata as Record<string, unknown> | null)?.spgUserId === userId);

  const unitMilik = async (userId: string): Promise<UnitKomisiSpg[]> => (await unitKomisiSpg(prisma, [userId])).get(userId) ?? [];

  const rencanaUntuk = async (userId: string, kunci: string) =>
    rencanaBayarKomisi({ units: await unitMilik(userId), kunci });

  // ---------------------------------------------------------------- tes

  it("baris bagi rata September yang belum dibayar (laporannya dicek): baris Sari dibayar dengan angka per SPG, bukan Rp 22.500", async () => {
    const lama = await septemberBagiRata({ ani: true, sari: false });
    // Baris putus hanya bisa dibayar bila toko × bulan penjualannya dicek (B8) — tanpa itu LAPORAN_BELUM_DICEK.
    expect(await tandaiKomisiDibayar({ commissionId: lama.sari.id, olehUserId: kantor, jumlahDiharapkan: 20_000 })).toMatchObject({ ok: false, code: "LAPORAN_BELUM_DICEK" });
    await prisma.spgSalesCheck.create({ data: { storeId: putus, period: SEP, checkedById: kantor, checkedAt: wib(`${OKT}-05T10:00:00`) } });

    // Kantor melihat Rp 22.500 (layar basi): ditolak, tidak ada yang tertulis.
    expect(await tandaiKomisiDibayar({ commissionId: lama.sari.id, olehUserId: kantor, jumlahDiharapkan: 22_500 })).toMatchObject({
      ok: false,
      code: "ANGKA_BERUBAH",
      jumlah: 20_000,
    });
    const tetap = await barisPutus(sari, SEP);
    expect([Number(tetap.commission), tetap.basis, tetap.paidAt]).toEqual([22_500, "BAGI_RATA", null]);
    expect(await prisma.auditLog.count({ where: { entityId: seededId(lama.sari.id) } })).toBe(0);
    expect(await koreksiMilik(sari)).toEqual([]);

    expect(await tandaiKomisiDibayar({ commissionId: lama.sari.id, olehUserId: kantor, jumlahDiharapkan: 20_000 })).toMatchObject({
      ok: true,
      diubah: true,
      dibayar: 20_000,
      koreksi: 0,
    });
    const dibayar = await barisPutus(sari, SEP);
    expect([Number(dibayar.commission), dibayar.unitsSold, dibayar.basis]).toEqual([20_000, 10, DASAR_TARIF_KATEGORI]);
    expect(dibayar.paidAt).not.toBeNull();
    expect(dibayar.lockedAt).toEqual(lama.sari.lockedAt);
    const hitungUlang = await prisma.auditLog.findMany({
      where: { action: JEJAK_KOMISI_SPG.DIHITUNG_ULANG_SAAT_BAYAR, entityId: seededId(lama.sari.id) },
      select: { entityType: true, changes: true },
    });
    expect(hitungUlang).toHaveLength(1);
    expect(hitungUlang[0]).toMatchObject({
      entityType: REF_KOMISI_SPG_PUTUS,
      changes: { before: { komisi: 22_500, dasar: "BAGI_RATA" }, after: { komisi: 20_000, dasar: DASAR_TARIF_KATEGORI } },
    });
  });

  it("pembayaran Ani berikutnya membawa koreksi September +Rp 17.500 tepat sekali", async () => {
    await septemberBagiRata({ ani: true, sari: true });
    await oktoberDitetapkan({ ani: 15 });
    const okt = await barisPutus(ani, OKT);

    expect(await tandaiKomisiDibayar({ commissionId: okt.id, olehUserId: kantor, jumlahDiharapkan: 47_500 })).toMatchObject({
      ok: true,
      storeId: putus,
      periode: OKT,
      diubah: false,
      dibayar: 47_500,
      koreksi: 17_500,
    });
    const k = await koreksiMilik(ani);
    expect(k.map((x) => [x.sourceKey, x.sourceKind, Number(x.amount), Number(x.difference), x.paidRefType, x.paidRefId, x.payoutMonth])).toEqual([
      [putusReportKey(putus, SEP), "PUTUS", 17_500, 17_500, REF_KOMISI_SPG_PUTUS, okt.id, BULAN_INI],
    ]);
    expect(k[0].note).toContain("Koreksi komisi penjualan");
    expect((await jejakKoreksi(ani)).map((j) => j.entityId)).toEqual([k[0].id]);

    expect(await tandaiKomisiDibayar({ commissionId: okt.id, olehUserId: kantor, jumlahDiharapkan: 47_500 })).toMatchObject({ ok: false, code: "SUDAH_DIBAYAR" });
    expect(await koreksiMilik(ani)).toHaveLength(1);

    // Pembayaran sesudahnya tidak membawa September lagi.
    const nov = await konsiOktober(ani, 5);
    const units = await unitMilik(ani);
    expect(selisihUnit(units.find((u) => u.kunci === putusReportKey(putus, SEP))!)).toBe(0);
    expect(selisihMenunggu(units)).toEqual([]);
    const r = rencanaBayarKomisi({ units, kunci: nov.kunci });
    expect(r?.koreksi.some((x) => x.sumber === putusReportKey(putus, SEP))).toBe(false);
    expect(r?.dibayar).toBe(10_000);
  });

  it("pratinjau kantor dan HP menampilkan +Rp 17.500 tanpa menulis apa pun; batal dicek tetap tanpa koreksi", async () => {
    await septemberBagiRata({ ani: true, sari: true });
    await oktoberDitetapkan({ ani: 15 });

    const kantorBulanIni = await daftarKomisiKantor(BULAN_INI, new Date());
    const laporan = kantorBulanIni.putus.find((l) => l.storeId === putus && l.bulanJual === OKT);
    expect(laporan?.baris.find((b) => b.userId === ani)?.bayar).toMatchObject({ sasaran: true, jumlahKoreksi: 17_500, dibayar: 47_500 });

    const hp = await ringkasGajiSaya(ani);
    const oktHp = hp.resmi.find((r) => r.jenis === "PUTUS" && r.bulanJual === OKT);
    expect(oktHp).toMatchObject({ diterima: 47_500, dibayar: null });
    expect(oktHp?.koreksi).toEqual([expect.objectContaining({ bulanJual: SEP, jumlah: 17_500, diterapkan: false })]);

    expect(await koreksiMilik(ani)).toEqual([]);
    expect(await batalkanTandaDicek({ storeId: putus, periode: OKT, olehUserId: kantor, alasan: "uji koreksi" })).toMatchObject({ ok: true });
    expect(await koreksiMilik(ani)).toEqual([]);
  });

  it("koreksi minus yang lebih besar dari pembayarannya: −Rp 2.000 diterapkan, −Rp 500 dibawa ke pembayaran berikutnya", async () => {
    await septemberBagiRata({ ani: true, sari: true });
    await oktoberDitetapkan({ sari: 1 });
    const okt = await barisPutus(sari, OKT);

    expect(await tandaiKomisiDibayar({ commissionId: okt.id, olehUserId: kantor, jumlahDiharapkan: 0 })).toMatchObject({ ok: true, dibayar: 0, koreksi: -2_000 });
    expect((await koreksiMilik(sari)).map((x) => [Number(x.amount), Number(x.difference)])).toEqual([[-2_000, -2_500]]);

    const berikut = await konsiOktober(sari, 5);
    const r = await rencanaUntuk(sari, berikut.kunci);
    expect(r).toMatchObject({ sasaran: true, dasar: 10_000, jumlahKoreksi: -500, dibayar: 9_500, dibawa: 0 });
    expect(await bayarKomisi({ commissionId: berikut.id, olehUserId: kantor, jumlahDiharapkan: 9_500 })).toMatchObject({ ok: true, dibayar: 9_500, koreksi: -500 });
    const k = await koreksiMilik(sari);
    expect(k.map((x) => [x.paidRefType, Number(x.amount)])).toEqual([
      [REF_KOMISI_SPG_PUTUS, -2_000],
      [REF_KOMISI_KONSI, -500],
    ]);
    expect(k.reduce((n, x) => n + Number(x.amount), 0)).toBe(-2_500);
  });

  it("retur pembeli dari bulan yang dibayar: selama MENUNGGU tidak mengubah apa pun, yang ditolak tidak pernah; disetujui sesudah dibayar → koreksi minus di pembayaran berikutnya", async () => {
    await oktoberDitetapkan({ ani: 15 });
    const okt = await barisPutus(ani, OKT);
    const nota0 = await prisma.spgSale.findFirstOrThrow({
      where: { id: { in: seededIds(nota) }, salesmanId: seededId(ani), storeId: seededId(putus) },
      select: { id: true, lines: { select: { id: true, itemId: true } } },
    });
    // Dilaporkan SPG di bulan penjualannya, SEBELUM komisinya dibayar: menunggu persetujuan kantor,
    // seperti yang ditulis HP (status MENUNGGU tertulis eksplisit). Kondisi RUSAK — tidak kembali ke buku stok.
    const lapor = async (hari: string) => {
      const r = await prisma.spgSaleReturn.create({
        data: {
          spgSaleId: nota0.id,
          storeId: putus,
          createdById: ani,
          reason: "uji",
          idempotencyKey: `${tag}-r${nomor++}`,
          createdAt: wib(`${OKT}-${hari}T10:00:00`),
          status: "MENUNGGU",
          lines: { create: [{ spgSaleLineId: nota0.lines[0].id, itemId: nota0.lines[0].itemId, qty: 1, condition: "RUSAK" }] },
        },
        select: { id: true },
      });
      retur.push(r.id);
      return r.id;
    };
    const akanDisetujui = await lapor("25");
    const akanDitolak = await lapor("26");

    // Yang menunggu tidak menurunkan apa pun: kantor melihatnya sebagai peringatan, pratinjau dan pembayaran tetap Rp 30.000.
    const laporanOkt = (await daftarKomisiKantor(BULAN_INI, new Date())).putus.find((l) => l.storeId === putus && l.bulanJual === OKT);
    expect(laporanOkt?.returMenunggu).toBe(2);
    expect(await rencanaUntuk(ani, putusReportKey(putus, OKT))).toMatchObject({ komisiBaru: 30_000, berubah: false, dibayar: 30_000 });
    expect(await tandaiKomisiDibayar({ commissionId: okt.id, olehUserId: kantor, jumlahDiharapkan: 30_000 })).toMatchObject({
      ok: true,
      diubah: false,
      dibayar: 30_000,
      koreksi: 0,
    });

    // Sesudah dibayar dan masih menunggu: tanpa selisih, pembayaran berikutnya tanpa koreksi.
    const berikut = await konsiOktober(ani, 5);
    const unitOkt = async () => (await unitMilik(ani)).find((u) => u.kunci === putusReportKey(putus, OKT))!;
    expect(selisihUnit(await unitOkt())).toBe(0);
    expect(await rencanaUntuk(ani, berikut.kunci)).toMatchObject({ koreksi: [], jumlahKoreksi: 0, dibayar: 10_000 });

    // Ditolak kantor: tidak pernah berpengaruh.
    expect(await tolakReturPembeli({ returnId: akanDitolak, olehUserId: kantor, alasan: "uji: bukan barang toko ini" })).toMatchObject({
      ok: true,
      status: "DITOLAK",
    });
    expect(selisihUnit(await unitOkt())).toBe(0);

    // Disetujui lewat penulis retur pembeli SESUDAH komisinya dibayar: baru sekarang Oktober turun,
    // dan selisihnya menjadi koreksi minus di pembayaran berikutnya — yang sudah dibayar tidak diubah.
    expect(await setujuiReturPembeli({ returnId: akanDisetujui, olehUserId: kantor })).toMatchObject({ ok: true, status: "DISETUJUI" });
    expect(Number((await barisPutus(ani, OKT)).commission)).toBe(30_000);
    expect(selisihUnit(await unitOkt())).toBe(-2_000);
    const r = await rencanaUntuk(ani, berikut.kunci);
    expect(r?.koreksi.map((x) => [x.sumber, x.selisih, x.diterapkan])).toEqual([[putusReportKey(putus, OKT), -2_000, -2_000]]);
    expect(await bayarKomisi({ commissionId: berikut.id, olehUserId: kantor, jumlahDiharapkan: 8_000 })).toMatchObject({ ok: true, dibayar: 8_000, koreksi: -2_000 });
    expect((await koreksiMilik(ani)).map((x) => [x.sourceKey, Number(x.amount), x.paidRefType, x.paidRefId])).toEqual([
      [putusReportKey(putus, OKT), -2_000, REF_KOMISI_KONSI, berikut.id],
    ]);
  });

    it("nota HP bertanggal bulan yang sudah dibayar, masuk sesudahnya: koreksi plus di pembayaran berikutnya", async () => {
    await oktoberDitetapkan({ ani: 15 });
    const okt = await barisPutus(ani, OKT);
    expect((await tandaiKomisiDibayar({ commissionId: okt.id, olehUserId: kantor, jumlahDiharapkan: 30_000 })).ok).toBe(true);

    await jual(ani, putus, wib(`${OKT}-28T20:00:00`), kaos, 2);
    const berikut = await konsiOktober(ani, 5);
    const r = await rencanaUntuk(ani, berikut.kunci);
    expect(r).toMatchObject({ jumlahKoreksi: 4_000, dibayar: 14_000 });
    expect(r?.koreksi.map((x) => [x.sumber, x.diterapkan])).toEqual([[putusReportKey(putus, OKT), 4_000]]);
  });

  it("siklus konsi terkunci dengan baris Rp 22.500 sama rata: Ani dibayar komisi Rp 40.000 dan gaji pokok sekarang, tidak pernah angka tersimpan", async () => {
    await jual(ani, konsi, wib(`${SEP}-10T10:00:00`), kaos, 20);
    await jual(sari, konsi, wib(`${SEP}-11T10:00:00`), kaos, 10);
    const c = await buatSiklus(SEP, wib(`${OKT}-05T10:00:00`), [{ itemId: kaos, qty: 30 }]);
    // Gaji pokok tersimpan Rp 500.000 (diketik di kunci lama); dasar gaji sekarang Rp 0 (`siapkanGajiUji`):
    // pembayaran menghitung ulang KEDUANYA di transaksinya (B21).
    const baris = await gajiKonsi(c, ani, { pokok: 500_000, komisi: 22_500 });
    await gajiKonsi(c, sari, { pokok: 500_000, komisi: 22_500 });

    expect(await bayarKomisi({ commissionId: baris.id, olehUserId: kantor, jumlahDiharapkan: 522_500 })).toMatchObject({ ok: false, alasan: "ANGKA_BERUBAH" });
    const tetap = await prisma.consignmentCommission.findUniqueOrThrow({ where: { id: baris.id }, select: { commission: true, total: true, paidAt: true } });
    expect([Number(tetap.commission), Number(tetap.total), tetap.paidAt]).toEqual([22_500, 522_500, null]);

    expect(await bayarKomisi({ commissionId: baris.id, olehUserId: kantor, jumlahDiharapkan: 40_000 })).toMatchObject({ ok: true, diubah: true, dibayar: 40_000 });
    const dibayar = await prisma.consignmentCommission.findUniqueOrThrow({ where: { id: baris.id }, select: { commission: true, baseSalary: true, total: true, paidAt: true } });
    expect([Number(dibayar.commission), Number(dibayar.baseSalary), Number(dibayar.total)]).toEqual([40_000, 0, 40_000]);
    expect(dibayar.paidAt).not.toBeNull();
    expect(await prisma.auditLog.count({ where: { action: JEJAK_KOMISI_SPG.DIHITUNG_ULANG_SAAT_BAYAR, entityId: seededId(baris.id) } })).toBe(1);
  });

  it("siklus konsi bagi rata yang SUDAH dibayar: selisihnya ikut baris konsi Ani berikutnya", async () => {
    await jual(ani, konsi, wib(`${SEP}-10T10:00:00`), kaos, 20);
    await jual(sari, konsi, wib(`${SEP}-11T10:00:00`), kaos, 10);
    const sep = await buatSiklus(SEP, wib(`${OKT}-05T10:00:00`), [{ itemId: kaos, qty: 30 }]);
    await gajiKonsi(sep, ani, { pokok: 0, komisi: 22_500, dibayar: wib(`${OKT}-06T10:00:00`) });

    await jual(ani, konsi, wib(`${OKT}-10T10:00:00`), kaos, 15);
    const okt = await buatSiklus(OKT, new Date(), [{ itemId: kaos, qty: 15 }]);
    const berikut = await gajiKonsi(okt, ani, { pokok: 0, komisi: 30_000 });

    expect(await bayarKomisi({ commissionId: berikut.id, olehUserId: kantor, jumlahDiharapkan: 47_500 })).toMatchObject({ ok: true, dibayar: 47_500, koreksi: 17_500 });
    expect((await koreksiMilik(ani)).map((x) => [x.sourceKey, x.sourceKind, Number(x.amount), x.paidRefType, x.paidRefId])).toEqual([
      [konsiReportKey(sep), "KONSI", 17_500, REF_KOMISI_KONSI, berikut.id],
    ]);
  });

    describe("balapan", () => {
    it("baris yang sama dibayar dua kali bersamaan: satu berhasil, satu SUDAH_DIBAYAR, satu set koreksi", async () => {
      await septemberBagiRata({ ani: true, sari: true });
      await oktoberDitetapkan({ ani: 15 });
      const okt = await barisPutus(ani, OKT);
      const hasil = await Promise.all([
        tandaiKomisiDibayar({ commissionId: okt.id, olehUserId: kantor, jumlahDiharapkan: 47_500 }),
        tandaiKomisiDibayar({ commissionId: okt.id, olehUserId: kantor, jumlahDiharapkan: 47_500 }),
      ]);
      expect(hasil.filter((h) => h.ok)).toHaveLength(1);
      expect(hasil.filter((h) => !h.ok)).toEqual([expect.objectContaining({ ok: false, code: "SUDAH_DIBAYAR" })]);
      expect((await koreksiMilik(ani)).map((x) => Number(x.amount))).toEqual([17_500]);
    });

    it("dua baris berbeda SPG yang sama dibayar bersamaan: koreksi September diterapkan tepat sekali", async () => {
      await septemberBagiRata({ ani: true, sari: true });
      await oktoberDitetapkan({ ani: 15 });
      const okt = await barisPutus(ani, OKT);
      const k = await konsiOktober(ani, 5);
      // Konsi didahulukan sebagai sasaran (bulan yang sama), tapi urutan kedatangan tidak boleh mengubah jumlahnya.
      const hasil = await Promise.all([
        tandaiKomisiDibayar({ commissionId: okt.id, olehUserId: kantor }),
        bayarKomisi({ commissionId: k.id, olehUserId: kantor }),
      ]);
      expect(hasil.map((h) => h.ok)).toEqual([true, true]);
      const sep = (await koreksiMilik(ani)).filter((x) => x.sourceKey === putusReportKey(putus, SEP));
      expect(sep).toHaveLength(1);
      expect(Number(sep[0].amount)).toBe(17_500);
    });

    it("pembayaran yang berbalapan dengan nota HP yang terlambat tetap konsisten: sisanya ikut pembayaran berikutnya", async () => {
      await oktoberDitetapkan({ ani: 15 });
      const okt = await barisPutus(ani, OKT);
      const [bayar] = await Promise.all([
        tandaiKomisiDibayar({ commissionId: okt.id, olehUserId: kantor }),
        jual(ani, putus, wib(`${OKT}-29T20:00:00`), kaos, 1),
      ]);
      expect(bayar.ok).toBe(true);
      const dibayar = Number((await barisPutus(ani, OKT)).commission);
      expect([30_000, 32_000]).toContain(dibayar);
      const unit = (await unitMilik(ani)).find((u) => u.kunci === putusReportKey(putus, OKT))!;
      expect(dibayar + selisihUnit(unit)).toBe(32_000);
      expect(await koreksiMilik(ani)).toEqual([]);
    });
  });

  it("rekap: bulan pembayaran 'Oktober' menunjukkan selisih menunggu Rp 17.500, lalu nol sesudah koreksinya dibayar bulan ini", async () => {
    await septemberBagiRata({ ani: true, sari: true });
    const rekapLama = async () => (await getCommissionRecap(OKT, prisma, { storeIds: [putus] })).rows.find((r) => r.salesmanId === ani);
    expect(await rekapLama()).toMatchObject({ figure: 40_000, paidAmount: 22_500, pendingDifference: 17_500 });

    await oktoberDitetapkan({ ani: 15 });
    const okt = await barisPutus(ani, OKT);
    expect((await tandaiKomisiDibayar({ commissionId: okt.id, olehUserId: kantor, jumlahDiharapkan: 47_500 })).ok).toBe(true);

    const rekapIni = (await getCommissionRecap(BULAN_INI, prisma, { storeIds: [putus] })).rows.find((r) => r.salesmanId === ani);
    expect(rekapIni).toMatchObject({ correctionsApplied: 17_500 });
    expect(await rekapLama()).toMatchObject({ pendingDifference: 0 });
  });

      it("penjual tanpa baris di laporan yang sudah tertutup: koreksi menunggunya terlihat sama di kantor dan di HP", async () => {
    // Siklus September dikunci bulan lalu; Ani punya baris (sudah dibayar sebesar angkanya),
    // Dewi menjual 3 kaos tanpa pernah punya baris — angkanya Rp 6.000 menunggu sebagai koreksi.
    await jual(ani, konsi, wib(`${SEP}-10T10:00:00`), kaos, 5);
    await jual(dewi, konsi, wib(`${SEP}-12T10:00:00`), kaos, 3);
    const c = await buatSiklus(SEP, wib(`${OKT}-05T10:00:00`), [{ itemId: kaos, qty: 8 }]);
    await gajiKonsi(c, ani, { pokok: 0, komisi: 10_000, dibayar: wib(`${OKT}-06T10:00:00`) });

    expect(await pemegangKomisiSpg(prisma, new Date(), { storeIds: tokoIds() })).toContain(dewi);

    const jumlah = (xs: { jumlah?: number; selisih?: number }[]) => xs.reduce((n, x) => n + (x.jumlah ?? x.selisih ?? 0), 0);
    const hp = await ringkasGajiSaya(dewi);
    expect(jumlah(hp.koreksiMenunggu)).toBe(6_000);
    const kantorDewi = (await daftarKomisiKantor(BULAN_INI, new Date())).koreksiMenunggu.find((k) => k.userId === dewi);
    expect(kantorDewi?.baris.map((b) => [b.sumber, b.selisih])).toEqual([[konsiReportKey(c), 6_000]]);
    expect(jumlah(kantorDewi?.baris ?? [])).toBe(jumlah(hp.koreksiMenunggu));
  });

  describe("penjual tanpa baris di bulan toko putus yang sudah dibayar: koreksinya ikut dan DITERAPKAN saat baris sasarannya dibayar", () => {
    /**
     * September toko putus dicek dan dibayar: Ani 20 kaos, barisnya Rp 40.000 (tarif kategori, sebesar
     * angkanya — tanpa selisih). Nota Dewi (3 kaos) masuk sesudah bulan itu dibayar, jadi ia tidak punya
     * baris September: angkanya Rp 6.000 menunggu sebagai koreksi. Pembayaran harus membaca ulang toko ×
     * bulan itu di transaksinya walau Dewi tidak punya baris di sana — kalau tidak, pratinjau Rp 16.000
     * ditolak ANGKA_BERUBAH (Rp 10.000) dan koreksinya tidak pernah diterapkan.
     */
    async function septemberDibayarTanpaBarisDewi() {
      await jual(ani, putus, wib(`${SEP}-10T10:00:00`), kaos, 20);
      await jual(dewi, putus, wib(`${SEP}-12T10:00:00`), kaos, 3);
      await prisma.spgSalesCheck.create({ data: { storeId: putus, period: SEP, checkedById: kantor, checkedAt: wib(`${OKT}-05T09:00:00`) } });
      await prisma.spgCommission.create({
        data: {
          userId: ani,
          storeId: putus,
          period: SEP,
          unitsSold: 20,
          commission: 40_000,
          basis: DASAR_TARIF_KATEGORI,
          lockedById: kantor,
          lockedAt: wib(`${OKT}-05T10:00:00`),
          paidAt: wib(`${OKT}-06T10:00:00`),
          paidById: kantor,
        },
      });
      const sep = (await unitMilik(dewi)).find((u) => u.kunci === putusReportKey(putus, SEP));
      expect(sep).toMatchObject({ baris: null, laporanTertutup: true, angka: 6_000 });
      expect(selisihUnit(sep!)).toBe(6_000);
    }

    it("sasarannya baris konsinyasi — Dewi tidak punya baris toko putus sama sekali", async () => {
      await septemberDibayarTanpaBarisDewi();
      const berikut = await konsiOktober(dewi, 5);
      expect(await rencanaUntuk(dewi, berikut.kunci)).toMatchObject({ sasaran: true, dasar: 10_000, jumlahKoreksi: 6_000, dibayar: 16_000 });

      expect(await bayarKomisi({ commissionId: berikut.id, olehUserId: kantor, jumlahDiharapkan: 16_000 })).toMatchObject({ ok: true, dibayar: 16_000, koreksi: 6_000 });
      const k = await koreksiMilik(dewi);
      expect(k.map((x) => [x.sourceKey, x.sourceKind, Number(x.amount), Number(x.difference), x.paidRefType, x.paidRefId])).toEqual([
        [putusReportKey(putus, SEP), "PUTUS", 6_000, 6_000, REF_KOMISI_KONSI, berikut.id],
      ]);
      expect((await jejakKoreksi(dewi)).map((j) => j.entityId)).toEqual([k[0].id]);
      expect(selisihMenunggu(await unitMilik(dewi))).toEqual([]);
    });

    it("sasarannya baris toko putus bulan lain — toko × bulan September tidak ada di antara baris Dewi", async () => {
      await septemberDibayarTanpaBarisDewi();
      await jual(dewi, putus, wib(`${OKT}-12T10:00:00`), kaos, 5);
      expect((await tandaiLaporanDicek({ storeId: putus, periode: OKT, olehUserId: kantor })).ok).toBe(true);
      expect((await tetapkanKomisiToko({ storeId: putus, periode: OKT, olehUserId: kantor })).ok).toBe(true);
      const okt = await prisma.spgCommission.findUniqueOrThrow({
        where: { userId_storeId_period: { userId: dewi, storeId: putus, period: OKT } },
        select: { id: true },
      });
      expect(await rencanaUntuk(dewi, putusReportKey(putus, OKT))).toMatchObject({ sasaran: true, dasar: 10_000, jumlahKoreksi: 6_000, dibayar: 16_000 });

      expect(await tandaiKomisiDibayar({ commissionId: okt.id, olehUserId: kantor, jumlahDiharapkan: 16_000 })).toMatchObject({ ok: true, dibayar: 16_000, koreksi: 6_000 });
      expect((await koreksiMilik(dewi)).map((x) => [x.sourceKey, Number(x.amount), x.paidRefType, x.paidRefId])).toEqual([
        [putusReportKey(putus, SEP), 6_000, REF_KOMISI_SPG_PUTUS, okt.id],
      ]);
      expect(selisihMenunggu(await unitMilik(dewi))).toEqual([]);
    });
  });

  it("SPG yang berhenti: dua kantor mencatat sisa minus yang sama bersamaan → tepat satu utang (unit dibangun ulang di transaksinya)", async () => {
    // September dibayar bagi rata Rp 22.500, per SPG Sari Rp 20.000 → sisa −Rp 2.500 sesudah ia berhenti.
    await septemberBagiRata({ ani: true, sari: true });
    await prisma.spgSalesCheck.create({ data: { storeId: putus, period: SEP, checkedById: kantor, checkedAt: wib(`${OKT}-05T10:00:00`) } });
    const akhirSep = `${SEP}-${String(new Date(Date.UTC(Number(SEP.slice(0, 4)), Number(SEP.slice(5, 7)), 0)).getUTCDate()).padStart(2, "0")}`;
    await prisma.user.update({ where: { id: sari }, data: { spgEndedOn: akhirSep, spgEndedStoreId: putus, assignedStoreId: null } });

    const [a, b] = await Promise.all([
      catatSisaSpgBerhenti({ spgUserId: sari, olehUserId: kantor, jumlahDiharapkan: 2_500, kunci: `${tag}-sisa-a` }),
      catatSisaSpgBerhenti({ spgUserId: sari, olehUserId: kantor, jumlahDiharapkan: 2_500, kunci: `${tag}-sisa-b` }),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const kalah = a.ok ? b : a;
    expect(kalah.ok ? null : kalah.kode).toMatch(/^(TIDAK_ADA_SISA|ANGKA_BERUBAH)$/);
    const utang = await prisma.spgDebt.findMany({ where: { spgUserId: seededId(sari) }, select: { kind: true, amount: true } });
    expect(utang.map((u) => [u.kind, Number(u.amount)])).toEqual([["KOREKSI", 2_500]]);
    expect((await koreksiMilik(sari)).filter((k) => k.paidRefType === "SpgDebt")).toHaveLength(1);
    // Kiriman ulang dialog yang menang tidak mencatat apa pun lagi.
    const kunciMenang = a.ok ? `${tag}-sisa-a` : `${tag}-sisa-b`;
    expect(await catatSisaSpgBerhenti({ spgUserId: sari, olehUserId: kantor, jumlahDiharapkan: 2_500, kunci: kunciMenang })).toMatchObject({ ok: true, ulang: true });
    expect(await prisma.spgDebt.count({ where: { spgUserId: seededId(sari) } })).toBe(1);
  });

  /** Hari terakhir bulan "YYYY-MM". */
  const akhirBulan = (bulan: string) =>
    `${bulan}-${String(new Date(Date.UTC(Number(bulan.slice(0, 4)), Number(bulan.slice(5, 7)), 0)).getUTCDate()).padStart(2, "0")}`;

  it("pembayaran terakhir SPG yang berhenti lewat penulis bayar sungguhan: minus yang tidak tertutup menjadi utang; baris sesudahnya memotongnya penuh (B28, B31)", async () => {
    // September dibayar bagi rata Rp 22.500, per SPG Sari Rp 20.000 → −Rp 2.500. Oktober Sari menjual 1 kaos (Rp 2.000).
    await septemberBagiRata({ ani: true, sari: true });
    await prisma.spgSalesCheck.create({ data: { storeId: putus, period: SEP, checkedById: kantor, checkedAt: wib(`${OKT}-05T10:00:00`) } });
    await oktoberDitetapkan({ sari: 1 });
    await prisma.user.update({ where: { id: sari }, data: { spgEndedOn: akhirBulan(OKT), spgEndedStoreId: putus, assignedStoreId: null } });
    const okt = await barisPutus(sari, OKT);

    // Pembayaran terakhirnya: −Rp 2.000 diambil dari komisinya, −Rp 500 yang tidak tertutup menjadi utang (P6a).
    expect(await tandaiKomisiDibayar({ commissionId: okt.id, olehUserId: kantor, jumlahDiharapkan: 0 })).toMatchObject({ ok: true, dibayar: 0, koreksi: -2_000, utang: 500 });
    const utang = await prisma.spgDebt.findMany({ where: { spgUserId: seededId(sari) }, select: { id: true, kind: true, amount: true, status: true } });
    expect(utang.map((u) => [u.kind, Number(u.amount), u.status])).toEqual([["KOREKSI", 500, "TERBUKA"]]);
    const k = await koreksiMilik(sari);
    expect(k.map((x) => [x.paidRefType, Number(x.amount)]).sort()).toEqual(
      [
        [REF_KOMISI_SPG_PUTUS, -2_000],
        [REF_UTANG_SPG, -500],
      ].sort(),
    );
    // Selisih September tertutup seluruhnya: −2.000 dibayar, −500 menjadi utang — tidak dibawa lagi.
    expect(selisihMenunggu(await unitMilik(sari))).toEqual([]);

    // Baris yang dikunci sesudahnya memotong utangnya penuh (B31): komisi Rp 10.000 − utang Rp 500.
    const berikut = await konsiOktober(sari, 5);
    expect(await bayarKomisi({ commissionId: berikut.id, olehUserId: kantor, jumlahDiharapkan: 9_500 })).toMatchObject({ ok: true, dibayar: 9_500 });
    const lunas = await prisma.spgDebt.findUniqueOrThrow({ where: { id: utang[0].id }, select: { settledAmount: true, status: true } });
    expect([Number(lunas.settledAmount), lunas.status]).toEqual([500, "LUNAS"]);
    const potong = await prisma.spgDebtSettlement.findMany({ where: { debtId: seededId(utang[0].id) }, select: { kind: true, refType: true, refId: true, amount: true } });
    expect(potong.map((x) => [x.kind, x.refType, x.refId, Number(x.amount)])).toEqual([["POTONG", REF_KOMISI_KONSI, berikut.id, 500]]);
  });

  it("SPG yang berhenti: dua kantor membayarkan koreksi plus yang sama bersamaan → tepat satu pembayaran tambahan (B29, P67)", async () => {
    // September dibayar bagi rata Rp 22.500, per SPG Ani Rp 40.000 → +Rp 17.500 sesudah ia berhenti.
    await septemberBagiRata({ ani: true, sari: true });
    await prisma.spgSalesCheck.create({ data: { storeId: putus, period: SEP, checkedById: kantor, checkedAt: wib(`${OKT}-05T10:00:00`) } });
    await prisma.user.update({ where: { id: ani }, data: { spgEndedOn: akhirBulan(SEP), spgEndedStoreId: putus, assignedStoreId: null } });
    const hariIni = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
    const bayar = (kunci: string) =>
      terapkanKoreksiPlusSesudahAkhir({ spgUserId: ani, cara: "transfer", dibayarPada: hariIni, kunci, jumlahDiharapkan: 17_500, olehUserId: kantor });

    const [a, b] = await Promise.all([bayar(`${tag}-plus-a`), bayar(`${tag}-plus-b`)]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const kalah = a.ok ? b : a;
    expect(kalah.ok ? null : kalah.kode).toMatch(/^(TIDAK_ADA_KOREKSI_PLUS|ANGKA_BERUBAH)$/);
    const payout = await prisma.spgExtraPayout.findMany({ where: { spgUserId: seededId(ani) }, select: { amount: true, offsetAmount: true, idempotencyKey: true } });
    expect(payout.map((p) => [Number(p.amount), Number(p.offsetAmount)])).toEqual([[17_500, 0]]);
    expect((await koreksiMilik(ani)).filter((x) => x.paidRefType === REF_BAYAR_TAMBAHAN_SPG).map((x) => Number(x.amount))).toEqual([17_500]);

    // Kiriman ulang dialog yang menang tidak membayar apa pun lagi.
    expect(await bayar(payout[0].idempotencyKey)).toMatchObject({ ok: true, ulang: true });
    expect(await prisma.spgExtraPayout.count({ where: { spgUserId: seededId(ani) } })).toBe(1);
    expect(selisihMenunggu(await unitMilik(ani))).toEqual([]);
  });

  it("muatan HP Ani tidak membawa id, nama, atau rupiah Sari", async () => {
    await septemberBagiRata({ ani: true, sari: true });
    await oktoberDitetapkan({ ani: 15, sari: 5 });
    const json = JSON.stringify(await ringkasGajiSaya(ani));
    expect(json).not.toContain(sari);
    expect(json).not.toContain("Sari");
    // Komisi Sari per SPG (Rp 20.000 September, Rp 10.000 Oktober) dan koreksinya (−Rp 2.500).
    for (const angka of ["20000", "10000", "-2500"]) expect(json).not.toContain(angka);
    expect(json).toContain("17500");
  });
});
