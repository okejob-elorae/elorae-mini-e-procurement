import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import { hariIniWib } from "@/lib/tanggal-isian";
import {
  HARI_KERJA_PRODUKSI_BAWAAN,
  kalenderKerja,
  KUNCI_HARI_KERJA_PRODUKSI,
  KUNCI_TANGGAL_MERAH,
} from "./hari-kerja";
import { susunTanggal, type StatusLangkah } from "./jadwal";
import { JEJAK_JADWAL } from "./jadwal-jejak";
import { ambilKalenderKerja, simpanHariKerjaProduksi, simpanTanggalMerah } from "./jadwal-pengaturan";
import {
  aturMulaiJadwal,
  hapusLangkah,
  pindahLangkahKe,
  pindahUrutanLangkah,
  tambahLangkah,
  tarikJadwalDariLeadTime,
  ubahLangkah,
  ubahStatusLangkah,
} from "./jadwal-writer";

/*
 * Jadwal proses per tahap — penulis, terhadap basis data uji. Semua baris milik
 * fixture buatan tes (tahun plan acak, pemasok/template/pengguna berkode acak);
 * teardown hanya lewat id yang diseed, tidak pernah lewat awalan atau tanggal.
 *
 * Kalender kerja (`produksi.hariKerja`, `produksi.tanggalMerah`) dipotret di
 * awal, diset Senin–Jumat tanpa tanggal merah, dan dikembalikan persis di akhir.
 * Penulis pengaturan dipanggil dengan `cakupanTahap` supaya tidak menggeser
 * jadwal sungguhan di basis data bersama.
 */

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

const tag = `JDW-${Math.random().toString(36).slice(2, 9)}`;
const KAL = kalenderKerja(HARI_KERJA_PRODUKSI_BAWAAN, []);
const teks = (x: Date | null) => (x ? formatDateOnlyJakarta(x) : null);

