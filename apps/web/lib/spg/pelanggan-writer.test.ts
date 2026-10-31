import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { JEJAK_PELANGGAN } from "./pelanggan";
import { pelangganTokoKantor, ringkasPelangganKantor } from "./pelanggan-kantor";
import { daftarPelangganHp, rincianPelangganHp } from "./pelanggan-queries";
import { tambahPelanggan, ubahPelanggan } from "./pelanggan-writer";
import { recordSpgSale } from "./sale-writer";
import { daftarTitipHp, rincianTitipHp } from "./titip-queries";

/*
 * Data pembeli: penulis, bacaan HP, dan bacaan kantor, terhadap basis data uji.
 * Inti tes ini adalah batas TOKO — pelanggan toko lain tidak pernah keluar
 * dari bacaan HP, juga lewat id yang ditebak — dan nomor HP yang tidak pernah
 * keluar utuh ke kantor. Teardown hanya lewat id yang diseed.
 */

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

const tag = `PLG-${Math.random().toString(36).slice(2, 9)}`;

d("pelanggan toko — penulis & bacaan (test bed only)", () => {
  let uomId = "";
  let kemeja = "";
  let toko = "";
  let tokoLain = "";
  let spg = "";
  let spgLain = "";
  let salesmanId = "";

  const tokoIds = () => seededIds([toko, tokoLain].filter(Boolean));
  const userIds = () => seededIds([spg, spgLain].filter(Boolean));

  beforeAll(async () => {
    uomId = "";
    kemeja = "";
    toko = "";
    tokoLain = "";
    spg = "";
    spgLain = "";
    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    kemeja = (
      await prisma.item.create({ data: { sku: `${tag}-KMJ`, nameId: "Kemeja Uji", nameEn: "Test shirt", type: "FINISHED_GOOD", uomId, isActive: true, sellingPrice: 100_000 } })
    ).id;
    toko = (await prisma.store.create({ data: { code: `${tag}-A`, name: `Toko A ${tag}`, address: "uji", termsType: "PUTUS" } })).id;
    tokoLain = (await prisma.store.create({ data: { code: `${tag}-B`, name: `Toko B ${tag}`, address: "uji", termsType: "PUTUS" } })).id;
    spg = (await prisma.user.create({ data: { email: `${tag}-spg@test.local`.toLowerCase(), name: `SPG ${tag}`, assignedStoreId: toko } })).id;
    spgLain = (await prisma.user.create({ data: { email: `${tag}-spg2@test.local`.toLowerCase(), name: `SPG2 ${tag}`, assignedStoreId: tokoLain } })).id;
    salesmanId = (await prisma.user.findFirstOrThrow({ where: { email: "salesman@elorae.com" } })).id;
  });

  afterEach(async () => {
    const pel = await prisma.storeCustomer.findMany({ where: { storeId: { in: tokoIds() } }, select: { id: true } });
    await prisma.auditLog.deleteMany({ where: { entityType: "StoreCustomer", entityId: { in: seededIds(pel.map((p) => p.id)) } } });
    await prisma.customerRequest.deleteMany({ where: { storeId: { in: tokoIds() } } });
    await prisma.storeStockMovement.deleteMany({ where: { itemId: seededId(kemeja) } });
    await prisma.salesHistory.deleteMany({ where: { itemId: seededId(kemeja) } });
    await prisma.spgSaleLine.deleteMany({ where: { itemId: seededId(kemeja) } });
    await prisma.spgSalePromo.deleteMany({ where: { spgSaleId: { in: (await prisma.spgSale.findMany({ where: { storeId: { in: tokoIds() } }, select: { id: true } })).map((x) => x.id) } } });
    await prisma.spgSale.deleteMany({ where: { storeId: { in: tokoIds() } } });
    await prisma.storeCustomer.deleteMany({ where: { storeId: { in: tokoIds() } } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: userIds() } } });
    await prisma.store.deleteMany({ where: { id: { in: tokoIds() } } });
    await prisma.item.deleteMany({ where: { id: seededId(kemeja) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  const tambah = async (storeId: string, userId: string, nama: string, hp: string) => {
    const r = await tambahPelanggan({ storeId, userId, isian: { nama, hp, setuju: true } });
    if (!r.ok) throw new Error(r.code);
    return r;
  };

  it("registers a customer once per number per store, with consent and a masked audit row", async () => {
    const a = await tambah(toko, spg, "Rina", "0812-1111-2222");
    expect(a.sudahAda).toBe(false);
    const p = await prisma.storeCustomer.findUniqueOrThrow({ where: { id: a.id } });
    expect(p).toMatchObject({ storeId: toko, name: "Rina", phone: "6281211112222", createdById: spg });
    expect(p.consentAt).toBeInstanceOf(Date);
    const jejak = await prisma.auditLog.findFirstOrThrow({ where: { entityId: a.id, action: JEJAK_PELANGGAN.DIBUAT } });
    expect(JSON.stringify(jejak.changes)).not.toContain("6281211112222");
    expect(JSON.stringify(jejak.changes)).toContain("0812****2222");

    // Nomor yang sama di toko ini membuka pelanggan yang sudah ada…
    const b = await tambah(toko, spg, "Rina K", "+62 812 1111 2222");
    expect(b).toMatchObject({ id: a.id, sudahAda: true, nama: "Rina" });
    // …di toko lain menjadi pelanggan toko itu sendiri.
    const c = await tambah(tokoLain, spgLain, "Rina", "081211112222");
    expect(c.id).not.toBe(a.id);
    expect(c.sudahAda).toBe(false);
  });

  it("refuses a new customer without WhatsApp consent", async () => {
    expect(await tambahPelanggan({ storeId: toko, userId: spg, isian: { nama: "Rina", hp: "081211112222" } })).toEqual({ ok: false, code: "PERSETUJUAN_WAJIB" });
  });

  it("race: the same number registered twice at once makes one customer", async () => {
    const [a, b] = await Promise.all([
      tambahPelanggan({ storeId: toko, userId: spg, isian: { nama: "Rina", hp: "081233334444", setuju: true } }),
      tambahPelanggan({ storeId: toko, userId: spg, isian: { nama: "Rina", hp: "081233334444", setuju: true } }),
    ]);
    if (!a.ok || !b.ok) throw new Error("tambah gagal");
    expect(a.id).toBe(b.id);
    expect([a.sudahAda, b.sudahAda].sort()).toEqual([false, true]);
    expect(await prisma.storeCustomer.count({ where: { storeId: toko } })).toBe(1);
  });

  it("edits name and note freely, but a new number needs new consent and must be free", async () => {
    const a = await tambah(toko, spg, "Rina", "081211112222");
    const b = await tambah(toko, spg, "Sari", "081255556666");
    const lama = await prisma.storeCustomer.findUniqueOrThrow({ where: { id: a.id } });

    expect(await ubahPelanggan({ storeId: toko, userId: spg, id: a.id, isian: { nama: "Rina Kurnia", hp: "081211112222", catatan: "suka biru" } })).toEqual({
      ok: true,
      id: a.id,
    });
    expect(await ubahPelanggan({ storeId: toko, userId: spg, id: a.id, isian: { nama: "Rina Kurnia", hp: "081277778888" } })).toEqual({
      ok: false,
      code: "PERSETUJUAN_WAJIB",
    });
    expect(await ubahPelanggan({ storeId: toko, userId: spg, id: a.id, isian: { nama: "Rina Kurnia", hp: "0812-5555-6666", setuju: true } })).toEqual({
      ok: false,
      code: "HP_DIPAKAI",
      idLain: b.id,
      namaLain: "Sari",
    });
    const sekarang = new Date(Date.now() + 60_000);
    expect(
      await ubahPelanggan({ storeId: toko, userId: spg, id: a.id, isian: { nama: "Rina Kurnia", hp: "081277778888", setuju: true }, sekarang }),
    ).toEqual({ ok: true, id: a.id });
    const baru = await prisma.storeCustomer.findUniqueOrThrow({ where: { id: a.id } });
    expect(baru).toMatchObject({ name: "Rina Kurnia", phone: "6281277778888", note: "suka biru" });
    expect(baru.consentAt.getTime()).toBe(sekarang.getTime());
    expect(baru.consentAt.getTime()).not.toBe(lama.consentAt.getTime());
    expect(await prisma.auditLog.count({ where: { entityId: a.id, action: JEJAK_PELANGGAN.DIUBAH } })).toBe(2);
    // Pelanggan toko lain tidak bisa diubah dari toko ini.
    expect(await ubahPelanggan({ storeId: tokoLain, userId: spgLain, id: a.id, isian: { nama: "X", hp: "081211112222" } })).toEqual({
      ok: false,
      code: "TIDAK_DITEMUKAN",
    });
  });

  it("never shows another store's customers on the phone — not in the list, not in search, not by id", async () => {
    const a = await tambah(toko, spg, "Rina", "081211112222");
    const b = await tambah(tokoLain, spgLain, "Sari Lain", "081299998888");

    const semua = await daftarPelangganHp(toko);
    expect(semua.baris.map((x) => x.id)).toEqual([a.id]);
    expect((await daftarPelangganHp(toko, { q: "Sari" })).baris).toHaveLength(0);
    expect((await daftarPelangganHp(toko, { q: "0812999" })).baris).toHaveLength(0);
    expect((await daftarPelangganHp(toko, { q: "0812111" })).baris.map((x) => x.id)).toEqual([a.id]);
    const muatan = JSON.stringify(semua);
    expect(muatan).not.toContain("Sari");
    expect(muatan).not.toContain("99998888");

    expect(await rincianPelangganHp(toko, b.id)).toBeNull();
    const req = await prisma.customerRequest.create({
      data: { storeId: tokoLain, customerId: b.id, description: "Topi", createdById: spgLain, idempotencyKey: `${tag}-lain` },
    });
    expect(await rincianTitipHp(toko, req.id)).toBeNull();
    expect(JSON.stringify(await daftarTitipHp(toko))).not.toContain("Topi");
  });

  it("shows the purchase history at THIS store only, net of discounts and shopper returns", async () => {
    const a = await tambah(toko, spg, "Rina", "081211112222");
    const jual = await recordSpgSale({ salesmanId, storeId: toko, lines: [{ itemId: kemeja, variantSku: null, qty: 2 }], pembeli: { id: a.id } });
    if (!jual.ok) throw new Error(jual.code);
    // Satu potong dikembalikan pembeli.
    await prisma.spgSaleLine.updateMany({ where: { spgSaleId: jual.spgSaleId }, data: { returnedQty: 1 } });
    // Nota pembeli bernomor sama di toko lain bukan riwayatnya di toko ini.
    const b = await tambah(tokoLain, spgLain, "Rina", "081211112222");
    const lain = await recordSpgSale({ salesmanId, storeId: tokoLain, lines: [{ itemId: kemeja, variantSku: null, qty: 5 }], pembeli: { id: b.id } });
    if (!lain.ok) throw new Error(lain.code);

    const r = await rincianPelangganHp(toko, a.id);
    expect(r).not.toBeNull();
    expect(r!.riwayat.map((n) => n.docNo)).toEqual([jual.docNo]);
    expect(r!.riwayat[0]).toMatchObject({ totalBersih: 100_000, barang: [{ nama: "Kemeja Uji", qty: 2, kembali: 1 }] });
    expect(r!.jumlahNota).toBe(1);
    expect(r!.totalBelanja).toBe(100_000);
    expect(r!.hp).toBe("081211112222");
    expect(r!.tautanWa).toBe("https://wa.me/6281211112222");

    const daftar = await daftarPelangganHp(toko);
    expect(daftar.baris[0]).toMatchObject({ id: a.id, jumlahNota: 1 });

    // Kantor: angka per toko, nomor disamarkan.
    const ringkas = (await ringkasPelangganKantor({ periodeHari: 90 })).toko.find((x) => x.storeId === toko);
    expect(ringkas).toMatchObject({ pelanggan: 1, notaPeriode: 1, notaBerpembeli: 1, belanjaPeriode: 100_000 });
    const kantor = (await pelangganTokoKantor(toko, { periodeHari: 90 }))!;
    expect(kantor.halaman.baris).toHaveLength(1);
    expect(kantor.halaman.baris[0]).toMatchObject({ nama: "Rina", hpSamar: "0812****2222", nota: 1, belanja: 100_000 });
    expect(JSON.stringify(kantor)).not.toContain("6281211112222");
    expect(JSON.stringify(kantor)).not.toContain("081211112222");
  });
});
