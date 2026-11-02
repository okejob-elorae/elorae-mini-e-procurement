import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { bulanWib } from "@/lib/salesman/pengaturan";
import { salesMonthNoteId } from "@/lib/spg-commission/payout";
import { bulanSebelum, DASAR_TARIF_KATEGORI, JEJAK_KOMISI_SPG } from "./komisi";
import { payloadGajiHp } from "./komisi-hp";
import { daftarKomisiKantor, komisiResmiSaya, perkiraanKomisiHp } from "./komisi-queries";
import { batalkanTandaDicek, tandaiKomisiDibayar, tandaiLaporanDicek, tetapkanKomisiToko } from "./komisi-writer";
import { tokoSpg } from "./queries";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

/**
 * Komisi SPG toko putus terhadap basis data sungguhan, dengan SATU hitungan (keputusan pemilik
 * 2026-11-01): tarif per kategori bulan penjualan × potong yang dijual masing-masing SPG. Laporan
 * dicek dulu ("Tandai laporan dicek" — bulan dicek = bulan pembayaran), baru ditetapkan dan
 * dibayar; batal dicek hanya selama belum ada yang dibayar; HP tidak pernah membawa rupiah rekan.
 * `Item.commissionPerPcs` diisi angka yang akan kelihatan kalau masih dibaca. Semua baris diseed di
 * sini; penghapusan lewat `seededId(s)`.
 */