d("jadwal produksi — penulis (test bed only)", () => {
  let user = "";
  let planYear = "";
  let kategori = "";
  let jenis = "";
  let kain = "";
  let jahit = "";
  let belumDisetujui = "";
  let tplRajut = "";
  let tplCelup = "";
  let tplJahit = "";
  let tplSablon = "";
  const tahapIds: string[] = [];
  let setelan: Record<string, string | null | undefined> = {};

  const buatTahap = async (ubah: { targetQty?: number } = {}) => {
    const t = await prisma.planStage.create({
      data: { planCategoryId: kategori, name: `Tahap ${tag} ${tahapIds.length + 1}`, targetQty: ubah.targetQty ?? 12_000, targetMonth: 3 },
      select: { id: true },
    });
    tahapIds.push(t.id);
    return t.id;
  };

  const langkahTahap = (planStageId: string) =>
    prisma.planStageStep
      .findMany({
        where: { planStageId: seededId(planStageId) },
        orderBy: { sequence: "asc" },
        select: { id: true, sequence: true, name: true, durationDays: true, status: true, supplierId: true, processTemplateId: true, targetDate: true, doneDate: true, note: true },
      })
      .then((r) => r.map((l) => ({ ...l, targetDate: teks(l.targetDate), doneDate: teks(l.doneDate) })));

  const tahapnya = (planStageId: string) =>
    prisma.planStage
      .findUniqueOrThrow({ where: { id: seededId(planStageId) }, select: { scheduleStart: true, deadline: true } })
      .then((t) => ({ scheduleStart: teks(t.scheduleStart), deadline: teks(t.deadline) }));

  /** Tiga langkah [3, 9, 2] hari dari Lead Time (kain#10, jahit#1, jahit#2) mulai `tanggal`. */
  const tarikStandar = (planStageId: string, tanggal: string, ubah: Partial<Parameters<typeof tarikJadwalDariLeadTime>[0]> = {}) =>
    tarikJadwalDariLeadTime({
      planStageId,
      langkah: [
        { supplierId: kain, sequence: 10 },
        { supplierId: jahit, sequence: 1 },
        { supplierId: jahit, sequence: 2 },
      ],
      mode: "MAJU",
      tanggal,
      cara: "GANTI",
      olehUserId: user,
      ...ubah,
    });

  /** Tanggal yang seharusnya, dari pustaka murni yang sama. */
  const harusnya = async (planStageId: string) => {
    const [t, l] = await Promise.all([tahapnya(planStageId), langkahTahap(planStageId)]);
    return susunTanggal(
      l.map((x) => ({ durationDays: x.durationDays, status: x.status as StatusLangkah, doneDate: x.doneDate })),
      t.scheduleStart ?? "",
      KAL,
    );
  };

  beforeAll(async () => {
    user = "";
    planYear = "";
    kategori = "";
    jenis = "";
    kain = "";
    jahit = "";
    belumDisetujui = "";
    tplRajut = tplCelup = tplJahit = tplSablon = "";
    setelan = {};
    for (const kunci of [KUNCI_HARI_KERJA_PRODUKSI, KUNCI_TANGGAL_MERAH]) {
      setelan[kunci] = (await prisma.systemSetting.findUnique({ where: { key: kunci }, select: { value: true } }))?.value ?? null;
    }
    await prisma.systemSetting.upsert({
      where: { key: KUNCI_HARI_KERJA_PRODUKSI },
      create: { key: KUNCI_HARI_KERJA_PRODUKSI, value: JSON.stringify({ hariKerja: [1, 2, 3, 4, 5] }) },
      update: { value: JSON.stringify({ hariKerja: [1, 2, 3, 4, 5] }) },
    });
    await prisma.systemSetting.upsert({
      where: { key: KUNCI_TANGGAL_MERAH },
      create: { key: KUNCI_TANGGAL_MERAH, value: "[]" },
      update: { value: "[]" },
    });

    user = (await prisma.user.create({ data: { email: `${tag}@test.local`.toLowerCase(), name: `Produksi ${tag}` } })).id;
    let tahun = 2050 + Math.floor(Math.random() * 50);
    while (await prisma.planYear.findUnique({ where: { year: tahun }, select: { id: true } })) tahun = 2050 + ((tahun - 2049) % 50);
    planYear = (await prisma.planYear.create({ data: { year: tahun, createdById: user, status: "ACTIVE", isLocked: true } })).id;
    kategori = (await prisma.planCategory.create({ data: { planYearId: planYear, code: tag, name: `Kaos ${tag}` } })).id;

    jenis = (await prisma.supplierType.create({ data: { code: tag, name: `Jenis ${tag}` } })).id;
    const pemasok = (kode: string, status: "ACTIVE" | "PENDING_APPROVAL" = "ACTIVE") =>
      prisma.supplier
        .create({ data: { code: `${tag}-${kode}`, name: `${kode} ${tag}`, typeId: jenis, status, phone: "081234567890" } })
        .then((s) => s.id);
    kain = await pemasok("KAIN");
    jahit = await pemasok("JAHIT");
    belumDisetujui = await pemasok("BARU", "PENDING_APPROVAL");

    const template = (nama: string, data: { leadTimeType?: "FIXED" | "PER_QTY"; days: number; rateQty?: number; isActive?: boolean }) =>
      prisma.processTemplate.create({ data: { name: `${nama} ${tag}`, ...data } }).then((t) => t.id);
    tplRajut = await template("Rajut", { days: 3 });
    tplCelup = await template("Celup", { days: 4, isActive: false });
    tplJahit = await template("Jahit", { leadTimeType: "PER_QTY", days: 7, rateQty: 10_000 });
    tplSablon = await template("Sablon", { days: 1 });
    await prisma.supplierProcess.createMany({
      data: [
        { supplierId: kain, processTemplateId: tplRajut, sequence: 10 },
        { supplierId: kain, processTemplateId: tplCelup, sequence: 20 },
        { supplierId: jahit, processTemplateId: tplJahit, sequence: 1 },
        { supplierId: jahit, processTemplateId: tplSablon, sequence: 2, overrideDays: 2 },
        { supplierId: belumDisetujui, processTemplateId: tplRajut, sequence: 1 },
      ],
    });
  });

  afterEach(async () => {
    await prisma.planStage.deleteMany({ where: { id: { in: seededIds(tahapIds) } } });
    tahapIds.length = 0;
  });

  afterAll(async () => {
    for (const [kunci, nilai] of Object.entries(setelan)) {
      if (nilai === null) await prisma.systemSetting.delete({ where: { key: kunci } }).catch(() => undefined);
      else if (nilai !== undefined) await prisma.systemSetting.update({ where: { key: kunci }, data: { value: nilai } });
    }
    await prisma.auditLog.deleteMany({ where: { userId: seededId(user) } });
    await prisma.planStage.deleteMany({ where: { id: { in: seededIds(tahapIds) } } });
    await prisma.planCategory.deleteMany({ where: { id: seededId(kategori) } });
    await prisma.planYear.deleteMany({ where: { id: seededId(planYear) } });
    const pemasok = () => seededIds([kain, jahit, belumDisetujui].filter(Boolean));
    await prisma.supplierProcess.deleteMany({ where: { supplierId: { in: pemasok() } } });
    await prisma.supplier.deleteMany({ where: { id: { in: pemasok() } } });
    await prisma.supplierType.deleteMany({ where: { id: seededId(jenis) } });
    await prisma.processTemplate.deleteMany({ where: { id: { in: seededIds([tplRajut, tplCelup, tplJahit, tplSablon].filter(Boolean)) } } });
    await prisma.user.deleteMany({ where: { id: seededId(user) } });
  });

  describe("tarik dari Lead Time", () => {
    it("MAJU GANTI lintas pemasok: lama sebanding qty (12.000 pcs pada 7 hari/10.000 = 9), hari kerja, plan terkunci tetap boleh", async () => {
      const t = await buatTahap();
      // Senin 3 Mar 2031: +3 → Kam 6; +9 → Rab 19; +2 → Jum 21 (melewati Sabtu/Minggu).
      expect(await tarikStandar(t, "2031-03-03")).toEqual({ ok: true, jumlah: 3 });
      const l = await langkahTahap(t);
      expect(l.map((x) => [x.sequence, x.durationDays, x.targetDate, x.status])).toEqual([
        [1, 3, "2031-03-06", "BELUM"],
        [2, 9, "2031-03-19", "BELUM"],
        [3, 2, "2031-03-21", "BELUM"],
      ]);
      expect(l.map((x) => x.supplierId)).toEqual([kain, jahit, jahit]);
      expect(l.map((x) => x.processTemplateId)).toEqual([tplRajut, tplJahit, tplSablon]);
      expect(l[0].name).toBe(`Rajut ${tag}`);
      expect(await tahapnya(t)).toEqual({ scheduleStart: "2031-03-03", deadline: null });

      const jejak = await prisma.auditLog.findMany({ where: { entityType: "PlanStage", entityId: t, action: JEJAK_JADWAL.DITARIK } });
      expect(jejak).toHaveLength(1);
      expect(jejak[0].metadata).toMatchObject({ mode: "MAJU", cara: "GANTI", jumlah: 3 });
      expect((jejak[0].changes as { after: { langkah: unknown[] } }).after.langkah).toHaveLength(3);
    });

    it("qty berubah → lama ikut sebanding: 5.000 pcs = 4 hari (ceil 3,5), bukan satu kapasitas penuh", async () => {
      const t = await buatTahap({ targetQty: 5_000 });
      await tarikStandar(t, "2031-03-03");
      expect((await langkahTahap(t)).map((x) => x.durationDays)).toEqual([3, 4, 2]);
    });

    it("TAMBAH MAJU ke jadwal berisi: menyambung di akhir, tanggal mulai lama tetap (tanggal isian diabaikan)", async () => {
      const t = await buatTahap();
      await tarikStandar(t, "2031-03-03");
      expect(
        await tarikJadwalDariLeadTime({
          planStageId: t,
          langkah: [{ supplierId: jahit, sequence: 2 }],
          mode: "MAJU",
          tanggal: "2031-05-05",
          cara: "TAMBAH",
          olehUserId: user,
        }),
      ).toEqual({ ok: true, jumlah: 1 });
      const l = await langkahTahap(t);
      expect(l.map((x) => [x.sequence, x.targetDate])).toEqual([
        [1, "2031-03-06"],
        [2, "2031-03-19"],
        [3, "2031-03-21"],
        [4, "2031-03-25"],
      ]);
      expect((await tahapnya(t)).scheduleStart).toBe("2031-03-03");
    });

    it("MUNDUR: tenggat diisi, mulai dihitung mundur dari total SEMUA langkah — langkah terakhir jatuh tepat di tenggat", async () => {
      const t = await buatTahap();
      expect(await tarikStandar(t, "2031-03-21", { mode: "MUNDUR" })).toEqual({ ok: true, jumlah: 3 });
      expect(await tahapnya(t)).toEqual({ scheduleStart: "2031-03-03", deadline: "2031-03-21" });
      expect((await langkahTahap(t)).at(-1)?.targetDate).toBe("2031-03-21");

      // TAMBAH mundur: total 14 + 2 = 16 hari kerja dihitung ulang dari tenggat baru.
      await tarikJadwalDariLeadTime({
        planStageId: t,
        langkah: [{ supplierId: jahit, sequence: 2 }],
        mode: "MUNDUR",
        tanggal: "2031-03-25",
        cara: "TAMBAH",
        olehUserId: user,
      });
      expect(await tahapnya(t)).toEqual({ scheduleStart: "2031-03-03", deadline: "2031-03-25" });
      const l = await langkahTahap(t);
      expect(l).toHaveLength(4);
      expect(l.at(-1)?.targetDate).toBe("2031-03-25");
    });

    it("sesudah MUNDUR, tarik MAJU GANTI mengosongkan tenggat", async () => {
      const t = await buatTahap();
      await tarikStandar(t, "2031-03-21", { mode: "MUNDUR" });
      await tarikStandar(t, "2031-03-10");
      expect(await tahapnya(t)).toEqual({ scheduleStart: "2031-03-10", deadline: null });
    });

    it("GANTI ditolak ADA_LANGKAH_BERJALAN bila ada langkah PROSES — tidak ada yang berubah", async () => {
      const t = await buatTahap();
      await tarikStandar(t, "2031-03-03");
      const [pertama] = await langkahTahap(t);
      expect(await ubahStatusLangkah({ stepId: pertama.id, status: "PROSES", olehUserId: user })).toEqual({ ok: true });
      const sebelum = await langkahTahap(t);
      expect(await tarikStandar(t, "2031-04-07")).toEqual({ ok: false, code: "ADA_LANGKAH_BERJALAN" });
      expect(await langkahTahap(t)).toEqual(sebelum);
      expect((await tahapnya(t)).scheduleStart).toBe("2031-03-03");
    });

    it("penolakan berkode: tahap/tanggal/langkah/pemasok", async () => {
      const t = await buatTahap();
      expect(await tarikStandar("tidak-ada", "2031-03-03")).toEqual({ ok: false, code: "TAHAP_TIDAK_ADA" });
      expect(await tarikStandar(t, "2031-02-30")).toEqual({ ok: false, code: "TANGGAL_TIDAK_SAH" });
      expect(await tarikStandar(t, "03/03/2031")).toEqual({ ok: false, code: "TANGGAL_TIDAK_SAH" });
      expect(await tarikStandar(t, "2031-03-03", { langkah: [] })).toEqual({ ok: false, code: "TANPA_LANGKAH_LEAD_TIME" });
      // Template proses yang diarsipkan tidak bisa ditarik.
      expect(await tarikStandar(t, "2031-03-03", { langkah: [{ supplierId: kain, sequence: 20 }] })).toEqual({
        ok: false,
        code: "TANPA_LANGKAH_LEAD_TIME",
      });
      expect(await tarikStandar(t, "2031-03-03", { langkah: [{ supplierId: jahit, sequence: 99 }] })).toEqual({
        ok: false,
        code: "TANPA_LANGKAH_LEAD_TIME",
      });
      // Pemasok yang belum disetujui bukan sumber Lead Time.
      expect(await tarikStandar(t, "2031-03-03", { langkah: [{ supplierId: belumDisetujui, sequence: 1 }] })).toEqual({
        ok: false,
        code: "PEMASOK_TIDAK_ADA",
      });
      expect(await langkahTahap(t)).toEqual([]);
    });
  });

  describe("status langkah menggeser jadwal", () => {
    // Senin 1 Jun 2026: [3, 9, 2] → Kam 4, Rab 17, Jum 19 Jun.
    const siapkan = async () => {
      const t = await buatTahap();
      await tarikStandar(t, "2026-06-01");
      return { t, l: await langkahTahap(t) };
    };

    it("SELESAI lebih cepat menarik maju semua langkah sesudahnya; PROSES tidak menggeser apa pun", async () => {
      const { t, l } = await siapkan();
      expect(l.map((x) => x.targetDate)).toEqual(["2026-06-04", "2026-06-17", "2026-06-19"]);

      await ubahStatusLangkah({ stepId: l[1].id, status: "PROSES", olehUserId: user });
      expect((await langkahTahap(t)).map((x) => x.targetDate)).toEqual(["2026-06-04", "2026-06-17", "2026-06-19"]);

      expect(await ubahStatusLangkah({ stepId: l[0].id, status: "SELESAI", doneDate: "2026-06-02", olehUserId: user })).toEqual({ ok: true });
      const sesudah = await langkahTahap(t);
      expect(sesudah.map((x) => [x.status, x.doneDate, x.targetDate])).toEqual([
        ["SELESAI", "2026-06-02", "2026-06-02"],
        ["PROSES", null, "2026-06-15"],
        ["BELUM", null, "2026-06-17"],
      ]);
      expect(sesudah.map((x) => x.targetDate)).toEqual(await harusnya(t));
    });

    it("SELESAI lebih lambat mendorong mundur; kembali BELUM mengosongkan tanggal selesai dan memulihkan jadwal", async () => {
      const { t, l } = await siapkan();
      await ubahStatusLangkah({ stepId: l[0].id, status: "SELESAI", doneDate: "2026-06-10", olehUserId: user });
      expect((await langkahTahap(t)).map((x) => x.targetDate)).toEqual(["2026-06-10", "2026-06-23", "2026-06-25"]);

      await ubahStatusLangkah({ stepId: l[0].id, status: "BELUM", doneDate: "2026-06-10", olehUserId: user });
      const pulih = await langkahTahap(t);
      expect(pulih[0]).toMatchObject({ status: "BELUM", doneDate: null });
      expect(pulih.map((x) => x.targetDate)).toEqual(["2026-06-04", "2026-06-17", "2026-06-19"]);

      const jejak = await prisma.auditLog.findMany({
        where: { entityType: "PlanStageStep", entityId: l[0].id, action: JEJAK_JADWAL.STATUS_DIUBAH },
        orderBy: { createdAt: "asc" },
      });
      expect(jejak.map((j) => j.changes)).toEqual([
        {
          before: { status: "BELUM", doneDate: null, targetDate: "2026-06-04" },
          after: { status: "SELESAI", doneDate: "2026-06-10", targetDate: "2026-06-10" },
        },
        {
          before: { status: "SELESAI", doneDate: "2026-06-10", targetDate: "2026-06-10" },
          after: { status: "BELUM", doneDate: null, targetDate: "2026-06-04" },
        },
      ]);
    });

    it("SELESAI tanpa tanggal = hari ini WIB; tanggal selesai di masa depan ditolak; status sama = tanpa jejak baru", async () => {
      const { t, l } = await siapkan();
      const hariIni = hariIniWib();
      expect(await ubahStatusLangkah({ stepId: l[2].id, status: "SELESAI", olehUserId: user })).toEqual({ ok: true });
      expect((await langkahTahap(t))[2]).toMatchObject({ status: "SELESAI", doneDate: hariIni, targetDate: hariIni });
      expect(await ubahStatusLangkah({ stepId: l[2].id, status: "SELESAI", olehUserId: user })).toEqual({ ok: true });
      expect(
        await prisma.auditLog.count({ where: { entityId: l[2].id, action: JEJAK_JADWAL.STATUS_DIUBAH } }),
      ).toBe(1);

      expect(await ubahStatusLangkah({ stepId: l[1].id, status: "SELESAI", doneDate: "2099-01-01", olehUserId: user })).toEqual({
        ok: false,
        code: "TANGGAL_TIDAK_SAH",
      });
      expect(await ubahStatusLangkah({ stepId: "tidak-ada", status: "PROSES", olehUserId: user })).toEqual({
        ok: false,
        code: "LANGKAH_TIDAK_ADA",
      });
      expect(await ubahStatusLangkah({ stepId: l[1].id, status: "BATAL" as StatusLangkah, olehUserId: user })).toEqual({
        ok: false,
        code: "ISIAN_TIDAK_SAH",
      });
    });
  });

  describe("langkah manual", () => {
    it("tambah di akhir; tahap tanpa jadwal mulai hari ini WIB", async () => {
      const t = await buatTahap();
      const hasil = await tambahLangkah({ planStageId: t, name: "  Potong kain ", durationDays: 2, note: " cek pola ", olehUserId: user });
      expect(hasil.ok).toBe(true);
      const hariIni = hariIniWib();
      expect((await tahapnya(t)).scheduleStart).toBe(hariIni);
      await tambahLangkah({ planStageId: t, name: "Jahit", durationDays: 0, supplierId: jahit, olehUserId: user });
      const l = await langkahTahap(t);
      expect(l.map((x) => [x.sequence, x.name, x.durationDays, x.supplierId, x.note])).toEqual([
        [1, "Potong kain", 2, null, "cek pola"],
        [2, "Jahit", 0, jahit, null],
      ]);
      expect(l.map((x) => x.targetDate)).toEqual(await harusnya(t));
      expect(l[1].targetDate).toBe(l[0].targetDate);
      if (hasil.ok) {
        const jejak = await prisma.auditLog.findFirst({ where: { entityId: hasil.id, action: JEJAK_JADWAL.LANGKAH_DITAMBAH } });
        expect(jejak?.metadata).toEqual({ planStageId: t });
      }
    });

    it("penolakan: nama kosong/terlalu panjang, durasi tidak sah, pemasok tidak ada, tahap tidak ada", async () => {
      const t = await buatTahap();
      const dasar = { planStageId: t, name: "QC", durationDays: 1, olehUserId: user };
      expect(await tambahLangkah({ ...dasar, name: "   " })).toEqual({ ok: false, code: "NAMA_WAJIB" });
      expect(await tambahLangkah({ ...dasar, name: "x".repeat(192) })).toEqual({ ok: false, code: "NAMA_TERLALU_PANJANG" });
      expect(await tambahLangkah({ ...dasar, durationDays: -1 })).toEqual({ ok: false, code: "DURASI_TIDAK_SAH" });
      expect(await tambahLangkah({ ...dasar, durationDays: 1.5 })).toEqual({ ok: false, code: "DURASI_TIDAK_SAH" });
      expect(await tambahLangkah({ ...dasar, supplierId: "tidak-ada" })).toEqual({ ok: false, code: "PEMASOK_TIDAK_ADA" });
      expect(await tambahLangkah({ ...dasar, planStageId: "tidak-ada" })).toEqual({ ok: false, code: "TAHAP_TIDAK_ADA" });
      expect(await langkahTahap(t)).toEqual([]);
    });

    it("ubah lama menyusun ulang tanggal; pemasok null mengosongkan; tanpa perubahan = tanpa jejak", async () => {
      const t = await buatTahap();
      await tarikStandar(t, "2031-03-03");
      const l = await langkahTahap(t);
      expect(await ubahLangkah({ stepId: l[0].id, durationDays: 5, supplierId: null, name: "Rajut ulang", olehUserId: user })).toEqual({ ok: true });
      const sesudah = await langkahTahap(t);
      expect(sesudah[0]).toMatchObject({ durationDays: 5, supplierId: null, name: "Rajut ulang", targetDate: "2031-03-10" });
      expect(sesudah.map((x) => x.targetDate)).toEqual(await harusnya(t));
      expect(sesudah.map((x) => x.targetDate)).toEqual(["2031-03-10", "2031-03-21", "2031-03-25"]);

      expect(await ubahLangkah({ stepId: l[0].id, durationDays: 5, olehUserId: user })).toEqual({ ok: true });
      expect(await prisma.auditLog.count({ where: { entityId: l[0].id, action: JEJAK_JADWAL.LANGKAH_DIUBAH } })).toBe(1);
      expect(await ubahLangkah({ stepId: l[0].id, name: "", olehUserId: user })).toEqual({ ok: false, code: "NAMA_WAJIB" });
      expect(await ubahLangkah({ stepId: l[0].id, supplierId: "tidak-ada", olehUserId: user })).toEqual({ ok: false, code: "PEMASOK_TIDAK_ADA" });
    });

    it("pindah urutan menukar dengan tetangga dan menyusun ulang tanggal; di ujung tidak berubah", async () => {
      const t = await buatTahap();
      await tarikStandar(t, "2031-03-03");
      const l = await langkahTahap(t);
      expect(await pindahUrutanLangkah({ stepId: l[2].id, arah: "NAIK", olehUserId: user })).toEqual({ ok: true });
      const sesudah = await langkahTahap(t);
      expect(sesudah.map((x) => [x.id, x.sequence, x.durationDays])).toEqual([
        [l[0].id, 1, 3],
        [l[2].id, 2, 2],
        [l[1].id, 3, 9],
      ]);
      expect(sesudah.map((x) => x.targetDate)).toEqual(["2031-03-06", "2031-03-10", "2031-03-21"]);

      expect(await pindahUrutanLangkah({ stepId: l[0].id, arah: "NAIK", olehUserId: user })).toEqual({ ok: true });
      expect((await langkahTahap(t)).map((x) => x.id)).toEqual([l[0].id, l[2].id, l[1].id]);
      expect(await prisma.auditLog.count({ where: { entityId: l[0].id, action: JEJAK_JADWAL.URUTAN_DIPINDAH } })).toBe(0);
    });

    it("pindah ke posisi (seret): langsung ke indeks tujuan, tanggal disusun ulang, jejak membawa urutan sebelum/sesudah", async () => {
      const t = await buatTahap();
      await tarikStandar(t, "2031-03-03");
      const l = await langkahTahap(t);

      expect(await pindahLangkahKe({ stepId: l[0].id, posisi: 2, olehUserId: user })).toEqual({ ok: true });
      let sesudah = await langkahTahap(t);
      expect(sesudah.map((x) => [x.id, x.sequence])).toEqual([
        [l[1].id, 1],
        [l[2].id, 2],
        [l[0].id, 3],
      ]);
      // Senin 3 Mar: +9 → 14 Mar; +2 → 18 Mar; +3 → 21 Mar.
      expect(sesudah.map((x) => x.targetDate)).toEqual(["2031-03-14", "2031-03-18", "2031-03-21"]);
      expect(sesudah.map((x) => x.targetDate)).toEqual(await harusnya(t));
      const jejak = await prisma.auditLog.findFirst({ where: { entityId: l[0].id, action: JEJAK_JADWAL.URUTAN_DIPINDAH } });
      expect(jejak?.userId).toBe(user);
      expect(jejak?.changes).toEqual({
        before: { sequence: 1, urutan: [l[0].id, l[1].id, l[2].id] },
        after: { sequence: 3, urutan: [l[1].id, l[2].id, l[0].id] },
      });
      expect(jejak?.metadata).toMatchObject({ planStageId: t, posisi: 2 });

      expect(await pindahLangkahKe({ stepId: l[2].id, posisi: 0, olehUserId: user })).toEqual({ ok: true });
      sesudah = await langkahTahap(t);
      expect(sesudah.map((x) => x.id)).toEqual([l[2].id, l[1].id, l[0].id]);
      expect(sesudah.map((x) => x.targetDate)).toEqual(["2031-03-05", "2031-03-18", "2031-03-21"]);

      // Posisi lewat akhir dijepit ke langkah terakhir.
      expect(await pindahLangkahKe({ stepId: l[2].id, posisi: 99, olehUserId: user })).toEqual({ ok: true });
      sesudah = await langkahTahap(t);
      expect(sesudah.map((x) => [x.id, x.sequence])).toEqual([
        [l[1].id, 1],
        [l[0].id, 2],
        [l[2].id, 3],
      ]);
      expect(sesudah.map((x) => x.targetDate)).toEqual(await harusnya(t));
    });

    it("pindah ke posisi yang sama: tidak berubah dan tanpa jejak; penolakan berkode", async () => {
      const t = await buatTahap();
      await tarikStandar(t, "2031-03-03");
      const l = await langkahTahap(t);
      expect(await pindahLangkahKe({ stepId: l[1].id, posisi: 1, olehUserId: user })).toEqual({ ok: true });
      expect((await langkahTahap(t)).map((x) => x.id)).toEqual(l.map((x) => x.id));
      expect(await prisma.auditLog.count({ where: { entityId: l[1].id, action: JEJAK_JADWAL.URUTAN_DIPINDAH } })).toBe(0);

      expect(await pindahLangkahKe({ stepId: l[1].id, posisi: -1, olehUserId: user })).toEqual({ ok: false, code: "ISIAN_TIDAK_SAH" });
      expect(await pindahLangkahKe({ stepId: l[1].id, posisi: 1.5, olehUserId: user })).toEqual({ ok: false, code: "ISIAN_TIDAK_SAH" });
      expect(await pindahLangkahKe({ stepId: "tidak-ada", posisi: 0, olehUserId: user })).toEqual({ ok: false, code: "LANGKAH_TIDAK_ADA" });
      expect(await pindahLangkahKe({ stepId: "", posisi: 0, olehUserId: user })).toEqual({ ok: false, code: "LANGKAH_TIDAK_ADA" });
      expect((await langkahTahap(t)).map((x) => x.sequence)).toEqual([1, 2, 3]);
    });

    it("hapus merapikan urutan 1..n dan menyusun ulang tanggal", async () => {
      const t = await buatTahap();
      await tarikStandar(t, "2031-03-03");
      const l = await langkahTahap(t);
      expect(await hapusLangkah({ stepId: l[0].id, olehUserId: user })).toEqual({ ok: true });
      const sesudah = await langkahTahap(t);
      expect(sesudah.map((x) => [x.sequence, x.targetDate])).toEqual([
        [1, "2031-03-14"],
        [2, "2031-03-18"],
      ]);
      expect(await hapusLangkah({ stepId: l[0].id, olehUserId: user })).toEqual({ ok: false, code: "LANGKAH_TIDAK_ADA" });
      const jejak = await prisma.auditLog.findFirst({ where: { entityId: l[0].id, action: JEJAK_JADWAL.LANGKAH_DIHAPUS } });
      expect(jejak?.changes).toMatchObject({ before: { name: `Rajut ${tag}`, durationDays: 3 }, after: null });
    });

    it("atur mulai MAJU/MUNDUR menggeser seluruh rantai", async () => {
      const t = await buatTahap();
      await tarikStandar(t, "2031-03-03");
      expect(await aturMulaiJadwal({ planStageId: t, mode: "MAJU", tanggal: "2031-03-10", olehUserId: user })).toEqual({ ok: true });
      expect((await langkahTahap(t)).map((x) => x.targetDate)).toEqual(["2031-03-13", "2031-03-26", "2031-03-28"]);
      expect(await aturMulaiJadwal({ planStageId: t, mode: "MUNDUR", tanggal: "2031-03-21", olehUserId: user })).toEqual({ ok: true });
      expect(await tahapnya(t)).toEqual({ scheduleStart: "2031-03-03", deadline: "2031-03-21" });
      expect((await langkahTahap(t)).at(-1)?.targetDate).toBe("2031-03-21");
      expect(await aturMulaiJadwal({ planStageId: t, mode: "MAJU", tanggal: "2031-13-01", olehUserId: user })).toEqual({
        ok: false,
        code: "TANGGAL_TIDAK_SAH",
      });
    });
  });

  describe("balapan (Promise.all)", () => {
    it("ubah status vs hapus pada langkah yang SAMA: urutan mana pun, hasilnya konsisten dan jejak hanya untuk yang berhasil", async () => {
      for (let putaran = 0; putaran < 3; putaran++) {
        const t = await buatTahap();
        await tarikStandar(t, "2026-06-01");
        const l = await langkahTahap(t);
        const [status, hapus] = await Promise.all([
          ubahStatusLangkah({ stepId: l[0].id, status: "SELESAI", doneDate: "2026-06-02", olehUserId: user }),
          hapusLangkah({ stepId: l[0].id, olehUserId: user }),
        ]);
        expect(hapus).toEqual({ ok: true });
        expect([{ ok: true }, { ok: false, code: "LANGKAH_TIDAK_ADA" }]).toContainEqual(status);
        const sisa = await langkahTahap(t);
        expect(sisa.map((x) => [x.id, x.sequence, x.status])).toEqual([
          [l[1].id, 1, "BELUM"],
          [l[2].id, 2, "BELUM"],
        ]);
        // Langkah pertama hilang → rantai mulai lagi dari 1 Jun: +9 → 12 Jun, +2 → 16 Jun.
        expect(sisa.map((x) => x.targetDate)).toEqual(["2026-06-12", "2026-06-16"]);
        expect(
          await prisma.auditLog.count({ where: { entityId: l[0].id, action: JEJAK_JADWAL.STATUS_DIUBAH } }),
        ).toBe(status.ok ? 1 : 0);
      }
    });

    it("dua seretan bersamaan di tahap yang sama: urutan 1..n tanpa ganda, keduanya tercermin, tanggal tersusun", async () => {
      for (let putaran = 0; putaran < 3; putaran++) {
        const t = await buatTahap();
        await tarikStandar(t, "2026-06-01");
        const l = await langkahTahap(t);
        // Urutan mana pun yang menang lebih dulu, hasil akhirnya [l2, l1, l0].
        const hasil = await Promise.all([
          pindahLangkahKe({ stepId: l[0].id, posisi: 2, olehUserId: user }),
          pindahLangkahKe({ stepId: l[2].id, posisi: 0, olehUserId: user }),
        ]);
        expect(hasil).toEqual([{ ok: true }, { ok: true }]);
        const sisa = await langkahTahap(t);
        expect(sisa.map((x) => [x.id, x.sequence])).toEqual([
          [l[2].id, 1],
          [l[1].id, 2],
          [l[0].id, 3],
        ]);
        expect(sisa.map((x) => x.targetDate)).toEqual(await harusnya(t));
      }
    });

    it("ubah status satu langkah vs hapus langkah lain: kedua perubahan tercermin di tanggal (tidak ada yang tertimpa)", async () => {
      for (let putaran = 0; putaran < 3; putaran++) {
        const t = await buatTahap();
        await tarikStandar(t, "2026-06-01");
        const l = await langkahTahap(t);
        const hasil = await Promise.all([
          ubahStatusLangkah({ stepId: l[0].id, status: "SELESAI", doneDate: "2026-06-02", olehUserId: user }),
          hapusLangkah({ stepId: l[1].id, olehUserId: user }),
        ]);
        expect(hasil).toEqual([{ ok: true }, { ok: true }]);
        const sisa = await langkahTahap(t);
        expect(sisa.map((x) => [x.id, x.sequence, x.status, x.targetDate])).toEqual([
          [l[0].id, 1, "SELESAI", "2026-06-02"],
          [l[2].id, 2, "BELUM", "2026-06-04"],
        ]);
      }
    });
  });

  describe("pengaturan kalender menyusun ulang tahap terbuka", () => {
    it("tanggal merah baru menggeser langkah; hari kerja Sabtu memajukan; daftar kosong/rusak ditolak", async () => {
      const t = await buatTahap();
      await tarikStandar(t, "2031-03-03");
      expect(
        await simpanTanggalMerah({
          daftar: [
            { tanggal: "2031-03-11", nama: " Libur uji " },
            { tanggal: "2031-03-11", nama: "ganda" },
          ],
          olehUserId: user,
          cakupanTahap: [t],
        }),
      ).toEqual({ ok: true, tanggalMerah: [{ tanggal: "2031-03-11", nama: "Libur uji" }] });
      expect((await langkahTahap(t)).map((x) => x.targetDate)).toEqual(["2031-03-06", "2031-03-20", "2031-03-24"]);
      expect((await ambilKalenderKerja()).tanggalMerah).toEqual([{ tanggal: "2031-03-11", nama: "Libur uji" }]);

      expect(
        await simpanHariKerjaProduksi({ hariKerja: [6, 1, 2, 3, 4, 5, 5], olehUserId: user, cakupanTahap: [t] }),
      ).toEqual({ ok: true, hariKerja: [1, 2, 3, 4, 5, 6] });
      // Senin 3 Mar, Senin–Sabtu, libur 11 Mar: +3 → 6 Mar; +9 → 18 Mar; +2 → 20 Mar.
      expect((await langkahTahap(t)).map((x) => x.targetDate)).toEqual(["2031-03-06", "2031-03-18", "2031-03-20"]);

      expect(await simpanHariKerjaProduksi({ hariKerja: [], olehUserId: user })).toEqual({ ok: false, code: "HARI_KERJA_TIDAK_SAH" });
      expect(await simpanHariKerjaProduksi({ hariKerja: [7], olehUserId: user })).toEqual({ ok: false, code: "HARI_KERJA_TIDAK_SAH" });
      expect(await simpanTanggalMerah({ daftar: [{ tanggal: "2031-02-30", nama: "" }], olehUserId: user })).toEqual({
        ok: false,
        code: "TANGGAL_TIDAK_SAH",
      });
      expect(await simpanTanggalMerah({ daftar: [{ tanggal: "2031-03-12", nama: "x".repeat(101) }], olehUserId: user })).toEqual({
        ok: false,
        code: "NAMA_TERLALU_PANJANG",
      });

      const jejak = await prisma.auditLog.findMany({
        where: { userId: user, action: { in: [JEJAK_JADWAL.HARI_KERJA_DIUBAH, JEJAK_JADWAL.TANGGAL_MERAH_DIUBAH] } },
        orderBy: { createdAt: "asc" },
      });
      expect(jejak.map((j) => [j.action, j.entityId, (j.metadata as { tahapDisusun: number }).tahapDisusun])).toEqual([
        [JEJAK_JADWAL.TANGGAL_MERAH_DIUBAH, KUNCI_TANGGAL_MERAH, 1],
        [JEJAK_JADWAL.HARI_KERJA_DIUBAH, KUNCI_HARI_KERJA_PRODUKSI, 1],
      ]);
      expect(jejak[1].changes).toEqual({ before: { hariKerja: [1, 2, 3, 4, 5] }, after: { hariKerja: [1, 2, 3, 4, 5, 6] } });

      // Kembalikan kalender uji untuk tes berikutnya di berkas ini.
      await prisma.systemSetting.update({ where: { key: KUNCI_HARI_KERJA_PRODUKSI }, data: { value: JSON.stringify({ hariKerja: [1, 2, 3, 4, 5] }) } });
      await prisma.systemSetting.update({ where: { key: KUNCI_TANGGAL_MERAH }, data: { value: "[]" } });
    });
  });
});
