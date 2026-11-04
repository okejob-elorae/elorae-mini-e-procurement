import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { SKEMA_KOMISI_BAWAAN, type SkemaKomisi } from "./komisi";
import { komisiSalesman, laporanKomisiBulan, tertagihTerverifikasi } from "./komisi-queries";

/**
 * Kueri komisi terhadap basis data sungguhan.
 *
 * Yang diuji adalah hal yang tidak bisa dibuktikan fungsi murni: bahwa HANYA
 * klaim terverifikasi yang dihitung (Aturan 1), bahwa bulannya bulan WIB
 * menurut `verifiedAt`, dan bahwa penjual dan penagih dibaca dari kolom yang
 * benar. Bulannya sengaja jauh di masa lalu (Maret 2001) supaya data dev tidak
 * ikut terhitung. Pengaturan bersama (`SystemSetting`) tidak pernah ditulis —
 * skema diberikan lewat `opsi`.
 *
 * Basis data dipakai bersama dengan data dev: setiap penghapusan lewat
 * `seededId()`/`seededIds()`, id fixture dideklarasikan `""` dan direset di awal hook.
 */

const BULAN = "2001-03";
const tag = `KMS-${Math.random().toString(36).slice(2, 8)}`;

let s1 = "";
let s2 = "";
let tokoId = "";
let piutangIds: string[] = [];
let klaimIds: string[] = [];

const skema = (x: Partial<SkemaKomisi> = {}): SkemaKomisi => ({ ...SKEMA_KOMISI_BAWAAN, ...x });

async function klaim(input: {
  kode: string;
  salesmanId: string;
  status: "DIKIRIM" | "TERVERIFIKASI" | "DITOLAK" | "DIBATALKAN";
  verifiedAt: Date | null;
  diterima?: number;
  pelunasan: { receivableId: string; nilai: number }[];
}) {
  const nilaiFaktur = input.pelunasan.reduce((n, p) => n + p.nilai, 0);
  const diterima = input.diterima ?? nilaiFaktur;
  const k = await prisma.paymentClaim.create({
    data: {
      docNo: `${tag}-${input.kode}`,
      storeId: tokoId,
      salesmanId: input.salesmanId,
      createdById: input.salesmanId,
      claimedTransferAt: new Date("2001-03-01T00:00:00Z"),
      invoiceAmount: nilaiFaktur,
      deductionTotal: nilaiFaktur - diterima,
      receivedAmount: diterima,
      status: input.status,
      verifiedAt: input.verifiedAt,
      receivableLinks: { create: input.pelunasan.map((p) => ({ receivableId: p.receivableId, settledAmount: p.nilai })) },
    },
  });
  klaimIds.push(k.id);
  return k.id;
}

