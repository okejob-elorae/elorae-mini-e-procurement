import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { postJournal, prisma, seededId, seededIds } from "@elorae/db";
import type { AccountType } from "@/lib/constants/enums";

/*
 * PPh 23 atas jasa jahit yang sebagian dibayar dengan UANG MUKA — basis data
 * sungguhan, angka uji akuntansi 2 (Okt 2026): jasa Rp 1.225.000, uang muka
 * Rp 500.000, pelunasan Rp 725.000. Dulu PPh 23 hanya Rp 14.500 (atas
 * pelunasan); benar Rp 24.500 (2% × 1.225.000), apa pun urutannya.
 *
 * Tanggal uji 2001. Peran dipalsukan ke akun uji berkas ini; hutang jasa WO
 * dipalsukan (satu langkah per pemasok, porsi dasar 100%) dengan "dibayar"
 * dibaca dari alokasi sungguhan. Hutang jasanya juga dijurnal (CR hutang usaha)
 * supaya buku pembantu bisa dicocokkan dengan buku besar.
 */

const peta = vi.hoisted(() => ({ akun: new Map<string, string>() }));
const jasa = vi.hoisted(() => ({ langkah: new Map<string, { stepId: string; hutang: number }>() }));

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
      const hasil = [];
      for (const [supplierId, l] of jasa.langkah) {
        if (opsi?.supplierId && opsi.supplierId !== supplierId) continue;
        const a = await db.supplierPaymentAllocation.findMany({
          where: { targetType: "WO_STEP", targetId: l.stepId, payment: { status: { not: "CANCELLED" } } },
          select: { amount: true },
        });
        const dibayar = Math.round(a.reduce((s, x) => s + Number(x.amount), 0) * 100) / 100;
        const sisa = Math.round((l.hutang - dibayar) * 100) / 100;
        hasil.push({
          supplierId,
          kodePemasok: "X",
          namaPemasok: "X",
          jenisPotong: "PPH23",
          adaNpwp: true,
          hutang: l.hutang,
          dasarPotong: l.hutang,
          dibayar,
          sisa,
          langkah: [
            { stepId: l.stepId, woId: "wo-uji", woDocNumber: "WO/UJI", urutan: 1, namaLangkah: "Jahit", supplierId, hargaPerPcs: 12_250, hargaTermasukPpn: false, qtyTerhutang: 100, hutang: l.hutang, dasarPotong: l.hutang, ppn: 0, dibayar, sisa },
          ],
        });
      }
      return hasil;
    }),
  };
});
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));

const w = await import("./pembayaran-writer");
const q = await import("./pembayaran-hutang-queries");
const { daftarPotongPemasokKas } = await import("@/lib/finance/kas/pph-dipotong-queries");

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3306") || url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

const token = Math.floor(Math.random() * 1e7);
const HARI_INI = "2001-12-31";
const JASA = 1_225_000;
let userId = "";
let tipeId = "";
const pemasokIds: string[] = [];
const akunIds: string[] = [];
const A: Record<string, string> = {};
const tgl = (h: string) => new Date(`${h}T10:00:00+07:00`);

async function buatAkun(k: string, tipe: AccountType, kas = false) {
  const a = await prisma.chartAccount.create({
    data: { code: `7${token}${String(akunIds.length).padStart(2, "0")}`, name: `${k} (uji PPh uang muka)`, type: tipe, depth: 1, isActive: true, ...(kas ? { cashFlowSection: "KAS" } : {}) },
    select: { id: true },
  });
  akunIds.push(a.id);
  A[k] = a.id;
}

/** Pemasok jasa PPh 23 ber-NPWP dengan satu langkah WO terutang Rp 1.225.000 (dan jurnal hutangnya). */
async function pemasokJasa(k: string): Promise<{ id: string; stepId: string }> {
  const s = await prisma.supplier.create({
    data: { code: `SUMP${token}${k}`, name: `CV Jahit ${k} ${token}`, typeId: tipeId, taxWithholding: "PPH23", hasNpwp: true, status: "ACTIVE" },
    select: { id: true },
  });
  pemasokIds.push(s.id);
  const stepId = `step-um-${token}-${k}`;
  jasa.langkah.set(s.id, { stepId, hutang: JASA });
  await postJournal(prisma, {
    source: { type: "UJI_JASA_UANG_MUKA", id: stepId },
    date: tgl("2001-02-28"),
    description: `uji hutang jasa ${token} ${k}`,
    postedById: userId,
    lines: [
      { chartAccountId: A.PERSEDIAAN, debit: JASA, credit: 0 },
      { chartAccountId: A.HUTANG, debit: 0, credit: JASA },
    ],
  });
  return { id: s.id, stepId };
}

