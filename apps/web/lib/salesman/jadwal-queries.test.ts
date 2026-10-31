import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { geserHari } from "./jadwal";
import { cariTokoUntukJadwal, jadwalHariIniSales, jadwalMinggu, jadwalRentang } from "./jadwal-queries";
import { kinerjaSatuSales, kinerjaSemuaSales } from "./metrik-queries";
import { ruteHariIni } from "./rute-queries";

/*
 * Kepatuhan jadwal kunjungan terhadap basis data uji: jadwal dan kunjungan
 * diseed langsung pada tanggal lampau yang acak (tidak bertabrakan dengan data
 * pengembangan), lalu dibaca lewat kueri layar kantor, HP, dasbor atasan dan
 * rute. Teardown hanya lewat id yang diseed.
 */

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const token = Math.random().toString(36).slice(2, 10);
const acak = (min: number, maks: number) => min + Math.floor(Math.random() * (maks - min + 1));
const HARI = `${acak(2001, 2019)}-${String(acak(1, 12)).padStart(2, "0")}-${String(acak(10, 28)).padStart(2, "0")}`;
const KEMARIN = geserHari(HARI, -1);
const jam = (hhmm: string, tanggal = HARI) => new Date(`${tanggal}T${hhmm}:00+07:00`);
// "Sekarang" = malam hari itu: kemarin sudah lewat, hari itu masih berjalan.
const SEKARANG = jam("20:00");

