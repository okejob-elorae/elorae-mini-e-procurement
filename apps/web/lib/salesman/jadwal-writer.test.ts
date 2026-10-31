import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { AKSI_JADWAL, ENTITAS_JADWAL, geserHari, seninDari } from "./jadwal";
import { salinMingguLalu, simpanJadwal } from "./jadwal-writer";

/*
 * Penulis jadwal kunjungan terhadap basis data uji. Semua baris milik
 * pengguna dan toko buatan tes; "sekarang" dipatok ke hari di masa depan yang
 * jauh, jadi tidak ada data pengembangan yang bisa ikut terbaca. Teardown
 * hanya lewat id yang diseed.
 */

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const token = Math.random().toString(36).slice(2, 10);
const HARI_INI = "2031-03-05";
const SEKARANG = new Date(`${HARI_INI}T03:00:00Z`); // 10.00 WIB
const SENIN = seninDari(HARI_INI);
const BESOK = geserHari(HARI_INI, 1);
const LUSA = geserHari(HARI_INI, 2);

d("penulis jadwal kunjungan (test bed only)", () => {
  let sales = "";
  let bukanSales = "";
  let admin = "";
  let tokoA = "";
  let tokoB = "";
  let tokoMati = "";

  const jejak = () =>
    prisma.auditLog.findMany({
      where: { entityType: ENTITAS_JADWAL, entityId: seededId(sales) },
      orderBy: { createdAt: "asc" },
    });
  const baris = () =>
    prisma.visitSchedule.findMany({
      where: { salesmanId: seededId(sales) },
      orderBy: [{ dayKey: "asc" }, { storeId: "asc" }],
      select: { dayKey: true, storeId: true, note: true, createdById: true },
    });

  beforeAll(async () => {
    sales = "";
    bukanSales = "";
    admin = "";
    tokoA = "";
    tokoB = "";
    tokoMati = "";
    const peran = await prisma.roleDefinition.findFirst({
      where: { isSystem: false, permissions: { some: { permission: { code: "pwa:access" } } } },
      select: { id: true },
    });
    if (!peran) throw new Error("Basis data uji tidak punya peran lapangan (pwa:access) — jalankan seed dulu.");

    sales = (await prisma.user.create({ data: { email: `jadwal-s-${token}@test.local`, name: `Jadwal S ${token}`, roleId: peran.id } })).id;
    bukanSales = (await prisma.user.create({ data: { email: `jadwal-x-${token}@test.local`, name: `Jadwal X ${token}` } })).id;
    admin = (await prisma.user.create({ data: { email: `jadwal-a-${token}@test.local`, name: `Jadwal A ${token}` } })).id;
    const toko = (kode: string, x: object = {}) =>
      prisma.store.create({ data: { code: `T-JW-${kode}-${token}`, name: `Toko ${kode} ${token}`, address: "x", termsType: "PUTUS", ...x } });
    tokoA = (await toko("A", { salesmanId: sales })).id;
    tokoB = (await toko("B")).id;
    tokoMati = (await toko("MATI", { isActive: false })).id;
  });

  beforeEach(async () => {
    await prisma.visitSchedule.deleteMany({ where: { salesmanId: seededId(sales) } });
    await prisma.auditLog.deleteMany({ where: { entityType: "VisitSchedule", entityId: seededId(sales) } });
  });

  afterAll(async () => {
    await prisma.visitSchedule.deleteMany({ where: { salesmanId: { in: seededIds([sales, bukanSales].filter(Boolean)) } } });
    await prisma.auditLog.deleteMany({
      where: { entityType: "VisitSchedule", entityId: { in: seededIds([sales, bukanSales].filter(Boolean)) } },
    });
    await prisma.store.deleteMany({ where: { id: { in: seededIds([tokoA, tokoB, tokoMati].filter(Boolean)) } } });
    await prisma.user.deleteMany({ where: { id: { in: seededIds([sales, bukanSales, admin].filter(Boolean)) } } });
  });

  it("menolak pengguna yang bukan sales lapangan, tanpa menulis apa pun", async () => {
    const r = await simpanJadwal({
      salesmanId: bukanSales,
      olehUserId: admin,
      sekarang: SEKARANG,
      perubahan: { tambah: [{ dayKey: BESOK, storeId: tokoA }] },
    });
    expect(r).toEqual({ ok: false, kode: "SALES_TIDAK_DITEMUKAN" });
    expect(await prisma.visitSchedule.count({ where: { salesmanId: seededId(bukanSales) } })).toBe(0);
  });

  it("menambah dua toko: dua baris, SATU jejak berisi sebelum/sesudah per hari", async () => {
    const r = await simpanJadwal({
      salesmanId: sales,
      olehUserId: admin,
      sekarang: SEKARANG,
      perubahan: {
        tambah: [
          { dayKey: BESOK, storeId: tokoA, note: "Bawa sampel" },
          { dayKey: BESOK, storeId: tokoB },
        ],
      },
    });
    expect(r).toMatchObject({ ok: true, hariBerubah: [BESOK] });
    const rows = await baris();
    expect(rows).toHaveLength(2);
    expect(rows.find((x) => x.storeId === tokoA)).toMatchObject({ note: "Bawa sampel", createdById: admin });

    const j = await jejak();
    expect(j).toHaveLength(1);
    expect(j[0]).toMatchObject({ action: AKSI_JADWAL, userId: admin, entityId: sales, metadata: { cara: "UBAH" } });
    const changes = j[0].changes as { before: Record<string, unknown[]>; after: Record<string, { storeId: string }[]> };
    expect(changes.before[BESOK]).toEqual([]);
    expect(changes.after[BESOK].map((x) => x.storeId).sort()).toEqual([tokoA, tokoB].sort());
  });

  it("toko yang sama di hari yang sama tetap satu baris; simpan yang tidak mengubah apa pun tidak menulis jejak", async () => {
    await simpanJadwal({ salesmanId: sales, olehUserId: admin, sekarang: SEKARANG, perubahan: { tambah: [{ dayKey: BESOK, storeId: tokoA }] } });
    const ulang = await simpanJadwal({
      salesmanId: sales,
      olehUserId: admin,
      sekarang: SEKARANG,
      perubahan: { tambah: [{ dayKey: BESOK, storeId: tokoA }] },
    });
    expect(ulang).toEqual({ ok: true, hariBerubah: [], jejak: null });
    expect(await baris()).toHaveLength(1);
    expect(await jejak()).toHaveLength(1);

    // Basis datanya sendiri menolak baris kembar per sales × toko × hari.
    await expect(
      prisma.visitSchedule.create({ data: { salesmanId: sales, storeId: tokoA, dayKey: BESOK, createdById: admin } }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("hari lewat dan toko nonaktif ditolak seluruhnya — tidak ada simpan setengah jalan", async () => {
    expect(
      await simpanJadwal({
        salesmanId: sales,
        olehUserId: admin,
        sekarang: SEKARANG,
        perubahan: { tambah: [{ dayKey: geserHari(HARI_INI, -1), storeId: tokoA }] },
      }),
    ).toEqual({ ok: false, kode: "HARI_LEWAT", dayKey: geserHari(HARI_INI, -1) });
    expect(
      await simpanJadwal({
        salesmanId: sales,
        olehUserId: admin,
        sekarang: SEKARANG,
        perubahan: {
          tambah: [
            { dayKey: BESOK, storeId: tokoA },
            { dayKey: BESOK, storeId: tokoMati },
          ],
        },
      }),
    ).toEqual({ ok: false, kode: "TOKO_TIDAK_AKTIF", storeIds: [tokoMati] });
    expect(await baris()).toHaveLength(0);
    expect(await jejak()).toHaveLength(0);
  });

  it("ganti + catatan + hapus dalam satu simpan", async () => {
    await simpanJadwal({
      salesmanId: sales,
      olehUserId: admin,
      sekarang: SEKARANG,
      perubahan: {
        tambah: [
          { dayKey: BESOK, storeId: tokoA },
          { dayKey: LUSA, storeId: tokoA },
        ],
      },
    });
    const r = await simpanJadwal({
      salesmanId: sales,
      olehUserId: admin,
      sekarang: SEKARANG,
      perubahan: {
        ganti: [{ dayKey: BESOK, toko: [{ storeId: tokoB, note: "Ganti A ke B" }] }],
        hapus: [{ dayKey: LUSA, storeId: tokoA }],
      },
    });
    expect(r).toMatchObject({ ok: true, hariBerubah: [BESOK, LUSA] });
    expect((await baris()).map((x) => [x.dayKey, x.storeId, x.note])).toEqual([[BESOK, tokoB, "Ganti A ke B"]]);

    await simpanJadwal({
      salesmanId: sales,
      olehUserId: admin,
      sekarang: SEKARANG,
      perubahan: { catatan: [{ dayKey: BESOK, storeId: tokoB, note: "  Tagih giro  " }] },
    });
    expect((await baris())[0].note).toBe("Tagih giro");
    expect(await jejak()).toHaveLength(3);
  });

  it("salin minggu lalu: yang sudah ada dilewati, hari lewat dilewati, satu jejak; salin kedua tidak menulis apa pun", async () => {
    // Minggu lalu ditulis langsung — penulis menolak hari lampau.
    const mingguLalu = geserHari(SENIN, -7);
    await prisma.visitSchedule.createMany({
      data: [
        { salesmanId: sales, storeId: tokoA, dayKey: mingguLalu, note: "Senin", createdById: admin }, // → Senin minggu ini: lewat
        { salesmanId: sales, storeId: tokoA, dayKey: geserHari(mingguLalu, 3), note: "Kamis", createdById: admin },
        { salesmanId: sales, storeId: tokoB, dayKey: geserHari(mingguLalu, 3), note: null, createdById: admin },
        { salesmanId: sales, storeId: tokoMati, dayKey: geserHari(mingguLalu, 4), note: null, createdById: admin },
      ],
    });
    const kamis = geserHari(SENIN, 3);
    expect(kamis >= HARI_INI).toBe(true);
    // Toko B sudah dijadwalkan Kamis minggu ini dengan catatannya sendiri.
    await simpanJadwal({
      salesmanId: sales,
      olehUserId: admin,
      sekarang: SEKARANG,
      perubahan: { tambah: [{ dayKey: kamis, storeId: tokoB, note: "Sudah diatur" }] },
    });

    const r = await salinMingguLalu({ salesmanId: sales, olehUserId: admin, minggu: HARI_INI, sekarang: SEKARANG });
    expect(r).toMatchObject({
      ok: true,
      disalin: 1,
      dilewati: { sudahAda: 1, hariLewat: SENIN < HARI_INI ? 1 : 0, tokoTidakAktif: 1, bukanMiliknya: 0, penuh: 0 },
    });
    const kamisIni = (await baris()).filter((x) => x.dayKey === kamis);
    expect(kamisIni.map((x) => [x.storeId, x.note]).sort()).toEqual(
      [
        [tokoA, "Kamis"],
        [tokoB, "Sudah diatur"],
      ].sort(),
    );
    const j = await jejak();
    expect(j).toHaveLength(2);
    expect(j[1].metadata).toEqual({ cara: "SALIN_MINGGU", dariSenin: mingguLalu, keSenin: SENIN });

    const lagi = await salinMingguLalu({ salesmanId: sales, olehUserId: admin, minggu: HARI_INI, sekarang: SEKARANG });
    expect(lagi).toMatchObject({ ok: true, disalin: 0 });
    expect(await jejak()).toHaveLength(2);
  });

  it("salin ke minggu yang seluruhnya sudah lewat ditolak", async () => {
    expect(
      await salinMingguLalu({ salesmanId: sales, olehUserId: admin, minggu: geserHari(SENIN, -7), sekarang: SEKARANG }),
    ).toEqual({ ok: false, kode: "HARI_LEWAT" });
  });
});