d("komisi SPG toko putus (test bed only)", () => {
  const tag = `KSP${Math.random().toString(36).slice(2, 8)}`;
  const BULAN_INI = bulanWib(new Date());
  /** Dua bulan lalu: sudah selesai, dan masih di jendela antrean "menunggu dicek". */
  const PERIODE = bulanSebelum(bulanSebelum(BULAN_INI));
  const SEBELUM = bulanSebelum(PERIODE);
  const SESUDAH = bulanSebelum(BULAN_INI);
  let uomId = "";
  let katKaos = "";
  let katTopi = "";
  let kaos = "";
  let topi = "";
  let putus = "";
  let putusKosong = "";
  let konsi = "";
  let spgA = "";
  let spgB = "";
  let spgK = "";
  let kantor = "";
  const nota: string[] = [];
  let nomor = 0;

  const tokoIds = () => seededIds([putus, putusKosong, konsi].filter(Boolean));

  beforeAll(async () => {
    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    const kategori = async (kode: string, tarif: number) => {
      const id = (await prisma.itemCategory.create({ data: { code: `${tag}-${kode}`, name: `${kode} ${tag}`, isActive: true } })).id;
      await prisma.spgCommissionRate.create({ data: { itemCategoryId: id, amountPerPiece: tarif, effectiveFrom: "2020-01", createdById: "uji" } });
      return id;
    };
    katKaos = await kategori("KAOS", 2_500);
    katTopi = await kategori("TOPI", 1_000);
    const barang = async (kode: string, categoryId: string) =>
      (
        await prisma.item.create({
          // Tarif barang sengaja besar: kalau masih dibaca, angka mana pun akan memuatnya.
          data: { sku: `${tag}-${kode}`, nameId: `${kode} ${tag}`, nameEn: kode, type: "FINISHED_GOOD", uomId, categoryId, sellingPrice: 50_000, commissionPerPcs: 99_999 },
        })
      ).id;
    kaos = await barang("KAOS", katKaos);
    topi = await barang("TOPI", katTopi);

    const toko = async (kode: string, termsType: "PUTUS" | "KONSI") =>
      (await prisma.store.create({ data: { code: `${tag}-${kode}`, name: `Toko ${kode} ${tag}`, address: "uji", termsType } })).id;
    putus = await toko("PUTUS", "PUTUS");
    putusKosong = await toko("KOSONG", "PUTUS");
    konsi = await toko("KONSI", "KONSI");

    const orang = async (nama: string, storeId: string | null) =>
      (await prisma.user.create({ data: { email: `${tag}-${nama}@test.local`.toLowerCase(), name: `${nama} ${tag}`, assignedStoreId: storeId } })).id;
    spgA = await orang("Ani", putus);
    spgB = await orang("Budi", putus);
    spgK = await orang("Kirana", konsi);
    kantor = await orang("Kantor", null);
  });

  afterEach(async () => {
    await prisma.spgCommissionCorrection.deleteMany({ where: { spgUserId: { in: seededIds([spgA, spgB, spgK].filter(Boolean)) } } });
    const audit = await prisma.auditLog.findMany({
      where: { entityType: { in: ["SpgCommission", "SpgSalesCheck"] } },
      select: { id: true, metadata: true },
    });
    const milikUji = audit
      .filter((a) => {
        const m = a.metadata as Record<string, unknown> | null;
        return typeof m?.storeId === "string" && tokoIds().includes(m.storeId);
      })
      .map((a) => a.id);
    await prisma.auditLog.deleteMany({ where: { id: { in: seededIds(milikUji) } } });
    await prisma.spgCommission.deleteMany({ where: { storeId: { in: tokoIds() } } });
    await prisma.spgSalesCheck.deleteMany({ where: { storeId: { in: tokoIds() } } });
    await prisma.spgSaleReturn.deleteMany({ where: { spgSaleId: { in: seededIds(nota) } } });
    await prisma.spgSale.deleteMany({ where: { id: { in: seededIds(nota) } } });
    nota.length = 0;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: seededIds([spgA, spgB, spgK, kantor].filter(Boolean)) } } });
    await prisma.store.deleteMany({ where: { id: { in: tokoIds() } } });
    await prisma.item.deleteMany({ where: { id: { in: seededIds([kaos, topi].filter(Boolean)) } } });
    await prisma.spgCommissionRate.deleteMany({ where: { itemCategoryId: { in: seededIds([katKaos, katTopi].filter(Boolean)) } } });
    await prisma.itemCategory.deleteMany({ where: { id: { in: seededIds([katKaos, katTopi].filter(Boolean)) } } });
    if (uomId) await prisma.uOM.delete({ where: { id: seededId(uomId) } });
  });

  async function jual(salesmanId: string, storeId: string, waktu: Date, baris: { itemId: string; qty: number }[]) {
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
        lines: { create: baris.map((b) => ({ itemId: b.itemId, productName: "uji", qty: b.qty, unitPrice: 50_000, lineTotal: 50_000 * b.qty })) },
      },
      select: { id: true, lines: { select: { id: true, itemId: true } } },
    });
    nota.push(s.id);
    return s;
  }

  async function kembalikan(sale: { id: string; lines: { id: string; itemId: string }[] }, storeId: string, qty: number, waktu: Date) {
    await prisma.spgSaleReturn.create({
      data: {
        spgSaleId: sale.id,
        storeId,
        createdById: kantor,
        reason: "uji",
        idempotencyKey: `${tag}-r${nomor++}`,
        createdAt: waktu,
        // Hanya retur yang disetujui kantor mengurangi komisi (keputusan pemilik 2026-11-02).
        status: "DISETUJUI",
        lines: { create: [{ spgSaleLineId: sale.lines[0].id, itemId: sale.lines[0].itemId, qty }] },
      },
    });
  }

  const wib = (s: string) => new Date(`${s}+07:00`);

  /** Ani 3 kaos + 1 topi; Budi 5 kaos, 2 dikembalikan; nota di luar bulan diabaikan. Ani 8.500, Budi 7.500. */
  async function bulanJual() {
    await jual(spgA, putus, wib(`${PERIODE}-10T10:00:00`), [
      { itemId: kaos, qty: 3 },
      { itemId: topi, qty: 1 },
    ]);
    const b = await jual(spgB, putus, wib(`${PERIODE}-28T23:30:00`), [{ itemId: kaos, qty: 5 }]);
    await kembalikan(b, putus, 2, wib(`${PERIODE}-28T23:45:00`));
    await jual(spgA, putus, wib(`${SEBELUM}-28T23:30:00`), [{ itemId: kaos, qty: 10 }]);
    await jual(spgB, putus, wib(`${SESUDAH}-01T00:10:00`), [{ itemId: kaos, qty: 10 }]);
  }

  const cek = () => tandaiLaporanDicek({ storeId: putus, periode: PERIODE, olehUserId: kantor });
  const tetapkan = () => tetapkanKomisiToko({ storeId: putus, periode: PERIODE, olehUserId: kantor });

  const baris = (storeId = putus) =>
    prisma.spgCommission.findMany({
      where: { storeId: seededId(storeId), period: PERIODE },
      orderBy: { commission: "desc" },
      select: { id: true, userId: true, unitsSold: true, commission: true, basis: true, lockedById: true, paidAt: true },
    });

  const jejak = async () => {
    const semua = await prisma.auditLog.findMany({
      where: { entityType: { in: ["SpgCommission", "SpgSalesCheck"] } },
      orderBy: { createdAt: "asc" },
      select: { action: true, entityId: true, changes: true, metadata: true, reason: true },
    });
    return semua.filter((a) => (a.metadata as Record<string, unknown> | null)?.storeId === putus);
  };

  const laporanKantor = async () =>
    (await daftarKomisiKantor(BULAN_INI, new Date())).putus.find((l) => l.storeId === putus && l.bulanJual === PERIODE);

  it("dicek lalu ditetapkan: tarif kategori × potong masing-masing SPG, dibayar di bulan dicek dengan catatan bulan penjualan", async () => {
    await bulanJual();

    expect(await cek()).toEqual({ ok: true, bulanBayar: BULAN_INI });
    const j1 = await jejak();
    expect(j1.map((x) => x.action)).toEqual([JEJAK_KOMISI_SPG.LAPORAN_DICEK]);
    expect(j1[0].metadata).toMatchObject({ period: PERIODE, bulanBayar: BULAN_INI, catatan: salesMonthNoteId(PERIODE), totalToko: 16_000 });

    expect(await tetapkan()).toEqual({ ok: true, ulang: false, ditulis: 2, dihapus: 0, totalToko: 16_000 });
    const r = await baris();
    expect(r.map((x) => [x.userId, x.unitsSold, Number(x.commission), x.basis, x.lockedById, x.paidAt])).toEqual([
      [spgA, 4, 8_500, DASAR_TARIF_KATEGORI, kantor, null],
      [spgB, 3, 7_500, DASAR_TARIF_KATEGORI, kantor, null],
    ]);
    const j2 = (await jejak()).filter((x) => x.action === JEJAK_KOMISI_SPG.DITETAPKAN);
    expect(j2.find((x) => x.entityId === r[0].id)?.changes).toEqual({
      before: null,
      after: { unitsSold: 4, commission: 8_500, basis: DASAR_TARIF_KATEGORI, deduction: 0 },
    });
  });

  it("menolak menetapkan dan membayar laporan yang belum dicek — termasuk baris aturan lama", async () => {
    await bulanJual();
    expect(await tetapkan()).toEqual({ ok: false, code: "LAPORAN_BELUM_DICEK" });
    const lama = await prisma.spgCommission.create({
      data: { userId: spgA, storeId: putus, period: PERIODE, unitsSold: 4, commission: 7_500, basis: "PER_SPG", lockedById: kantor },
    });
    expect(await tandaiKomisiDibayar({ commissionId: lama.id, olehUserId: kantor })).toEqual({ ok: false, code: "LAPORAN_BELUM_DICEK" });
    // Dicek lalu ditetapkan ulang: baris lama diganti hitungan tarif kategori sebelum bisa dibayar.
    expect((await cek()).ok).toBe(true);
    expect(await tetapkan()).toMatchObject({ ok: true, ulang: true });
    expect((await baris()).map((x) => [x.userId, Number(x.commission), x.basis])).toEqual([
      [spgA, 8_500, DASAR_TARIF_KATEGORI],
      [spgB, 7_500, DASAR_TARIF_KATEGORI],
    ]);
  });

  it("baris aturan lama yang laporannya sudah dicek dibayar dengan komisi per SPG sekarang, tidak pernah dengan angka tersimpannya", async () => {
    await bulanJual();
    const lama = await prisma.spgCommission.create({
      data: { userId: spgA, storeId: putus, period: PERIODE, unitsSold: 4, commission: 7_500, basis: "BAGI_RATA", lockedById: kantor },
    });
    expect((await cek()).ok).toBe(true);
    // Layar yang masih menyebut angka lama ditolak tanpa menulis apa pun.
    expect(await tandaiKomisiDibayar({ commissionId: lama.id, olehUserId: kantor, jumlahDiharapkan: 7_500 })).toMatchObject({
      ok: false,
      code: "ANGKA_BERUBAH",
      jumlah: 8_500,
    });
    expect((await prisma.spgCommission.findUniqueOrThrow({ where: { id: lama.id } })).paidAt).toBeNull();
    expect((await jejak()).some((x) => x.action === JEJAK_KOMISI_SPG.DIBAYAR)).toBe(false);

    expect(await tandaiKomisiDibayar({ commissionId: lama.id, olehUserId: kantor, jumlahDiharapkan: 8_500 })).toMatchObject({
      ok: true,
      diubah: true,
      dibayar: 8_500,
    });
    const ani = await prisma.spgCommission.findUniqueOrThrow({ where: { id: lama.id } });
    expect([Number(ani.commission), ani.unitsSold, ani.basis, ani.paidAt !== null]).toEqual([8_500, 4, DASAR_TARIF_KATEGORI, true]);
    // Satu jejak hitung ulang untuk baris itu (dicari lewat id barisnya; metadatanya menyebut SPG-nya).
    expect(
      await prisma.auditLog.count({ where: { action: JEJAK_KOMISI_SPG.DIHITUNG_ULANG_SAAT_BAYAR, entityId: seededId(lama.id) } }),
    ).toBe(1);
    await prisma.auditLog.deleteMany({ where: { action: JEJAK_KOMISI_SPG.DIHITUNG_ULANG_SAAT_BAYAR, entityId: seededId(lama.id) } });
  });

  it("menolak mencek toko × bulan yang komisinya sudah dibayar dengan aturan lama — bulan itu tidak dihitung dua kali", async () => {
    await bulanJual();
    await prisma.spgCommission.create({
      data: {
        userId: spgA,
        storeId: putus,
        period: PERIODE,
        unitsSold: 4,
        commission: 7_500,
        basis: "PER_SPG",
        lockedById: kantor,
        paidAt: new Date(),
        paidById: kantor,
      },
    });
    expect(await cek()).toEqual({ ok: false, code: "SUDAH_DIBAYAR" });
    expect(await prisma.spgSalesCheck.count({ where: { storeId: seededId(putus), period: PERIODE } })).toBe(0);
    expect((await jejak()).some((x) => x.action === JEJAK_KOMISI_SPG.LAPORAN_DICEK)).toBe(false);
    // Antrean "menunggu dicek" tidak menawarkannya.
    const kantorBulanIni = await daftarKomisiKantor(BULAN_INI, new Date());
    expect(kantorBulanIni.menungguCek.some((m) => m.storeId === putus && m.bulanJual === PERIODE)).toBe(false);

    // Baris Budi yang belum dibayar tidak terkunci selamanya: dibayar tanpa tanda dicek, dengan komisi
    // per SPG-nya sendiri (3 kaos × 2.500 = 7.500), bukan angka aturan lamanya.
    const budi = await prisma.spgCommission.create({
      data: { userId: spgB, storeId: putus, period: PERIODE, unitsSold: 4, commission: 9_000, basis: "BAGI_RATA", lockedById: kantor },
    });
    expect(await tandaiKomisiDibayar({ commissionId: budi.id, olehUserId: kantor, jumlahDiharapkan: 7_500 })).toMatchObject({
      ok: true,
      diubah: true,
      dibayar: 7_500,
    });
    const b = await prisma.spgCommission.findUniqueOrThrow({ where: { id: budi.id } });
    expect([Number(b.commission), b.unitsSold, b.basis]).toEqual([7_500, 3, DASAR_TARIF_KATEGORI]);
    await prisma.auditLog.deleteMany({ where: { action: JEJAK_KOMISI_SPG.DIHITUNG_ULANG_SAAT_BAYAR, entityId: seededId(budi.id) } });
  });

  it("tandai dicek menolak bulan berjalan, toko konsinyasi, toko tanpa penjualan, dan dicek dua kali — juga bersamaan", async () => {
    await bulanJual();
    expect(await tandaiLaporanDicek({ storeId: putus, periode: BULAN_INI, olehUserId: kantor })).toEqual({ ok: false, code: "BULAN_BELUM_SELESAI" });
    expect(await tandaiLaporanDicek({ storeId: putus, periode: "2026-8", olehUserId: kantor })).toEqual({ ok: false, code: "PERIODE_TIDAK_SAH" });
    expect(await tandaiLaporanDicek({ storeId: konsi, periode: PERIODE, olehUserId: kantor })).toEqual({ ok: false, code: "BUKAN_TOKO_PUTUS" });
    expect(await tandaiLaporanDicek({ storeId: putusKosong, periode: PERIODE, olehUserId: kantor })).toEqual({ ok: false, code: "TANPA_PENJUALAN" });

    const hasil = await Promise.all([cek(), cek()]);
    expect(hasil.filter((h) => h.ok)).toHaveLength(1);
    expect(hasil.filter((h) => !h.ok)).toEqual([{ ok: false, code: "SUDAH_DICEK" }]);
    expect(await prisma.spgSalesCheck.count({ where: { storeId: seededId(putus), period: PERIODE } })).toBe(1);
  });

  it("batal dicek menghapus komisi yang belum dibayar dengan jejaknya; dicek dan ditetapkan lagi tidak menggandakan; ditolak sesudah ada yang dibayar", async () => {
    await bulanJual();
    await cek();
    await tetapkan();

    expect(await batalkanTandaDicek({ storeId: putus, periode: PERIODE, olehUserId: kantor, alasan: " " })).toEqual({ ok: false, code: "ALASAN_WAJIB" });
    expect(await batalkanTandaDicek({ storeId: putus, periode: PERIODE, olehUserId: kantor, alasan: "nota HP belum masuk" })).toEqual({ ok: true, dihapus: 2 });
    expect(await baris()).toEqual([]);
    expect(await prisma.spgSalesCheck.count({ where: { storeId: seededId(putus), period: PERIODE } })).toBe(0);
    const batal = (await jejak()).filter((x) => x.action === JEJAK_KOMISI_SPG.LAPORAN_BATAL_DICEK);
    expect(batal).toHaveLength(1);
    expect(batal[0]).toMatchObject({ reason: "nota HP belum masuk", changes: { after: null } });
    expect(await batalkanTandaDicek({ storeId: putus, periode: PERIODE, olehUserId: kantor, alasan: "lagi" })).toEqual({ ok: false, code: "BELUM_DICEK" });

    // Dicek ulang dan ditetapkan ulang: tetap satu baris per SPG, angka yang sama.
    await cek();
    await tetapkan();
    expect((await baris()).map((x) => [x.userId, Number(x.commission)])).toEqual([
      [spgA, 8_500],
      [spgB, 7_500],
    ]);
    expect(await prisma.spgSalesCheck.count({ where: { storeId: seededId(putus), period: PERIODE } })).toBe(1);

    const [ani] = await baris();
    expect(await tandaiKomisiDibayar({ commissionId: ani.id, olehUserId: kantor, jumlahDiharapkan: 8_500 })).toMatchObject({ ok: true, dibayar: 8_500 });
    expect(await batalkanTandaDicek({ storeId: putus, periode: PERIODE, olehUserId: kantor, alasan: "terlambat" })).toEqual({ ok: false, code: "SUDAH_DIBAYAR" });
    expect(await prisma.spgSalesCheck.count({ where: { storeId: seededId(putus), period: PERIODE } })).toBe(1);
  });

  it("ditetapkan ulang sesudah nota yang menyusul, dengan angka lama di jejak; kantor melihat bedanya lebih dulu", async () => {
    await bulanJual();
    await cek();
    await tetapkan();

    // Nota dari antrean HP yang baru tersinkron, bertanggal di bulan penjualan.
    await jual(spgA, putus, wib(`${PERIODE}-20T12:00:00`), [{ itemId: kaos, qty: 2 }]);
    const lihat = await laporanKantor();
    expect(lihat?.berbeda).toBe(true);
    expect(lihat?.baris.find((b) => b.userId === spgA)).toMatchObject({ potong: 6, komisi: 13_500, status: "DITETAPKAN" });

    expect(await tetapkan()).toMatchObject({ ok: true, ulang: true, ditulis: 2 });
    const r = await baris();
    expect(r.map((x) => [x.userId, Number(x.commission)])).toEqual([
      [spgA, 13_500],
      [spgB, 7_500],
    ]);
    const ulang = (await jejak()).filter((x) => x.action === JEJAK_KOMISI_SPG.DITETAPKAN_ULANG);
    expect(ulang.find((x) => x.entityId === r[0].id)?.changes).toEqual({
      before: { unitsSold: 4, commission: 8_500, basis: DASAR_TARIF_KATEGORI, deduction: 0 },
      after: { unitsSold: 6, commission: 13_500, basis: DASAR_TARIF_KATEGORI, deduction: 0 },
    });
    expect((await laporanKantor())?.berbeda).toBe(false);
  });

  it("dua penetapan pertama bersamaan berakhir dengan satu baris per SPG", async () => {
    await bulanJual();
    await cek();
    const [a, b] = await Promise.all([tetapkan(), tetapkan()]);
    expect(a.ok && b.ok).toBe(true);
    expect((await baris()).map((x) => Number(x.commission))).toEqual([8_500, 7_500]);
  });

  it("dibayar tepat sekali di bawah balapan, lalu bulan toko itu tidak bisa ditetapkan ulang", async () => {
    await bulanJual();
    await cek();
    await tetapkan();
    const [ani] = await baris();

    const hasil = await Promise.all([
      tandaiKomisiDibayar({ commissionId: ani.id, olehUserId: kantor, catatan: "transfer" }),
      tandaiKomisiDibayar({ commissionId: ani.id, olehUserId: kantor }),
    ]);
    expect(hasil.filter((h) => h.ok)).toHaveLength(1);
    expect(hasil.filter((h) => !h.ok)).toEqual([{ ok: false, code: "SUDAH_DIBAYAR" }]);

    const dibayar = (await jejak()).filter((x) => x.action === JEJAK_KOMISI_SPG.DIBAYAR);
    expect(dibayar).toHaveLength(1);
    expect(dibayar[0].metadata).toMatchObject({ bulanBayar: BULAN_INI, catatan: salesMonthNoteId(PERIODE) });

    expect(await tetapkan()).toEqual({ ok: false, code: "SUDAH_DIBAYAR" });
    expect(await tandaiKomisiDibayar({ commissionId: "tidak-ada", olehUserId: kantor })).toEqual({ ok: false, code: "TIDAK_DITEMUKAN" });
    expect(await tandaiKomisiDibayar({ commissionId: ani.id, olehUserId: kantor, catatan: "x".repeat(501) })).toEqual({
      ok: false,
      code: "CATATAN_TERLALU_PANJANG",
    });
  });

  it("kantor: menunggu dicek dulu, lalu masuk bulan pembayaran berjalan; toko konsi menunggu dikunci di siklusnya", async () => {
    await bulanJual();
    await jual(spgK, konsi, wib(`${PERIODE}-12T10:00:00`), [{ itemId: topi, qty: 2 }]);

    const sebelum = await daftarKomisiKantor(BULAN_INI, new Date());
    expect(sebelum.menungguCek.find((m) => m.storeId === putus && m.bulanJual === PERIODE)).toMatchObject({
      potongToko: 7,
      totalToko: 16_000,
      jumlahPenerima: 2,
      adaResmiLama: false,
    });
    expect(sebelum.menungguCek.some((m) => m.storeId === putusKosong)).toBe(false);
    expect(sebelum.konsiMenungguKunci.find((k) => k.storeId === konsi && k.bulanJual === PERIODE)).toMatchObject({ cycleId: null });
    expect(sebelum.putus.some((l) => l.storeId === putus)).toBe(false);

    await cek();
    const sesudah = await daftarKomisiKantor(BULAN_INI, new Date());
    expect(sesudah.menungguCek.some((m) => m.storeId === putus && m.bulanJual === PERIODE)).toBe(false);
    const l = sesudah.putus.find((x) => x.storeId === putus && x.bulanJual === PERIODE);
    expect(l?.dicek).not.toBeNull();
    expect(l?.baris.map((b) => [b.userId, b.potong, b.komisi, b.status])).toEqual([
      [spgA, 4, 8_500, "BELUM"],
      [spgB, 3, 7_500, "BELUM"],
    ]);
    // Bulan penjualannya sendiri bukan bulan pembayarannya.
    expect((await daftarKomisiKantor(PERIODE, new Date())).putus.some((x) => x.storeId === putus)).toBe(false);
  });

  describe("HP SPG", () => {
    const fmt = { bulan: (p: string) => p, tanggal: (iso: string) => iso.slice(0, 10) };

    async function bulanBerjalan() {
      await jual(spgA, putus, new Date(), [{ itemId: kaos, qty: 2 }]);
      await jual(spgB, putus, new Date(), [{ itemId: kaos, qty: 4 }]);
    }

    it("hanya bagiannya sendiri yang sampai ke HP — tidak pernah rupiah, nama, atau id rekan", async () => {
      await bulanJual();
      await cek();
      await tetapkan();
      await bulanBerjalan();

      const toko = await tokoSpg(spgA);
      const perkiraan = await perkiraanKomisiHp(spgA, toko!, new Date());
      expect(perkiraan).toMatchObject({ jenis: "PUTUS", dasar: "PER_SPG", bagianSaya: 5_000, potongSaya: 2, totalToko: 5_000, potongToko: null });
      const resmi = await komisiResmiSaya(spgA);
      expect(resmi.filter((r) => r.jenis === "PUTUS").map((r) => [r.bulanJual, r.bulanBayar, r.komisi, r.potong, r.aturanLama])).toEqual([
        [PERIODE, BULAN_INI, 8_500, 4, false],
      ]);

      const json = JSON.stringify(payloadGajiHp({ perkiraan, resmi }, false, fmt));
      expect(json).not.toContain(spgB);
      expect(json).not.toContain("Budi");
      // Komisi Budi bulan ini (10.000) dan bulan penjualan (7.500), dan total toko (15.000 / 16.000).
      for (const angka of ["10000", "7500", "15000", "16000"]) expect(json).not.toContain(angka);
      expect(JSON.parse(json).resmi[0]).toMatchObject({ bulanJualLabel: PERIODE, bulanBayarLabel: BULAN_INI });
    });

    it("toko konsinyasi memakai hitungan yang sama: potong sendiri × tarif kategori", async () => {
      await jual(spgK, konsi, new Date(), [{ itemId: topi, qty: 2 }]);
      const k = await perkiraanKomisiHp(spgK, (await tokoSpg(spgK))!, new Date());
      expect(k).toMatchObject({ jenis: "KONSI", dasar: "PER_SPG", bagianSaya: 2_000, potongSaya: 2, totalToko: 2_000, jumlahSpg: 1 });
    });
  });
});
