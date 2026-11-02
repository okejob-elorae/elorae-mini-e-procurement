import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { bulanWib } from "@/lib/salesman/pengaturan";
import { getAntreanKantor } from "@/lib/dashboard/antrean-kantor";
import { bulanSebelum, rentangBulanWib } from "./komisi";
import { daftarKomisiKantor, jumlahKomisiPutusBelumDitetapkan, tokoKomisiPutusBelumDitetapkan } from "./komisi-queries";
import { tandaiLaporanDicek, tetapkanKomisiToko } from "./komisi-writer";

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

/**
 * Baris Beranda "komisi SPG toko putus bulan lalu belum ditetapkan": toko putus yang punya nota
 * SPG bulan lalu yang masih mengonfirmasi potong (bukan yang seluruhnya dikembalikan pembeli) dan
 * laporannya belum dicek, atau sudah dicek tapi belum ditetapkan. Definisinya
 * sama dengan antrean "menunggu dicek" di halaman Komisi SPG, dan tokonya keluar begitu keuangan
 * menetapkannya. Data uji diseed di sini dan dihapus lewat `seededId(s)`.
 */
d("antrean komisi SPG toko putus (test bed only)", () => {
  const tag = `KAN${Math.random().toString(36).slice(2, 8)}`;
  const sekarang = new Date();
  const periode = bulanSebelum(bulanWib(sekarang));
  const tengahBulanLalu = new Date(rentangBulanWib(periode).awal.getTime() + 10 * 86_400_000);
  let uomId = "";
  let katId = "";
  let kaos = "";
  let putusSpg = "";
  let putusTanpaJual = "";
  let konsi = "";
  let spgA = "";
  let spgDiam = "";
  let spgK = "";
  let kantor = "";
  const nota: string[] = [];
  let nomor = 0;
  const tokoIds = () => seededIds([putusSpg, putusTanpaJual, konsi].filter(Boolean));

  beforeAll(async () => {
    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    katId = (await prisma.itemCategory.create({ data: { code: `K-${tag}`, name: `Kaos ${tag}`, isActive: true } })).id;
    await prisma.spgCommissionRate.create({ data: { itemCategoryId: katId, amountPerPiece: 2_000, effectiveFrom: "2020-01", createdById: "uji" } });
    kaos = (
      await prisma.item.create({
        data: { sku: `${tag}-KAOS`, nameId: `Kaos ${tag}`, nameEn: "Tee", type: "FINISHED_GOOD", uomId, categoryId: katId, sellingPrice: 50_000 },
      })
    ).id;
    const toko = async (kode: string, termsType: "PUTUS" | "KONSI") =>
      (await prisma.store.create({ data: { code: `${tag}-${kode}`, name: `Toko ${kode} ${tag}`, address: "uji", termsType } })).id;
    putusSpg = await toko("P1", "PUTUS");
    putusTanpaJual = await toko("P2", "PUTUS");
    konsi = await toko("K", "KONSI");
    const orang = async (nama: string, storeId: string | null) =>
      (await prisma.user.create({ data: { email: `${tag}-${nama}@test.local`.toLowerCase(), name: `${nama} ${tag}`, assignedStoreId: storeId } })).id;
    spgA = await orang("ani", putusSpg);
    // Bertugas di toko putus kedua, tapi tidak berjualan bulan lalu — tidak ada komisi yang menunggu.
    spgDiam = await orang("diam", putusTanpaJual);
    spgK = await orang("kirana", konsi);
    kantor = await orang("kantor", null);
  });

  afterEach(async () => {
    const audit = await prisma.auditLog.findMany({
      where: { entityType: { in: ["SpgCommission", "SpgSalesCheck"] } },
      select: { id: true, metadata: true },
    });
    const milikUji = audit
      .filter((a) => {
        const m = a.metadata as Record<string, unknown> | null;
        return typeof m?.storeId === "string" && tokoIds().includes(m.storeId);
      })
      .map((a) => a.id);
    await prisma.auditLog.deleteMany({ where: { id: { in: seededIds(milikUji) } } });
    await prisma.spgCommission.deleteMany({ where: { storeId: { in: tokoIds() } } });
    await prisma.spgSalesCheck.deleteMany({ where: { storeId: { in: tokoIds() } } });
    await prisma.spgSaleReturn.deleteMany({ where: { spgSaleId: { in: seededIds(nota) } } });
    await prisma.spgSale.deleteMany({ where: { id: { in: seededIds(nota) } } });
    nota.length = 0;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: seededIds([spgA, spgDiam, spgK, kantor].filter(Boolean)) } } });
    await prisma.store.deleteMany({ where: { id: { in: tokoIds() } } });
    await prisma.item.deleteMany({ where: { id: seededId(kaos) } });
    if (katId) {
      await prisma.spgCommissionRate.deleteMany({ where: { itemCategoryId: seededId(katId) } });
      await prisma.itemCategory.delete({ where: { id: seededId(katId) } });
    }
    if (uomId) await prisma.uOM.delete({ where: { id: seededId(uomId) } });
  });

  const jual = async (salesmanId: string, storeId: string, qty = 2) => {
    const s = await prisma.spgSale.create({
      data: {
        docNo: `${tag}-${nomor++}`,
        salesmanId,
        storeId,
        subtotal: 0,
        total: 0,
        cashReceived: 0,
        changeGiven: 0,
        createdById: salesmanId,
        createdAt: tengahBulanLalu,
        lines: { create: [{ itemId: kaos, productName: "uji", qty, unitPrice: 50_000, lineTotal: 50_000 * qty }] },
      },
      select: { id: true, lines: { select: { id: true } } },
    });
    nota.push(s.id);
    return s;
  };
  /**
   * Pembeli mengembalikan `qty` potong dari nota itu, di bulan yang sama dengan penjualannya. Retur
   * baru berpengaruh setelah kantor MENYETUJUINYA (keputusan pemilik 2026-11-02); bawaannya di sini
   * yang sudah disetujui.
   */
  const kembalikan = async (
    sale: { id: string; lines: { id: string }[] },
    storeId: string,
    qty: number,
    status: "MENUNGGU" | "DISETUJUI" | "DITOLAK" | "DIBATALKAN" = "DISETUJUI",
  ) => {
    await prisma.spgSaleReturn.create({
      data: {
        spgSaleId: sale.id,
        storeId,
        createdById: kantor,
        reason: "uji",
        idempotencyKey: `${tag}-r${nomor++}`,
        createdAt: new Date(tengahBulanLalu.getTime() + 3_600_000),
        status,
        lines: { create: [{ spgSaleLineId: sale.lines[0].id, itemId: kaos, qty }] },
      },
    });
  };
  const milikUji = (ids: Iterable<string>) => [...ids].filter((id) => tokoIds().includes(id)).sort();
  /** Toko putus × bulan lalu yang menunggu dicek menurut halaman Komisi SPG. */
  const menungguMenurutHalaman = async () =>
    new Set((await daftarKomisiKantor(bulanWib(sekarang), sekarang)).menungguCek.filter((m) => m.bulanJual === periode).map((m) => m.storeId));

  it("toko putus yang berjualan bulan lalu masuk antrean sampai ditetapkan; toko tanpa nota dan toko konsinyasi tidak", async () => {
    await jual(spgA, putusSpg);
    await jual(spgK, konsi);
    expect(milikUji(await tokoKomisiPutusBelumDitetapkan(periode))).toEqual([putusSpg]);
    // Satu definisi dengan antrean halaman: yang belum dicek tampil di "menunggu dicek".
    expect(milikUji(await menungguMenurutHalaman())).toEqual([putusSpg]);
  });

  it("sudah dicek tapi belum ditetapkan tetap di antrean; begitu ditetapkan, keluar dari Beranda", async () => {
    await jual(spgA, putusSpg);
    const sebelum = (await getAntreanKantor(["*"])).spgCommissionsUnset ?? 0;
    expect((await tandaiLaporanDicek({ storeId: putusSpg, periode, olehUserId: kantor, sekarang })).ok).toBe(true);
    expect(milikUji(await tokoKomisiPutusBelumDitetapkan(periode))).toEqual([putusSpg]);
    expect(milikUji(await menungguMenurutHalaman())).toEqual([]);

    expect((await tetapkanKomisiToko({ storeId: putusSpg, periode, olehUserId: kantor, sekarang })).ok).toBe(true);
    expect(milikUji(await tokoKomisiPutusBelumDitetapkan(periode))).toEqual([]);
    expect((await getAntreanKantor(["*"])).spgCommissionsUnset).toBe(sebelum - 1);
    expect(await jumlahKomisiPutusBelumDitetapkan(sekarang)).toBe(sebelum - 1);
  });

  it("toko putus yang seluruh penjualannya dikembalikan di bulan yang sama tidak masuk antrean maupun Beranda — dicek pun ditolak", async () => {
    const sebelum = await jumlahKomisiPutusBelumDitetapkan(sekarang);
    const nota3 = await jual(spgDiam, putusTanpaJual, 3);
    await kembalikan(nota3, putusTanpaJual, 3);

    expect(milikUji(await tokoKomisiPutusBelumDitetapkan(periode))).toEqual([]);
    expect(milikUji(await menungguMenurutHalaman())).toEqual([]);
    expect(await jumlahKomisiPutusBelumDitetapkan(sekarang)).toBe(sebelum);
    // Satu definisi dengan penulisnya: tombol "Tandai laporan dicek" memang akan gagal di sini.
    expect(await tandaiLaporanDicek({ storeId: putusTanpaJual, periode, olehUserId: kantor, sekarang })).toEqual({ ok: false, code: "TANPA_PENJUALAN" });

    // Satu potong saja yang tersisa: toko itu kembali menunggu dicek.
    await jual(spgDiam, putusTanpaJual, 1);
    expect(milikUji(await tokoKomisiPutusBelumDitetapkan(periode))).toEqual([putusTanpaJual]);
    expect(milikUji(await menungguMenurutHalaman())).toEqual([putusTanpaJual]);
  });

  it("retur pembeli yang masih menunggu atau ditolak kantor tidak mengurangi apa pun: bulannya tetap di antrean dengan potongnya", async () => {
    for (const status of ["MENUNGGU", "DITOLAK"] as const) {
      const n = await jual(spgDiam, putusTanpaJual, 3);
      await kembalikan(n, putusTanpaJual, 3, status);
      expect(milikUji(await tokoKomisiPutusBelumDitetapkan(periode))).toEqual([putusTanpaJual]);
      const halaman = (await daftarKomisiKantor(bulanWib(sekarang), sekarang)).menungguCek.find(
        (m) => m.storeId === putusTanpaJual && m.bulanJual === periode,
      );
      expect(halaman?.potongToko).toBe(3);
      // Yang menunggu ditampilkan, supaya pengecek tahu ia bisa menjadi koreksi minus.
      expect(halaman?.returMenunggu).toBe(status === "MENUNGGU" ? 1 : 0);
      await prisma.spgSaleReturn.deleteMany({ where: { spgSaleId: { in: seededIds(nota) } } });
      await prisma.spgSale.deleteMany({ where: { id: { in: seededIds(nota) } } });
      nota.length = 0;
    }
    // Disetujui: seluruh potongnya kembali, jadi bulan itu keluar dari antrean (TANPA_PENJUALAN).
    const n = await jual(spgDiam, putusTanpaJual, 3);
    await kembalikan(n, putusTanpaJual, 3, "DISETUJUI");
    expect(milikUji(await tokoKomisiPutusBelumDitetapkan(periode))).toEqual([]);
  });
});
