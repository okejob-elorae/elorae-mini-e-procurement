import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { KUNCI_MEMBER, MEMBER_BAWAAN } from "./member";
import { memberKantor, pelangganTokoKantor, ringkasPelangganKantor } from "./pelanggan-kantor";

/*
 * Pelacakan pelanggan dan daftar member kantor terhadap basis data uji, dengan
 * "sekarang" 20 Agu 2026 12.00 WIB dan periode 90 hari (23 Mei – 20 Agu).
 * Pengaturan member (global) dipotret dan dipulihkan PALING DULU; semua baris
 * lain dibuat tes ini dan dihapus lewat id (`seededId`/`seededIds`). Nomor HP
 * acak.
 */

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

const tag = `PLC-${Math.random().toString(36).slice(2, 9)}`;
const SEKARANG = new Date("2026-08-20T05:00:00Z");
const wib = (day: string, jam = "12:00") => new Date(`${day}T${jam}:00+07:00`);
const nomorAcak = () => `62812${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;

d("pelacakan pelanggan kantor (test bed only)", () => {
  let setelanLama: string | null | undefined = undefined;
  let uomId = "";
  let kategoriId = "";
  let kaos = "";
  let polos = "";
  let tokoA = "";
  let tokoB = "";
  let spg = "";
  let saleIds: string[] = [];
  let pelangganIds: string[] = [];
  let memberIds: string[] = [];
  let titipIds: string[] = [];
  const hp = { ani: nomorAcak(), budi: nomorAcak(), cici: nomorAcak(), dodi: nomorAcak() };
  const id = { ani: "", budi: "", cici: "", dodi: "", aniB: "" };

  const jual = async (storeId: string, customerId: string | null, createdAt: Date, baris: { itemId: string; qty: number; bersih: number; kembali?: number }[]) => {
    const total = baris.reduce((s, b) => s + b.bersih, 0);
    const s = await prisma.spgSale.create({
      data: {
        docNo: `${tag}/${saleIds.length + 1}`,
        salesmanId: spg,
        storeId,
        customerId,
        subtotal: total,
        total,
        cashReceived: total,
        changeGiven: 0,
        createdById: spg,
        createdAt,
        lines: {
          create: baris.map((b) => ({ itemId: b.itemId, productName: "Uji", qty: b.qty, unitPrice: b.bersih / b.qty, lineTotal: b.bersih, returnedQty: b.kembali ?? 0 })),
        },
      },
    });
    saleIds.push(s.id);
  };
  const pelanggan = async (storeId: string, name: string, phone: string) => {
    const p = await prisma.storeCustomer.create({ data: { storeId, name, phone, consentAt: SEKARANG, createdById: spg, createdAt: wib("2026-01-02") } });
    pelangganIds.push(p.id);
    return p.id;
  };

  beforeAll(async () => {
    setelanLama = undefined;
    uomId = "";
    kategoriId = "";
    kaos = "";
    polos = "";
    tokoA = "";
    tokoB = "";
    spg = "";
    saleIds = [];
    pelangganIds = [];
    memberIds = [];
    titipIds = [];

    const s = await prisma.systemSetting.findUnique({ where: { key: KUNCI_MEMBER } });
    setelanLama = s ? s.value : null;
    const nilai = JSON.stringify(MEMBER_BAWAAN);
    await prisma.systemSetting.upsert({ where: { key: KUNCI_MEMBER }, create: { key: KUNCI_MEMBER, value: nilai }, update: { value: nilai } });

    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    kategoriId = (await prisma.itemCategory.create({ data: { name: `Kaos ${tag}` } })).id;
    kaos = (await prisma.item.create({ data: { sku: `${tag}-K`, nameId: "Kaos Uji", nameEn: "Tee", type: "FINISHED_GOOD", uomId, categoryId: kategoriId } })).id;
    polos = (await prisma.item.create({ data: { sku: `${tag}-P`, nameId: "Tanpa kategori", nameEn: "No category", type: "FINISHED_GOOD", uomId } })).id;
    const toko = (k: string) => prisma.store.create({ data: { code: `${tag}-${k}`, name: `Toko ${k} ${tag}`, address: "uji", termsType: "KONSI" } });
    tokoA = (await toko("A")).id;
    tokoB = (await toko("B")).id;
    spg = (await prisma.user.create({ data: { email: `${tag}-spg@test.local`.toLowerCase(), name: `SPG ${tag}`, assignedStoreId: tokoA } })).id;

    id.ani = await pelanggan(tokoA, "Ani", hp.ani);
    id.budi = await pelanggan(tokoA, "Budi", hp.budi);
    id.cici = await pelanggan(tokoA, "Cici", hp.cici);
    id.dodi = await pelanggan(tokoA, "Dodi", hp.dodi);
    id.aniB = await pelanggan(tokoB, "Ani", hp.ani);

    // Toko A. Ani: satu nota di periode, 2 kaos, 1 dikembalikan → bersih Rp100.000.
    await jual(tokoA, id.ani, wib("2026-08-10"), [{ itemId: kaos, qty: 2, bersih: 200_000, kembali: 1 }]);
    // Budi: satu nota sebelum periode (barang tanpa kategori), satu di dalamnya.
    await jual(tokoA, id.budi, wib("2026-03-01"), [{ itemId: polos, qty: 3, bersih: 150_000 }]);
    await jual(tokoA, id.budi, wib("2026-08-15"), [{ itemId: kaos, qty: 1, bersih: 100_000 }]);
    // Cici: terakhir 1 Apr, 141 hari sebelum "sekarang" → tidur.
    await jual(tokoA, id.cici, wib("2026-04-01"), [{ itemId: kaos, qty: 1, bersih: 80_000 }]);
    // Nota tanpa pembeli tercatat.
    await jual(tokoA, null, wib("2026-08-12"), [{ itemId: kaos, qty: 1, bersih: 50_000 }]);
    // Toko B: Ani belanja juga di sana.
    await jual(tokoB, id.aniB, wib("2026-08-18"), [{ itemId: kaos, qty: 1, bersih: 120_000 }]);

    const member = (name: string, phone: string, isActive: boolean) =>
      prisma.member.create({
        data: {
          name,
          phone,
          consentAt: wib("2026-08-10"),
          joinedAt: wib("2026-08-10"),
          joinedStoreId: tokoA,
          joinedById: spg,
          isActive,
          deactivatedAt: isActive ? null : wib("2026-08-16"),
          deactivatedById: isActive ? null : spg,
        },
      });
    memberIds.push((await member(`Ani ${tag}`, hp.ani, true)).id);
    memberIds.push((await member(`Budi ${tag}`, hp.budi, false)).id);

    titipIds.push((await prisma.customerRequest.create({ data: { storeId: tokoA, customerId: id.cici, description: "Kaos XL", status: "MENUNGGU", createdById: spg } })).id);
  });

  afterAll(async () => {
    if (setelanLama === null) await prisma.systemSetting.delete({ where: { key: KUNCI_MEMBER } }).catch(() => undefined);
    else if (setelanLama !== undefined) await prisma.systemSetting.update({ where: { key: KUNCI_MEMBER }, data: { value: setelanLama } });
    await prisma.customerRequest.deleteMany({ where: { id: { in: seededIds(titipIds) } } });
    await prisma.member.deleteMany({ where: { id: { in: seededIds(memberIds) } } });
    await prisma.spgSalePromo.deleteMany({ where: { spgSaleId: { in: seededIds(saleIds) } } });
    await prisma.spgSaleLine.deleteMany({ where: { spgSaleId: { in: seededIds(saleIds) } } });
    await prisma.spgSale.deleteMany({ where: { id: { in: seededIds(saleIds) } } });
    await prisma.storeCustomer.deleteMany({ where: { id: { in: seededIds(pelangganIds) } } });
    await prisma.user.deleteMany({ where: { id: seededId(spg) } });
    await prisma.item.deleteMany({ where: { id: { in: [seededId(kaos), seededId(polos)] } } });
    await prisma.itemCategory.deleteMany({ where: { id: seededId(kategoriId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.store.deleteMany({ where: { id: { in: [seededId(tokoA), seededId(tokoB)] } } });
  });

  it("summarises each store: coverage over all SPG receipts, returning buyers, first purchases, dormant, members", async () => {
    const r = await ringkasPelangganKantor({ sekarang: SEKARANG, periodeHari: 90 });
    expect(r.periode).toEqual({ hari: 90, hariAwal: "2026-05-23", hariAkhir: "2026-08-20" });
    expect(r.hariTidur).toBe(90);
    const a = r.toko.find((x) => x.storeId === tokoA)!;
    expect(a).toMatchObject({
      pelanggan: 4,
      member: 1,
      notaPeriode: 3,
      notaBerpembeli: 2,
      pembeliPeriode: 2,
      kembali: 1,
      kembaliPersen: 50,
      baru: 1,
      tidur: 1,
      belumBelanja: 1,
      // Nota berpembeli di periode Rp300.000, dikurangi satu kaos yang dikembalikan (Rp100.000).
      belanjaPeriode: 200_000,
      belanjaTerakhir: wib("2026-08-15").toISOString(),
    });
    expect(a.cakupanPersen).toBeCloseTo(200 / 3);
    expect(r.toko.find((x) => x.storeId === tokoB)).toMatchObject({ pelanggan: 1, member: 1, notaPeriode: 1, notaBerpembeli: 1, cakupanPersen: 100, kembali: 0, baru: 1 });
    // Semua toko: member dihitung sekali per orang (Ani di dua toko), dari member aktif Elorae.
    expect(r.semua.member).toBe(await prisma.member.count({ where: { isActive: true } }));
  });

  it("lists one store's customers with status, tier, net spend, favourite category and open requests — phones always masked", async () => {
    const data = (await pelangganTokoKantor(tokoA, { sekarang: SEKARANG, periodeHari: 90 }))!;
    expect(data.toko.id).toBe(tokoA);
    expect(data.ringkas).toMatchObject({ pelanggan: 4, notaPeriode: 3, notaBerpembeli: 2, member: 1, tidur: 1 });
    expect(data.halaman.baris.map((b) => b.nama)).toEqual(["Budi", "Ani", "Cici", "Dodi"]);
    const baris = (nama: string) => data.halaman.baris.find((b) => b.nama === nama)!;
    expect(baris("Ani")).toMatchObject({
      status: "BARU",
      member: { tingkat: "Reguler", aktif: true },
      nota: 1,
      belanja: 100_000,
      rataNota: 100_000,
      hariSejak: 10,
      favorit: { nama: `Kaos ${tag}`, potong: 1 },
    });
    expect(baris("Budi")).toMatchObject({
      status: "AKTIF",
      member: { tingkat: "Reguler", aktif: false },
      nota: 2,
      belanja: 250_000,
      rataNota: 125_000,
      pertama: wib("2026-03-01").toISOString(),
      hariSejak: 5,
      // Barang tanpa kategori tidak dihitung.
      favorit: { nama: `Kaos ${tag}`, potong: 1 },
    });
    expect(baris("Cici")).toMatchObject({ status: "TIDUR", member: null, hariSejak: 141, titipTerbuka: 1 });
    expect(baris("Dodi")).toMatchObject({ status: "BELUM_BELANJA", nota: 0, belanja: 0, rataNota: null, terakhir: null, favorit: null });
    const json = JSON.stringify(data);
    for (const n of Object.values(hp)) expect(json).not.toContain(n.slice(2));
    expect(baris("Ani").hpSamar).toBe(`0812****${hp.ani.slice(-4)}`);
  });

  it("filters by status, by active membership and by name or the visible phone digits, with counts following the search", async () => {
    const saring = async (o: Parameters<typeof pelangganTokoKantor>[1]) => (await pelangganTokoKantor(tokoA, o))!;
    expect((await saring({ sekarang: SEKARANG, periodeHari: 90, status: "TIDUR" })).halaman.baris.map((b) => b.nama)).toEqual(["Cici"]);
    expect((await saring({ sekarang: SEKARANG, periodeHari: 90, member: "ya" })).halaman.baris.map((b) => b.nama)).toEqual(["Ani"]);
    const cari = await saring({ sekarang: SEKARANG, periodeHari: 90, cari: hp.budi.slice(-4) });
    expect(cari.halaman.baris.map((b) => b.nama)).toEqual(["Budi"]);
    expect(cari.hitung).toMatchObject({ semua: 1, status: { AKTIF: 1, BARU: 0 }, member: { ya: 0, tidak: 1 } });
    // Angka tengah nomor yang disamarkan tidak bisa dicari: Budi hanya ketemu kalau angka itu kebetulan tampil di samarannya.
    const tengah = hp.budi.slice(5, 9);
    const hasilTengah = await saring({ sekarang: SEKARANG, periodeHari: 90, cari: tengah });
    expect(hasilTengah.halaman.baris.some((b) => b.nama === "Budi")).toBe(`0812****${hp.budi.slice(-4)}`.includes(tengah));
    expect(await pelangganTokoKantor(`${tag}-tidak-ada`, { sekarang: SEKARANG, periodeHari: 90 })).toBeNull();
  });

  it("lists Elorae members across stores with tier spend, the stores they bought at, and their status", async () => {
    const data = await memberKantor({ sekarang: SEKARANG, cari: tag });
    expect(data.periodeBulan).toBe(12);
    expect(data.hitung).toEqual({ semua: 2, aktif: 1, nonaktif: 1 });
    const ani = data.halaman.baris.find((m) => m.id === memberIds[0])!;
    expect(ani).toMatchObject({
      aktif: true,
      tingkat: "Reguler",
      // Rp100.000 di toko A + Rp120.000 di toko B, 12 bulan terakhir.
      belanjaPeriode: 220_000,
      tokoBergabung: `Toko A ${tag}`,
      nonaktifSejak: null,
      hpSamar: `0812****${hp.ani.slice(-4)}`,
    });
    expect(ani.toko.map((t) => t.id)).toEqual([tokoA, tokoB]);
    const budi = data.halaman.baris.find((m) => m.id === memberIds[1])!;
    expect(budi).toMatchObject({ aktif: false, belanjaPeriode: 250_000, nonaktifSejak: wib("2026-08-16").toISOString() });
    expect((await memberKantor({ sekarang: SEKARANG, cari: tag, status: "nonaktif" })).halaman.baris.map((m) => m.id)).toEqual([memberIds[1]]);
    expect(JSON.stringify(data)).not.toContain(hp.ani.slice(2));
  });
});