beforeEach(async () => {
  s1 = "";
  s2 = "";
  tokoId = "";
  piutangIds = [];
  klaimIds = [];

  s1 = (await prisma.user.create({ data: { email: `${tag}-a@example.com`, name: `${tag} Andi` } })).id;
  s2 = (await prisma.user.create({ data: { email: `${tag}-b@example.com`, name: `${tag} Budi` } })).id;
  tokoId = (
    await prisma.store.create({
      data: { code: tag, name: `${tag} Toko`, address: "uji", termsType: "PUTUS", isActive: true },
    })
  ).id;

  const piutang = async (akhiran: string, salesmanId: string | null) => {
    const p = await prisma.receivable.create({
      data: {
        invoiceNo: `${tag}/${akhiran}`,
        storeId: tokoId,
        invoiceDate: new Date("2001-02-01T00:00:00Z"),
        dueDate: new Date("2001-03-01T00:00:00Z"),
        amount: 5_000_000,
        outstanding: 5_000_000,
        source: "MANUAL",
        salesmanId,
      },
    });
    piutangIds.push(p.id);
    return p.id;
  };
  const r1 = await piutang("R1", s1); // dijual s1
  const r2 = await piutang("R2", s2); // dijual s2
  const r3 = await piutang("R3", null); // impor, tanpa penjual

  // s1 menagih R1 (miliknya) + R3 (tanpa penjual); toko memotong 200rb retur.
  await klaim({
    kode: "C1",
    salesmanId: s1,
    status: "TERVERIFIKASI",
    verifiedAt: new Date("2001-03-10T03:00:00Z"),
    diterima: 800_000,
    pelunasan: [
      { receivableId: r1, nilai: 600_000 },
      { receivableId: r3, nilai: 400_000 },
    ],
  });
  // s1 menagih faktur penjualan s2 (toko sudah dipindah ke s1).
  await klaim({
    kode: "C2",
    salesmanId: s1,
    status: "TERVERIFIKASI",
    verifiedAt: new Date("2001-03-15T03:00:00Z"),
    pelunasan: [{ receivableId: r2, nilai: 500_000 }],
  });
  // 1 Maret 00.30 WIB = 28 Feb 17.30 UTC — MASUK Maret.
  await klaim({
    kode: "C3",
    salesmanId: s2,
    status: "TERVERIFIKASI",
    verifiedAt: new Date("2001-02-28T17:30:00Z"),
    pelunasan: [{ receivableId: r2, nilai: 100_000 }],
  });
  // 1 April 00.30 WIB = 31 Mar 17.30 UTC — KELUAR dari Maret.
  await klaim({
    kode: "C4",
    salesmanId: s1,
    status: "TERVERIFIKASI",
    verifiedAt: new Date("2001-03-31T17:30:00Z"),
    pelunasan: [{ receivableId: r1, nilai: 70_000 }],
  });
  // Klaim yang belum / tidak diverifikasi: bernilai nol.
  await klaim({ kode: "C5", salesmanId: s1, status: "DIKIRIM", verifiedAt: null, pelunasan: [{ receivableId: r1, nilai: 11_000 }] });
  await klaim({
    kode: "C6",
    salesmanId: s1,
    status: "DITOLAK",
    verifiedAt: new Date("2001-03-12T03:00:00Z"),
    pelunasan: [{ receivableId: r1, nilai: 22_000 }],
  });
  await klaim({
    kode: "C7",
    salesmanId: s1,
    status: "DIBATALKAN",
    verifiedAt: new Date("2001-03-13T03:00:00Z"),
    pelunasan: [{ receivableId: r1, nilai: 33_000 }],
  });
});

afterEach(async () => {
  await prisma.paymentClaimReceivable.deleteMany({ where: { paymentClaimId: { in: seededIds(klaimIds) } } });
  await prisma.paymentClaim.deleteMany({ where: { id: { in: seededIds(klaimIds) } } });
  await prisma.receivable.deleteMany({ where: { id: { in: seededIds(piutangIds) } } });
  if (tokoId) await prisma.store.delete({ where: { id: seededId(tokoId) } });
  await prisma.user.deleteMany({ where: { id: { in: [s1, s2].filter(Boolean).map(seededId) } } });
});

