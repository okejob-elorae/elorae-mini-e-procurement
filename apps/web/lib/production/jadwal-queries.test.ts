import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { parseDateOnly } from "@/lib/date-only";
import { geserHari, hariIniWib } from "@/lib/tanggal-isian";
import { KUNCI_HARI_KERJA_PRODUKSI, KUNCI_TANGGAL_MERAH } from "./hari-kerja";
import {
  followUpProduksi,
  hitungLangkahHariIni,
  hitungLangkahTelat,
  ikhtisarJadwalTahun,
  kalenderProduksiBulan,
  ruangKerjaTahap,
  tahapBulan,
  tautanWaPemasok,
} from "./jadwal-queries";

/*
 * Jadwal proses per tahap — kueri, terhadap basis data uji. Langkah diseed
 * langsung dengan tanggal yang diketahui (kueri tidak menyusun ulang apa pun),
 * relatif terhadap hari ini WIB supaya keadaan TELAT/HARI_INI tetap benar
 * kapan pun tes berjalan. Tahun plan acak 2050–2099 yang belum terpakai; daftar
 * yang global (follow-up, sumber Lead Time) disaring ke pemasok buatan tes.
 */

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

const tag = `JDQ-${Math.random().toString(36).slice(2, 9)}`;
const tgl = (teks: string) => parseDateOnly(teks) as Date;

