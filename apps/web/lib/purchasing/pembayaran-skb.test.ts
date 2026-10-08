import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import type { AccountType } from "@/lib/constants/enums";

/*
 * SKB pemasok terhadap basis data sungguhan: satu penentu
 * (`tentukanPotongPemasok`) dipakai penulis pembayaran pemasok, penerapan uang
 * muka, dan voucher kas keluar ke pemasok. SKB yang berlaku pada hari bayar
 * membebaskan potongan apa pun jenisnya dan tercatat di jejak + halaman PPh
 * dipotong sebagai baris bernilai 0; SKB yang habis → potongan normal.
 *
 * Tanggal uji 2003. Peran dipalsukan ke akun uji berkas ini; hutang jasa WO
 * dipalsukan (satu langkah per tes) dengan "dibayar" dibaca dari alokasi
 * sungguhan. Teardown lewat `seededId()`.
 */

const peta = vi.hoisted(() => ({ akun: new Map<string, string>() }));
const jasa = vi.hoisted(() => ({ stepId: "", supplierId: "", hutang: 1_110_000, dasar: 1_000_000 }));

vi.mock("@/lib/finance/journals/mapping", async (asli) => {
  const m = await asli<typeof import("@/lib/finance/journals/mapping")>();
  return {
    ...m,
    resolveAccount: vi.fn(async (role: string) => {
      const id = peta.akun.get(role);
      if (!id) throw new m.UnmappedRoleError(role);
      return id;
    }),
  };
});
vi.mock("@/lib/production/hutang-jasa-queries", async () => {
  const { prisma: db } = await import("@elorae/db");
  return {
    TARGET_ALOKASI_LANGKAH_WO: "WO_STEP",
    daftarHutangJasa: vi.fn(async (opsi?: { supplierId?: string }) => {
      if (!jasa.stepId || (opsi?.supplierId && opsi.supplierId !== jasa.supplierId)) return [];
      const a = await db.supplierPaymentAllocation.findMany({
        where: { targetType: "WO_STEP", targetId: jasa.stepId, payment: { status: { not: "CANCELLED" } } },
        select: { amount: true },
      });
      const dibayar = a.reduce((s, x) => s + Number(x.amount), 0);
      return [
        {
          supplierId: jasa.supplierId,
          kodePemasok: "X",
          namaPemasok: "X",
          jenisPotong: "PPH21",
          adaNpwp: true,
          hutang: jasa.hutang,
          dasarPotong: jasa.dasar,
          dibayar,
          sisa: jasa.hutang - dibayar,
          langkah: [
            {
              stepId: jasa.stepId,
              woId: "wo-uji-skb",
              woDocNumber: "WO/UJI-SKB",
              urutan: 1,
              namaLangkah: "Jahit",
              supplierId: jasa.supplierId,
              hargaPerPcs: jasa.hutang / 100,
              hargaTermasukPpn: false,
              qtyTerhutang: 100,
              hutang: jasa.hutang,
              dasarPotong: jasa.dasar,
              ppn: jasa.hutang - jasa.dasar,
              dibayar,
              sisa: jasa.hutang - dibayar,
            },
          ],
        },
      ];
    }),
  };
});

const w = await import("./pembayaran-writer");
const q = await import("./pembayaran-queries");
const { catatVoucher } = await import("@/lib/finance/kas/voucher-writer");
const { daftarPotongPemasokKas } = await import("@/lib/finance/kas/pph-dipotong-queries");
const { rincianVoucher } = await import("@/lib/finance/kas/voucher-queries");

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3306") || url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

const token = Math.floor(Math.random() * 1e7);
const HARI_INI = "2003-12-31";
const NOMOR_SKB = `SKB-UJI-${token}`;
let userId = "";
let tipeId = "";
let pemasokId = "";
const akunIds: string[] = [];
const voucherIds: string[] = [];
const A: Record<string, string> = {};