d("kepatuhan jadwal kunjungan — kueri (test bed only)", () => {
  let sales = "";
  let admin = "";
  let tokoA = "";
  let tokoB = "";
  let tokoMati = "";
  let visitIds: string[] = [];

  beforeAll(async () => {
    sales = "";
    admin = "";
    tokoA = "";
    tokoB = "";
    tokoMati = "";
    visitIds = [];
    sales = (await prisma.user.create({ data: { email: `jq-s-${token}@test.local`, name: `JQ Sales ${token}` } })).id;
    admin = (await prisma.user.create({ data: { email: `jq-a-${token}@test.local`, name: `JQ Admin ${token}` } })).id;
    const toko = (kode: string, x: object = {}) =>
      prisma.store.create({
        data: { code: `T-JQ-${kode}-${token}`, name: `JQ ${kode} ${token}`, address: `Jl. ${kode}`, termsType: "PUTUS", ...x },
      });
    tokoA = (await toko("A", { salesmanId: sales, lat: -6.2, lng: 106.8 })).id;
    // B: tidak dipegang dan tidak pernah didatangi — bukan "toko saya".
    tokoB = (await toko("B")).id;
    tokoMati = (await toko("C", { isActive: false })).id;

    await prisma.visitSchedule.createMany({
      data: [
        { salesmanId: sales, storeId: tokoA, dayKey: KEMARIN, createdById: admin },
        { salesmanId: sales, storeId: tokoB, dayKey: KEMARIN, createdById: admin },
        { salesmanId: sales, storeId: tokoA, dayKey: HARI, note: "Tagih giro", createdById: admin },
        { salesmanId: sales, storeId: tokoB, dayKey: HARI, note: "Toko baru", createdById: admin },
        { salesmanId: sales, storeId: tokoMati, dayKey: HARI, createdById: admin },
      ],
    });
    const kunjungan = async (storeId: string, checkinAt: Date) => {
      const v = await prisma.storeVisit.create({
        data: { storeId, userId: sales, checkinAt, checkoutAt: new Date(checkinAt.getTime() + 600_000), checkinLat: -6.2, checkinLng: 106.8 },
      });
      visitIds.push(v.id);
    };
    // Kemarin 23.30 WIB → kemarin; hari itu 00.30 WIB (masih kemarin di UTC) → hari itu.
    await kunjungan(tokoA, jam("23:30", KEMARIN));
    await kunjungan(tokoA, jam("00:30"));
    // Sales lain di toko B tidak menghitung untuk sales ini.
    await prisma.storeVisit
      .create({ data: { storeId: tokoB, userId: admin, checkinAt: jam("09:00"), checkinLat: -6.2, checkinLng: 106.8 } })
      .then((v) => visitIds.push(v.id));
  });

  afterAll(async () => {
    await prisma.storeVisit.deleteMany({ where: { id: { in: seededIds(visitIds) } } });
    await prisma.visitSchedule.deleteMany({ where: { salesmanId: seededId(sales) } });
    await prisma.store.deleteMany({ where: { id: { in: seededIds([tokoA, tokoB, tokoMati].filter(Boolean)) } } });
    await prisma.user.deleteMany({ where: { id: { in: seededIds([sales, admin].filter(Boolean)) } } });
  });

  it("status per baris: didatangi pada hari WIB-nya, terlewat bila hari lewat, menunggu bila belum", async () => {
    const r = await jadwalRentang(sales, KEMARIN, HARI, SEKARANG);
    expect(r.map((b) => [b.dayKey, b.storeId, b.status, b.aktif])).toEqual([
      [KEMARIN, tokoA, "DIKUNJUNGI", true],
      [KEMARIN, tokoB, "TERLEWAT", true],
      [HARI, tokoA, "DIKUNJUNGI", true],
      [HARI, tokoB, "MENUNGGU", true],
      [HARI, tokoMati, "MENUNGGU", false],
    ]);
    expect(r[2]).toMatchObject({ catatan: "Tagih giro", nama: `JQ A ${token}`, lat: -6.2, lng: 106.8 });
  });

  it("satu minggu per hari; HP tidak melihat toko nonaktif", async () => {
    const kantor = await jadwalMinggu(sales, geserHari(HARI, -14), SEKARANG);
    expect(kantor.ringkas.direncanakan).toBe(0);

    const hp = await jadwalRentang(sales, HARI, HARI, SEKARANG);
    expect(hp).toHaveLength(3);
    const hariIni = await jadwalHariIniSales(sales, SEKARANG);
    expect(hariIni.map((j) => [j.storeId, j.dikunjungi, j.catatan])).toEqual([
      [tokoA, true, "Tagih giro"],
      [tokoB, false, "Toko baru"],
    ]);
  });

  it("dasbor atasan: ringkasan kepatuhan per sales; tanpa rencana (kabar harian) tidak dimuat", async () => {
    const tim = await kinerjaSemuaSales({ dari: KEMARIN, sampai: HARI }, { sekarang: SEKARANG, salesmanIds: [sales] });
    expect(tim.baris[0].jadwal).toEqual({ direncanakan: 5, dikunjungi: 2, terlewat: 1, menunggu: 2, izin: 0 });

    const ringan = await kinerjaSemuaSales(
      { dari: KEMARIN, sampai: HARI },
      { sekarang: SEKARANG, salesmanIds: [sales], denganRencana: false },
    );
    expect(ringan.baris[0].jadwal).toBeNull();
  });

  it("satu sales (layar Hari ini / rincian): baris jadwal bernama dengan statusnya", async () => {
    const r = await kinerjaSatuSales(sales, { dari: HARI, sampai: HARI }, { sekarang: SEKARANG });
    expect(r?.kinerja.jadwal).toEqual({ direncanakan: 3, dikunjungi: 1, terlewat: 0, menunggu: 2, izin: 0 });
    expect(r?.jadwal.map((j) => [j.nama, j.status, j.catatan])).toEqual([
      [`JQ A ${token}`, "DIKUNJUNGI", "Tagih giro"],
      [`JQ B ${token}`, "MENUNGGU", "Toko baru"],
      [`JQ C ${token}`, "MENUNGGU", null],
    ]);
  });

  it("rute hari ini: toko terjadwal paling depan — juga yang bukan toko saya — bertanda jadwal", async () => {
    const r = await ruteHariIni(sales, SEKARANG);
    expect(r.rencana.slice(0, 2)).toEqual([tokoA, tokoB]);
    const b = r.toko.find((x) => x.id === tokoB);
    expect(b).toMatchObject({ jadwal: { catatan: "Toko baru" }, alasan: null, dikunjungiHariIni: false, alamat: "Jl. B" });
    const a = r.toko.find((x) => x.id === tokoA);
    expect(a).toMatchObject({ jadwal: { catatan: "Tagih giro" }, dikunjungiHariIni: true });
    // Toko nonaktif tidak masuk rute.
    expect(r.toko.some((x) => x.id === tokoMati)).toBe(false);
  });

  it("cari toko: toko yang dipegang dulu; saat kunci menyala hanya toko yang dipegang", async () => {
    // Toko C nonaktif: tidak pernah ditawarkan.
    const bebas = await cariTokoUntukJadwal({ salesmanId: sales, q: token, terkunci: false });
    expect(bebas.map((t) => [t.id, t.milikSales])).toEqual([
      [tokoA, true],
      [tokoB, false],
    ]);
    const terkunci = await cariTokoUntukJadwal({ salesmanId: sales, q: token, terkunci: true });
    expect(terkunci.map((t) => t.id)).toEqual([tokoA]);
  });
});
