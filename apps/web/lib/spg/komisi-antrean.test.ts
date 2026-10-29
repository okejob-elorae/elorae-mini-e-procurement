import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { bulanWib } from "@/lib/salesman/pengaturan";
import { getAntreanKantor } from "@/lib/dashboard/antrean-kantor";
import { bulanSebelum, rentangBulanWib } from "./komisi";
import { daftarKomisiKantor, jumlahKomisiPutusBelumDitetapkan, tokoKomisiPutusBelumDitetapkan } from "./komisi-queries";
import { tetapkanKomisiToko } from "./komisi-writer";
import { KUNCI_KOMISI_PUTUS } from "./pengaturan";

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

/**
 * Baris Beranda "komisi SPG toko putus bulan lalu belum ditetapkan": angkanya
 * HARUS sama dengan "belum ditetapkan" di halaman Komisi SPG bulan lalu
 * (`daftarKomisiKantor().ringkas.tokoBelum`), dan hilang begitu keuangan
 * menetapkannya. Pengaturan komisi diubah lalu dipulihkan; data uji diseed di
 * sini dan dihapus lewat `seededId(s)`.
 */
d("antrean komisi SPG toko putus (test bed only)", () => {
  const tag = `KAN${Math.random().toString(36).slice(2, 8)}`;
  const sekarang = new Date();
  const periode = bulanSebelum(bulanWib(sekarang));
  const tengahBulanLalu = new Date(rentangBulanWib(periode).awal.getTime() + 10 * 86_400_000);
  let uomId = "";
  let kaos = "";
  let putusSpg = "";
  let putusTanpaSpg = "";
  let konsi = "";
  let spgA = "";
  let spgLepas = "";
  let spgK = "";
  let kantor = "";
  const nota: string[] = [];
  let setelanAwal: string | null = null;
  let nomor = 0;
  const tokoIds = () => seededIds([putusSpg, putusTanpaSpg, konsi].filter(Boolean));

  beforeAll(async () => {
    setelanAwal = (await prisma.systemSetting.findUnique({ where: { key: KUNCI_KOMISI_PUTUS }, select: { value: true } }))?.value ?? null;
    uomId = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    kaos = (
      await prisma.item.create({
        data: { sku: `${tag}-KAOS`, nameId: `Kaos ${tag}`, nameEn: "Tee", type: "FINISHED_GOOD", uomId, sellingPrice: 50_000, commissionPerPcs: 2_000 },
      })
    ).id;
    const toko = async (kode: string, termsType: "PUTUS" | "KONSI") =>
      (await prisma.store.create({ data: { code: `${tag}-${kode}`, name: `Toko ${kode} ${tag}`, address: "uji", termsType } })).id;
    putusSpg = await toko("P1", "PUTUS");
    putusTanpaSpg = await toko("P2", "PUTUS");
    konsi = await toko("K", "KONSI");
    const orang = async (nama: string, storeId: string | null) =>
      (await prisma.user.create({ data: { email: `${tag}-${nama}@test.local`.toLowerCase(), name: `${nama} ${tag}`, assignedStoreId: storeId } })).id;
    spgA = await orang("ani", putusSpg);
    spgK = await orang("kirana", konsi);
    // Pernah berjualan di toko putus kedua bulan lalu, sekarang tidak ditugaskan di mana pun.
    spgLepas = await orang("lepas", null);
    kantor = await orang("kantor", null);
  });

  afterEach(async () => {
    const audit = await prisma.auditLog.findMany({ where: { entityType: "SpgCommission" }, select: { id: true, metadata: true } });
    const milikUji = audit
      .filter((a) => {
        const m = a.metadata as Record<string, unknown> | null;
        return typeof m?.storeId === "string" && tokoIds().includes(m.storeId);
      })
      .map((a) => a.id);
    await prisma.auditLog.deleteMany({ where: { id: { in: seededIds(milikUji) } } });
    await prisma.spgCommission.deleteMany({ where: { storeId: { in: tokoIds() } } });
    await prisma.spgSalePromo.deleteMany({ where: { spgSaleId: { in: (await prisma.spgSale.findMany({ where: { id: { in: seededIds(nota) } }, select: { id: true } })).map((x) => x.id) } } });
    await prisma.spgSale.deleteMany({ where: { id: { in: seededIds(nota) } } });
    nota.length = 0;
  });

  afterAll(async () => {
    if (setelanAwal === null) await prisma.systemSetting.deleteMany({ where: { key: seededId(KUNCI_KOMISI_PUTUS) } });
    else await prisma.systemSetting.update({ where: { key: KUNCI_KOMISI_PUTUS }, data: { value: setelanAwal } });
    await prisma.user.deleteMany({ where: { id: { in: seededIds([spgA, spgLepas, spgK, kantor].filter(Boolean)) } } });
    await prisma.store.deleteMany({ where: { id: { in: tokoIds() } } });
    await prisma.item.deleteMany({ where: { id: seededId(kaos) } });
    if (uomId) await prisma.uOM.delete({ where: { id: seededId(uomId) } });
  });

  const aturan = async (nilai: Record<string, unknown>) => {
    const v = JSON.stringify(nilai);
    await prisma.systemSetting.upsert({ where: { key: KUNCI_KOMISI_PUTUS }, create: { key: KUNCI_KOMISI_PUTUS, value: v }, update: { value: v } });
  };
  const jual = async (salesmanId: string, storeId: string) => {
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
        lines: { create: [{ itemId: kaos, productName: "uji", qty: 2, unitPrice: 50_000, lineTotal: 100_000 }] },
      },
      select: { id: true },
    });
    nota.push(s.id);
  };
  /** Toko "belum ditetapkan" menurut halaman Komisi SPG bulan lalu. */
  const belumMenurutHalaman = async () =>
    new Set((await daftarKomisiKantor(periode, sekarang)).toko.filter((t) => !t.adaResmi && t.baris.some((b) => b.penerima)).map((t) => t.storeId));
  const milikUji = (ids: Iterable<string>) => [...ids].filter((id) => tokoIds().includes(id)).sort();

  it("PER_SPG: toko putus dengan SPG bertugas atau penjual bulan lalu masuk antrean; toko konsinyasi tidak", async () => {
    await aturan({ aktif: true, dasar: "PER_SPG" });
    await jual(spgLepas, putusTanpaSpg);
    await jual(spgK, konsi);
    const ids = await tokoKomisiPutusBelumDitetapkan(periode);
    expect(milikUji(ids)).toEqual([putusSpg, putusTanpaSpg].sort());
    // Satu definisi: sama persis dengan halaman, untuk SEMUA toko di basis data.
    const halaman = await belumMenurutHalaman();
    expect(new Set(ids)).toEqual(halaman);
    expect(await jumlahKomisiPutusBelumDitetapkan(sekarang)).toBe(halaman.size);
  });

  it("BAGI_RATA: hanya SPG yang ditugaskan yang menerima — toko tanpa SPG bertugas tidak masuk", async () => {
    await aturan({ aktif: true, dasar: "BAGI_RATA" });
    await jual(spgLepas, putusTanpaSpg);
    const ids = await tokoKomisiPutusBelumDitetapkan(periode);
    expect(milikUji(ids)).toEqual([putusSpg]);
    expect(new Set(ids)).toEqual(await belumMenurutHalaman());
  });

  it("begitu ditetapkan, toko itu keluar dari antrean Beranda", async () => {
    await aturan({ aktif: true, dasar: "PER_SPG" });
    await jual(spgA, putusSpg);
    const sebelum = (await getAntreanKantor(["*"])).spgCommissionsUnset ?? 0;
    expect(milikUji(await tokoKomisiPutusBelumDitetapkan(periode))).toEqual([putusSpg]);
    const r = await tetapkanKomisiToko({ storeId: putusSpg, periode, olehUserId: kantor, sekarang });
    expect(r.ok).toBe(true);
    expect(milikUji(await tokoKomisiPutusBelumDitetapkan(periode))).toEqual([]);
    expect((await getAntreanKantor(["*"])).spgCommissionsUnset).toBe(sebelum - 1);
  });

  it("komisi toko putus dimatikan: tidak ada yang bisa ditetapkan, angkanya nol", async () => {
    await aturan({ aktif: false, dasar: "PER_SPG" });
    expect(await jumlahKomisiPutusBelumDitetapkan(sekarang)).toBe(0);
  });
});
