import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { KUNCI_TITIP_PESAN } from "./pengaturan";
import { batasSimpanDari, JEJAK_TITIP, pesanTitipTersedia } from "./titip";
import { daftarTitipHp, rincianTitipHp } from "./titip-queries";
import { buatTitipan, catatDicariDenganTitip, tandaiDikabari, tutupTitipan } from "./titip-writer";

/*
 * Titip pesan — penulis, terhadap basis data uji. Semua baris milik fixture
 * buatan tes (toko, barang, pengguna berkode acak); teardown hanya lewat id
 * yang diseed, tidak pernah lewat awalan atau rentang tanggal.
 *
 * Pengaturan `spg.titipPesan` dipotret di awal dan dikembalikan persis di akhir.
 */

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

const tag = `TTP-${Math.random().toString(36).slice(2, 9)}`;

d("titip pesan — penulis (test bed only)", () => {
  let uomId = "";
  let kaos = "";
  let kemeja = "";
  let toko = "";
  let tokoLain = "";
  let spg = "";
  let spgLain = "";
  let setelanAwal: string | null | undefined = undefined;
  let kunciKe = 0;
  const kunci = () => `${tag}-k${kunciKe++}`;
  let hp = 100;
  const hpBaru = () => `08123${String(hp++).padStart(7, "0")}`;

  const tokoIds = () => seededIds([toko, tokoLain].filter(Boolean));
  const userIds = () => seededIds([spg, spgLain].filter(Boolean));
  const itemIds = () => seededIds([kaos, kemeja].filter(Boolean));

  beforeAll(async () => {
    uomId = "";
    kaos = "";
    kemeja = "";
    toko = "";
    tokoLain = "";
    spg = "";
    spgLain = "";
    const ada = await prisma.systemSetting.findUnique({ where: { key: KUNCI_TITIP_PESAN }, select: { value: true } });
    setelanAwal = ada?.value ?? null;
    await prisma.systemSetting.upsert({
      where: { key: KUNCI_TITIP_PESAN },
      create: { key: KUNCI_TITIP_PESAN, value: JSON.stringify({ hariSimpan: 4 }) },
      update: { value: JSON.stringify({ hariSimpan: 4 }) },
    });

    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    kaos = (
      await prisma.item.create({
        data: {
          sku: `${tag}-KAOS`,
          nameId: "Kaos Uji",
          nameEn: "Test tee",
          type: "FINISHED_GOOD",
          uomId,
          sellingPrice: 123_457,
          variants: [
            { sku: `${tag}-KAOS-M`, size: "M", color: "Hitam" },
            { sku: `${tag}-KAOS-L`, size: "L", color: "Hitam" },
          ],
        },
      })
    ).id;
    kemeja = (await prisma.item.create({ data: { sku: `${tag}-KMJ`, nameId: "Kemeja Uji", nameEn: "Test shirt", type: "FINISHED_GOOD", uomId } })).id;
    toko = (await prisma.store.create({ data: { code: `${tag}-A`, name: `Toko A ${tag}`, address: "uji", termsType: "KONSI" } })).id;
    tokoLain = (await prisma.store.create({ data: { code: `${tag}-B`, name: `Toko B ${tag}`, address: "uji", termsType: "PUTUS" } })).id;
    spg = (await prisma.user.create({ data: { email: `${tag}-spg@test.local`.toLowerCase(), name: `SPG ${tag}`, assignedStoreId: toko } })).id;
    spgLain = (await prisma.user.create({ data: { email: `${tag}-spg2@test.local`.toLowerCase(), name: `SPG2 ${tag}`, assignedStoreId: tokoLain } })).id;
  });

  afterEach(async () => {
    const req = await prisma.customerRequest.findMany({ where: { storeId: { in: tokoIds() } }, select: { id: true } });
    const pel = await prisma.storeCustomer.findMany({ where: { storeId: { in: tokoIds() } }, select: { id: true } });
    await prisma.auditLog.deleteMany({ where: { entityType: "CustomerRequest", entityId: { in: seededIds(req.map((r) => r.id)) } } });
    await prisma.auditLog.deleteMany({ where: { entityType: "StoreCustomer", entityId: { in: seededIds(pel.map((p) => p.id)) } } });
    await prisma.customerRequest.deleteMany({ where: { storeId: { in: tokoIds() } } });
    await prisma.lostSale.deleteMany({ where: { storeId: { in: tokoIds() } } });
    await prisma.storeCustomer.deleteMany({ where: { storeId: { in: tokoIds() } } });
    await prisma.storeStockMovement.deleteMany({ where: { storeId: { in: tokoIds() } } });
  });

  afterAll(async () => {
    if (setelanAwal === null) await prisma.systemSetting.delete({ where: { key: KUNCI_TITIP_PESAN } }).catch(() => undefined);
    else if (setelanAwal !== undefined) await prisma.systemSetting.update({ where: { key: KUNCI_TITIP_PESAN }, data: { value: setelanAwal } });
    await prisma.user.deleteMany({ where: { id: { in: userIds() } } });
    await prisma.store.deleteMany({ where: { id: { in: tokoIds() } } });
    await prisma.item.deleteMany({ where: { id: { in: itemIds() } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  const tambahStok = (storeId: string, itemId: string, variantSku: string, qty: number) =>
    prisma.storeStockMovement.create({ data: { storeId, itemId, variantSku, qty, kind: "OPNAME", createdById: spg } });

  const buat = (ubah: Partial<Parameters<typeof buatTitipan>[0]> = {}) =>
    buatTitipan({
      storeId: toko,
      userId: spg,
      pembeli: { nama: "Rina", hp: hpBaru(), setuju: true },
      itemId: kaos,
      variantSku: `${tag}-KAOS-L`,
      qty: 1,
      idempotencyKey: kunci(),
      ...ubah,
    });

  it("creates a waiting request and a new customer together, each with its audit row", async () => {
    const r = await buat();
    if (!r.ok) throw new Error(r.code);
    const req = await prisma.customerRequest.findUniqueOrThrow({ where: { id: r.id } });
    expect(req).toMatchObject({ storeId: toko, status: "MENUNGGU", itemId: kaos, variantSku: `${tag}-KAOS-L`, qty: 1, description: "Kaos Uji (Hitam, L)" });
    const pel = await prisma.storeCustomer.findUniqueOrThrow({ where: { id: r.customerId } });
    expect(pel.storeId).toBe(toko);
    expect(pel.phone.startsWith("628")).toBe(true);
    const jejak = await prisma.auditLog.findMany({ where: { entityId: { in: [r.id, r.customerId] } }, select: { action: true } });
    expect(jejak.map((j) => j.action).sort()).toEqual(["CUSTOMER_CREATED", JEJAK_TITIP.DIBUAT]);
  });

  it("replays the same key without a second request, and refuses a key used by another store", async () => {
    const k = kunci();
    const a = await buat({ idempotencyKey: k });
    const b = await buat({ idempotencyKey: k });
    if (!a.ok || !b.ok) throw new Error("buat gagal");
    expect(b).toMatchObject({ id: a.id, ulang: true });
    expect(await prisma.customerRequest.count({ where: { storeId: toko } })).toBe(1);
    const c = await buat({ idempotencyKey: k, storeId: tokoLain, userId: spgLain });
    expect(c).toEqual({ ok: false, code: "KUNCI_DIPAKAI" });
  });

  it("never attaches a request to another store's customer", async () => {
    const lain = await buat({ storeId: tokoLain, userId: spgLain });
    if (!lain.ok) throw new Error(lain.code);
    const r = await buat({ pembeli: { id: lain.customerId } });
    expect(r).toEqual({ ok: false, code: "PELANGGAN_TIDAK_VALID" });
    expect(await prisma.customerRequest.count({ where: { storeId: toko } })).toBe(0);
  });

  it("reuses the customer already registered with that number at this store", async () => {
    const nomor = hpBaru();
    const a = await buat({ pembeli: { nama: "Rina", hp: nomor, setuju: true } });
    const b = await buat({ pembeli: { nama: "Rina K", hp: nomor.replace(/^0/, "+62"), setuju: true }, itemId: kemeja, variantSku: null });
    if (!a.ok || !b.ok) throw new Error("buat gagal");
    expect(b.customerId).toBe(a.customerId);
    expect(await prisma.storeCustomer.count({ where: { storeId: toko } })).toBe(1);
  });

  it("validates goods, variant, text and quantity", async () => {
    expect(await buat({ variantSku: "BUKAN-VARIAN" })).toEqual({ ok: false, code: "VARIAN_TIDAK_DIKENAL" });
    expect(await buat({ itemId: kemeja, variantSku: "APA" })).toEqual({ ok: false, code: "VARIAN_TIDAK_DIKENAL" });
    expect(await buat({ itemId: null, variantSku: null, keterangan: "  " })).toEqual({ ok: false, code: "KETERANGAN_WAJIB" });
    expect(await buat({ qty: 0 })).toEqual({ ok: false, code: "JUMLAH_TIDAK_VALID" });
    expect(await buat({ pembeli: { nama: "Rina", hp: "022-123456", setuju: true } })).toEqual({ ok: false, code: "HP_TIDAK_VALID" });
    expect(await buat({ pembeli: { nama: "Rina", hp: hpBaru(), setuju: false } })).toEqual({ ok: false, code: "PERSETUJUAN_WAJIB" });
    // Tidak satu pun yang tertolak meninggalkan pelanggan atau permintaan.
    expect(await prisma.customerRequest.count({ where: { storeId: toko } })).toBe(0);
    expect(await prisma.storeCustomer.count({ where: { storeId: toko } })).toBe(0);
    const bebas = await buat({ itemId: null, variantSku: null, keterangan: "Kemeja flanel hijau XL" });
    expect(bebas.ok).toBe(true);
  });

  it("records a lost sale and its request together, linked, and only once per key", async () => {
    const k = kunci();
    const isi = {
      storeId: toko,
      userId: spg,
      pembeli: { nama: "Budi", hp: hpBaru(), setuju: true },
      itemId: kemeja,
      variantSku: null,
      description: "Kemeja putih lengan panjang",
      qty: 2,
      idempotencyKey: k,
    };
    const a = await catatDicariDenganTitip(isi);
    const b = await catatDicariDenganTitip(isi);
    if (!a.ok || !b.ok) throw new Error("dicari gagal");
    expect(b).toMatchObject({ id: a.id, ulang: true });
    const lost = await prisma.lostSale.findMany({ where: { storeId: toko } });
    expect(lost).toHaveLength(1);
    expect(lost[0]).toMatchObject({ itemId: kemeja, qty: 2, description: "Kemeja putih lengan panjang", userId: spg });
    const req = await prisma.customerRequest.findUniqueOrThrow({ where: { id: a.id } });
    expect(req.lostSaleId).toBe(lost[0].id);
    expect(req.description).toBe("Kemeja putih lengan panjang");
  });

  it("leaves no lost sale behind when the customer part is refused", async () => {
    const r = await catatDicariDenganTitip({
      storeId: toko,
      userId: spg,
      pembeli: { nama: "Budi", hp: hpBaru(), setuju: false },
      description: "Topi",
      qty: 1,
      idempotencyKey: kunci(),
    });
    expect(r).toEqual({ ok: false, code: "PERSETUJUAN_WAJIB" });
    expect(await prisma.lostSale.count({ where: { storeId: toko } })).toBe(0);
  });

  it("notifies only once the goods are in the store, and holds them for the configured days", async () => {
    const r = await buat();
    if (!r.ok) throw new Error(r.code);
    expect(await tandaiDikabari({ storeId: toko, userId: spg, requestId: r.id })).toEqual({ ok: false, code: "BELUM_ADA" });
    // Stok varian lain tidak membuat varian yang diminta tersedia.
    await tambahStok(toko, kaos, `${tag}-KAOS-M`, 3);
    expect(await tandaiDikabari({ storeId: toko, userId: spg, requestId: r.id })).toEqual({ ok: false, code: "BELUM_ADA" });
    await tambahStok(toko, kaos, `${tag}-KAOS-L`, 1);
    const sekarang = new Date();
    const hasil = await tandaiDikabari({ storeId: toko, userId: spg, requestId: r.id, sekarang });
    expect(hasil).toEqual({ ok: true, holdUntil: batasSimpanDari(sekarang, 4), ulang: false });
    const req = await prisma.customerRequest.findUniqueOrThrow({ where: { id: r.id } });
    expect(req).toMatchObject({ status: "DIKABARI", notifiedById: spg, holdUntil: batasSimpanDari(sekarang, 4) });
    expect(req.availableAt).not.toBeNull();
    // Kirim ulang pesan tidak memperpanjang masa simpan.
    const lagi = await tandaiDikabari({ storeId: toko, userId: spg, requestId: r.id, sekarang: new Date(sekarang.getTime() + 3 * 86_400_000) });
    expect(lagi).toEqual({ ok: true, holdUntil: batasSimpanDari(sekarang, 4), ulang: true });
    expect(await prisma.auditLog.count({ where: { entityId: r.id, action: JEJAK_TITIP.DIKABARI } })).toBe(1);
  });

  it("treats an empty variant on a variant item as any variant", async () => {
    const r = await buat({ variantSku: null });
    if (!r.ok) throw new Error(r.code);
    expect((await prisma.customerRequest.findUniqueOrThrow({ where: { id: r.id } })).description).toBe("Kaos Uji");
    await tambahStok(toko, kaos, `${tag}-KAOS-M`, 1);
    expect((await tandaiDikabari({ storeId: toko, userId: spg, requestId: r.id })).ok).toBe(true);
  });

  it("lets the SPG judge a free-text request herself", async () => {
    const r = await buat({ itemId: null, variantSku: null, keterangan: "Jaket parasut biru" });
    if (!r.ok) throw new Error(r.code);
    expect((await tandaiDikabari({ storeId: toko, userId: spg, requestId: r.id })).ok).toBe(true);
  });

  it("never touches another store's request", async () => {
    const r = await buat();
    if (!r.ok) throw new Error(r.code);
    expect(await tandaiDikabari({ storeId: tokoLain, userId: spgLain, requestId: r.id })).toEqual({ ok: false, code: "TIDAK_DITEMUKAN" });
    expect(await tutupTitipan({ storeId: tokoLain, userId: spgLain, requestId: r.id, hasil: "SELESAI" })).toEqual({ ok: false, code: "TIDAK_DITEMUKAN" });
    expect((await prisma.customerRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("MENUNGGU");
  });

  it("closes as picked up, or cancels only with a reason, and stays closed", async () => {
    const a = await buat();
    const b = await buat();
    if (!a.ok || !b.ok) throw new Error("buat gagal");
    expect(await tutupTitipan({ storeId: toko, userId: spg, requestId: a.id, hasil: "BATAL", alasan: "  " })).toEqual({ ok: false, code: "ALASAN_WAJIB" });
    expect(await tutupTitipan({ storeId: toko, userId: spg, requestId: a.id, hasil: "BATAL", alasan: "Pembeli sudah beli di tempat lain" })).toEqual({ ok: true });
    expect(await tutupTitipan({ storeId: toko, userId: spg, requestId: b.id, hasil: "SELESAI" })).toEqual({ ok: true });
    expect(await tutupTitipan({ storeId: toko, userId: spg, requestId: a.id, hasil: "SELESAI" })).toEqual({ ok: false, code: "SUDAH_DITUTUP" });
    expect(await tandaiDikabari({ storeId: toko, userId: spg, requestId: b.id })).toEqual({ ok: false, code: "SUDAH_DITUTUP" });
    const batal = await prisma.customerRequest.findUniqueOrThrow({ where: { id: a.id } });
    expect(batal).toMatchObject({ status: "BATAL", closedById: spg, closeReason: "Pembeli sudah beli di tempat lain" });
    const jejak = await prisma.auditLog.findFirstOrThrow({ where: { entityId: a.id, action: JEJAK_TITIP.DIBATALKAN } });
    expect(jejak.reason).toBe("Pembeli sudah beli di tempat lain");
    expect(jejak.changes).toEqual({ before: { status: "MENUNGGU" }, after: { status: "BATAL" } });
  });

  it("race: two notifications at once change the request once and write one audit row", async () => {
    const r = await buat();
    if (!r.ok) throw new Error(r.code);
    await tambahStok(toko, kaos, `${tag}-KAOS-L`, 1);
    const hasil = await Promise.all([
      tandaiDikabari({ storeId: toko, userId: spg, requestId: r.id }),
      tandaiDikabari({ storeId: toko, userId: spg, requestId: r.id }),
    ]);
    expect(hasil.every((h) => h.ok)).toBe(true);
    expect(hasil.filter((h) => h.ok && !h.ulang)).toHaveLength(1);
    expect(await prisma.auditLog.count({ where: { entityId: r.id, action: JEJAK_TITIP.DIKABARI } })).toBe(1);
  });

  it("race: picked up and cancelled at once — exactly one wins", async () => {
    const r = await buat();
    if (!r.ok) throw new Error(r.code);
    const hasil = await Promise.all([
      tutupTitipan({ storeId: toko, userId: spg, requestId: r.id, hasil: "SELESAI" }),
      tutupTitipan({ storeId: toko, userId: spg, requestId: r.id, hasil: "BATAL", alasan: "salah catat" }),
    ]);
    expect(hasil.filter((h) => h.ok)).toHaveLength(1);
    expect(hasil.filter((h) => !h.ok).map((h) => !h.ok && h.code)).toEqual(["SUDAH_DITUTUP"]);
    expect(await prisma.auditLog.count({ where: { entityId: r.id, action: { in: [JEJAK_TITIP.SELESAI, JEJAK_TITIP.DIBATALKAN] } } })).toBe(1);
  });

  it("never puts a price on the phone at a consignment store — list, detail, or the WhatsApp text", async () => {
    const r = await buat();
    if (!r.ok) throw new Error(r.code);
    await tambahStok(toko, kaos, `${tag}-KAOS-L`, 2);
    const daftar = await daftarTitipHp(toko);
    const rincian = await rincianTitipHp(toko, r.id);
    expect(rincian).not.toBeNull();
    expect(daftar.datang.map((x) => x.id)).toEqual([r.id]);
    for (const muatan of [JSON.stringify(daftar), JSON.stringify(rincian)]) {
      expect(muatan).not.toContain("123457");
      expect(muatan).not.toMatch(/price|harga|total/i);
    }
    const teks = pesanTitipTersedia({ ...rincian!.pesan, sampai: "2026-10-06" });
    expect(teks).toContain(`Toko A ${tag}`);
    expect(teks).toContain("Kaos Uji (Hitam, L)");
    expect(teks).not.toMatch(/Rp|123[.,]?457/);
  });
});
