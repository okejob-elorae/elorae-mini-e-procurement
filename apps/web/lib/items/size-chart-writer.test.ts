import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { daftarTabelUkuran, pilihanTabelUkuran } from "./size-chart-queries";
import { JEJAK_TABEL_UKURAN, type IsianTabelUkuran } from "./size-chart";
import { hapusTabelUkuran, simpanTabelUkuran } from "./size-chart-writer";

/*
 * Master tabel ukuran terhadap basis data sungguhan: satu tabel aktif per
 * kategori (termasuk dua simpan bersamaan), jejak sebelum/sesudah di
 * transaksi yang sama, dan hapus yang ditolak selama barang memasangnya.
 * Jangan pernah dijalankan ke basis data produksi.
 */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("tabel ukuran — penulis (test bed only)", () => {
  const token = Math.random().toString(36).slice(2, 10);
  let userId = "";
  let katA = "";
  let katB = "";
  let uomId = "";
  let itemId = "";
  let chartIds: string[] = [];

  const isian = (ubah: Partial<IsianTabelUkuran> = {}): IsianTabelUkuran => ({
    name: `Kaos ${token}`,
    unit: "cm",
    categoryId: null,
    columns: ["Lebar dada", "Panjang badan"],
    rows: [
      { ukuran: "S", nilai: [48, 68] },
      { ukuran: "M", nilai: [50, 70] },
    ],
    note: null,
    isActive: true,
    ...ubah,
  });
  const catat = (h: { ok: boolean; id?: string }) => {
    if (h.ok && h.id) chartIds.push(h.id);
  };

  beforeAll(async () => {
    userId = "";
    katA = "";
    katB = "";
    uomId = "";
    itemId = "";
    chartIds = [];
    userId = (await prisma.user.create({ data: { email: `test-tu-${token}@example.com`, name: "Uji TU" } })).id;
    katA = (await prisma.itemCategory.create({ data: { name: `TEST-TU-A-${token}` } })).id;
    katB = (await prisma.itemCategory.create({ data: { name: `TEST-TU-B-${token}` } })).id;
    uomId = (await prisma.uOM.create({ data: { code: `TEST-UOM-TU-${token}`, nameId: "t", nameEn: "t" } })).id;
  });

  afterAll(async () => {
    await prisma.item.deleteMany({ where: { id: seededId(itemId) } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: seededIds(chartIds) } } });
    await prisma.sizeChart.deleteMany({ where: { id: { in: seededIds(chartIds) } } });
    await prisma.uOM.deleteMany({ where: { id: seededId(uomId) } });
    await prisma.itemCategory.deleteMany({ where: { id: { in: seededIds([katA, katB]) } } });
    await prisma.auditLog.deleteMany({ where: { userId: seededId(userId) } });
    await prisma.user.deleteMany({ where: { id: seededId(userId) } });
  });

  it("creates a chart and writes CREATED with before null / after the saved shape", async () => {
    const h = await simpanTabelUkuran({ isian: isian({ categoryId: katA, note: "  Ukur datar " }), userId });
    catat(h);
    expect(h.ok).toBe(true);
    if (!h.ok) return;
    const baris = await prisma.sizeChart.findUniqueOrThrow({ where: { id: h.id } });
    expect(baris.columns).toEqual(["Lebar dada", "Panjang badan"]);
    expect(baris.note).toBe("Ukur datar");
    const jejak = await prisma.auditLog.findMany({ where: { entityId: h.id } });
    expect(jejak).toHaveLength(1);
    expect(jejak[0].action).toBe(JEJAK_TABEL_UKURAN.DIBUAT);
    expect((jejak[0].changes as { before: unknown; after: { categoryId: string } }).before).toBeNull();
    expect((jejak[0].changes as { after: { categoryId: string } }).after.categoryId).toBe(katA);
  });

  it("refuses a second ACTIVE chart for the same category, allows an inactive one", async () => {
    const dua = await simpanTabelUkuran({ isian: isian({ name: `Kedua ${token}`, categoryId: katA }), userId });
    expect(dua).toEqual({ ok: false, code: "DUPLIKAT_KATEGORI", namaBentrok: `Kaos ${token}` });
    const mati = await simpanTabelUkuran({ isian: isian({ name: `Cadangan ${token}`, categoryId: katA, isActive: false }), userId });
    catat(mati);
    expect(mati.ok).toBe(true);
    // Menyalakan yang nonaktif juga ditolak selama yang pertama aktif.
    if (mati.ok) {
      const nyala = await simpanTabelUkuran({ id: mati.id, isian: isian({ name: `Cadangan ${token}`, categoryId: katA }), userId });
      expect(nyala.ok).toBe(false);
    }
  });

  it("two simultaneous saves for one category: exactly one wins", async () => {
    const hasil = await Promise.all([
      simpanTabelUkuran({ isian: isian({ name: `Balap 1 ${token}`, categoryId: katB }), userId }),
      simpanTabelUkuran({ isian: isian({ name: `Balap 2 ${token}`, categoryId: katB }), userId }),
    ]);
    hasil.forEach(catat);
    expect(hasil.filter((h) => h.ok)).toHaveLength(1);
    expect(hasil.filter((h) => !h.ok && h.code === "DUPLIKAT_KATEGORI")).toHaveLength(1);
    expect(await prisma.sizeChart.count({ where: { categoryId: katB, isActive: true } })).toBe(1);
  });

  it("updating writes UPDATED with the previous values; editing itself keeps its category", async () => {
    const h = await simpanTabelUkuran({ isian: isian({ name: `Ubah ${token}` }), userId });
    catat(h);
    if (!h.ok) throw new Error("gagal membuat");
    const u = await simpanTabelUkuran({
      id: h.id,
      isian: isian({ name: `Ubah ${token}`, unit: "inci", columns: ["Dada"], rows: [{ ukuran: "XL", nilai: [22.5] }] }),
      userId,
    });
    expect(u).toEqual({ ok: true, id: h.id });
    const jejak = await prisma.auditLog.findFirstOrThrow({ where: { entityId: h.id, action: JEJAK_TABEL_UKURAN.DIUBAH } });
    const c = jejak.changes as { before: { unit: string; columns: string[] }; after: { unit: string; rows: unknown } };
    expect(c.before.unit).toBe("cm");
    expect(c.before.columns).toEqual(["Lebar dada", "Panjang badan"]);
    expect(c.after.unit).toBe("inci");
    expect(c.after.rows).toEqual([{ ukuran: "XL", nilai: [22.5] }]);

    // Tabel kategori A disimpan ulang tanpa bentrok dengan dirinya sendiri.
    const pertama = await prisma.sizeChart.findFirstOrThrow({ where: { categoryId: katA, isActive: true } });
    const ulang = await simpanTabelUkuran({ id: pertama.id, isian: isian({ categoryId: katA }), userId });
    expect(ulang.ok).toBe(true);
  });

  it("invalid input, unknown chart and unknown category are refused without writing", async () => {
    const salah = await simpanTabelUkuran({ isian: isian({ name: "" }), userId });
    expect(salah).toEqual({ ok: false, code: "TIDAK_SAH", masalah: ["NAMA_WAJIB"] });
    expect(await simpanTabelUkuran({ id: `tidak-ada-${token}`, isian: isian(), userId })).toEqual({ ok: false, code: "TIDAK_DITEMUKAN" });
    expect(await simpanTabelUkuran({ isian: isian({ categoryId: `tidak-ada-${token}` }), userId })).toEqual({
      ok: false,
      code: "KATEGORI_TIDAK_DITEMUKAN",
    });
  });

  it("delete is refused while an item uses the chart, then allowed and audited", async () => {
    const h = await simpanTabelUkuran({ isian: isian({ name: `Hapus ${token}` }), userId });
    catat(h);
    if (!h.ok) throw new Error("gagal membuat");
    itemId = (
      await prisma.item.create({
        data: { sku: `TEST-TU-${token}`, nameId: "Uji", nameEn: "Test", type: "FINISHED_GOOD", uomId, sizeChartId: h.id },
      })
    ).id;

    const daftar = await daftarTabelUkuran();
    expect(daftar.find((x) => x.id === h.id)?.dipakaiBarang).toBe(1);

    expect(await hapusTabelUkuran({ id: h.id, userId })).toEqual({ ok: false, code: "DIPAKAI", jumlah: 1 });
    await prisma.item.update({ where: { id: itemId }, data: { sizeChartId: null } });
    expect(await hapusTabelUkuran({ id: h.id, userId })).toEqual({ ok: true });
    expect(await prisma.sizeChart.findUnique({ where: { id: h.id } })).toBeNull();
    const jejak = await prisma.auditLog.findFirstOrThrow({ where: { entityId: h.id, action: JEJAK_TABEL_UKURAN.DIHAPUS } });
    expect((jejak.changes as { before: { name: string }; after: unknown }).before.name).toBe(`Hapus ${token}`);
    expect(await hapusTabelUkuran({ id: h.id, userId })).toEqual({ ok: false, code: "TIDAK_DITEMUKAN" });
  });

  it("the item-form picker lists active charts plus the one already on the item", async () => {
    const mati = await prisma.sizeChart.findFirstOrThrow({ where: { name: `Cadangan ${token}` } });
    const tanpa = await pilihanTabelUkuran();
    expect(tanpa.some((x) => x.id === mati.id)).toBe(false);
    const dengan = await pilihanTabelUkuran(mati.id);
    expect(dengan.find((x) => x.id === mati.id)?.isActive).toBe(false);
  });
});