async function buatAkun(k: string, tipe: AccountType, kas = false) {
  const a = await prisma.chartAccount.create({
    data: { code: `6${token}${String(akunIds.length).padStart(2, "0")}`, name: `${k} (uji skb)`, type: tipe, depth: 1, isActive: true, ...(kas ? { cashFlowSection: "KAS" } : {}) },
    select: { id: true },
  });
  akunIds.push(a.id);
  A[k] = a.id;
}

async function barisJurnal(sourceType: string, sourceId: string) {
  const j = await prisma.journal.findUnique({ where: { sourceType_sourceId: { sourceType, sourceId } }, select: { lines: { select: { chartAccountId: true, debit: true, credit: true } } } });
  const nama = new Map(Object.entries(A).map(([k, v]) => [v, k]));
  return (j?.lines ?? []).map((l) => [nama.get(l.chartAccountId), Number(l.debit), Number(l.credit)]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
}

async function jejakBayar(id: string) {
  const r = await prisma.auditLog.findFirst({ where: { action: "SUPPLIER_PAYMENT_RECORDED", entityId: id }, select: { metadata: true } });
  return (r?.metadata ?? null) as Record<string, unknown> | null;
}

/** Langkah jasa baru untuk satu tes (hutang dan dasar potongnya). */
function langkahBaru(hutang: number, dasar: number) {
  jasa.stepId = `step-skb-${token}-${Math.random().toString(36).slice(2, 7)}`;
  jasa.hutang = hutang;
  jasa.dasar = dasar;
  return jasa.stepId;
}

async function aturSkb(sampai: string | null) {
  await prisma.supplier.update({
    where: { id: pemasokId },
    data: { skbNumber: sampai ? NOMOR_SKB : null, skbValidUntil: sampai ? new Date(`${sampai}T00:00:00.000+07:00`) : null },
  });
}

const bayar = (tanggal: string, stepId: string, jumlah: number, tambahan: Record<string, unknown> = {}) =>
  w.catatPembayaranPemasok({
    pemasokId,
    tanggal,
    cara: "TRANSFER",
    rekeningId: A.BANK,
    alokasi: [{ jenis: "WO_STEP", id: stepId, jumlah }],
    olehUserId: userId,
    hariIni: HARI_INI,
    ...tambahan,
  });

d("SKB pemasok (basis data uji)", () => {
  beforeAll(async () => {
    userId = (await prisma.user.create({ data: { email: `skb-${token}@test.local`, name: "Uji SKB" }, select: { id: true } })).id;
    tipeId = (await prisma.supplierType.create({ data: { code: `TSKB${token}`, name: "Uji SKB" }, select: { id: true } })).id;
    pemasokId = (
      await prisma.supplier.create({ data: { code: `SSKB${token}`, name: `Penjahit Uji SKB ${token}`, typeId: tipeId, taxWithholding: "PPH21", hasNpwp: true, status: "ACTIVE" }, select: { id: true } })
    ).id;
    jasa.supplierId = pemasokId;
    await buatAkun("BANK", "ASET", true);
    await buatAkun("HUTANG", "LIABILITAS");
    await buatAkun("PPH21", "LIABILITAS");
    await buatAkun("PPH23", "LIABILITAS");
    await buatAkun("BEBAN_JASA", "BEBAN");
    peta.akun.set("AP", A.HUTANG);
    peta.akun.set("PPH21_PAYABLE", A.PPH21);
    peta.akun.set("PPH23_PAYABLE", A.PPH23);
    peta.akun.set("BANK", A.BANK);
  }, 60_000);

  afterAll(async () => {
    const j = await prisma.journal.findMany({ where: { postedById: seededId(userId) }, select: { id: true } });
    await prisma.journal.deleteMany({ where: { id: { in: seededIds(j.map((x) => x.id)) } } });
    await prisma.supplierPayment.deleteMany({ where: { supplierId: seededId(pemasokId) } });
    await prisma.cashVoucher.deleteMany({ where: { id: { in: seededIds(voucherIds) } } });
    await prisma.auditLog.deleteMany({ where: { userId: seededId(userId) } });
    if (pemasokId) await prisma.supplier.deleteMany({ where: { id: seededId(pemasokId) } });
    if (tipeId) await prisma.supplierType.deleteMany({ where: { id: seededId(tipeId) } });
    await prisma.chartAccount.deleteMany({ where: { id: { in: seededIds(akunIds) } } });
    if (userId) await prisma.user.deleteMany({ where: { id: seededId(userId) } });
  }, 60_000);

  it("SKB berlaku sampai hari bayar → tidak dipotong (jenis yang diminta pun); dicatat di jejak, rincian, dan halaman PPh dipotong bernilai 0", async () => {
    await aturSkb("2003-06-30");
    const step = langkahBaru(1_110_000, 1_000_000);
    // Jenis yang diketik di formulir tetap kalah oleh SKB yang berlaku.
    const r = await bayar("2003-06-30", step, 1_110_000, { jenisPotong: "PPH23" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const b = await prisma.supplierPayment.findUnique({ where: { id: r.id }, select: { withholdingAmount: true, withholdingType: true, netAmount: true } });
    expect(Number(b!.withholdingAmount)).toBe(0);
    expect(b!.withholdingType).toBeNull();
    expect(Number(b!.netAmount)).toBe(1_110_000);
    expect(await barisJurnal("SUPPLIER_PAYMENT_DOC", r.id)).toEqual([
      ["BANK", 0, 1_110_000],
      ["HUTANG", 1_110_000, 0],
    ]);
    expect((await jejakBayar(r.id))?.dibebaskanSkb).toEqual({
      nomor: NOMOR_SKB,
      berlakuSampai: "2003-06-30",
      jenis: "PPH23",
      keterangan: `Dibebaskan SKB ${NOMOR_SKB}`,
      dasar: 1_000_000,
    });
    const rinci = await q.rincianPembayaran(r.id);
    expect(rinci?.dibebaskanSkb).toEqual({ nomor: NOMOR_SKB, berlakuSampai: "2003-06-30", jenis: "PPH23" });
    const masa = (await daftarPotongPemasokKas("2003-06")).filter((x) => x.id === r.id);
    expect(masa).toEqual([
      expect.objectContaining({ sumber: "PEMBAYARAN_PEMASOK", jenis: "PPH23", pph: 0, dasar: 1_000_000, dibebaskanSkb: { nomor: NOMOR_SKB, berlakuSampai: "2003-06-30" } }),
    ]);
  });

  it("SKB habis sebelum hari bayar → PPh 21 normal (50% × 5% = 2,5%), tanpa catatan bebas", async () => {
    await aturSkb("2003-06-30");
    const step = langkahBaru(1_110_000, 1_000_000);
    const r = await bayar("2003-07-01", step, 1_110_000);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const b = await prisma.supplierPayment.findUnique({ where: { id: r.id }, select: { withholdingAmount: true, withholdingType: true } });
    expect(Number(b!.withholdingAmount)).toBe(25_000);
    expect(b!.withholdingType).toBe("PPH21");
    expect((await jejakBayar(r.id))?.dibebaskanSkb ?? null).toBeNull();
    expect((await q.rincianPembayaran(r.id))?.dibebaskanSkb).toBeNull();
  });

  it("uang muka dibayar selagi SKB berlaku tidak dipotong saat diterapkan sesudah SKB habis", async () => {
    await aturSkb("2003-08-31");
    const step = langkahBaru(1_110_000, 1_000_000);
    const um = await w.catatPembayaranPemasok({ pemasokId, tanggal: "2003-08-15", cara: "TRANSFER", rekeningId: A.BANK, uangMuka: 1_110_000, olehUserId: userId, hariIni: HARI_INI });
    expect(um.ok).toBe(true);
    if (!um.ok) return;
    expect((await jejakBayar(um.id))?.uangMukaTerpotong).toBe(1_110_000);
    const r = await w.terapkanUangMuka({ pembayaranId: um.id, alokasi: [{ jenis: "WO_STEP", id: step, jumlah: 1_110_000 }], olehUserId: userId, hariIni: "2003-09-10" });
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.potong).toBeUndefined();
    const potongan = await prisma.supplierPayment.count({ where: { supplierId: pemasokId, idempotencyKey: { startsWith: `potong-uang-muka:${um.id}:` } } });
    expect(potongan).toBe(0);
  });

  it("penerapan uang muka yang melunasi dokumen selagi SKB berlaku: tidak dipotong, pembebasannya dicatat", async () => {
    await aturSkb(null);
    const step = langkahBaru(1_110_000, 1_000_000);
    // Uang muka tanpa SKB: PPh 21 ditunda ke penerapan (dasar uang muka nol).
    const um = await w.catatPembayaranPemasok({ pemasokId, tanggal: "2003-10-01", cara: "TRANSFER", rekeningId: A.BANK, uangMuka: 1_110_000, olehUserId: userId, hariIni: HARI_INI });
    if (!um.ok) throw new Error(um.kode);
    await aturSkb("2003-10-31");
    const r = await w.terapkanUangMuka({ pembayaranId: um.id, alokasi: [{ jenis: "WO_STEP", id: step, jumlah: 1_110_000 }], olehUserId: userId, hariIni: "2003-10-20" });
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.potong).toBeUndefined();
    const jejak = await prisma.auditLog.findFirst({ where: { action: "SUPPLIER_ADVANCE_APPLIED", entityId: um.id }, select: { metadata: true } });
    expect((jejak?.metadata as Record<string, unknown>).dibebaskanSkb).toMatchObject({ nomor: NOMOR_SKB, jenis: "PPH21", pph: 25_000 });
  });

  it("voucher kas keluar ke pemasok ber-SKB: tidak dipotong selagi berlaku, dipotong normal sesudah habis", async () => {
    await aturSkb("2003-11-15");
    const isian = (tanggal: string, k: string) => ({
      jenis: "OUT",
      tanggal,
      rekeningId: A.BANK,
      pihak: "Penjahit uji",
      pemasokId,
      jenisPotong: "PPH21",
      baris: [{ akunId: A.BEBAN_JASA, jumlah: "1000000", kenaPotong: true }],
      idempotencyKey: `uji-skb-${token}-${k}`,
      olehUserId: userId,
      hariIni: HARI_INI,
    });
    const bebas = await catatVoucher(isian("2003-11-15", "v1"));
    expect(bebas.ok).toBe(true);
    if (!bebas.ok) return;
    voucherIds.push(bebas.id);
    const v1 = await prisma.cashVoucher.findUnique({ where: { id: bebas.id }, select: { withholdingAmount: true, withholdingType: true } });
    expect(Number(v1!.withholdingAmount)).toBe(0);
    expect(v1!.withholdingType).toBeNull();
    const masa = (await daftarPotongPemasokKas("2003-11")).filter((x) => x.id === bebas.id);
    expect(masa).toEqual([expect.objectContaining({ sumber: "VOUCHER_KAS", jenis: "PPH21", pph: 0, dasar: 1_000_000, dibebaskanSkb: { nomor: NOMOR_SKB, berlakuSampai: "2003-11-15" } })]);
    expect((await rincianVoucher(bebas.id))?.dibebaskanSkb).toEqual({ nomor: NOMOR_SKB, berlakuSampai: "2003-11-15", jenis: "PPH21" });

    const normal = await catatVoucher(isian("2003-11-16", "v2"));
    expect(normal.ok).toBe(true);
    if (!normal.ok) return;
    voucherIds.push(normal.id);
    const v2 = await prisma.cashVoucher.findUnique({ where: { id: normal.id }, select: { withholdingAmount: true, withholdingType: true } });
    expect(Number(v2!.withholdingAmount)).toBe(25_000);
    expect(v2!.withholdingType).toBe("PPH21");
    expect((await rincianVoucher(normal.id))?.dibebaskanSkb).toBeNull();
  });
});
