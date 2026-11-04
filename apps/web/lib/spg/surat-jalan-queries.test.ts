import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { bolehDibukaSpg, ENTITAS_SURAT_JALAN } from "./surat-jalan";
import { dataSuratJalanMutasi, responsSuratJalan } from "./surat-jalan-queries";

/*
 * Surat jalan terhadap basis data uji: data dokumen dari mutasi sungguhan
 * (toko, barang bervarian, pengirim, penerima) dan jejak cetaknya. Semua baris
 * milik fixture buatan tes; teardown hanya lewat id yang diseed.
 */

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

const tag = `SJ-${Math.random().toString(36).slice(2, 9)}`;

d("surat jalan mutasi — kueri dan respons (test bed only)", () => {
  let uomId = "";
  let kaos = "";
  let kemeja = "";
  let asal = "";
  let tujuan = "";
  let spgAsal = "";
  let spgTujuan = "";
  let transfer = "";

  beforeAll(async () => {
    uomId = kaos = kemeja = asal = tujuan = spgAsal = spgTujuan = transfer = "";
    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    kaos = (
      await prisma.item.create({
        data: {
          sku: `${tag}-KAOS`,
          nameId: "Kaos Uji",
          nameEn: "Test tee",
          type: "FINISHED_GOOD",
          uomId,
          sellingPrice: 150000,
          variants: [{ sku: `${tag}-KAOS-HTM-M`, Color: "Hitam", Size: "M" }],
        },
      })
    ).id;
    kemeja = (
      await prisma.item.create({ data: { sku: `${tag}-KMJ`, nameId: "Kemeja Uji", nameEn: "Test shirt", type: "FINISHED_GOOD", uomId, sellingPrice: 250000 } })
    ).id;
    asal = (
      await prisma.store.create({
        data: { code: `${tag}-A`, name: `Toko Asal ${tag}`, address: "Jl. Asal 1, Bandung", phone: "0812-0000-1111", contactName: "Bu Ani", termsType: "KONSI" },
      })
    ).id;
    tujuan = (
      await prisma.store.create({ data: { code: `${tag}-B`, name: `Toko Tujuan ${tag}`, address: "Jl. Tujuan 2, Jakarta", termsType: "KONSI" } })
    ).id;
    spgAsal = (await prisma.user.create({ data: { email: `${tag}-asal@test.local`.toLowerCase(), name: `Sari ${tag}`, assignedStoreId: asal } })).id;
    spgTujuan = (await prisma.user.create({ data: { email: `${tag}-tujuan@test.local`.toLowerCase(), name: `Rina ${tag}`, assignedStoreId: tujuan } })).id;
    transfer = (
      await prisma.storeTransfer.create({
        data: {
          docNo: `MTS/${tag}`,
          fromStoreId: asal,
          toStoreId: tujuan,
          status: "DISETUJUI",
          reason: "Ukuran M habis di sana",
          createdById: spgAsal,
          approvedAt: new Date("2026-10-01T09:00:00.000Z"),
          idempotencyKey: `${tag}-k`,
          lines: {
            create: [
              { itemId: kaos, variantSku: `${tag}-KAOS-HTM-M`, productName: "Kaos Uji", qty: 5 },
              { itemId: kemeja, variantSku: "", productName: "Kemeja Uji", qty: 7 },
            ],
          },
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { entityType: seededId(ENTITAS_SURAT_JALAN), entityId: seededId(transfer) } });
    await prisma.storeReceipt.deleteMany({ where: { storeId: { in: seededIds([asal, tujuan].filter(Boolean)) } } });
    await prisma.storeTransfer.deleteMany({ where: { id: seededId(transfer) } });
    await prisma.user.deleteMany({ where: { id: { in: seededIds([spgAsal, spgTujuan].filter(Boolean)) } } });
    await prisma.store.deleteMany({ where: { id: { in: seededIds([asal, tujuan].filter(Boolean)) } } });
    await prisma.item.deleteMany({ where: { id: { in: seededIds([kaos, kemeja].filter(Boolean)) } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  const jejakCetak = () => prisma.auditLog.count({ where: { entityType: ENTITAS_SURAT_JALAN, entityId: seededId(transfer), action: "PRINT" } });

  it("membaca toko (alamat, telepon), SKU varian dan label ukuran dari master barang", async () => {
    const data = await dataSuratJalanMutasi(transfer);
    expect(data).not.toBeNull();
    if (!data) return;
    expect(data.docNo).toBe(`MTS/${tag}`);
    expect(data.status).toBe("DISETUJUI");
    expect(data.asal).toMatchObject({ id: asal, alamat: "Jl. Asal 1, Bandung", telepon: "0812-0000-1111", kontak: "Bu Ani" });
    expect(data.tujuan).toMatchObject({ id: tujuan, alamat: "Jl. Tujuan 2, Jakarta", telepon: null });
    expect(data.disetujuiIso).toBe("2026-10-01T09:00:00.000Z");
    expect(data.dikirimIso).toBeNull();
    expect(data.pengirim).toBeNull();
    expect(data.baris).toEqual([
      { sku: `${tag}-KAOS-HTM-M`, nama: "Kaos Uji", varian: "Hitam · M", qty: 5 },
      { sku: `${tag}-KMJ`, nama: "Kemeja Uji", varian: null, qty: 7 },
    ]);
    // Toko tujuan belum boleh melihatnya sebelum barang berangkat.
    expect(bolehDibukaSpg(data, asal)).toBe(true);
    expect(bolehDibukaSpg(data, tujuan)).toBe(false);
  });

  it("draf tercetak dengan cap DRAF, tanpa harga barang, dan menulis jejak cetak", async () => {
    const data = await dataSuratJalanMutasi(transfer);
    if (!data) throw new Error("tidak ada");
    const sebelum = await jejakCetak();
    const r = await responsSuratJalan({ data, userId: spgAsal, kembaliHref: "/pwa/spg/mutasi/x", pratinjau: false, dari: "HP" });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/html");
    const html = await r.text();
    expect(html).toContain("DRAF");
    expect(html).toContain("Jl. Asal 1, Bandung");
    // Harga jual master (150.000 / 250.000) tidak pernah sampai ke kertas.
    expect(html).not.toMatch(/\bRp\b|150\.000|250\.000|150000|250000/);
    expect(await jejakCetak()).toBe(sebelum + 1);
  });

  it("sesudah dikirim dan diterima: pengirim dan penerima terisi, toko tujuan boleh membuka", async () => {
    await prisma.storeTransfer.update({
      where: { id: transfer },
      data: { status: "DITERIMA", shippedById: spgAsal, shippedAt: new Date("2026-10-02T18:30:00.000Z") },
    });
    await prisma.storeReceipt.create({
      data: { storeId: tujuan, sourceType: "MUTASI", sourceId: transfer, sourceDocNo: `MTS/${tag}`, receivedById: spgTujuan, receivedAt: new Date("2026-10-04T02:00:00.000Z") },
    });
    const data = await dataSuratJalanMutasi(transfer);
    if (!data) throw new Error("tidak ada");
    expect(data.pengirim).toBe(`Sari ${tag}`);
    expect(data.penerima).toBe(`Rina ${tag}`);
    expect(data.diterimaIso).toBe("2026-10-04T02:00:00.000Z");
    expect(bolehDibukaSpg(data, tujuan)).toBe(true);
    const html = await (await responsSuratJalan({ data, userId: spgTujuan, kembaliHref: "/x", pratinjau: true, dari: "HP" })).text();
    expect(html).not.toContain("DRAF");
    expect(html).toContain(`( Sari ${tag} )`);
    expect(html).toContain(`( Rina ${tag} )`);
  });

  it("dibatalkan: tidak bisa dicetak dan tidak menulis jejak", async () => {
    await prisma.storeTransfer.update({ where: { id: transfer }, data: { status: "DIBATALKAN" } });
    const data = await dataSuratJalanMutasi(transfer);
    if (!data) throw new Error("tidak ada");
    const sebelum = await jejakCetak();
    const r = await responsSuratJalan({ data, userId: spgAsal, kembaliHref: "/x", pratinjau: false, dari: "HP" });
    expect(r.status).toBe(409);
    expect(await r.text()).toContain("tidak bisa dicetak");
    expect(await jejakCetak()).toBe(sebelum);
  });

  it("mutasi yang tidak ada → null", async () => {
    expect(await dataSuratJalanMutasi(`${tag}-tidak-ada`)).toBeNull();
  });
});
