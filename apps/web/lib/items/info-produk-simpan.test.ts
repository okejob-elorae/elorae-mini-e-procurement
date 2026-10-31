import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { createItem, updateItem } from "./mutations";

/*
 * Formulir barang menyimpan bahan, cara rawat, dan tabel ukuran — terhadap
 * basis data sungguhan. Yang dijaga: kolomnya tersimpan, pemanggil yang tidak
 * mengirimnya tidak menghapusnya, kosong = dikosongkan, dan tabel yang tidak
 * ada ditolak. Jangan pernah dijalankan ke basis data produksi.
 */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("info produk di formulir barang (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  let uomId = "";
  let chartId = "";
  let itemId = "";

  beforeAll(async () => {
    uomId = "";
    chartId = "";
    itemId = "";
    uomId = (await prisma.uOM.create({ data: { code: `TEST-UOM-IP-${token}`, nameId: "t", nameEn: "t" } })).id;
    chartId = (
      await prisma.sizeChart.create({ data: { name: `TEST-IP-${token}`, columns: ["Dada"], rows: [{ ukuran: "M", nilai: [50] }] } })
    ).id;
  });

  afterAll(async () => {
    await prisma.inventoryValue.deleteMany({ where: { itemId: seededId(itemId) } });
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.sizeChart.deleteMany({ where: { id: seededId(chartId) } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
  });

  const dasar = () => ({ nameId: "Kaos uji", nameEn: "Test tee", type: "FINISHED_GOOD" as const, uomId });

  it("creates with the three fields, keeps them when a later save omits them, clears on blank", async () => {
    const { item } = await createItem({
      ...dasar(),
      sku: `TEST-IP-${token}`,
      material: " Katun  combed ",
      careInstructions: "Cuci dingin\nJangan diputih",
      sizeChartId: chartId,
    });
    itemId = item.id;
    let baris = await prisma.item.findUniqueOrThrow({ where: { id: itemId } });
    expect(baris.material).toBe("Katun combed");
    expect(baris.careInstructions).toBe("Cuci dingin\nJangan diputih");
    expect(baris.sizeChartId).toBe(chartId);

    await prisma.$transaction((tx) => updateItem(tx, itemId, { ...dasar(), nameId: "Kaos uji 2" }));
    baris = await prisma.item.findUniqueOrThrow({ where: { id: itemId } });
    expect(baris.nameId).toBe("Kaos uji 2");
    expect(baris.material).toBe("Katun combed");
    expect(baris.sizeChartId).toBe(chartId);

    await prisma.$transaction((tx) => updateItem(tx, itemId, { ...dasar(), material: "", careInstructions: " ", sizeChartId: "" }));
    baris = await prisma.item.findUniqueOrThrow({ where: { id: itemId } });
    expect(baris.material).toBeNull();
    expect(baris.careInstructions).toBeNull();
    expect(baris.sizeChartId).toBeNull();
  });

  it("refuses a size chart that does not exist", async () => {
    await expect(
      prisma.$transaction((tx) => updateItem(tx, itemId, { ...dasar(), sizeChartId: `tidak-ada-${token}` })),
    ).rejects.toThrow(/sizeChartId/);
  });
});
