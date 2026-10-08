import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { postJournal, prisma, seededId, seededIds } from "@elorae/db";
import type { AccountType } from "@/lib/constants/enums";

/*
 * Pembayaran pemasok sebagian (dokumen BYR/…) terhadap basis data sungguhan:
 * buku pembantu hutang (GRN berjurnal, retur pemasok FIFO, jasa WO, saldo
 * awal, uang muka), penulis (alokasi, PPh 23 jasa, idempotensi, tanda lunas PO
 * otomatis), batal, terapkan uang muka, cermin tombol lama, dan penolakan tombol
 * lama untuk PO yang sudah dibayar lewat dokumen.
 *
 * Tanggal uji 2008-08. Peran dipalsukan ke akun uji berkas ini; hutang jasa
 * WO dipalsukan (satu langkah) dengan "dibayar" dibaca dari alokasi sungguhan.
 */

const peta = vi.hoisted(() => ({ akun: new Map<string, string>() }));
const jasa = vi.hoisted(() => ({ stepId: "", supplierId: "" }));
const sesi = vi.hoisted(() => ({ id: "" }));

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
          jenisPotong: "PPH23",
          adaNpwp: true,
          hutang: 1_110_000,
          dasarPotong: 1_000_000,
          dibayar,
          sisa: 1_110_000 - dibayar,
          langkah: [
            { stepId: jasa.stepId, woId: "wo-uji", woDocNumber: "WO/UJI", urutan: 1, namaLangkah: "Jahit", supplierId: jasa.supplierId, hargaPerPcs: 11_100, hargaTermasukPpn: true, qtyTerhutang: 100, hutang: 1_110_000, dasarPotong: 1_000_000, ppn: 110_000, dibayar, sisa: 1_110_000 - dibayar },
          ],
        },
      ];
    }),
  };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: sesi.id, permissions: ["*"] } })) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/app/actions/notifications", () => ({
  getActorName: async () => "Uji",
  notifyPOCreated: async () => {},
  notifyPOStatusUpdated: async () => {},
  notifyPOPaymentToggled: async () => {},
}));
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));

const w = await import("./pembayaran-writer");
const q = await import("./pembayaran-hutang-queries");
const cermin = await import("./pembayaran-tandai-lunas");
const { setPOPaidAt } = await import("@/app/actions/purchase-orders");

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3306") || url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

const token = Math.floor(Math.random() * 1e7);
const HARI_INI = "2008-12-31";
const RUANG = `uji-bayar-${token}`;
let userId = "";
let tipeId = "";
let pemasokId = "";
const akunIds: string[] = [];
const poIds: string[] = [];
const grnIds: string[] = [];
const returIds: string[] = [];
const imporIds: string[] = [];
const A: Record<string, string> = {};
const G: Record<string, string> = {};
const P: Record<string, string> = {};
const tgl = (h: string) => new Date(`${h}T10:00:00+07:00`);

async function buatAkun(k: string, tipe: AccountType, kas = false) {
  const a = await prisma.chartAccount.create({
    data: { code: `5${token}${String(akunIds.length).padStart(2, "0")}`, name: `${k} (uji bayar)`, type: tipe, depth: 1, isActive: true, ...(kas ? { cashFlowSection: "KAS" } : {}) },
    select: { id: true },
  });
  akunIds.push(a.id);
  A[k] = a.id;
}

async function buatPo(k: string, status: "CLOSED" | "PARTIAL", paidAt: Date | null = null) {
  const po = await prisma.purchaseOrder.create({ data: { docNumber: `PO-BYR-${token}-${k}`, supplierId: pemasokId, createdById: userId, status, paidAt }, select: { id: true } });
  poIds.push(po.id);
  P[k] = po.id;
}

