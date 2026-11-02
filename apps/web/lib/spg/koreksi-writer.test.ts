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
import {
  daftarTunggakanKomisi,
  daftarTunggakanKomisiLama,
  jumlahKomisiSpgTertunggak,
  pemegangKomisiSpg,
  unitKomisiSpg,
} from "./koreksi-queries";
import { setujuiReturPembeli, tolakReturPembeli } from "./retur-pembeli";

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
  const MAKS_POTONG = 50;
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
  });

  beforeEach(() => {
    nota.length = 0;
    siklus.length = 0;
    retur.length = 0;
  });

  afterEach(async () => {
    await prisma.spgCommissionCorrection.deleteMany({ where: { spgUserId: { in: seededIds(orangIds()) } } });
    const audit = await prisma.auditLog.findMany({
      where: { entityType: { in: ["SpgCommission", "SpgSalesCheck", "ConsignmentCommission", "SpgSaleReturn", ENTITAS_KOREKSI_KOMISI] } },
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
    await prisma.user.deleteMany({ where: { id: { in: seededIds(orangIds()) } } });
    await prisma.store.deleteMany({ where: { id: { in: tokoIds() } } });
    await prisma.item.deleteMany({ where: { id: { in: seededIds([kaos, topi, tas, jaket].filter(Boolean)) } } });
    await prisma.spgCommissionRate.deleteMany({ where: { itemCategoryId: { in: kategoriIds() } } });
    await prisma.itemCategory.deleteMany({ where: { id: { in: kategoriIds() } } });
    if (uomId) await prisma.uOM.delete({ where: { id: seededId(uomId) } });
  });

  // ---------------------------------------------------------------- penyiap

  async function jual(salesmanId: string, storeId: string, waktu: Date, itemId: string, qty: number) {
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
        lines: { create: [{ itemId, productName: "uji", qty, unitPrice: 50_000, lineTotal: 50_000 * qty }] },
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
        salaried: true,
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
    rencanaBayarKomisi({ units: await unitMilik(userId), kunci, maksPotongPersen: MAKS_POTONG });

  // ---------------------------------------------------------------- tes

  it("bulan putus aturan lama yang sebagian sudah dibayar: baris Sari dibayar dengan angka per SPG, bukan Rp 22.500", async () => {
    const lama = await septemberBagiRata({ ani: true, sari: false });

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
    const r = rencanaBayarKomisi({ units, kunci: nov.kunci, maksPotongPersen: MAKS_POTONG });
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

  describe("HP SPG — baris yang belum boleh dibayar tidak pernah menjanjikan angka lama", () => {
    const fmt = { bulan: (p: string) => p, tanggal: (iso: string) => iso.slice(0, 10) };

    it("bulan putus aturan lama yang belum dicek: 'akan diterima' komisi per SPG Rp 20.000, Rp 22.500 hanya sebagai sebelumnya — dan itu yang dibayar sesudah dicek", async () => {
      const lama = await septemberBagiRata({ ani: false, sari: false });
      const sep = (await ringkasGajiSaya(sari)).resmi.find((r) => r.jenis === "PUTUS" && r.bulanJual === SEP);
      expect(sep).toMatchObject({ komisi: 20_000, komisiLama: 22_500, total: 20_000, diterima: 20_000, potong: 10, aturanLama: false, ditahan: false, dibayar: null });
      expect(sep?.belumPasti).toBe(false);
      const json = JSON.stringify(payloadGajiHp({ perkiraan: null, resmi: (await ringkasGajiSaya(sari)).resmi }, false, fmt));
      expect(JSON.parse(json).resmi[0]).toMatchObject({ diterima: 20_000, komisiLama: 22_500, belumPasti: false, ditahan: false });

      // Belum dicek: kantor belum bisa membayarnya; sesudah dicek, angkanya sama dengan yang dilihat HP.
      expect(await tandaiKomisiDibayar({ commissionId: lama.sari.id, olehUserId: kantor, jumlahDiharapkan: 20_000 })).toMatchObject({
        ok: false,
        code: "LAPORAN_BELUM_DICEK",
      });
      expect((await tandaiLaporanDicek({ storeId: putus, periode: SEP, olehUserId: kantor })).ok).toBe(true);
      expect(await tandaiKomisiDibayar({ commissionId: lama.sari.id, olehUserId: kantor, jumlahDiharapkan: 20_000 })).toMatchObject({ ok: true, dibayar: 20_000 });
    });

    it("ditahan (potong tanpa tarif) dan siklus yang kuncinya dibuka: tidak ada angka 'akan diterima'", async () => {
      await jual(ani, putus, wib(`${SEP}-10T10:00:00`), jaket, 20);
      await jual(sari, putus, wib(`${SEP}-11T10:00:00`), jaket, 10);
      await barisBagiRata({ ani: false, sari: false });
      const ditahan = (await ringkasGajiSaya(sari)).resmi.find((r) => r.jenis === "PUTUS" && r.bulanJual === SEP);
      expect(ditahan).toMatchObject({ ditahan: true, komisiLama: null });
      expect(ditahan?.belumPasti).toBe(false);

      // Siklus September yang kuncinya dibuka lagi: angkanya baru ada saat dikunci lagi.
      const c = await buatSiklus(SEP, null, [{ itemId: kaos, qty: 3 }]);
      await gajiKonsi(c, dewi, { pokok: 100_000, komisi: 22_500 });
      const dibuka = (await ringkasGajiSaya(dewi)).resmi.find((r) => r.jenis === "KONSI" && r.bulanJual === SEP);
      expect(dibuka).toMatchObject({ bulanBayar: null, ditahan: false, belumPasti: true });
      const muatan = payloadGajiHp({ perkiraan: null, resmi: dibuka ? [dibuka] : [] }, true, fmt);
      expect(muatan.resmi[0]).toMatchObject({ bulanBayarLabel: null, belumPasti: true });
    });
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

  it("siklus konsi aturan lama yang terkunci dengan baris Rp 22.500 sama rata: Ani dibayar komisi Rp 40.000, tidak pernah Rp 22.500", async () => {
    await jual(ani, konsi, wib(`${SEP}-10T10:00:00`), kaos, 20);
    await jual(sari, konsi, wib(`${SEP}-11T10:00:00`), kaos, 10);
    const c = await buatSiklus(SEP, wib(`${OKT}-05T10:00:00`), [{ itemId: kaos, qty: 30 }]);
    const baris = await gajiKonsi(c, ani, { pokok: 500_000, komisi: 22_500 });
    await gajiKonsi(c, sari, { pokok: 500_000, komisi: 22_500 });

    expect(await bayarKomisi({ commissionId: baris.id, olehUserId: kantor, jumlahDiharapkan: 522_500 })).toMatchObject({ ok: false, alasan: "ANGKA_BERUBAH" });
    const tetap = await prisma.consignmentCommission.findUniqueOrThrow({ where: { id: baris.id }, select: { commission: true, total: true, paidAt: true } });
    expect([Number(tetap.commission), Number(tetap.total), tetap.paidAt]).toEqual([22_500, 522_500, null]);

    expect(await bayarKomisi({ commissionId: baris.id, olehUserId: kantor, jumlahDiharapkan: 540_000 })).toMatchObject({ ok: true, diubah: true, dibayar: 540_000 });
    const dibayar = await prisma.consignmentCommission.findUniqueOrThrow({ where: { id: baris.id }, select: { commission: true, total: true, paidAt: true } });
    expect([Number(dibayar.commission), Number(dibayar.total)]).toEqual([40_000, 540_000]);
    expect(dibayar.paidAt).not.toBeNull();
    expect(await prisma.auditLog.count({ where: { action: JEJAK_KOMISI_SPG.DIHITUNG_ULANG_SAAT_BAYAR, entityId: seededId(baris.id) } })).toBe(1);
  });

  it("siklus konsi aturan lama yang SUDAH dibayar: selisihnya ikut baris konsi Ani berikutnya", async () => {
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

  describe("penahanan — laporan aturan lama yang tidak bisa dibandingkan jujur", () => {
    it("tarif pertama baru sejak Oktober (seperti produksi): September bagi rata yang sudah dibayar TIDAK dikoreksi −Rp 22.500, dan baris September yang belum dibayar ditolak TANPA_TARIF", async () => {
      await jual(ani, putus, wib(`${SEP}-10T10:00:00`), jaket, 20);
      await jual(sari, putus, wib(`${SEP}-11T10:00:00`), jaket, 10);
      const lama = await barisBagiRata({ ani: true, sari: false });

      const unitSari = (await unitMilik(sari)).find((u) => u.kunci === putusReportKey(putus, SEP))!;
      expect(unitSari).toMatchObject({ angka: 0, potongTanpaTarif: 10, ditahan: "TANPA_TARIF" });

      // Tidak dibayar dengan Rp 0 (hitungan sekarang) maupun Rp 22.500 (angka lama): ditolak, tidak ada yang tertulis.
      for (const jumlahDiharapkan of [0, 22_500]) {
        expect(await tandaiKomisiDibayar({ commissionId: lama.sari.id, olehUserId: kantor, jumlahDiharapkan })).toEqual({ ok: false, code: "TANPA_TARIF" });
      }
      const tetap = await barisPutus(sari, SEP);
      expect([Number(tetap.commission), tetap.basis, tetap.paidAt]).toEqual([22_500, "BAGI_RATA", null]);
      expect(await prisma.auditLog.count({ where: { entityId: seededId(lama.sari.id) } })).toBe(0);

      // Pembayaran Ani berikutnya tidak membawa September (−Rp 22.500 kalau potongnya dibaca Rp 0).
      await oktoberDitetapkan({ ani: 15 });
      const okt = await barisPutus(ani, OKT);
      expect(await rencanaUntuk(ani, putusReportKey(putus, OKT))).toMatchObject({ sasaran: true, koreksi: [], jumlahKoreksi: 0, dibayar: 30_000 });
      expect(await tandaiKomisiDibayar({ commissionId: okt.id, olehUserId: kantor, jumlahDiharapkan: 30_000 })).toMatchObject({ ok: true, koreksi: 0 });
      expect(await koreksiMilik(ani)).toEqual([]);
      expect(await koreksiMilik(sari)).toEqual([]);

      // Kantor melihat keduanya menunggu keputusan pemilik.
      const ditahan = (await daftarKomisiKantor(BULAN_INI, new Date())).koreksiDitahan;
      expect(ditahan.find((d) => d.userId === ani)?.baris).toEqual([
        expect.objectContaining({ sumber: putusReportKey(putus, SEP), alasan: "TANPA_TARIF", selisih: -22_500, belumDibayar: false }),
      ]);
      expect(ditahan.find((d) => d.userId === sari)?.baris).toEqual([
        expect.objectContaining({ sumber: putusReportKey(putus, SEP), alasan: "TANPA_TARIF", belumDibayar: true }),
      ]);
    });

    it("siklus konsi aturan lama yang angka resminya tidak seluruhnya tercatat di HP (Q7): yang sudah dibayar tidak dikoreksi, yang belum dibayar dibayar dengan aturan hari ini beserta gajinya", async () => {
      // Resmi 30 kaos + 2 baris diketik tanpa barang; HP mencatat Ani 8, Sari 4.
      await jual(ani, konsi, wib(`${SEP}-10T10:00:00`), kaos, 8);
      await jual(sari, konsi, wib(`${SEP}-11T10:00:00`), kaos, 4);
      const c = await buatSiklus(SEP, wib(`${OKT}-05T10:00:00`), [
        { itemId: kaos, qty: 30 },
        { itemId: null, qty: 2 },
      ]);
      await gajiKonsi(c, ani, { pokok: 0, komisi: 22_500, dibayar: wib(`${OKT}-06T10:00:00`) });
      const sariBaris = await gajiKonsi(c, sari, { pokok: 500_000, komisi: 22_500 });

      // Ani sudah dibayar Rp 22.500 dari angka resmi; HP-nya hanya Rp 16.000 → tidak ditarik kembali.
      expect((await unitMilik(ani)).find((u) => u.kunci === konsiReportKey(c))).toMatchObject({ angka: 16_000, ditahan: "LAPORAN_TIDAK_LENGKAP" });
      // Baris Sari yang belum dibayar tidak ditahan, juga tidak di kartu #tunggakan.
      expect((await unitMilik(sari)).find((u) => u.kunci === konsiReportKey(c))).toMatchObject({ angka: 8_000, ditahan: null });
      const rencanaSari = await rencanaUntuk(sari, konsiReportKey(c));
      expect(rencanaSari).toMatchObject({ ditahan: null, komisiLama: 22_500, komisiBaru: 8_000, berubah: true, dibayar: 508_000 });

      // Dibayar dengan aturan hari ini (Q7): gaji pokok Rp 500.000 + komisi potong HP 4 × Rp 2.000.
      expect(await bayarKomisi({ commissionId: sariBaris.id, olehUserId: kantor, jumlahDiharapkan: 508_000 })).toMatchObject({
        ok: true,
        diubah: true,
        dibayar: 508_000,
        koreksi: 0,
      });
      const sesudah = await prisma.consignmentCommission.findUniqueOrThrow({ where: { id: sariBaris.id }, select: { commission: true, total: true, paidAt: true } });
      expect([Number(sesudah.commission), Number(sesudah.total), sesudah.paidAt !== null]).toEqual([8_000, 508_000, true]);
      // Dibayar sebesar angkanya: tidak ada selisih, tidak ada yang ditahan.
      const unitSari = (await unitMilik(sari)).find((u) => u.kunci === konsiReportKey(c))!;
      expect([unitSari.ditahan, selisihUnit(unitSari)]).toEqual([null, 0]);

      // Pembayaran konsi Ani berikutnya tidak menarik kembali −Rp 6.500 dari September.
      const berikut = await konsiOktober(ani, 5);
      expect(await bayarKomisi({ commissionId: berikut.id, olehUserId: kantor, jumlahDiharapkan: 10_000 })).toMatchObject({ ok: true, dibayar: 10_000, koreksi: 0 });
      expect(await koreksiMilik(ani)).toEqual([]);
      expect(await koreksiMilik(sari)).toEqual([]);
    });
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

  it("tunggakan: daftar tersaring sama dengan kartu #tunggakan; yang lebih tua dari jendela didaftar terpisah dan tidak dihitung Beranda", async () => {
    const lama = await septemberBagiRata({ ani: true, sari: false });
    const c = await buatSiklus(SEP, wib(`${OKT}-05T10:00:00`), [{ itemId: kaos, qty: 1 }]);
    await jual(sari, konsi, wib(`${SEP}-12T10:00:00`), kaos, 1);
    const konsiBaris = await gajiKonsi(c, sari, { pokok: 0, komisi: 2_000 });
    // Dikunci sebulan sebelum awal jendela koreksi dan belum pernah dibayar: tunggakan paling tua.
    const bulanKunciTua = bulanSebelum(awalJendelaKoreksi(BULAN_INI));
    const tua = await buatSiklus(bulanSebelum(bulanKunciTua), wib(`${bulanKunciTua}-05T10:00:00`), [{ itemId: kaos, qty: 1 }]);
    const tuaBaris = await gajiKonsi(tua, sari, { pokok: 100_000, komisi: 0 });

    const lingkup = { storeIds: tokoIds() };
    const urut = (xs: { refId: string }[]) => xs.map((t) => t.refId).sort();
    const sekarang = new Date();
    const dalam = urut(await daftarTunggakanKomisi(prisma, sekarang, lingkup));
    const lampau = urut(await daftarTunggakanKomisiLama(prisma, sekarang, lingkup));
    expect(dalam).toEqual([lama.sari.id, konsiBaris.id].sort());
    expect(lampau).toEqual([tuaBaris.id]);

    const halaman = await daftarKomisiKantor(BULAN_INI, sekarang);
    const milikUji = (xs: { storeId: string; refId: string }[]) => urut(xs.filter((t) => tokoIds().includes(t.storeId)));
    expect(milikUji(halaman.tunggakan)).toEqual(dalam);
    expect(milikUji(halaman.tunggakanLama)).toEqual(lampau);
    // Baris tunggakan lama tidak pernah menjadi sasaran koreksi.
    expect(halaman.tunggakanLama.find((t) => t.refId === tuaBaris.id)?.bayar?.sasaran).toBe(false);

    // Siklus aturan lama tanpa nota HP (laporan diketik kantor): baris yang belum dibayar TIDAK ditahan —
    // dibayar dengan aturan hari ini (Q7): komisi Rp 0, gaji pokoknya tetap.
    expect((await daftarTunggakanKomisiLama(prisma, sekarang, lingkup)).find((t) => t.refId === tuaBaris.id)?.ditahan).toBeNull();
    expect(halaman.tunggakanLama.find((t) => t.refId === tuaBaris.id)?.bayar).toMatchObject({ ditahan: null, komisiBaru: 0, dibayar: 100_000 });

    // Beranda menghitung tepat bagian di jendela yang bisa dibayar — satu definisi dengan kartu (seluruh basis data, bukan hanya milik uji).
    const semuaDiJendela = await daftarTunggakanKomisi(prisma, sekarang);
    expect(await jumlahKomisiSpgTertunggak(sekarang)).toBe(semuaDiJendela.filter((t) => t.ditahan === null).length);
    expect(semuaDiJendela.some((t) => t.refId === tuaBaris.id)).toBe(false);
  });

  it("tunggakan yang menunggu keputusan pemilik: didaftar terpisah di kartu #tunggakan dan TIDAK dihitung Beranda", async () => {
    // September bagi rata dengan jaket (tarifnya baru sejak "Oktober"): Ani dibayar, baris Sari ditahan TANPA_TARIF.
    await jual(ani, putus, wib(`${SEP}-10T10:00:00`), jaket, 20);
    await jual(sari, putus, wib(`${SEP}-11T10:00:00`), jaket, 10);
    const lama = await barisBagiRata({ ani: true, sari: false });
    const lingkup = { storeIds: tokoIds() };
    const sekarang = new Date();

    const dalam = await daftarTunggakanKomisi(prisma, sekarang, lingkup);
    expect(dalam.map((t) => [t.refId, t.ditahan])).toEqual([[lama.sari.id, "TANPA_TARIF"]]);

    const halaman = await daftarKomisiKantor(BULAN_INI, sekarang);
    expect(halaman.tunggakan.some((t) => t.refId === lama.sari.id)).toBe(false);
    const ditahan = halaman.tunggakanDitahan.find((t) => t.refId === lama.sari.id);
    // Satu aturan dengan rencana bayarnya: penulis menolak baris ini dengan sebab yang sama.
    expect([ditahan?.ditahan, ditahan?.bayar?.ditahan]).toEqual(["TANPA_TARIF", "TANPA_TARIF"]);
    expect(await tandaiKomisiDibayar({ commissionId: lama.sari.id, olehUserId: kantor, jumlahDiharapkan: 22_500 })).toEqual({ ok: false, code: "TANPA_TARIF" });

    const semuaDiJendela = await daftarTunggakanKomisi(prisma, sekarang);
    expect(semuaDiJendela.find((t) => t.refId === lama.sari.id)?.ditahan).toBe("TANPA_TARIF");
    expect(await jumlahKomisiSpgTertunggak(sekarang)).toBe(semuaDiJendela.filter((t) => t.ditahan === null).length);
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
