import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { JEJAK_RANTAI, aturProsesBanyakPemasok, sisipkanLangkahPemasok } from "./rantai-pemasok-writer";

/*
 * Rantai proses pemasok — penulis seret-lepas dan "Centang pemasok…", terhadap
 * basis data uji. Semua baris milik fixture buatan tes (pemasok, jenis, template,
 * pengguna berkode acak); teardown hanya lewat id yang diseed.
 */

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

const tag = `RNT-${Math.random().toString(36).slice(2, 9)}`;

d("rantai proses pemasok — penulis (test bed only)", () => {
  let user = "";
  let jenis = "";
  let tplRajut = "";
  let tplCelup = "";
  let tplQc = "";
  let tplArsip = "";
  const pemasokIds: string[] = [];

  const buatPemasok = async (rantai: string[] = []) => {
    const s = await prisma.supplier.create({
      data: { code: `${tag}-${pemasokIds.length + 1}`, name: `Pemasok ${tag} ${pemasokIds.length + 1}`, typeId: jenis, status: "ACTIVE" },
      select: { id: true },
    });
    pemasokIds.push(s.id);
    // Urutan sengaja tidak rapat (10, 20, …) seperti data hasil SOP/seed.
    for (const [i, processTemplateId] of rantai.entries()) {
      await prisma.supplierProcess.create({ data: { supplierId: s.id, processTemplateId, sequence: (i + 1) * 10 } });
    }
    return s.id;
  };

  const rantainya = (supplierId: string) =>
    prisma.supplierProcess.findMany({
      where: { supplierId: seededId(supplierId) },
      orderBy: { sequence: "asc" },
      select: { id: true, sequence: true, processTemplateId: true },
    });

  beforeAll(async () => {
    user = "";
    jenis = "";
    tplRajut = tplCelup = tplQc = tplArsip = "";
    user = (await prisma.user.create({ data: { email: `${tag}@test.local`.toLowerCase(), name: `Lead time ${tag}` } })).id;
    jenis = (await prisma.supplierType.create({ data: { code: tag, name: `Jenis ${tag}` } })).id;
    const template = (nama: string, isActive = true) =>
      prisma.processTemplate.create({ data: { name: `${nama} ${tag}`, days: 3, isActive } }).then((t) => t.id);
    tplRajut = await template("Rajut");
    tplCelup = await template("Celup");
    tplQc = await template("QC");
    tplArsip = await template("Arsip", false);
  });

  afterEach(async () => {
    await prisma.supplierProcess.deleteMany({ where: { supplierId: { in: seededIds(pemasokIds) } } });
    await prisma.supplier.deleteMany({ where: { id: { in: seededIds(pemasokIds) } } });
    pemasokIds.length = 0;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { userId: seededId(user) } });
    await prisma.supplierProcess.deleteMany({ where: { supplierId: { in: seededIds(pemasokIds) } } });
    await prisma.supplier.deleteMany({ where: { id: { in: seededIds(pemasokIds) } } });
    await prisma.supplierType.deleteMany({ where: { id: seededId(jenis) } });
    await prisma.processTemplate.deleteMany({
      where: { id: { in: seededIds([tplRajut, tplCelup, tplQc, tplArsip].filter(Boolean)) } },
    });
    await prisma.user.deleteMany({ where: { id: seededId(user) } });
  });

  describe("sisipkan dari palet (seret)", () => {
    it("di tengah: langkah lain bergeser, urutan dirapikan 1..n, jejak ADD membawa urutan sebelum/sesudah", async () => {
      const p = await buatPemasok([tplRajut, tplCelup]);
      const awal = await rantainya(p);
      const hasil = await sisipkanLangkahPemasok({ supplierId: p, processTemplateId: tplQc, celah: 1, olehUserId: user });
      expect(hasil).toMatchObject({ ok: true, sequence: 2 });
      const sesudah = await rantainya(p);
      expect(sesudah.map((l) => [l.sequence, l.processTemplateId])).toEqual([
        [1, tplRajut],
        [2, tplQc],
        [3, tplCelup],
      ]);
      const baru = hasil.ok ? hasil.id : "";
      const jejak = await prisma.auditLog.findFirst({ where: { entityId: baru, action: JEJAK_RANTAI.DITAMBAH } });
      expect(jejak?.userId).toBe(user);
      expect(jejak?.entityType).toBe("SupplierProcess");
      expect(jejak?.changes).toEqual({ after: { supplierId: p, templateName: `QC ${tag}`, sequence: 2 } });
      expect(jejak?.metadata).toEqual({
        cara: "SERET",
        celah: 1,
        urutanSebelum: awal.map((l) => l.id),
        urutanSesudah: [awal[0].id, baru, awal[1].id],
      });
    });

    it("di depan, di belakang, lewat akhir (dijepit), dan ke kartu kosong; proses yang sama boleh dua kali", async () => {
      const p = await buatPemasok([tplRajut]);
      expect(await sisipkanLangkahPemasok({ supplierId: p, processTemplateId: tplCelup, celah: 0, olehUserId: user })).toMatchObject({ ok: true, sequence: 1 });
      expect(await sisipkanLangkahPemasok({ supplierId: p, processTemplateId: tplQc, celah: 2, olehUserId: user })).toMatchObject({ ok: true, sequence: 3 });
      expect(await sisipkanLangkahPemasok({ supplierId: p, processTemplateId: tplQc, celah: 99, olehUserId: user })).toMatchObject({ ok: true, sequence: 4 });
      expect((await rantainya(p)).map((l) => [l.sequence, l.processTemplateId])).toEqual([
        [1, tplCelup],
        [2, tplRajut],
        [3, tplQc],
        [4, tplQc],
      ]);
      const kosong = await buatPemasok();
      expect(await sisipkanLangkahPemasok({ supplierId: kosong, processTemplateId: tplRajut, celah: 3, olehUserId: user })).toMatchObject({ ok: true, sequence: 1 });
    });

    it("penolakan berkode tanpa mengubah apa pun", async () => {
      const p = await buatPemasok([tplRajut, tplCelup]);
      const awal = await rantainya(p);
      const tolak = async (ubah: Partial<Parameters<typeof sisipkanLangkahPemasok>[0]>) =>
        sisipkanLangkahPemasok({ supplierId: p, processTemplateId: tplQc, celah: 1, olehUserId: user, ...ubah });
      expect(await tolak({ processTemplateId: tplArsip })).toEqual({ ok: false, code: "PROSES_TIDAK_ADA" });
      expect(await tolak({ processTemplateId: "tidak-ada" })).toEqual({ ok: false, code: "PROSES_TIDAK_ADA" });
      expect(await tolak({ supplierId: "tidak-ada" })).toEqual({ ok: false, code: "PEMASOK_TIDAK_ADA" });
      expect(await tolak({ supplierId: "" })).toEqual({ ok: false, code: "PEMASOK_TIDAK_ADA" });
      expect(await tolak({ celah: -1 })).toEqual({ ok: false, code: "ISIAN_TIDAK_SAH" });
      expect(await tolak({ celah: 0.5 })).toEqual({ ok: false, code: "ISIAN_TIDAK_SAH" });
      expect(await rantainya(p)).toEqual(awal);
    });
  });

  describe("Centang pemasok…", () => {
    it("pasang di akhir rantai yang belum punya; lepas SEMUA langkah proses itu dan rapikan urutan; jejak per langkah", async () => {
      const a = await buatPemasok([tplRajut]);
      const b = await buatPemasok([tplQc, tplRajut]);
      const c = await buatPemasok([tplQc, tplCelup, tplQc]);
      const dSudah = await buatPemasok([tplQc]);
      const kenaC = (await rantainya(c)).filter((l) => l.processTemplateId === tplQc);

      const hasil = await aturProsesBanyakPemasok({ processTemplateId: tplQc, tambah: [a, dSudah], lepas: [b, c], olehUserId: user });
      expect(hasil).toEqual({ ok: true, ditambah: [a], dilepas: [b, c] });

      // Dipasang di belakang (max + 1, sama dengan "+" di palet); rantai lain tidak disentuh.
      expect((await rantainya(a)).map((l) => [l.sequence, l.processTemplateId])).toEqual([
        [10, tplRajut],
        [11, tplQc],
      ]);
      expect((await rantainya(b)).map((l) => [l.sequence, l.processTemplateId])).toEqual([[1, tplRajut]]);
      expect((await rantainya(c)).map((l) => [l.sequence, l.processTemplateId])).toEqual([[1, tplCelup]]);
      expect((await rantainya(dSudah)).map((l) => l.processTemplateId)).toEqual([tplQc]);

      const jejakLepas = await prisma.auditLog.findMany({
        where: { userId: user, action: JEJAK_RANTAI.DILEPAS, entityId: { in: kenaC.map((l) => l.id) } },
      });
      expect(jejakLepas).toHaveLength(2);
      expect(jejakLepas[0].changes).toMatchObject({ before: { supplierId: c, templateName: `QC ${tag}` } });
      expect(jejakLepas[0].metadata).toEqual({ cara: "CENTANG_PEMASOK", processTemplateId: tplQc });
      const baruA = (await rantainya(a))[1].id;
      expect(await prisma.auditLog.count({ where: { entityId: baruA, action: JEJAK_RANTAI.DITAMBAH } })).toBe(1);
    });

    it("yang sudah dalam keadaan diminta dilewati tanpa jejak; daftar kosong = tidak ada apa pun", async () => {
      const a = await buatPemasok([tplQc]);
      const b = await buatPemasok([tplRajut]);
      expect(await aturProsesBanyakPemasok({ processTemplateId: tplQc, tambah: [a], lepas: [b], olehUserId: user })).toEqual({
        ok: true,
        ditambah: [],
        dilepas: [],
      });
      expect(await aturProsesBanyakPemasok({ processTemplateId: tplQc, tambah: [], lepas: [], olehUserId: user })).toEqual({
        ok: true,
        ditambah: [],
        dilepas: [],
      });
      const idLangkah = [...(await rantainya(a)), ...(await rantainya(b))].map((l) => l.id);
      expect(await prisma.auditLog.count({ where: { userId: seededId(user), entityId: { in: seededIds(idLangkah) } } })).toBe(0);
    });

    it("proses arsip: memasang ditolak, melepas tetap boleh; penolakan lain berkode dan tidak mengubah apa pun", async () => {
      const a = await buatPemasok([tplArsip, tplRajut]);
      const b = await buatPemasok([tplRajut]);
      expect(await aturProsesBanyakPemasok({ processTemplateId: tplArsip, tambah: [b], lepas: [], olehUserId: user })).toEqual({
        ok: false,
        code: "PROSES_TIDAK_ADA",
      });
      expect(await aturProsesBanyakPemasok({ processTemplateId: tplArsip, tambah: [], lepas: [a], olehUserId: user })).toEqual({
        ok: true,
        ditambah: [],
        dilepas: [a],
      });
      expect((await rantainya(a)).map((l) => [l.sequence, l.processTemplateId])).toEqual([[1, tplRajut]]);

      const sebelum = await rantainya(b);
      expect(await aturProsesBanyakPemasok({ processTemplateId: tplQc, tambah: [b], lepas: [b], olehUserId: user })).toEqual({
        ok: false,
        code: "ISIAN_TIDAK_SAH",
      });
      expect(await aturProsesBanyakPemasok({ processTemplateId: tplQc, tambah: [b, ""], lepas: [], olehUserId: user })).toEqual({
        ok: false,
        code: "ISIAN_TIDAK_SAH",
      });
      expect(await aturProsesBanyakPemasok({ processTemplateId: tplQc, tambah: [b, "tidak-ada"], lepas: [], olehUserId: user })).toEqual({
        ok: false,
        code: "PEMASOK_TIDAK_ADA",
      });
      expect(await aturProsesBanyakPemasok({ processTemplateId: "tidak-ada", tambah: [b], lepas: [], olehUserId: user })).toEqual({
        ok: false,
        code: "PROSES_TIDAK_ADA",
      });
      expect(await rantainya(b)).toEqual(sebelum);
    });
  });

  describe("balapan (Promise.all)", () => {
    it("dua sisipan bersamaan di pemasok yang sama: keduanya masuk, urutan 1..n tanpa ganda", async () => {
      for (let putaran = 0; putaran < 3; putaran++) {
        const p = await buatPemasok([tplRajut, tplCelup]);
        const hasil = await Promise.all([
          sisipkanLangkahPemasok({ supplierId: p, processTemplateId: tplQc, celah: 1, olehUserId: user }),
          sisipkanLangkahPemasok({ supplierId: p, processTemplateId: tplQc, celah: 0, olehUserId: user }),
        ]);
        expect(hasil.map((h) => h.ok)).toEqual([true, true]);
        const rantai = await rantainya(p);
        expect(rantai.map((l) => l.sequence)).toEqual([1, 2, 3, 4]);
        expect(rantai.filter((l) => l.processTemplateId === tplQc)).toHaveLength(2);
        expect(rantai.filter((l) => l.processTemplateId !== tplQc).map((l) => l.processTemplateId)).toEqual([tplRajut, tplCelup]);
      }
    });

    it("centang massal vs sisipan di pemasok yang sama: tidak ada urutan ganda, keduanya tercermin", async () => {
      for (let putaran = 0; putaran < 3; putaran++) {
        const p = await buatPemasok([tplQc, tplRajut]);
        const hasil = await Promise.all([
          aturProsesBanyakPemasok({ processTemplateId: tplQc, tambah: [], lepas: [p], olehUserId: user }),
          sisipkanLangkahPemasok({ supplierId: p, processTemplateId: tplCelup, celah: 2, olehUserId: user }),
        ]);
        expect(hasil.map((h) => h.ok)).toEqual([true, true]);
        const rantai = await rantainya(p);
        expect(rantai.map((l) => l.processTemplateId)).toEqual([tplRajut, tplCelup]);
        expect(rantai.map((l) => l.sequence)).toEqual([1, 2]);
      }
    });
  });
});