d("jadwal produksi — kueri (test bed only)", () => {
  let user = "";
  let tahun = 0;
  let planYear = "";
  let kategori = "";
  let kategoriLain = "";
  let jenis = "";
  let jahit = "";
  let kain = "";
  let belumDisetujui = "";
  let arsipSaja = "";
  let tplRajut = "";
  let tplArsip = "";
  let uom = "";
  let kaos = "";
  let bahanKain = "";
  let kancing = "";
  let benang = "";
  let wo = "";
  let tahapA = "";
  let tahapB = "";
  let tahapC = "";
  let tahapD = "";
  const langkah: Record<string, string> = {};
  const poIds: string[] = [];
  let setelan: Record<string, string | null | undefined> = {};
  const hariIni = hariIniWib();

  beforeAll(async () => {
    user = planYear = kategori = kategoriLain = jenis = jahit = kain = belumDisetujui = arsipSaja = "";
    tplRajut = tplArsip = uom = kaos = bahanKain = kancing = benang = wo = "";
    tahapA = tahapB = tahapC = tahapD = "";
    tahun = 0;
    poIds.length = 0;
    for (const k of Object.keys(langkah)) delete langkah[k];
    setelan = {};
    for (const kunci of [KUNCI_HARI_KERJA_PRODUKSI, KUNCI_TANGGAL_MERAH]) {
      setelan[kunci] = (await prisma.systemSetting.findUnique({ where: { key: kunci }, select: { value: true } }))?.value ?? null;
    }
    const nilai = { [KUNCI_HARI_KERJA_PRODUKSI]: JSON.stringify({ hariKerja: [1, 2, 3, 4, 5, 6] }), [KUNCI_TANGGAL_MERAH]: JSON.stringify([{ tanggal: "2031-08-17", nama: "HUT RI" }]) };
    for (const [key, value] of Object.entries(nilai)) {
      await prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
    }

    user = (await prisma.user.create({ data: { email: `${tag}@test.local`.toLowerCase(), name: `Produksi ${tag}` } })).id;
    tahun = 2050 + Math.floor(Math.random() * 50);
    while (await prisma.planYear.findUnique({ where: { year: tahun }, select: { id: true } })) tahun = 2050 + ((tahun - 2049) % 50);
    planYear = (await prisma.planYear.create({ data: { year: tahun, createdById: user, status: "ACTIVE", isLocked: true } })).id;

    uom = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "meter", nameEn: "meter" } })).id;
    const barang = (sku: string, type: "FINISHED_GOOD" | "FABRIC" | "ACCESSORIES") =>
      prisma.item.create({ data: { sku: `${tag}-${sku}`, nameId: `${sku} uji`, nameEn: sku, type, uomId: uom } }).then((i) => i.id);
    kaos = await barang("KAOS", "FINISHED_GOOD");
    bahanKain = await barang("KAIN", "FABRIC");
    kancing = await barang("KANCING", "ACCESSORIES");
    benang = await barang("BENANG", "ACCESSORIES");
    await prisma.consumptionRule.createMany({
      data: [
        { finishedGoodId: kaos, materialId: bahanKain, qtyRequired: 0.5, wastePercent: 10 },
        { finishedGoodId: kaos, materialId: kancing, qtyRequired: 6, wastePercent: 0 },
        { finishedGoodId: kaos, materialId: benang, qtyRequired: 1, wastePercent: 0, isActive: false },
      ],
    });

    kategori = (await prisma.planCategory.create({ data: { planYearId: planYear, code: `${tag}-K`, name: `Kaos ${tag}`, itemId: kaos, sortOrder: 0 } })).id;
    kategoriLain = (await prisma.planCategory.create({ data: { planYearId: planYear, code: `${tag}-L`, name: `Lain ${tag}`, sortOrder: 1 } })).id;

    jenis = (await prisma.supplierType.create({ data: { code: tag, name: `Jenis ${tag}` } })).id;
    const pemasok = (kode: string, status: "ACTIVE" | "PENDING_APPROVAL" = "ACTIVE", phone: string | null = "081234567890") =>
      prisma.supplier.create({ data: { code: `${tag}-${kode}`, name: `${kode} ${tag}`, typeId: jenis, status, phone } }).then((s) => s.id);
    jahit = await pemasok("JAHIT");
    kain = await pemasok("KAIN", "ACTIVE", "021-555");
    belumDisetujui = await pemasok("BARU", "PENDING_APPROVAL");
    arsipSaja = await pemasok("ARSIP");
    tplRajut = (await prisma.processTemplate.create({ data: { name: `Jahit ${tag}`, leadTimeType: "PER_QTY", days: 7, rateQty: 10_000 } })).id;
    tplArsip = (await prisma.processTemplate.create({ data: { name: `Arsip ${tag}`, days: 2, isActive: false } })).id;
    await prisma.supplierProcess.createMany({
      data: [
        { supplierId: jahit, processTemplateId: tplRajut, sequence: 5 },
        { supplierId: jahit, processTemplateId: tplArsip, sequence: 6 },
        { supplierId: belumDisetujui, processTemplateId: tplRajut, sequence: 1 },
        { supplierId: arsipSaja, processTemplateId: tplArsip, sequence: 1 },
      ],
    });

    const tahap = (data: { name: string; planCategoryId: string; targetQty: number; targetMonth: number | null; sortOrder?: number }) =>
      prisma.planStage.create({ data: { ...data, sortOrder: data.sortOrder ?? 0 } }).then((t) => t.id);
    tahapA = await tahap({ name: `A ${tag}`, planCategoryId: kategori, targetQty: 12_000, targetMonth: 3 });
    tahapB = await tahap({ name: `B ${tag}`, planCategoryId: kategori, targetQty: 500, targetMonth: 3, sortOrder: 1 });
    tahapC = await tahap({ name: `C ${tag}`, planCategoryId: kategoriLain, targetQty: 300, targetMonth: 5 });
    tahapD = await tahap({ name: `D ${tag}`, planCategoryId: kategoriLain, targetQty: 100, targetMonth: null });
    await prisma.planStage.update({
      where: { id: tahapA },
      data: { supplierId: jahit, variantSku: `${tag}-KAOS-M`, scheduleStart: tgl("2026-06-01"), deadline: tgl("2031-01-31") },
    });

    wo = (
      await prisma.workOrder.create({
        data: { docNumber: `WO-${tag}`, vendorId: jahit, finishedGoodId: kaos, plannedQty: 12_000, consumptionPlan: [], createdById: user },
      })
    ).id;
    await prisma.planStage.update({ where: { id: tahapA }, data: { workOrderId: wo } });

    const buatLangkah = async (
      kunci: string,
      planStageId: string,
      sequence: number,
      targetDate: string,
      status: "BELUM" | "PROSES" | "SELESAI",
      supplierId: string | null,
    ) => {
      langkah[kunci] = (
        await prisma.planStageStep.create({
          data: {
            planStageId,
            sequence,
            name: `${kunci} ${tag}`,
            durationDays: 2,
            targetDate: tgl(targetDate),
            doneDate: status === "SELESAI" ? tgl(targetDate) : null,
            status,
            supplierId,
            note: kunci === "a2" ? "telepon dulu" : null,
          },
        })
      ).id;
    };
    await buatLangkah("a1", tahapA, 1, "2026-06-04", "SELESAI", jahit);
    await buatLangkah("a2", tahapA, 2, geserHari(hariIni, -1), "BELUM", jahit);
    await buatLangkah("a3", tahapA, 3, hariIni, "PROSES", jahit);
    await buatLangkah("a4", tahapA, 4, geserHari(hariIni, 3), "BELUM", kain);
    await buatLangkah("a5", tahapA, 5, geserHari(hariIni, 10), "BELUM", null);
    await buatLangkah("c1", tahapC, 1, "2026-05-04", "SELESAI", null);
    await buatLangkah("d1", tahapD, 1, `${tahun}-03-10`, "BELUM", null);
    await buatLangkah("d2", tahapD, 2, `${tahun}-03-10`, "SELESAI", null);
    await buatLangkah("d3", tahapD, 3, `${tahun}-03-31`, "BELUM", null);
    await buatLangkah("d4", tahapD, 4, `${tahun}-04-01`, "BELUM", null);

    const po = async (kode: string, planStageId: string, status: "SUBMITTED" | "CANCELLED", baris: { itemId: string; qty: number; receivedQty: number }[]) => {
      const p = await prisma.purchaseOrder.create({
        data: {
          docNumber: `PO-${tag}-${kode}`,
          supplierId: kain,
          status,
          createdById: user,
          planStageId,
          etaDate: tgl("2031-02-14"),
          grandTotal: 1_250_000.5,
          items: { create: baris.map((b) => ({ ...b, price: 1000, uomId: uom })) },
        },
      });
      poIds.push(p.id);
    };
    await po("1", tahapA, "SUBMITTED", [
      { itemId: bahanKain, qty: 3000, receivedQty: 2000 },
      { itemId: kancing, qty: 72_000, receivedQty: 0 },
      { itemId: benang, qty: 50, receivedQty: 50 },
    ]);
    await po("2", tahapA, "SUBMITTED", [{ itemId: bahanKain, qty: 2000, receivedQty: 0 }]);
    await po("3", tahapA, "CANCELLED", [{ itemId: bahanKain, qty: 999, receivedQty: 0 }]);
    await po("4", tahapC, "SUBMITTED", [{ itemId: bahanKain, qty: 10, receivedQty: 10 }]);
  });

  afterAll(async () => {
    for (const [kunci, nilai] of Object.entries(setelan)) {
      if (nilai === null) await prisma.systemSetting.delete({ where: { key: kunci } }).catch(() => undefined);
      else if (nilai !== undefined) await prisma.systemSetting.update({ where: { key: kunci }, data: { value: nilai } });
    }
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: seededIds(poIds) } } });
    await prisma.planStage.deleteMany({ where: { id: { in: seededIds([tahapA, tahapB, tahapC, tahapD].filter(Boolean)) } } });
    await prisma.workOrder.deleteMany({ where: { id: seededId(wo) } });
    await prisma.planCategory.deleteMany({ where: { id: { in: seededIds([kategori, kategoriLain].filter(Boolean)) } } });
    await prisma.planYear.deleteMany({ where: { id: seededId(planYear) } });
    await prisma.consumptionRule.deleteMany({ where: { finishedGoodId: seededId(kaos) } });
    await prisma.item.deleteMany({ where: { id: { in: seededIds([kaos, bahanKain, kancing, benang].filter(Boolean)) } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uom) } });
    const pemasok = () => seededIds([jahit, kain, belumDisetujui, arsipSaja].filter(Boolean));
    await prisma.supplierProcess.deleteMany({ where: { supplierId: { in: pemasok() } } });
    await prisma.supplier.deleteMany({ where: { id: { in: pemasok() } } });
    await prisma.supplierType.deleteMany({ where: { id: seededId(jenis) } });
    await prisma.processTemplate.deleteMany({ where: { id: { in: seededIds([tplRajut, tplArsip].filter(Boolean)) } } });
    await prisma.user.deleteMany({ where: { id: seededId(user) } });
  });

  it("tautan WA hanya untuk nomor seluler", () => {
    expect(tautanWaPemasok("0812-3456-7890")).toBe("https://wa.me/6281234567890");
    expect(tautanWaPemasok("021-555")).toBeNull();
    expect(tautanWaPemasok(null)).toBeNull();
  });

  describe("ruangKerjaTahap", () => {
    it("lengkap untuk penonton yang boleh melihat PO dan SPK", async () => {
      const r = await ruangKerjaTahap(tahapA, { lihatPo: true, lihatSpk: true });
      expect(r).not.toBeNull();
      if (!r) return;
      expect(r.tahap).toEqual({
        id: tahapA,
        name: `A ${tag}`,
        targetQty: 12_000,
        targetMonth: 3,
        variantSku: `${tag}-KAOS-M`,
        planYear: tahun,
        planYearId: planYear,
        statusPlan: "ACTIVE",
        planTerkunci: true,
        kategori: { id: kategori, code: `${tag}-K`, name: `Kaos ${tag}` },
        barang: { id: kaos, sku: `${tag}-KAOS`, nama: "KAOS uji" },
        penjahit: { id: jahit, name: `JAHIT ${tag}` },
        scheduleStart: "2026-06-01",
        deadline: "2031-01-31",
      });
      expect(r.hariIni).toBe(hariIni);
      expect(r.langkah.map((l) => [l.name, l.status, l.keadaan])).toEqual([
        [`a1 ${tag}`, "SELESAI", "SELESAI"],
        [`a2 ${tag}`, "BELUM", "TELAT"],
        [`a3 ${tag}`, "PROSES", "HARI_INI"],
        [`a4 ${tag}`, "BELUM", "MENDATANG"],
        [`a5 ${tag}`, "BELUM", "MENDATANG"],
      ]);
      expect(r.langkah[0]).toMatchObject({ targetDate: "2026-06-04", doneDate: "2026-06-04", sequence: 1, durationDays: 2 });
      expect(r.langkah[1]).toMatchObject({
        note: "telepon dulu",
        doneDate: null,
        pemasok: { id: jahit, name: `JAHIT ${tag}`, wa: "https://wa.me/6281234567890" },
      });
      expect(r.langkah[3].pemasok).toEqual({ id: kain, name: `KAIN ${tag}`, wa: null });
      expect(r.langkah[4].pemasok).toBeNull();
      expect(r.ringkasan).toEqual({
        jumlah: 5,
        selesai: 1,
        telat: 1,
        berikutnya: { name: `a2 ${tag}`, targetDate: geserHari(hariIni, -1), keadaan: "TELAT" },
        selesaiPada: geserHari(hariIni, 10),
      });
      expect(r.wo).toEqual({ id: wo, docNumber: `WO-${tag}`, status: "DRAFT" });
      expect(r.po.map((p) => [p.docNumber, p.status, p.supplierName, p.etaDate, p.grandTotal])).toEqual([
        [`PO-${tag}-1`, "SUBMITTED", `KAIN ${tag}`, "2031-02-14", 1_250_000.5],
        [`PO-${tag}-2`, "SUBMITTED", `KAIN ${tag}`, "2031-02-14", 1_250_000.5],
        [`PO-${tag}-3`, "CANCELLED", `KAIN ${tag}`, "2031-02-14", 1_250_000.5],
      ]);
      // 12.000 × 0,5 × 1,1 = 6.600 m; PO batal tidak dihitung; aturan nonaktif (benang) tidak ikut.
      expect(r.kebutuhan).toEqual([
        { itemId: bahanKain, nama: "KAIN uji", sku: `${tag}-KAIN`, satuan: `U-${tag}`, perPcs: 0.5, wastePercent: 10, butuh: 6600, diPo: 5000, diterima: 2000 },
        { itemId: kancing, nama: "KANCING uji", sku: `${tag}-KANCING`, satuan: `U-${tag}`, perPcs: 6, wastePercent: 0, butuh: 72_000, diPo: 72_000, diterima: 0 },
      ]);
      const sumber = r.sumberLeadTime.filter((s) => [jahit, kain, belumDisetujui, arsipSaja].includes(s.supplierId));
      // Hanya pemasok ACTIVE dengan template aktif; `sequence` = SupplierProcess.sequence; 12.000 pcs → 9 hari.
      expect(sumber).toEqual([
        {
          supplierId: jahit,
          supplierName: `JAHIT ${tag}`,
          jenis: `Jenis ${tag}`,
          langkah: [{ sequence: 5, name: `Jahit ${tag}`, type: "PER_QTY", days: 7, rateQty: 10_000, hariUntukQty: 9 }],
        },
      ]);
      expect(r.hariKerja).toEqual([1, 2, 3, 4, 5, 6]);
      expect(r.tanggalMerah).toEqual(["2031-08-17"]);
    });

    it("tanpa izin PO/SPK: PO kosong, SPK null, kebutuhan tetap tampil tanpa angka PO", async () => {
      const r = await ruangKerjaTahap(tahapA, { lihatPo: false, lihatSpk: false });
      expect(r?.po).toEqual([]);
      expect(r?.wo).toBeNull();
      expect(r?.kebutuhan.map((k) => [k.itemId, k.butuh, k.diPo, k.diterima])).toEqual([
        [bahanKain, 6600, 0, 0],
        [kancing, 72_000, 0, 0],
      ]);
    });

    it("tahap tanpa barang jadi dan tanpa langkah; tahap yang tidak ada → null", async () => {
      const r = await ruangKerjaTahap(tahapD, { lihatPo: true, lihatSpk: true });
      expect(r?.tahap.barang).toBeNull();
      expect(r?.kebutuhan).toEqual([]);
      const b = await ruangKerjaTahap(tahapB, { lihatPo: true, lihatSpk: true });
      expect(b?.langkah).toEqual([]);
      expect(b?.ringkasan).toEqual({ jumlah: 0, selesai: 0, telat: 0, berikutnya: null, selesaiPada: null });
      expect(b?.tahap.scheduleStart).toBeNull();
      expect(await ruangKerjaTahap("tidak-ada", { lihatPo: true, lihatSpk: true })).toBeNull();
    });
  });

  describe("ikhtisar dan tahap per bulan", () => {
    it("12 bulan; tahap tanpa bulan tidak dihitung", async () => {
      const ikhtisar = await ikhtisarJadwalTahun(tahun);
      expect(ikhtisar).toHaveLength(12);
      expect(ikhtisar[2]).toEqual({ bulan: 3, tahap: 2, qty: 12_500, langkahTelat: 1, tanpaJadwal: 1, tanpaPo: 1, selesai: 0 });
      expect(ikhtisar[4]).toEqual({ bulan: 5, tahap: 1, qty: 300, langkahTelat: 0, tanpaJadwal: 0, tanpaPo: 0, selesai: 1 });
      expect(ikhtisar.filter((b) => b.bulan !== 3 && b.bulan !== 5).every((b) => b.tahap === 0 && b.langkahTelat === 0)).toBe(true);
    });

    it("tahapBulan urut kategori lalu urutan tahap; PO/SPK disembunyikan tanpa izin", async () => {
      const semua = await tahapBulan(tahun, 3, { lihatPo: true, lihatSpk: true });
      expect(semua.map((t) => [t.id, t.jumlahPo, t.wo?.id ?? null, t.penjahit?.id ?? null])).toEqual([
        [tahapA, 2, wo, jahit],
        [tahapB, 0, null, null],
      ]);
      // Nomor PO untuk tautan di Kalender: urut dibuat, PO batal tidak ikut; tahap tanpa PO = [].
      expect(semua.map((t) => t.po?.map((p) => p.docNumber))).toEqual([[`PO-${tag}-1`, `PO-${tag}-2`], []]);
      expect(semua[0].po?.map((p) => p.id)).toEqual(poIds.slice(0, 2));
      expect(semua[0].kategori).toEqual({ id: kategori, code: `${tag}-K`, name: `Kaos ${tag}` });
      expect(semua[0].ringkasan).toMatchObject({ jumlah: 5, selesai: 1, telat: 1 });
      const terbatas = await tahapBulan(tahun, 3, { lihatPo: false, lihatSpk: false });
      expect(terbatas.map((t) => [t.jumlahPo, t.wo, t.po])).toEqual([
        [null, null, null],
        [null, null, null],
      ]);
      expect(await tahapBulan(tahun, 13, { lihatPo: true, lihatSpk: true })).toEqual([]);
    });
  });

  describe("follow-up produksi", () => {
    const ids = (r: { baris: { stepId: string }[] }) => r.baris.map((b) => b.stepId);

    it("tab per saringan, disaring pemasok; jumlah tab memakai saringan pemasok yang sama", async () => {
      const telat = await followUpProduksi({ saring: "terlambat", supplierId: jahit });
      expect(ids(telat)).toEqual([langkah.a2]);
      expect(telat.jumlah).toEqual({ hariIni: 1, terlambat: 1, mingguIni: 1, semua: 2 });
      expect(telat.baris[0]).toEqual({
        stepId: langkah.a2,
        name: `a2 ${tag}`,
        status: "BELUM",
        keadaan: "TELAT",
        targetDate: geserHari(hariIni, -1),
        durationDays: 2,
        note: "telepon dulu",
        tahap: { id: tahapA, name: `A ${tag}`, targetQty: 12_000 },
        kategori: { code: `${tag}-K`, name: `Kaos ${tag}` },
        tahun,
        pemasok: { id: jahit, name: `JAHIT ${tag}`, wa: "https://wa.me/6281234567890" },
      });
      expect(ids(await followUpProduksi({ saring: "hari-ini", supplierId: jahit }))).toEqual([langkah.a3]);
      expect(ids(await followUpProduksi({ saring: "minggu-ini", supplierId: jahit }))).toEqual([langkah.a3]);
      expect(ids(await followUpProduksi({ saring: "semua", supplierId: jahit }))).toEqual([langkah.a2, langkah.a3]);
      // Hari ini + 3 masuk "minggu ini"; yang SELESAI tidak pernah muncul.
      const kainMinggu = await followUpProduksi({ saring: "minggu-ini", supplierId: kain });
      expect(ids(kainMinggu)).toEqual([langkah.a4]);
      expect(kainMinggu.jumlah).toEqual({ hariIni: 0, terlambat: 0, mingguIni: 1, semua: 1 });
      expect(kainMinggu).toMatchObject({ halaman: 1, jumlahHalaman: 1 });
    });

    it("halaman di luar jangkauan dijepit; angka antrean Beranda = jumlah tab tanpa saringan pemasok", async () => {
      expect(await followUpProduksi({ saring: "semua", supplierId: jahit, halaman: 99 })).toMatchObject({ halaman: 1, jumlahHalaman: 1 });
      const [telat, hariIniN, semua] = await Promise.all([hitungLangkahTelat(), hitungLangkahHariIni(), followUpProduksi({ saring: "semua" })]);
      expect(telat).toBe(semua.jumlah.terlambat);
      expect(hariIniN).toBe(semua.jumlah.hariIni);
      expect(telat).toBeGreaterThanOrEqual(1);
      expect(hariIniN).toBeGreaterThanOrEqual(1);
      expect((await followUpProduksi({ saring: "terlambat" })).baris.length).toBe(Math.min(telat, 50));
    });
  });

  it("kalender bulan: dikelompokkan per tanggal target, semua status, batas bulan WIB", async () => {
    const k = await kalenderProduksiBulan(tahun, 3);
    expect(Object.keys(k).sort()).toEqual([`${tahun}-03-10`, `${tahun}-03-31`]);
    expect(k[`${tahun}-03-10`].map((c) => [c.stepId, c.status, c.keadaan, c.tahapId, c.kodeKategori])).toEqual([
      [langkah.d1, "BELUM", "MENDATANG", tahapD, `${tag}-L`],
      [langkah.d2, "SELESAI", "SELESAI", tahapD, `${tag}-L`],
    ]);
    expect(k[`${tahun}-03-31`].map((c) => c.stepId)).toEqual([langkah.d3]);
    expect(Object.keys(await kalenderProduksiBulan(tahun, 4))).toEqual([`${tahun}-04-01`]);
    expect(await kalenderProduksiBulan(tahun, 3, { supplierId: jahit })).toEqual({});
  });
});