async function buatGrn(k: string, poKunci: string, hari: string, nilai: number, berjurnal = true) {
  const g = await prisma.gRN.create({
    data: { docNumber: `GRN-BYR-${token}-${k}`, poId: P[poKunci], supplierId: pemasokId, grnDate: tgl(hari), receivedBy: userId, totalAmount: nilai, items: [] },
    select: { id: true },
  });
  grnIds.push(g.id);
  G[k] = g.id;
  if (berjurnal) {
    await postJournal(prisma, {
      source: { type: "GRN", id: g.id },
      date: tgl(hari),
      description: `uji grn ${token}`,
      postedById: userId,
      lines: [
        { chartAccountId: A.PERSEDIAAN, debit: nilai, credit: 0 },
        { chartAccountId: A.HUTANG, debit: 0, credit: nilai },
      ],
    });
  }
}

async function jurnal(sourceType: string, sourceId: string) {
  const j = await prisma.journal.findUnique({ where: { sourceType_sourceId: { sourceType, sourceId } }, select: { id: true, reversalOfId: true, lines: { select: { chartAccountId: true, debit: true, credit: true, memo: true } } } });
  if (!j) return null;
  const nama = new Map(Object.entries(A).map(([k, v]) => [v, k]));
  return { ...j, baris: j.lines.map((l) => [nama.get(l.chartAccountId), Number(l.debit), Number(l.credit)]).sort((a, b) => String(a[0]).localeCompare(String(b[0])) || Number(a[1]) - Number(b[1])) };
}

const dok = async () => (await q.bacaHutangPemasok({ supplierIds: [pemasokId], ruangSaldoAwal: RUANG })).pemasok[0];
const sisaDok = (h: Awaited<ReturnType<typeof dok>>, id: string) => h.dokumen.find((x) => x.id === id)?.sisaSen;