const dokJasa = async (pemasokId: string) => {
  const h = (await q.bacaHutangPemasok({ supplierIds: [pemasokId] })).pemasok[0];
  return { h, langkah: h.dokumen.find((x) => x.jenis === "WO_STEP")! };
};

async function jurnalBaris(sourceType: string, sourceId: string) {
  const j = await prisma.journal.findUnique({ where: { sourceType_sourceId: { sourceType, sourceId } }, select: { lines: { select: { chartAccountId: true, debit: true, credit: true } } } });
  if (!j) return null;
  const nama = new Map(Object.entries(A).map(([k, v]) => [v, k]));
  return j.lines.map((l) => [nama.get(l.chartAccountId), Number(l.debit), Number(l.credit)]).sort((a, b) => String(a[0]).localeCompare(String(b[0])) || Number(a[1]) - Number(b[1]));
}

/** Saldo hutang usaha pemasok di buku besar (kredit − debit) dari jurnal yang menyentuh akun uji. */
async function saldoHutangGl(ids: string[]): Promise<number> {
  const r = await prisma.journalLine.aggregate({
    where: { chartAccountId: A.HUTANG, journal: { status: "POSTED", OR: [{ sourceId: { in: ids } }] } },
    _sum: { debit: true, credit: true },
  });
  return Math.round((Number(r._sum.credit ?? 0) - Number(r._sum.debit ?? 0)) * 100);
}

async function pphTercatat(pemasokId: string): Promise<number> {
  const r = await prisma.supplierPayment.aggregate({ where: { supplierId: pemasokId, status: "POSTED" }, _sum: { withholdingAmount: true } });
  return Number(r._sum.withholdingAmount ?? 0);
}

const bayarDasar = (pemasokId: string) => ({ pemasokId, cara: "TRANSFER", rekeningId: A.BANK, olehUserId: userId, hariIni: HARI_INI });

