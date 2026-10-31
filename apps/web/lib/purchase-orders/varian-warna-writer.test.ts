import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { JEJAK_VARIAN_WARNA, hexPantone, tambahVarianWarna } from "./varian-warna-writer";

/*
 * "+ Warna baru" dari formulir PO — terhadap basis data uji. Warna Pantone uji
 * memakai kode "00-xxxx" (buku TCX sungguhan mulai 11-), dibuat dan dihapus
 * oleh tes ini.
 */

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes(":3306") || url.includes("api.elorae.cloud") ? describe.skip : describe;

const tag = `VWP-${Math.random().toString(36).slice(2, 9)}`.toUpperCase();
const tcx = `00-${String(Math.floor(1000 + Math.random() * 8999))}`;

d("tambahVarianWarna (test bed only)", () => {
  let user = "";
  let uom = "";
  let kain = "";
  let kainBerwarna = "";
  let kaos = "";
  let pantoneDibuat = false;

  beforeAll(async () => {
    user = uom = kain = kainBerwarna = kaos = "";
    pantoneDibuat = false;
    user = (await prisma.user.create({ data: { email: `${tag}@test.local`.toLowerCase(), name: `PO ${tag}` } })).id;
    uom = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "kg", nameEn: "kg" } })).id;
    const barang = (sku: string, type: "FINISHED_GOOD" | "FABRIC", variants?: unknown) =>
      prisma.item
        .create({ data: { sku: `${tag}-${sku}`, nameId: `${sku} uji`, nameEn: sku, type, uomId: uom, ...(variants ? { variants: variants as never } : {}) } })
        .then((i) => i.id);
    kain = await barang("KAIN", "FABRIC");
    kainBerwarna = await barang("KAIN2", "FABRIC", [{ Color: "BLUE", sku: `${tag}-KAIN2-BLUE` }]);
    kaos = await barang("KAOS", "FINISHED_GOOD");
    if (!(await prisma.pantoneColor.findUnique({ where: { tcx } }))) {
      await prisma.pantoneColor.create({
        data: { tcx, name: `Uji ${tag}`, hex: "#1A2B3C", rgbR: 26, rgbG: 43, rgbB: 60, filterTags: {} },
      });
      pantoneDibuat = true;
    }
  });

  afterAll(async () => {
    const barang = () => seededIds([kain, kainBerwarna, kaos].filter(Boolean));
    await prisma.auditLog.deleteMany({ where: { entityType: "Item", entityId: { in: barang() } } });
    await prisma.item.deleteMany({ where: { id: { in: barang() } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uom) } });
    if (pantoneDibuat) await prisma.pantoneColor.deleteMany({ where: { tcx: seededId(tcx) } });
    await prisma.user.deleteMany({ where: { id: seededId(user) } });
  });

  it("menambah varian warna + Pantone dan mencatat jejak sebelum/sesudah", async () => {
    const hasil = await tambahVarianWarna({ itemId: kain, warna: " hitam ", pantone: `${tcx} TCX`, userId: user });
    expect(hasil).toEqual({
      ok: true,
      varian: { sku: `${tag}-KAIN-HITAM`, warna: "HITAM", pantone: `${tcx} TCX`, hex: "#1a2b3c" },
      variants: [{ warna: "HITAM", sku: `${tag}-KAIN-HITAM`, pantone: `${tcx} TCX` }],
    });
    const item = await prisma.item.findUniqueOrThrow({ where: { id: kain }, select: { variants: true } });
    expect(item.variants).toEqual([{ warna: "HITAM", sku: `${tag}-KAIN-HITAM`, pantone: `${tcx} TCX` }]);
    const jejak = await prisma.auditLog.findMany({ where: { entityType: "Item", entityId: kain, action: JEJAK_VARIAN_WARNA } });
    expect(jejak).toHaveLength(1);
    expect(jejak[0].userId).toBe(user);
    expect(jejak[0].changes).toEqual({ before: [], after: [{ warna: "HITAM", sku: `${tag}-KAIN-HITAM`, pantone: `${tcx} TCX` }] });
    expect(jejak[0].metadata).toMatchObject({ sku: `${tag}-KAIN-HITAM`, warna: "HITAM", sumber: "PO" });
  });

  it("menolak warna yang sudah ada (nama atau SKU) tanpa menulis apa pun", async () => {
    const hasil = await tambahVarianWarna({ itemId: kain, warna: "Hitam", userId: user });
    expect(hasil).toEqual({
      ok: false,
      kode: "VARIAN_SUDAH_ADA",
      sku: `${tag}-KAIN-HITAM`,
      variants: [{ warna: "HITAM", sku: `${tag}-KAIN-HITAM`, pantone: `${tcx} TCX` }],
    });
    expect(await prisma.auditLog.count({ where: { entityType: "Item", entityId: kain } })).toBe(1);
  });

  it("mengikuti kunci warna varian yang sudah ada", async () => {
    const hasil = await tambahVarianWarna({ itemId: kainBerwarna, warna: "merah", userId: user });
    expect(hasil.ok && hasil.variants).toEqual([
      { Color: "BLUE", sku: `${tag}-KAIN2-BLUE` },
      { Color: "MERAH", sku: `${tag}-KAIN2-MERAH` },
    ]);
  });

  it("menolak barang jadi — variannya datang dari Jubelio", async () => {
    expect(await tambahVarianWarna({ itemId: kaos, warna: "Hitam", userId: user })).toEqual({ ok: false, kode: "BARANG_JADI" });
    const item = await prisma.item.findUniqueOrThrow({ where: { id: kaos }, select: { variants: true } });
    expect(item.variants ?? []).toEqual([]);
  });

  it("menolak Pantone yang tidak terbaca atau tidak ada di katalog, dan barang yang tidak ada", async () => {
    expect(await tambahVarianWarna({ itemId: kain, warna: "Biru", pantone: "abc", userId: user })).toEqual({
      ok: false,
      kode: "PANTONE_TIDAK_SAH",
    });
    expect(await tambahVarianWarna({ itemId: kain, warna: "Biru", pantone: "00-0000", userId: user })).toEqual({
      ok: false,
      kode: "PANTONE_TIDAK_ADA",
    });
    expect(await tambahVarianWarna({ itemId: `tidak-ada-${tag}`, warna: "Biru", userId: user })).toEqual({
      ok: false,
      kode: "BARANG_TIDAK_ADA",
    });
  });

  it("dua orang menambah warna yang sama bersamaan → satu varian", async () => {
    const [a, b] = await Promise.all([
      tambahVarianWarna({ itemId: kain, warna: "Putih", userId: user }),
      tambahVarianWarna({ itemId: kain, warna: "putih", userId: user }),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const kalah = a.ok ? b : a;
    expect(kalah).toMatchObject({ ok: false, kode: "VARIAN_SUDAH_ADA", sku: `${tag}-KAIN-PUTIH` });
    const item = await prisma.item.findUniqueOrThrow({ where: { id: kain }, select: { variants: true } });
    expect((item.variants as { warna: string }[]).filter((v) => v.warna === "PUTIH")).toHaveLength(1);
  });

  it("hexPantone membaca kode tersimpan", async () => {
    expect(await hexPantone([`${tcx} TCX`, "bukan kode"])).toEqual({ [tcx]: "#1a2b3c" });
    expect(await hexPantone([])).toEqual({});
  });
});