d("pembayaran pemasok sebagian (basis data uji)", () => {
  beforeAll(async () => {
    userId = (await prisma.user.create({ data: { email: `bayar-${token}@test.local`, name: "Uji bayar" }, select: { id: true } })).id;
    sesi.id = userId;
    tipeId = (await prisma.supplierType.create({ data: { code: `TBYR${token}`, name: "Uji bayar" }, select: { id: true } })).id;
    pemasokId = (
      await prisma.supplier.create({ data: { code: `SBYR${token}`, name: `CV Uji Bayar ${token}`, typeId: tipeId, taxWithholding: "PPH23", hasNpwp: true, status: "ACTIVE" }, select: { id: true } })
    ).id;
    jasa.supplierId = pemasokId;
    jasa.stepId = `step-${token}`;
    await buatAkun("BANK", "ASET", true);
    await buatAkun("PERSEDIAAN", "ASET");
    await buatAkun("HUTANG", "LIABILITAS");
    await buatAkun("PPH23", "LIABILITAS");
    peta.akun.set("AP", A.HUTANG);
    peta.akun.set("PPH23_PAYABLE", A.PPH23);
    peta.akun.set("BANK", A.BANK);

    await buatPo("1", "CLOSED");
    await buatGrn("g1", "1", "2008-08-01", 1_000_000);
    await buatGrn("g2", "1", "2008-08-20", 500_000);
    await buatPo("2", "PARTIAL");
    await buatGrn("g3", "2", "2008-08-05", 300_000);
    await buatGrn("g4", "2", "2008-08-06", 100, false);
    const vr = await prisma.vendorReturn.create({
      data: { docNumber: `RET-BYR-${token}`, vendorId: pemasokId, lines: [], totalItems: 1, totalValue: 200_000, status: "COMPLETED", completedAt: tgl("2008-08-10"), createdById: userId, poId: P["1"], poCreditAmount: 200_000 },
      select: { id: true },
    });
    returIds.push(vr.id);
    // Jurnal retur ke pemasok (akuntansi operasional): DR hutang usaha sebesar kredit PO.
    await postJournal(prisma, {
      source: { type: "VENDOR_RETURN", id: vr.id },
      date: tgl("2008-08-10"),
      description: `uji retur ${token}`,
      postedById: userId,
      lines: [
        { chartAccountId: A.HUTANG, debit: 200_000, credit: 0 },
        { chartAccountId: A.PERSEDIAAN, debit: 0, credit: 200_000 },
      ],
    });
    const imp = await prisma.openingBalanceImport.create({
      data: { kind: `${RUANG}:AP`, cutoverDate: tgl("2008-07-01"), totalAmount: 250_000, status: "POSTED", postedAt: new Date(), postedById: userId, entries: [{ supplierId: pemasokId, jumlah: 250_000 }], createdById: userId },
      select: { id: true },
    });
    imporIds.push(imp.id);
  }, 60_000);

  afterAll(async () => {
    const j = await prisma.journal.findMany({ where: { postedById: seededId(userId) }, select: { id: true } });
    await prisma.journal.deleteMany({ where: { id: { in: seededIds(j.map((x) => x.id)) } } });
    await prisma.supplierPayment.deleteMany({ where: { supplierId: seededId(pemasokId) } });
    await prisma.vendorReturn.deleteMany({ where: { id: { in: seededIds(returIds) } } });
    await prisma.gRN.deleteMany({ where: { id: { in: seededIds(grnIds) } } });
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: seededIds(poIds) } } });
    await prisma.openingBalanceImport.deleteMany({ where: { id: { in: seededIds(imporIds) } } });
    await prisma.auditLog.deleteMany({ where: { userId: seededId(userId) } });
    if (pemasokId) await prisma.supplier.deleteMany({ where: { id: seededId(pemasokId) } });
    if (tipeId) await prisma.supplierType.deleteMany({ where: { id: seededId(tipeId) } });
    await prisma.chartAccount.deleteMany({ where: { id: { in: seededIds(akunIds) } } });
    if (userId) await prisma.user.deleteMany({ where: { id: seededId(userId) } });
  }, 60_000);

  it("buku pembantu: hutang GRN dari jurnal, retur FIFO, jasa WO, saldo awal, GRN tanpa jurnal", async () => {
    const h = await dok();
    expect(h.grnBelumBerjurnal).toBe(1);
    expect(h.dokumen.map((x) => [x.jenis, x.id === G.g1 ? "g1" : x.id === G.g2 ? "g2" : x.id === G.g3 ? "g3" : x.id, x.hutangSen, x.kreditSen, x.sisaSen])).toEqual([
      ["OTHER", "SALDO_AWAL", 25_000_000, 0, 25_000_000],
      ["GRN", "g1", 100_000_000, 20_000_000, 80_000_000],
      ["GRN", "g3", 30_000_000, 0, 30_000_000],
      ["GRN", "g2", 50_000_000, 0, 50_000_000],
      ["WO_STEP", jasa.stepId, 111_000_000, 0, 111_000_000],
    ]);
    expect(h.dokumen.find((x) => x.jenis === "WO_STEP")!.porsiDasarPotong).toBeCloseTo(1_000_000 / 1_110_000, 10);
    expect(h.sisaSen).toBe(296_000_000);
  });

  it("bayar sebagian ke banyak dokumen + uang muka; PPh 23 hanya atas jasa tanpa PPN; idempoten", async () => {
    const isian = {
      pemasokId,
      tanggal: "2008-09-01",
      cara: "TRANSFER",
      rekeningId: A.BANK,
      referensi: "TRX-1",
      alokasi: [
        { jenis: "GRN", id: G.g1, jumlah: 800_000 },
        { jenis: "WO_STEP", id: jasa.stepId, jumlah: 555_000 },
      ],
      uangMuka: 100_000,
      idempotencyKey: `uji-bayar-${token}-1`,
      olehUserId: userId,
      hariIni: HARI_INI,
    };
    const r = await w.catatPembayaranPemasok(isian);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.nomor.startsWith("BYR/")).toBe(true);
    const b = await prisma.supplierPayment.findUnique({ where: { id: r.id }, include: { allocations: true } });
    expect(Number(b!.grossAmount)).toBe(1_455_000);
    expect(Number(b!.withholdingAmount)).toBe(10_000);
    expect(Number(b!.netAmount)).toBe(1_445_000);
    expect(b!.withholdingType).toBe("PPH23");
    expect(b!.isAdvance).toBe(true);
    expect(b!.allocations).toHaveLength(2);
    const j = await jurnal("SUPPLIER_PAYMENT_DOC", r.id);
    expect(j!.baris).toEqual([
      ["BANK", 0, 1_445_000],
      ["HUTANG", 100_000, 0],
      ["HUTANG", 555_000, 0],
      ["HUTANG", 800_000, 0],
      ["PPH23", 0, 10_000],
    ]);
    expect(await w.catatPembayaranPemasok({ ...isian, uangMuka: 1 })).toEqual({ ok: true, id: r.id, nomor: r.nomor, journalId: j!.id, ulang: true });

    const h = await dok();
    expect(sisaDok(h, G.g1)).toBe(0);
    expect(sisaDok(h, jasa.stepId)).toBe(55_500_000);
    expect(h.uangMukaSen).toBe(10_000_000);
    expect((await prisma.purchaseOrder.findUnique({ where: { id: P["1"] } }))!.paidAt).toBeNull();
  });

  it("menolak alokasi di atas sisa, dokumen tak dikenal, dan rekening yang bukan kas", async () => {
    const dasar = { pemasokId, tanggal: "2008-09-02", cara: "TRANSFER", rekeningId: A.BANK, olehUserId: userId, hariIni: HARI_INI };
    expect(await w.catatPembayaranPemasok({ ...dasar, alokasi: [{ jenis: "GRN", id: G.g2, jumlah: 600_000 }] })).toEqual({ ok: false, kode: "MELEBIHI_SISA", baris: 1 });
    expect(await w.catatPembayaranPemasok({ ...dasar, alokasi: [{ jenis: "GRN", id: "tidak-ada", jumlah: 1 }] })).toEqual({ ok: false, kode: "DOKUMEN_TIDAK_DITEMUKAN", baris: 1 });
    expect(await w.catatPembayaranPemasok({ ...dasar, rekeningId: A.PERSEDIAAN, uangMuka: 5 })).toEqual({ ok: false, kode: "REKENING_TIDAK_SAH" });
  });

  it("uang muka diterapkan ke GRN; pelunasan sisa menandai PO CLOSED lunas otomatis; tombol lama menolak; batal membuka tandanya", async () => {
    const um = (await prisma.supplierPayment.findFirst({ where: { supplierId: pemasokId, isAdvance: true }, select: { id: true } }))!;
    expect(await w.terapkanUangMuka({ pembayaranId: um.id, alokasi: [{ jenis: "GRN", id: G.g2, jumlah: 150_000 }], olehUserId: userId })).toEqual({ ok: false, kode: "MELEBIHI_UANG_MUKA" });
    expect(await w.terapkanUangMuka({ pembayaranId: um.id, alokasi: [{ jenis: "GRN", id: G.g2, jumlah: 100_000 }], olehUserId: userId })).toMatchObject({ ok: true });
    expect((await prisma.supplierPayment.findUnique({ where: { id: um.id } }))!.isAdvance).toBe(false);
    let h = await dok();
    expect(sisaDok(h, G.g2)).toBe(40_000_000);
    expect(h.uangMukaSen).toBe(0);

    const lunas = await w.catatPembayaranPemasok({ pemasokId, tanggal: "2008-09-03", cara: "CASH", rekeningId: A.BANK, jenisPotong: "", alokasi: [{ jenis: "GRN", id: G.g2, jumlah: "400.000" }], olehUserId: userId, hariIni: HARI_INI });
    expect(lunas.ok).toBe(true);
    if (!lunas.ok) return;
    const po1 = await prisma.purchaseOrder.findUnique({ where: { id: P["1"] }, include: { statusHistory: true } });
    expect(po1!.paidAt?.toISOString()).toBe(new Date("2008-09-03T00:00:00+07:00").toISOString());
    expect(po1!.statusHistory.map((s) => [s.paymentEvent, s.notes])).toEqual([["MARKED", `Lunas lewat pembayaran ${lunas.nomor}`]]);

    expect(await cermin.adaPembayaranDokumenUntukPo(P["1"])).toBe(true);
    expect(await setPOPaidAt(P["1"], null)).toEqual({ changed: false, refusal: "ADA_PEMBAYARAN_DOKUMEN", journalFailure: null });

    expect(await w.batalkanPembayaranPemasok({ id: lunas.id, olehUserId: userId, alasan: " sal " })).toEqual({ ok: false, kode: "ALASAN_WAJIB" });
    const batal = await w.batalkanPembayaranPemasok({ id: lunas.id, olehUserId: userId, alasan: "Salah pemasok" });
    expect(batal.ok).toBe(true);
    const balik = await jurnal("SUPPLIER_PAYMENT_DOC_REVERSAL", lunas.id);
    expect(balik!.baris).toEqual([
      ["BANK", 400_000, 0],
      ["HUTANG", 0, 400_000],
    ]);
    const po1b = await prisma.purchaseOrder.findUnique({ where: { id: P["1"] }, include: { statusHistory: { orderBy: { createdAt: "asc" } } } });
    expect(po1b!.paidAt).toBeNull();
    expect(po1b!.statusHistory.map((s) => s.paymentEvent)).toEqual(["MARKED", "UNMARKED"]);
    h = await dok();
    expect(sisaDok(h, G.g2)).toBe(40_000_000);
    expect(await w.batalkanPembayaranPemasok({ id: lunas.id, olehUserId: userId, alasan: "Salah pemasok" })).toEqual({ ok: false, kode: "SUDAH_DIBATALKAN" });
  });

  it("tombol lama: cermin satu pembayaran penuh dibuat/dibatalkan mengikuti jurnalnya; PO bertanda lunas tombol lama tidak dibayar lagi lewat dokumen", async () => {
    await buatPo("3", "CLOSED");
    await buatGrn("g5", "3", "2008-08-25", 200_000);
    await postJournal(prisma, {
      source: { type: "SUPPLIER_PAYMENT", id: `${P["3"]}#1` },
      date: tgl("2008-09-05"),
      description: `uji tandai ${token}`,
      postedById: userId,
      lines: [
        { chartAccountId: A.HUTANG, debit: 200_000, credit: 0 },
        { chartAccountId: A.BANK, debit: 0, credit: 200_000 },
      ],
    });
    await prisma.purchaseOrder.update({ where: { id: P["3"] }, data: { paidAt: tgl("2008-09-05") } });
    expect(await cermin.selaraskanCerminTandaiLunas(P["3"], userId)).toEqual({ dibuat: 1, dibatalkan: 0 });
    expect(await cermin.selaraskanCerminTandaiLunas(P["3"], userId)).toEqual({ dibuat: 0, dibatalkan: 0 });
    const c = await prisma.supplierPayment.findFirst({ where: { idempotencyKey: `tandai-lunas:${P["3"]}#1` }, include: { allocations: true } });
    expect(c).toMatchObject({ status: "POSTED", cashAccountId: A.BANK });
    expect(c!.allocations.map((a) => [a.targetType, a.targetId, Number(a.amount)])).toEqual([["PO", P["3"], 200_000]]);
    expect(await w.batalkanPembayaranPemasok({ id: c!.id, olehUserId: userId, alasan: "Coba batal" })).toEqual({ ok: false, kode: "PAKAI_BATAL_TANDAI_LUNAS" });
    expect(sisaDok(await dok(), G.g5)).toBe(0);
    expect(await cermin.adaPembayaranDokumenUntukPo(P["3"])).toBe(false);

    // Tombol lama yang jurnalnya gagal: PO lunas tanpa jurnal → dokumen tidak boleh membayarnya.
    await buatPo("4", "CLOSED", tgl("2008-09-06"));
    await buatGrn("g6", "4", "2008-08-26", 70_000);
    expect(
      await w.catatPembayaranPemasok({ pemasokId, tanggal: "2008-09-07", cara: "TRANSFER", rekeningId: A.BANK, alokasi: [{ jenis: "GRN", id: G.g6, jumlah: 70_000 }], olehUserId: userId, hariIni: HARI_INI }),
    ).toEqual({ ok: false, kode: "PO_DITANDAI_LUNAS", baris: 1 });

    await postJournal(prisma, {
      source: { type: "SUPPLIER_PAYMENT_REVERSAL", id: `${P["3"]}#1` },
      date: tgl("2008-09-05"),
      description: `uji tandai balik ${token}`,
      postedById: userId,
      lines: [
        { chartAccountId: A.BANK, debit: 200_000, credit: 0 },
        { chartAccountId: A.HUTANG, debit: 0, credit: 200_000 },
      ],
    });
    expect(await cermin.selaraskanCerminTandaiLunas(P["3"], userId)).toEqual({ dibuat: 0, dibatalkan: 1 });
    expect(sisaDok(await dok(), G.g5)).toBe(20_000_000);
  });

  it("tombol lama Tandai lunas membayar hutang GRN dikurangi jurnal retur pemasok (bukan hutang GRN penuh)", async () => {
    const { postSupplierPaymentJournal } = await import("./supplier-payment-journal");
    await buatPo("5", "CLOSED");
    await buatGrn("g7", "5", "2008-08-27", 300_000);
    const vr = await prisma.vendorReturn.create({
      data: { docNumber: `RET-BYR-${token}-5`, vendorId: pemasokId, lines: [], totalItems: 1, totalValue: 100_000, status: "COMPLETED", completedAt: tgl("2008-08-28"), createdById: userId, poId: P["5"], poCreditAmount: 100_000 },
      select: { id: true },
    });
    returIds.push(vr.id);
    await postJournal(prisma, {
      source: { type: "VENDOR_RETURN", id: vr.id },
      date: tgl("2008-08-28"),
      description: `uji retur 5 ${token}`,
      postedById: userId,
      lines: [
        { chartAccountId: A.HUTANG, debit: 100_000, credit: 0 },
        { chartAccountId: A.PERSEDIAAN, debit: 0, credit: 100_000 },
      ],
    });
    const r = await postSupplierPaymentJournal(P["5"], userId, tgl("2008-09-10"));
    expect(r.ok).toBe(true);
    expect((await jurnal("SUPPLIER_PAYMENT", `${P["5"]}#1`))!.baris).toEqual([
      ["BANK", 0, 200_000],
      ["HUTANG", 200_000, 0],
    ]);
    // Buku pembantu: GRN g7 lunas (retur 100.000 + tombol lama 200.000).
    expect(sisaDok(await dok(), G.g7)).toBe(0);
  });

  it("alokasi saldo awal hanya bila impor saldo awal hutang berlaku ada; buku pembantu membacanya per pemasok", async () => {
    expect(
      await w.catatPembayaranPemasok({ pemasokId, tanggal: "2008-09-08", cara: "TRANSFER", rekeningId: A.BANK, alokasi: [{ jenis: "OTHER", id: "SALDO_AWAL", jumlah: 1 }], olehUserId: userId, hariIni: HARI_INI }),
    ).toEqual({ ok: false, kode: "DOKUMEN_TIDAK_DITEMUKAN", baris: 1 });
    const h = await dok();
    expect(sisaDok(h, "SALDO_AWAL")).toBe(25_000_000);
  });
});
