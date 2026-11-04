import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { formatDateOnlyJakarta, parseDateOnly } from "@/lib/date-only";
import { hariIniWib } from "@/lib/tanggal-isian";
import { hapusPengiriman, simpanPengiriman, tandaiDiterima } from "./sampel-writer";

// Push stok ke Jubelio menendang api sesudah mengantre — ditiru, antreannya tetap nyata.
vi.mock("@/lib/internal-api", () => ({ apiFetch: vi.fn(async () => ({ ok: true, status: 200 })) }));

/*
 * Penulis pengiriman sampel KOL terhadap basis data uji. Semua baris milik
 * fixture buatan tes (barang, KOL, kolaborasi, pengguna berkode acak);
 * teardown hanya lewat id yang diseed.
 */

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3306") || url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const tag = `SMP-${Math.random().toString(36).slice(2, 9).toUpperCase()}`;

d("pengiriman sampel KOL — penulis (test bed only)", () => {
  let uomId = "";
  let userId = "";
  let kaos = "";
  let polos = "";
  let jaket = "";
  let kolId = "";
  let campaignId = "";
  let kolabId = "";
  let urut = 0;
  const kolabIds: string[] = [];

  const M = `${tag}-KAOS-M`;
  const L = `${tag}-KAOS-L`;

  beforeAll(async () => {
    uomId = "";
    userId = "";
    kaos = "";
    polos = "";
    jaket = "";
    kolId = "";
    campaignId = "";
    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    userId = (await prisma.user.create({ data: { email: `${tag}@test.local`.toLowerCase(), name: `Kreatif ${tag}` } })).id;
    const barang = async (kode: string, variants?: object[]) =>
      (
        await prisma.item.create({
          data: {
            sku: `${tag}-${kode}`,
            nameId: `Barang ${kode}`,
            nameEn: `Item ${kode}`,
            type: "FINISHED_GOOD",
            uomId,
            ...(variants ? { variants } : {}),
          },
        })
      ).id;
    kaos = await barang("KAOS", [
      { sku: M, size: "M" },
      { sku: L, size: "L" },
    ]);
    polos = await barang("POLOS");
    // Bervarian di katalog, tanpa satu pun baris stok.
    jaket = await barang("JAKET", [
      { sku: `${tag}-JAKET-S`, size: "S" },
      { sku: `${tag}-JAKET-XL`, size: "XL" },
    ]);
    kolId = (
      await prisma.kol.create({ data: { name: `KOL ${tag}`, waNormal: "6281200000001", address: "Jl. Uji 1", city: "Bandung" } })
    ).id;
    campaignId = (await prisma.kolCampaign.create({ data: { name: `Campaign ${tag}` } })).id;
  });

  const itemIds = () => seededIds([kaos, polos, jaket].filter(Boolean));

  beforeEach(async () => {
    kolabId = "";
    await prisma.inventoryValue.deleteMany({ where: { itemId: { in: itemIds() } } });
    await prisma.inventoryValue.createMany({
      data: [
        // M: 10 di rak, 2 sudah dipesan orang → tersedia 8.
        { itemId: kaos, variantSku: M, qtyOnHand: 10, reservedQty: 2, avgCost: 40_000, totalValue: 400_000 },
        { itemId: kaos, variantSku: L, qtyOnHand: 1, reservedQty: 0, avgCost: 41_000, totalValue: 41_000 },
        // Bentuk produksi: barang tanpa varian memakai variantSku null.
        { itemId: polos, variantSku: null, qtyOnHand: 5, reservedQty: 0, avgCost: 20_000, totalValue: 100_000 },
      ],
    });
    kolabId = (
      await prisma.kolBrief.create({
        data: {
          docNo: `${tag}/${++urut}`,
          kolId,
          campaignId,
          tahap: "DEAL",
          items: {
            create: [
              { itemId: kaos, itemName: "Barang KAOS", variantSku: M, qty: 3 },
              { itemId: polos, itemName: "Barang POLOS", variantSku: null, qty: 1 },
            ],
          },
        },
      })
    ).id;
    kolabIds.push(kolabId);
  });

  afterEach(async () => {
    await prisma.auditLog.deleteMany({ where: { entityType: "KolBrief", entityId: { in: seededIds(kolabIds) } } });
    await prisma.stockAdjustment.deleteMany({ where: { itemId: { in: itemIds() } } });
    await prisma.stockLedgerEntry.deleteMany({ where: { itemId: { in: itemIds() } } });
    await prisma.jubelioOutbox.deleteMany({ where: { entityType: "stock_push", entityId: { in: itemIds() } } });
    await prisma.jubelioProductMapping.deleteMany({ where: { itemId: { in: itemIds() } } });
    await prisma.kolBrief.deleteMany({ where: { id: { in: seededIds(kolabIds) } } });
  });

  afterAll(async () => {
    await prisma.inventoryValue.deleteMany({ where: { itemId: { in: itemIds() } } });
    await prisma.item.deleteMany({ where: { id: { in: itemIds() } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.kolCampaign.deleteMany({ where: { id: seededId(campaignId) } });
    await prisma.kol.deleteMany({ where: { id: seededId(kolId) } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
  });

  const stok = async (itemId: string, variantSku: string | null) => {
    const r = await prisma.inventoryValue.findFirstOrThrow({ where: { itemId, variantSku } });
    return { qty: Number(r.qtyOnHand), nilai: Number(r.totalValue) };
  };
  const penyesuaian = () =>
    prisma.stockAdjustment.findMany({ where: { itemId: { in: itemIds() } }, orderBy: { qtyChange: "asc" } });
  const bukuStok = () => prisma.stockLedgerEntry.findMany({ where: { itemId: { in: itemIds() } } });
  const pengiriman = () =>
    prisma.kolShipment.findMany({ where: { collabId: seededId(kolabId) }, include: { lines: true }, orderBy: { createdAt: "asc" } });
  const tahap = async () => (await prisma.kolBrief.findUniqueOrThrow({ where: { id: kolabId } })).tahap;
  const jejak = (action: string) => prisma.auditLog.findMany({ where: { entityType: "KolBrief", entityId: seededId(kolabId), action } });

  it("simpan tanpa resi: rencana barang jadi baris pengiriman, stok tidak bergerak, tahap tetap", async () => {
    const r = await simpanPengiriman({ kolaborasiId: kolabId, courier: "JNE", olehUserId: userId });
    expect(r).toMatchObject({ ok: true, dibuat: true, berangkat: false, tahap: null });
    const [p] = await pengiriman();
    expect(p.stockIssuedAt).toBeNull();
    expect(p.sentAt).toBeNull();
    expect(p.lines.map((l) => [l.itemId, l.variantSku, l.qty]).sort()).toEqual(
      [
        [kaos, M, 3],
        [polos, null, 1],
      ].sort(),
    );
    expect(await penyesuaian()).toHaveLength(0);
    expect(await bukuStok()).toHaveLength(0);
    expect((await stok(kaos, M)).qty).toBe(10);
    expect(await tahap()).toBe("DEAL");
    expect(await jejak("KOL_SHIPMENT_CREATED")).toHaveLength(1);
  });

  it("isi resi di kolaborasi yang sudah punya pengiriman belum berangkat MENGUBAH baris itu, tidak menambah baris", async () => {
    const draf = await simpanPengiriman({ kolaborasiId: kolabId, olehUserId: userId });
    if (!draf.ok) throw new Error("draf harus ok");
    const r = await simpanPengiriman({ kolaborasiId: kolabId, courier: "J&T", trackingNo: " JP 123 ", olehUserId: userId });
    expect(r).toMatchObject({ ok: true, id: draf.id, dibuat: false, berangkat: true });
    const semua = await pengiriman();
    expect(semua).toHaveLength(1);
    expect(semua[0].trackingNo).toBe("JP123");
    expect(semua[0].courier).toBe("J&T");
    // Tanggal kirim kosong = hari ini (WIB).
    expect(formatDateOnlyJakarta(semua[0].sentAt!)).toBe(hariIniWib());
  });

  it("berangkat: stok per varian keluar sekali, penyesuaian KOL_SEEDING, HPP disalin, tahap maju", async () => {
    const r = await simpanPengiriman({ kolaborasiId: kolabId, courier: "JNE", trackingNo: "JNE001", olehUserId: userId });
    expect(r).toMatchObject({ ok: true, berangkat: true, tahap: { dari: "DEAL", ke: "SAMPEL_DIKIRIM" } });

    expect(await stok(kaos, M)).toEqual({ qty: 7, nilai: 280_000 });
    expect((await stok(kaos, L)).qty).toBe(1);
    expect((await stok(polos, null)).qty).toBe(4);

    const adj = await penyesuaian();
    expect(adj).toHaveLength(2);
    for (const a of adj) {
      expect(a.source).toBe("KOL_SEEDING");
      expect(a.type).toBe("NEGATIVE");
      expect(a.docNumber.startsWith("ADJ/")).toBe(true);
      expect(a.idempotencyKey?.startsWith("kol-sampel:")).toBe(true);
      expect(a.createdById).toBe(userId);
    }
    const kaosAdj = adj.find((a) => a.itemId === kaos)!;
    expect([Number(kaosAdj.qtyChange), Number(kaosAdj.prevQty), Number(kaosAdj.newQty), Number(kaosAdj.prevAvgCost)]).toEqual([-3, 10, 7, 40_000]);

    // Satu baris buku stok gudang per potongan, menunjuk penyesuaiannya.
    const buku = await bukuStok();
    expect(buku).toHaveLength(2);
    const bukuKaos = buku.find((e) => e.itemId === kaos)!;
    expect(bukuKaos).toMatchObject({
      locationType: "MAIN",
      variantSku: M,
      type: "OUT",
      refType: "StockAdjustment",
      refId: kaosAdj.id,
      refDocNumber: kaosAdj.docNumber,
      createdById: userId,
    });
    expect([Number(bukuKaos.qty), Number(bukuKaos.balanceQty), Number(bukuKaos.totalCost), Number(bukuKaos.balanceValue)]).toEqual([
      -3, 7, -120_000, 280_000,
    ]);
    const bukuPolos = buku.find((e) => e.itemId === polos)!;
    expect(bukuPolos).toMatchObject({ variantSku: "", refId: adj.find((a) => a.itemId === polos)!.id });
    expect(Number(bukuPolos.balanceQty)).toBe(4);

    const [p] = await pengiriman();
    expect(p.stockIssuedAt).not.toBeNull();
    const biaya = Object.fromEntries(p.lines.map((l) => [l.itemId, Number(l.unitCost)]));
    expect(biaya).toEqual({ [kaos]: 40_000, [polos]: 20_000 });
    expect(await tahap()).toBe("SAMPEL_DIKIRIM");
    expect(await jejak("KOL_SHIPMENT_SENT")).toHaveLength(1);
    expect(await jejak("KOL_COLLAB_STAGE_AUTO_ADVANCED")).toHaveLength(1);
  });

  it("idempoten: simpan ulang, kirim ulang tanpa id dengan resi yang sama, dan kunci yang sama tidak memotong stok lagi", async () => {
    const r = await simpanPengiriman({ kolaborasiId: kolabId, trackingNo: "JNE002", kunci: `${tag}-k1`, olehUserId: userId });
    if (!r.ok) throw new Error("harus ok");

    const lagi = await simpanPengiriman({ id: r.id, kolaborasiId: kolabId, trackingNo: "JNE002", olehUserId: userId });
    expect(lagi).toMatchObject({ ok: true, id: r.id, berangkat: false });

    const resiSama = await simpanPengiriman({ kolaborasiId: kolabId, trackingNo: "jne 002", olehUserId: userId });
    expect(resiSama).toMatchObject({ ok: true, id: r.id, ulang: true, berangkat: false });

    const kunciSama = await simpanPengiriman({ kolaborasiId: kolabId, tanpaResi: true, kunci: `${tag}-k1`, olehUserId: userId });
    expect(kunciSama).toMatchObject({ ok: true, id: r.id, ulang: true });

    expect(await pengiriman()).toHaveLength(1);
    expect(await penyesuaian()).toHaveLength(2);
    expect(await bukuStok()).toHaveLength(2);
    expect((await stok(kaos, M)).qty).toBe(7);
  });

  it("menolak bila stok TERSEDIA (stok − cadangan) kurang, dan tidak menulis apa pun", async () => {
    const r = await simpanPengiriman({
      kolaborasiId: kolabId,
      trackingNo: "JNE003",
      baris: [{ itemId: kaos, variantSku: M, qty: 9 }],
      olehUserId: userId,
    });
    expect(r).toMatchObject({ ok: false, kode: "STOK_KURANG" });
    if (r.ok || r.kode !== "STOK_KURANG") throw new Error("harus STOK_KURANG");
    expect(r.kurang).toEqual([
      expect.objectContaining({ itemId: kaos, variantSku: M, diminta: 9, tersedia: 8, itemName: "Barang KAOS" }),
    ]);
    expect(await pengiriman()).toHaveLength(0);
    expect(await penyesuaian()).toHaveLength(0);
    expect(await bukuStok()).toHaveLength(0);
    expect((await stok(kaos, M)).qty).toBe(10);
    expect(await tahap()).toBe("DEAL");
  });

  it("barang tanpa varian dengan baris kembar null + \"\": potongan mendarat di baris ber-id terkecil, sama dengan penggerak stok", async () => {
    await prisma.inventoryValue.create({
      data: { itemId: polos, variantSku: "", qtyOnHand: 5, reservedQty: 0, avgCost: 20_000, totalValue: 100_000 },
    });
    const kembar = await prisma.inventoryValue.findMany({ where: { itemId: polos }, orderBy: { id: "asc" }, select: { id: true } });
    expect(kembar).toHaveLength(2);

    const r = await simpanPengiriman({
      kolaborasiId: kolabId,
      trackingNo: "JNE010",
      baris: [{ itemId: polos, variantSku: null, qty: 2 }],
      olehUserId: userId,
    });
    expect(r).toMatchObject({ ok: true, berangkat: true });
    const sesudah = await prisma.inventoryValue.findMany({ where: { itemId: polos }, orderBy: { id: "asc" } });
    expect(sesudah.map((x) => [x.id, Number(x.qtyOnHand)])).toEqual([
      [kembar[0].id, 3],
      [kembar[1].id, 5],
    ]);
    const buku = await bukuStok();
    expect(buku).toHaveLength(1);
    expect(Number(buku[0].balanceQty)).toBe(3);
  });

  it("barang bervarian wajib menyebut varian; varian yang tidak dikenal ditolak", async () => {
    const tanpa = await simpanPengiriman({
      kolaborasiId: kolabId,
      trackingNo: "JNE004",
      baris: [{ itemId: kaos, variantSku: null, qty: 1 }],
      olehUserId: userId,
    });
    expect(tanpa).toMatchObject({ ok: false, kode: "VARIAN_WAJIB" });

    const jaketTanpa = await simpanPengiriman({
      kolaborasiId: kolabId,
      trackingNo: "JNE004",
      baris: [{ itemId: jaket, variantSku: null, qty: 1 }],
      olehUserId: userId,
    });
    expect(jaketTanpa).toMatchObject({ ok: false, kode: "VARIAN_WAJIB" });

    const asing = await simpanPengiriman({
      kolaborasiId: kolabId,
      baris: [{ itemId: kaos, variantSku: `${tag}-KAOS-XXL`, qty: 1 }],
      olehUserId: userId,
    });
    expect(asing).toMatchObject({ ok: false, kode: "VARIAN_TIDAK_DIKENAL" });
    expect(await pengiriman()).toHaveLength(0);
  });

  it("sesudah berangkat: baris terkunci, resi tidak bisa dikosongkan, kurir dan ongkir masih bisa dibetulkan", async () => {
    const r = await simpanPengiriman({ kolaborasiId: kolabId, trackingNo: "JNE005", olehUserId: userId });
    if (!r.ok) throw new Error("harus ok");

    const ubahBaris = await simpanPengiriman({
      id: r.id,
      kolaborasiId: kolabId,
      baris: [{ itemId: polos, variantSku: null, qty: 2 }],
      olehUserId: userId,
    });
    expect(ubahBaris).toMatchObject({ ok: false, kode: "SUDAH_BERANGKAT" });

    expect(await simpanPengiriman({ id: r.id, kolaborasiId: kolabId, trackingNo: "", olehUserId: userId })).toMatchObject({
      ok: false,
      kode: "RESI_WAJIB",
    });

    const betul = await simpanPengiriman({ id: r.id, kolaborasiId: kolabId, courier: "SiCepat", shippingCost: 12_000, olehUserId: userId });
    expect(betul).toMatchObject({ ok: true, berangkat: false });
    const [p] = await pengiriman();
    expect([p.courier, Number(p.shippingCost)]).toEqual(["SiCepat", 12_000]);
    expect(await jejak("KOL_SHIPMENT_UPDATED")).toHaveLength(1);
    expect(await penyesuaian()).toHaveLength(2);
  });

  it("tanggal kirim tanpa resi ditolak; tanpa resi yang disengaja memberangkatkan paket", async () => {
    expect(
      await simpanPengiriman({ kolaborasiId: kolabId, sentAt: parseDateOnly(hariIniWib())!, olehUserId: userId }),
    ).toMatchObject({ ok: false, kode: "RESI_WAJIB" });

    const r = await simpanPengiriman({ kolaborasiId: kolabId, courier: "GoSend", tanpaResi: true, olehUserId: userId });
    expect(r).toMatchObject({ ok: true, berangkat: true });
    const [p] = await pengiriman();
    expect(p.trackingNo).toBe("-");
    expect(p.stockIssuedAt).not.toBeNull();
  });

  it("tandai diterima: hanya paket yang sudah berangkat, tanggal tidak boleh sebelum kirim atau di masa depan", async () => {
    const draf = await simpanPengiriman({ kolaborasiId: kolabId, olehUserId: userId });
    if (!draf.ok) throw new Error("harus ok");
    expect(await tandaiDiterima({ pengirimanId: draf.id, receivedAt: new Date(), olehUserId: userId })).toMatchObject({
      ok: false,
      kode: "BELUM_BERANGKAT",
    });

    await simpanPengiriman({ id: draf.id, kolaborasiId: kolabId, trackingNo: "JNE006", sentAt: parseDateOnly("2026-10-02")!, olehUserId: userId });
    expect(await tandaiDiterima({ pengirimanId: draf.id, receivedAt: parseDateOnly("2026-10-01")!, olehUserId: userId })).toMatchObject({
      ok: false,
      kode: "TERIMA_SEBELUM_KIRIM",
    });
    const besok = new Date(Date.now() + 2 * 86_400_000);
    expect(await tandaiDiterima({ pengirimanId: draf.id, receivedAt: besok, olehUserId: userId })).toMatchObject({
      ok: false,
      kode: "TANGGAL_DI_DEPAN",
    });

    const r = await tandaiDiterima({ pengirimanId: draf.id, receivedAt: parseDateOnly("2026-10-03")!, olehUserId: userId });
    expect(r).toMatchObject({ ok: true, tahap: { dari: "SAMPEL_DIKIRIM", ke: "SAMPEL_DITERIMA" } });
    expect(await tahap()).toBe("SAMPEL_DITERIMA");
    expect(await jejak("KOL_SHIPMENT_RECEIVED")).toHaveLength(1);

    // Tanggal yang sama lagi: tidak ada yang berubah.
    expect(await tandaiDiterima({ pengirimanId: draf.id, receivedAt: parseDateOnly("2026-10-03")!, olehUserId: userId })).toMatchObject({
      ok: true,
      ulang: true,
    });
    expect(await jejak("KOL_SHIPMENT_RECEIVED")).toHaveLength(1);
  });

  it("antrean push stok Jubelio ditulis sesudah commit untuk barang yang terpetakan saja", async () => {
    const acak = () => 1_500_000_000 + Math.floor(Math.random() * 400_000_000);
    await prisma.jubelioProductMapping.create({
      data: { itemId: kaos, jubelioItemGroupId: acak(), jubelioItemId: acak(), jubelioItemCode: `${tag}-KAOS-M-J`, erpVariantSku: M },
    });
    const r = await simpanPengiriman({ kolaborasiId: kolabId, trackingNo: "JNE007", olehUserId: userId });
    expect(r).toMatchObject({ ok: true, berangkat: true });
    const antre = await prisma.jubelioOutbox.findMany({
      where: { entityType: "stock_push", entityId: { in: itemIds() }, status: "PENDING" },
      select: { entityId: true, payload: true },
    });
    expect(antre.map((a) => a.entityId)).toEqual([kaos]);
    expect(antre[0].payload).toMatchObject({ sumber: "KOL_SAMPEL" });
  });

  it("kolaborasi di jalur keluar tidak bisa dikirimi sampel", async () => {
    await prisma.kolBrief.update({ where: { id: kolabId }, data: { tahap: "BATAL" } });
    expect(await simpanPengiriman({ kolaborasiId: kolabId, trackingNo: "JNE008", olehUserId: userId })).toMatchObject({
      ok: false,
      kode: "KOLABORASI_TUTUP",
    });
    expect(await pengiriman()).toHaveLength(0);
  });

  it("hapus hanya untuk pengiriman yang belum berangkat", async () => {
    const draf = await simpanPengiriman({ kolaborasiId: kolabId, olehUserId: userId });
    if (!draf.ok) throw new Error("harus ok");
    expect(await hapusPengiriman({ pengirimanId: draf.id, olehUserId: userId })).toEqual({ ok: true });
    expect(await pengiriman()).toHaveLength(0);

    const jalan = await simpanPengiriman({ kolaborasiId: kolabId, trackingNo: "JNE009", olehUserId: userId });
    if (!jalan.ok) throw new Error("harus ok");
    expect(await hapusPengiriman({ pengirimanId: jalan.id, olehUserId: userId })).toEqual({ ok: false, kode: "SUDAH_BERANGKAT" });
  });
});