describe("tertagihTerverifikasi (basis data)", () => {
  it("hanya klaim TERVERIFIKASI di bulan WIB-nya, dengan uang masuk per faktur", async () => {
    const baris = (await tertagihTerverifikasi(BULAN, s1)).filter((b) => b.docNo.startsWith(tag));
    const ringkas = baris
      .map((b) => ({ docNo: b.docNo.slice(tag.length + 1), invoiceNo: b.invoiceNo.slice(tag.length + 1), nilai: b.nilai, dilunasi: b.dilunasi }))
      .sort((a, b) => (a.docNo + a.invoiceNo).localeCompare(b.docNo + b.invoiceNo));
    expect(ringkas).toEqual([
      // Potongan 200rb dibagi menurut porsi: 600rb → 480rb, 400rb → 320rb.
      { docNo: "C1", invoiceNo: "R1", nilai: 480_000, dilunasi: 600_000 },
      { docNo: "C1", invoiceNo: "R3", nilai: 320_000, dilunasi: 400_000 },
      { docNo: "C2", invoiceNo: "R2", nilai: 500_000, dilunasi: 500_000 },
    ]);
  });

  it("membaca penjual dari piutang dan penagih dari klaim", async () => {
    const baris = (await tertagihTerverifikasi(BULAN, s1)).filter((b) => b.docNo.startsWith(tag));
    const r2 = baris.find((b) => b.invoiceNo.endsWith("/R2"))!;
    expect(r2.penjualId).toBe(s2);
    expect(r2.penagihId).toBe(s1);
    expect(baris.find((b) => b.invoiceNo.endsWith("/R3"))!.penjualId).toBeNull();
    expect(r2.toko).toBe(`${tag} Toko`);
  });

  it("disaring ke salesman: s2 melihat klaim yang melunasi penjualannya dan klaimnya sendiri", async () => {
    const baris = (await tertagihTerverifikasi(BULAN, s2)).filter((b) => b.docNo.startsWith(tag));
    expect(baris.map((b) => b.docNo.slice(tag.length + 1)).sort()).toEqual(["C2", "C3"]);
  });

  it("id salesman kosong tidak melebar ke semua klaim", async () => {
    expect(await tertagihTerverifikasi(BULAN, "")).toEqual([]);
  });
});

describe("komisiSalesman (basis data)", () => {
  it("dasar TERTAGIH: bagian penjual + bagian penagih, faktur impor milik penagih", async () => {
    const r = await komisiSalesman(s1, BULAN, { skema: skema({ bagianPenagihPersen: 20 }), target: null });
    // s1: R1 sendiri 480rb (penjual) + R3 tanpa penjual 320rb + 20% dari 500rb milik s2 = 100rb.
    expect(r.tertagih).toEqual({ bagianPenjual: 480_000, bagianPenagih: 420_000, total: 900_000 });
    expect(r.hasil.dasarNilai).toBe(900_000);
    expect(r.hasil.komisi).toBe(9_000);
    expect(r.baris.map((b) => [b.invoiceNo.slice(tag.length + 1), b.peran, b.bagian]).sort()).toEqual([
      ["R1", "SENDIRI", 480_000],
      ["R2", "PENAGIH", 100_000],
      ["R3", "TANPA_PENJUAL", 320_000],
    ]);

    const b = await komisiSalesman(s2, BULAN, { skema: skema({ bagianPenagihPersen: 20 }), target: null });
    // s2: 80% dari 500rb (C2, ditagih s1) + 100rb (C3, ditagih sendiri).
    expect(b.tertagih).toEqual({ bagianPenjual: 500_000, bagianPenagih: 0, total: 500_000 });
  });

  it("dasar PENJUALAN memakai omzet (nol untuk salesman tanpa penjualan)", async () => {
    const r = await komisiSalesman(s1, BULAN, { skema: skema({ dasar: "PENJUALAN" }), target: null });
    expect(r.omzet.total).toBe(0);
    expect(r.hasil.dasarNilai).toBe(0);
    expect(r.hasil.komisi).toBe(0);
  });
});

describe("laporanKomisiBulan (basis data)", () => {
  it("memuat pengguna yang punya uang tertagih walau bukan salesman terdaftar", async () => {
    const { baris } = await laporanKomisiBulan(BULAN);
    const a = baris.find((b) => b.salesmanId === s1);
    const b = baris.find((x) => x.salesmanId === s2);
    expect(a?.nama).toBe(`${tag} Andi`);
    // Skema yang dibaca dari pengaturan dev bisa apa saja; yang pasti totalnya
    // = uang yang masuk atas faktur mereka berdua di bulan ini.
    expect((a?.tertagih.total ?? 0) + (b?.tertagih.total ?? 0)).toBe(1_400_000);
  });
});