d("PPh 23 atas jasa yang sebagian dibayar dengan uang muka (basis data uji)", () => {
  beforeAll(async () => {
    userId = (await prisma.user.create({ data: { email: `um-pph-${token}@test.local`, name: "Uji PPh uang muka" }, select: { id: true } })).id;
    tipeId = (await prisma.supplierType.create({ data: { code: `TUMP${token}`, name: "Uji PPh uang muka" }, select: { id: true } })).id;
    await buatAkun("BANK", "ASET", true);
    await buatAkun("PERSEDIAAN", "ASET");
    await buatAkun("HUTANG", "LIABILITAS");
    await buatAkun("PPH23", "LIABILITAS");
    peta.akun.set("AP", A.HUTANG);
    peta.akun.set("PPH23_PAYABLE", A.PPH23);
    peta.akun.set("BANK", A.BANK);
  }, 60_000);

  afterAll(async () => {
    const j = await prisma.journal.findMany({ where: { postedById: seededId(userId) }, select: { id: true } });
    await prisma.journal.deleteMany({ where: { id: { in: seededIds(j.map((x) => x.id)) } } });
    await prisma.supplierPayment.deleteMany({ where: { supplierId: { in: seededIds(pemasokIds) } } });
    await prisma.auditLog.deleteMany({ where: { userId: seededId(userId) } });
    await prisma.supplier.deleteMany({ where: { id: { in: seededIds(pemasokIds) } } });
    if (tipeId) await prisma.supplierType.deleteMany({ where: { id: seededId(tipeId) } });
    await prisma.chartAccount.deleteMany({ where: { id: { in: seededIds(akunIds) } } });
    if (userId) await prisma.user.deleteMany({ where: { id: seededId(userId) } });
  }, 60_000);

  it("angka uji: uang muka 500.000 diterapkan, pelunasan 725.000 → PPh 23 24.500, keluar 700.500; buku pembantu = buku besar", async () => {
    const p = await pemasokJasa("A");
    const um = await w.catatPembayaranPemasok({ ...bayarDasar(p.id), tanggal: "2001-03-01", uangMuka: 500_000 });
    expect(um.ok).toBe(true);
    if (!um.ok) return;
    expect(Number((await prisma.supplierPayment.findUniqueOrThrow({ where: { id: um.id } })).withholdingAmount)).toBe(0);

    const terap = await w.terapkanUangMuka({ pembayaranId: um.id, alokasi: [{ jenis: "WO_STEP", id: p.stepId, jumlah: 500_000 }], olehUserId: userId, hariIni: "2001-03-10" });
    expect(terap).toMatchObject({ ok: true, journalId: null });
    expect(terap.ok && terap.potong).toBeUndefined();
    let { langkah } = await dokJasa(p.id);
    expect(langkah.sisaSen).toBe(72_500_000);
    expect(langkah.uangMukaBelumDipotongSen).toBe(50_000_000);

    // Dasar yang diketik boleh sampai bruto + uang muka belum dipotong — tidak lebih.
    expect(
      await w.catatPembayaranPemasok({ ...bayarDasar(p.id), tanggal: "2001-03-20", alokasi: [{ jenis: "WO_STEP", id: p.stepId, jumlah: 725_000 }], dasarPotong: 1_225_001 }),
    ).toEqual({ ok: false, kode: "DASAR_POTONG_TIDAK_SAH" });

    const lunas = await w.catatPembayaranPemasok({ ...bayarDasar(p.id), tanggal: "2001-03-20", alokasi: [{ jenis: "WO_STEP", id: p.stepId, jumlah: 725_000 }] });
    expect(lunas.ok).toBe(true);
    if (!lunas.ok) return;
    const b = await prisma.supplierPayment.findUniqueOrThrow({ where: { id: lunas.id } });
    expect([Number(b.grossAmount), Number(b.withholdingAmount), Number(b.netAmount), b.withholdingType]).toEqual([725_000, 24_500, 700_500, "PPH23"]);
    expect(await jurnalBaris("SUPPLIER_PAYMENT_DOC", lunas.id)).toEqual([
      ["BANK", 0, 700_500],
      ["HUTANG", 725_000, 0],
      ["PPH23", 0, 24_500],
    ]);
    expect(await pphTercatat(p.id)).toBe(24_500);

    ({ langkah } = await dokJasa(p.id));
    expect(langkah.sisaSen).toBe(0);
    expect(langkah.uangMukaBelumDipotongSen ?? 0).toBe(0);
    const { h } = await dokJasa(p.id);
    expect(h.netoSen).toBe(0);
    expect(await saldoHutangGl([p.stepId, um.id, lunas.id])).toBe(h.netoSen);

    // Halaman PPh dipotong: dasar 1.225.000, PPh 24.500 di masa pelunasan.
    const masa = (await daftarPotongPemasokKas("2001-03")).filter((x) => x.id === lunas.id || x.id === um.id);
    expect(masa.map((x) => [x.nomor, x.dasar, x.pph])).toEqual([[lunas.nomor, 1_225_000, 24_500]]);
  });

  it("pelunasan 725.000 dulu, lalu uang muka 500.000 melunasi dokumen → PPh 10.000 dipotong saat diterapkan (total 24.500); batal uang muka ikut membatalkan potongannya", async () => {
    const p = await pemasokJasa("B");
    const lunas = await w.catatPembayaranPemasok({ ...bayarDasar(p.id), tanggal: "2001-04-02", alokasi: [{ jenis: "WO_STEP", id: p.stepId, jumlah: 725_000 }] });
    expect(lunas.ok).toBe(true);
    if (!lunas.ok) return;
    expect(Number((await prisma.supplierPayment.findUniqueOrThrow({ where: { id: lunas.id } })).withholdingAmount)).toBe(14_500);
    const um = await w.catatPembayaranPemasok({ ...bayarDasar(p.id), tanggal: "2001-04-03", uangMuka: 500_000 });
    expect(um.ok).toBe(true);
    if (!um.ok) return;

    const terap = await w.terapkanUangMuka({ pembayaranId: um.id, alokasi: [{ jenis: "WO_STEP", id: p.stepId, jumlah: 500_000 }], olehUserId: userId, hariIni: "2001-04-15" });
    expect(terap.ok).toBe(true);
    if (!terap.ok || !terap.potong) throw new Error("potongan uang muka tidak dibuat");
    expect(terap.potong.jumlah).toBe(10_000);

    const pot = await prisma.supplierPayment.findUniqueOrThrow({ where: { id: terap.potong.id }, include: { allocations: true } });
    expect([Number(pot.grossAmount), Number(pot.withholdingAmount), Number(pot.netAmount), pot.withholdingType, pot.cashAccountId]).toEqual([10_000, 10_000, 0, "PPH23", A.BANK]);
    expect(pot.date.toISOString()).toBe(new Date("2001-04-15T00:00:00+07:00").toISOString());
    expect(pot.allocations.map((a) => [a.targetType, a.targetId, Number(a.amount)])).toEqual([["WO_STEP", p.stepId, 10_000]]);
    expect(await jurnalBaris("SUPPLIER_PAYMENT_DOC", pot.id)).toEqual([
      ["HUTANG", 10_000, 0],
      ["PPH23", 0, 10_000],
    ]);
    const alokasiUm = await prisma.supplierPaymentAllocation.findMany({ where: { paymentId: seededId(um.id) }, select: { amount: true } });
    expect(alokasiUm.map((a) => Number(a.amount))).toEqual([490_000]);
    expect(await pphTercatat(p.id)).toBe(24_500);

    let { h, langkah } = await dokJasa(p.id);
    expect(langkah.sisaSen).toBe(0);
    expect(langkah.uangMukaBelumDipotongSen ?? 0).toBe(0);
    // Uang muka dibayar 500.000 tanpa potongan; yang semestinya diterima pemasok untuk bagian itu 490.000 → sisa uang muka 10.000.
    expect(h.uangMukaSen).toBe(1_000_000);
    expect(h.netoSen).toBe(-1_000_000);
    expect(await saldoHutangGl([p.stepId, lunas.id, um.id, pot.id])).toBe(h.netoSen);

    const masa = (await daftarPotongPemasokKas("2001-04")).filter((x) => [lunas.id, um.id, pot.id].includes(x.id));
    expect(masa.map((x) => [x.id, x.tanggal, x.dasar, x.pph])).toEqual([
      [lunas.id, "2001-04-02", 725_000, 14_500],
      [pot.id, "2001-04-15", 500_000, 10_000],
    ]);

    // Batal uang muka → potongannya ikut batal (jurnal dibalik), dokumen terbuka lagi 500.000 tanpa uang muka tertunda.
    const batal = await w.batalkanPembayaranPemasok({ id: um.id, olehUserId: userId, alasan: "Salah catat uang muka" });
    expect(batal.ok).toBe(true);
    expect((await prisma.supplierPayment.findUniqueOrThrow({ where: { id: pot.id } })).status).toBe("CANCELLED");
    expect(await jurnalBaris("SUPPLIER_PAYMENT_DOC_REVERSAL", pot.id)).toEqual([
      ["HUTANG", 0, 10_000],
      ["PPH23", 10_000, 0],
    ]);
    ({ h, langkah } = await dokJasa(p.id));
    expect(langkah.sisaSen).toBe(50_000_000);
    expect(langkah.uangMukaBelumDipotongSen ?? 0).toBe(0);
    expect(h.uangMukaSen).toBe(0);
    expect(await pphTercatat(p.id)).toBe(14_500);
  });

  it("uang muka 2.000.000 lebih besar dari jasa 1.225.000: diterapkan penuh → PPh 24.500, uang muka terpakai 1.200.500, sisa 799.500", async () => {
    const p = await pemasokJasa("C");
    const um = await w.catatPembayaranPemasok({ ...bayarDasar(p.id), tanggal: "2001-05-01", uangMuka: 2_000_000 });
    expect(um.ok).toBe(true);
    if (!um.ok) return;
    const terap = await w.terapkanUangMuka({ pembayaranId: um.id, alokasi: [{ jenis: "WO_STEP", id: p.stepId, jumlah: JASA }], olehUserId: userId, hariIni: "2001-05-02" });
    expect(terap.ok && terap.potong?.jumlah).toBe(24_500);
    expect(await pphTercatat(p.id)).toBe(24_500);
    const { h, langkah } = await dokJasa(p.id);
    expect(langkah.sisaSen).toBe(0);
    expect(h.uangMukaSen).toBe(79_950_000);
    expect(h.uangMuka.map((u) => [u.pembayaranId, u.sisaSen])).toEqual([[um.id, 79_950_000]]);
    expect(await prisma.supplierPayment.findUniqueOrThrow({ where: { id: um.id } }).then((b) => b.isAdvance)).toBe(true);
    const ids = (await prisma.supplierPayment.findMany({ where: { supplierId: p.id }, select: { id: true } })).map((x) => x.id);
    expect(await saldoHutangGl([p.stepId, ...ids])).toBe(h.netoSen);
  });

  it("dua penerapan serentak uang muka yang sama ke dokumen yang sama: tepat satu berhasil, PPh dipotong SEKALI", async () => {
    const p = await pemasokJasa("D");
    const um = await w.catatPembayaranPemasok({ ...bayarDasar(p.id), tanggal: "2001-06-01", uangMuka: 2_000_000 });
    expect(um.ok).toBe(true);
    if (!um.ok) return;
    const terap = () => w.terapkanUangMuka({ pembayaranId: um.id, alokasi: [{ jenis: "WO_STEP", id: p.stepId, jumlah: JASA }], olehUserId: userId, hariIni: "2001-06-02" });
    const hasil = await Promise.all([terap(), terap()]);
    expect(hasil.filter((r) => r.ok)).toHaveLength(1);
    expect(hasil.filter((r) => !r.ok).map((r) => (r.ok ? null : r.kode))).toEqual([expect.stringMatching(/^(ALOKASI_GANDA|MELEBIHI_SISA|MELEBIHI_UANG_MUKA)$/)]);
    expect(await pphTercatat(p.id)).toBe(24_500);
    expect(await prisma.supplierPayment.count({ where: { supplierId: p.id, status: "POSTED", withholdingAmount: { gt: 0 } } })).toBe(1);
    const { h, langkah } = await dokJasa(p.id);
    expect(langkah.sisaSen).toBe(0);
    expect(h.uangMukaSen).toBe(79_950_000);
  });
});
