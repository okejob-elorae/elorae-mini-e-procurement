import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { JENIS_SALDO_AWAL, kunciJenis } from "./jenis";
import { hitungHutangPemasokAwal, hitungPiutangMarketplaceAwal, hitungPiutangTokoAwal } from "./hitung-queries";
import { postingSaldoAwal } from "./writer";

/*
 * Angka saldo awal yang dihitung dari modul (piutang toko, piutang
 * marketplace, hutang pemasok) dan postingnya. Selalu dengan cakupan id
 * dokumen milik tes; pemetaan peran dipalsukan (`resolveAccount`).
 */

const peta = vi.hoisted(() => new Map<string, string>());
vi.mock("@/lib/finance/journals/mapping", async (asli) => {
  const m = await asli<typeof import("@/lib/finance/journals/mapping")>();
  return {
    ...m,
    resolveAccount: vi.fn(async (role: string) => {
      const id = peta.get(role);
      if (!id) throw new m.UnmappedRoleError(role);
      return id;
    }),
  };
});

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3306") || url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const MULAI = new Date("2091-03-01T00:00:00.000+07:00");
const tgl = (s: string) => new Date(`${s}T10:00:00.000+07:00`);

d("hitungan saldo awal dari modul (basis data uji)", () => {
  let token = "";
  let userId = "";
  let akun: Record<string, string> = {};
  let tokoPutusId = "";
  let tokoKonsiId = "";
  let piutangIds: string[] = [];
  let klaimIds: string[] = [];
  let pembayaranIds: string[] = [];
  let orderIds: string[] = [];
  let tipePemasokId = "";
  let pemasokIds: string[] = [];
  let grnIds: string[] = [];
  /* Diisi di beforeEach (butuh token dan id pemasok); kasus yang butuh dokumen tambahan memakainya. */
  let piutang: (
    no: string,
    storeId: string,
    tanggal: string,
    amount: number,
    lain?: { isConsignment?: boolean; status?: "VOIDED" },
  ) => Promise<string> = async () => {
    throw new Error("piutang dipanggil sebelum beforeEach");
  };
  let grn: (
    n: string,
    tanggal: string,
    total: number,
    lain?: {
      requiresNoPoConfirmation?: boolean;
      noPoConfirmedAt?: Date;
      noPoConfirmedById?: string;
      requiresOwnerApproval?: boolean;
      ownerDeclinedAt?: Date;
    },
  ) => Promise<string> = async () => {
    throw new Error("grn dipanggil sebelum beforeEach");
  };

  beforeEach(async () => {
    token = "";
    userId = "";
    akun = {};
    tokoPutusId = "";
    tokoKonsiId = "";
    piutangIds = [];
    klaimIds = [];
    pembayaranIds = [];
    orderIds = [];
    tipePemasokId = "";
    pemasokIds = [];
    grnIds = [];
    peta.clear();

    token = Math.floor(Math.random() * 1e6).toString().padStart(6, "0");
    userId = (await prisma.user.create({ data: { email: `saldo-awal-hitung-${token}@test.local`, name: "Uji hitung" } })).id;
    const buat = async (n: string, type: "ASET" | "LIABILITAS" | "EKUITAS") =>
      (await prisma.chartAccount.create({ data: { code: `94${token}${n}`, name: `Akun ${n} (uji)`, type, depth: 1 } })).id;
    akun = { ekuitas: await buat("01", "EKUITAS"), arToko: await buat("02", "ASET"), arMp: await buat("03", "ASET"), ap: await buat("04", "LIABILITAS") };
    peta.set("OPENING_EQUITY", akun.ekuitas);
    peta.set("AR_STORE", akun.arToko);
    peta.set("AR", akun.arMp);
    peta.set("AP", akun.ap);

    // ── Piutang toko ──
    tokoPutusId = (await prisma.store.create({ data: { code: `SA-${token}-P`, name: `Toko ${token}`, address: "uji", termsType: "PUTUS" } })).id;
    tokoKonsiId = (await prisma.store.create({ data: { code: `SA-${token}-K`, name: `Konsi ${token}`, address: "uji", termsType: "KONSI" } })).id;
    piutang = async (no, storeId, tanggal, amount, lain = {}) =>
      (
        await prisma.receivable.create({
          data: { invoiceNo: `SA-${token}-${no}`, storeId, invoiceDate: tgl(tanggal), dueDate: tgl(tanggal), amount, outstanding: 999, source: "MANUAL", ...lain },
        })
      ).id;
    const r1 = await piutang("R1", tokoPutusId, "2091-01-10", 5_000_000);
    const r2 = await piutang("R2", tokoPutusId, "2091-02-01", 1_000_000);
    const r3 = await piutang("R3", tokoPutusId, "2091-03-05", 7_000_000); // sesudah tanggal mulai
    const r4 = await piutang("R4", tokoKonsiId, "2091-01-10", 9_000_000, { isConsignment: true }); // tagihan konsinyasi
    piutangIds = [r1, r2, r3, r4];
    const klaim = async (no: string, receivableId: string, nilai: number, verifiedAt: string | null, status: "TERVERIFIKASI" | "DIKIRIM") => {
      const k = await prisma.paymentClaim.create({
        data: {
          docNo: `SA-${token}-${no}`,
          storeId: tokoPutusId,
          salesmanId: userId,
          createdById: userId,
          claimedTransferAt: tgl("2091-02-01"),
          invoiceAmount: nilai,
          receivedAmount: nilai,
          status,
          verifiedAt: verifiedAt ? tgl(verifiedAt) : null,
          receivableLinks: { create: { receivableId, settledAmount: nilai } },
        },
      });
      klaimIds.push(k.id);
    };
    await klaim("K1", r1, 2_000_000, "2091-02-10", "TERVERIFIKASI"); // sebelum mulai → mengurangi
    await klaim("K2", r2, 1_000_000, "2091-03-05", "TERVERIFIKASI"); // sesudah mulai → belum mengurangi
    await klaim("K3", r1, 500_000, null, "DIKIRIM"); // belum diverifikasi → tidak pernah mengurangi

    // ── Pesanan marketplace ──
    const pesanan = async (n: number, channel: "SHOPEE" | "TIKTOK", grandTotal: number, shippedAt: string, lain: { isCanceled?: boolean } = {}) =>
      (
        await prisma.salesOrder.create({
          data: {
            salesorderId: 900_000_000 + Number(token) * 10 + n,
            salesorderNo: `SA-${token}-SO${n}`,
            channel,
            sourceName: channel,
            status: "COMPLETED",
            subTotal: grandTotal,
            totalDisc: 0,
            totalTax: 0,
            shippingCost: 0,
            grandTotal,
            transactionDate: tgl(shippedAt),
            shippedAt: tgl(shippedAt),
            ...lain,
          },
        })
      ).id;
    const a = await pesanan(1, "SHOPEE", 100_000, "2091-02-10");
    const b = await pesanan(2, "TIKTOK", 200_000, "2091-02-15"); // cair sebelum mulai
    const c = await pesanan(3, "SHOPEE", 300_000, "2091-03-02"); // dikirim sesudah mulai
    const dd = await pesanan(4, "TIKTOK", 400_000, "2091-02-20"); // settlement-nya berakhir sesudah mulai → masih piutang
    const e = await pesanan(5, "SHOPEE", 500_000, "2091-02-11", { isCanceled: true });
    orderIds = [a, b, c, dd, e];
    await prisma.settlement.create({
      data: {
        marketplace: "TIKTOK",
        seller: "uji",
        periodFrom: tgl("2091-02-16"),
        periodTo: tgl("2091-02-20"),
        fileName: `SA-${token}.xlsx`,
        uploadedById: userId,
        totalPendapatan: 0,
        totalPengeluaran: 0,
        totalDilepas: 0,
        parsedNetTotal: 0,
        checksumOk: true,
        checksumVariance: 0,
        summaryRaw: {},
        sellerFeesRaw: {},
        adjustmentsRaw: {},
        lines: {
          create: [
            { orderNo: `SA-${token}-SO2`, netIncome: 0, hargaAsliProduk: 0, totalDiskonProduk: 0, biayaAdministrasi: 0, biayaLayanan: 0, biayaKomisiAms: 0, biayaProsesPesanan: 0, raw: {}, matchStatus: "MATCHED", matchedSalesOrderId: b },
          ],
        },
      },
    });
    // Settlement kedua (berakhir sesudah mulai) untuk pesanan 4: tidak mengeluarkannya.
    await prisma.settlementLine.create({
      data: {
        settlement: {
          create: {
            marketplace: "TIKTOK",
            seller: "uji-2",
            periodFrom: tgl("2091-02-25"),
            periodTo: tgl("2091-03-05"),
            fileName: `SA-${token}-2.xlsx`,
            uploadedById: userId,
            totalPendapatan: 0,
            totalPengeluaran: 0,
            totalDilepas: 0,
            parsedNetTotal: 0,
            checksumOk: true,
            checksumVariance: 0,
            summaryRaw: {},
            sellerFeesRaw: {},
            adjustmentsRaw: {},
          },
        },
        orderNo: `SA-${token}-SO4`,
        netIncome: 0,
        hargaAsliProduk: 0,
        totalDiskonProduk: 0,
        biayaAdministrasi: 0,
        biayaLayanan: 0,
        biayaKomisiAms: 0,
        biayaProsesPesanan: 0,
        raw: {},
        matchStatus: "MATCHED",
        matchedSalesOrderId: dd,
      },
    });

    // ── Hutang pemasok ──
    tipePemasokId = (await prisma.supplierType.create({ data: { code: `ST-SA-${token}`, name: "Uji" } })).id;
    const pemasok = async (n: string) => (await prisma.supplier.create({ data: { code: `SUP-SA-${token}-${n}`, name: `Pemasok ${n} ${token}`, typeId: tipePemasokId } })).id;
    pemasokIds = [await pemasok("A"), await pemasok("B")];
    grn = async (n, tanggal, total, lain = {}) =>
      (
        await prisma.gRN.create({
          data: { docNumber: `GRN-SA-${token}-${n}`, supplierId: pemasokIds[0], grnDate: tgl(tanggal), receivedBy: "uji", totalAmount: total, items: [], ...lain },
        })
      ).id;
    grnIds = [await grn("1", "2091-02-05", 4_860_000), await grn("2", "2091-03-03", 1_000_000)];
  }, 60_000);

  afterEach(async () => {
    const jurnal = await prisma.journal.findMany({ where: { postedById: seededId(userId) }, select: { id: true } });
    await prisma.journal.deleteMany({ where: { id: { in: seededIds(jurnal.map((j) => j.id)) } } });
    if (token) await prisma.openingBalanceImport.deleteMany({ where: { kind: { in: seededIds(JENIS_SALDO_AWAL.map((j) => kunciJenis(j, `uji-hitung-${token}`))) } } });
    await prisma.auditLog.deleteMany({ where: { userId: seededId(userId) } });
    await prisma.gRN.deleteMany({ where: { id: { in: seededIds(grnIds) } } });
    await prisma.supplier.deleteMany({ where: { id: { in: seededIds(pemasokIds) } } });
    if (tipePemasokId) await prisma.supplierType.delete({ where: { id: seededId(tipePemasokId) } });
    await prisma.settlementLine.deleteMany({ where: { matchedSalesOrderId: { in: seededIds(orderIds) } } });
    await prisma.settlement.deleteMany({ where: { uploadedById: seededId(userId) } });
    await prisma.salesOrder.deleteMany({ where: { id: { in: seededIds(orderIds) } } });
    await prisma.paymentAllocation.deleteMany({ where: { paymentId: { in: seededIds(pembayaranIds) } } });
    await prisma.payment.deleteMany({ where: { id: { in: seededIds(pembayaranIds) } } });
    await prisma.paymentClaimReceivable.deleteMany({ where: { paymentClaimId: { in: seededIds(klaimIds) } } });
    await prisma.paymentClaim.deleteMany({ where: { id: { in: seededIds(klaimIds) } } });
    await prisma.receivable.deleteMany({ where: { id: { in: seededIds(piutangIds) } } });
    await prisma.store.deleteMany({ where: { id: { in: [seededId(tokoPutusId), seededId(tokoKonsiId)] } } });
    await prisma.chartAccount.deleteMany({ where: { id: { in: seededIds(Object.values(akun)) } } });
    if (userId) await prisma.user.delete({ where: { id: seededId(userId) } });
  }, 60_000);

  it("piutang toko: sisa per tanggal mulai — hanya BKM terverifikasi SEBELUM tanggal mulai mengurangi; konsinyasi dan faktur sesudahnya tidak ikut", async () => {
    const baris = await hitungPiutangTokoAwal(MULAI, { storeIds: [tokoPutusId, tokoKonsiId] });
    expect(baris).toEqual([{ storeId: tokoPutusId, kode: `SA-${token}-P`, nama: `Toko ${token}`, faktur: 2, jumlah: 3_000_000 + 1_000_000 }]);
  });

  it("piutang toko: tanda konsinyasi di FAKTURNYA yang menentukan, bukan syarat toko hari ini; faktur dibatalkan tidak ikut", async () => {
    // Faktur putus yang tercatat sebelum toko pindah ke konsinyasi tetap piutang toko.
    const r5 = await piutang("R5", tokoKonsiId, "2091-01-20", 2_500_000);
    const r6 = await piutang("R6", tokoPutusId, "2091-01-25", 800_000, { status: "VOIDED" });
    piutangIds.push(r5, r6);
    const baris = await hitungPiutangTokoAwal(MULAI, { storeIds: [tokoPutusId, tokoKonsiId] });
    expect(baris).toEqual([
      { storeId: tokoKonsiId, kode: `SA-${token}-K`, nama: `Konsi ${token}`, faktur: 1, jumlah: 2_500_000 },
      { storeId: tokoPutusId, kode: `SA-${token}-P`, nama: `Toko ${token}`, faktur: 2, jumlah: 3_000_000 + 1_000_000 },
    ]);
  });

  it("piutang toko: pembayaran kantor POSTED sebelum tanggal mulai mengurangi; sesudahnya dan yang dibatalkan tidak", async () => {
    const bayar = async (no: string, receivableId: string, nilai: number, paidAt: string, status: "POSTED" | "VOIDED") => {
      const p = await prisma.payment.create({
        data: {
          docNo: `SA-${token}-${no}`,
          storeId: tokoPutusId,
          paidAt: tgl(paidAt),
          method: "TRANSFER",
          amount: nilai,
          status,
          recordedById: userId,
          allocations: { create: [{ receivableId, amount: nilai }] },
        },
      });
      pembayaranIds.push(p.id);
    };
    const [r1, r2] = piutangIds;
    await bayar("P1", r2, 400_000, "2091-02-15", "POSTED"); // sebelum mulai → mengurangi
    await bayar("P2", r1, 300_000, "2091-03-02", "POSTED"); // sesudah mulai → dijurnal sendiri
    await bayar("P3", r1, 250_000, "2091-02-20", "VOIDED"); // dibatalkan → tidak pernah mengurangi
    const baris = await hitungPiutangTokoAwal(MULAI, { storeIds: [tokoPutusId, tokoKonsiId] });
    expect(baris).toEqual([{ storeId: tokoPutusId, kode: `SA-${token}-P`, nama: `Toko ${token}`, faktur: 2, jumlah: 3_000_000 + 600_000 }]);
  });

  it("piutang toko: faktur yang jurnal fakturnya mendebit AR (bentuk lama) sudah di buku besar, tidak ikut saldo awal", async () => {
    // Tanpa memo peran di baris debitnya = bentuk lama, yang mendebit AR.
    await prisma.journal.create({
      data: {
        date: tgl("2091-01-10"),
        description: "uji faktur bentuk lama",
        sourceType: "STORE_INVOICE",
        sourceId: piutangIds[0],
        postedById: userId,
        lines: { create: [{ chartAccountId: akun.arMp, debit: 5_000_000, credit: 0 }, { chartAccountId: akun.ekuitas, debit: 0, credit: 5_000_000 }] },
      },
    });
    const baris = await hitungPiutangTokoAwal(MULAI, { storeIds: [tokoPutusId, tokoKonsiId] });
    expect(baris).toEqual([{ storeId: tokoPutusId, kode: `SA-${token}-P`, nama: `Toko ${token}`, faktur: 1, jumlah: 1_000_000 }]);
  });

  it("piutang marketplace: terkirim sebelum mulai dan belum cair per tanggal mulai, per kanal", async () => {
    const baris = await hitungPiutangMarketplaceAwal(MULAI, { orderIds });
    expect(baris).toEqual([
      { kanal: "SHOPEE", pesanan: 1, jumlah: 100_000 },
      { kanal: "TIKTOK", pesanan: 1, jumlah: 400_000 },
    ]);
  });

  it("piutang marketplace: pesanan yang sudah berjurnal pendapatan dilewati", async () => {
    await prisma.journal.create({
      data: {
        date: tgl("2091-02-10"),
        description: "uji pendapatan",
        sourceType: "SALESORDER_REVENUE",
        sourceId: orderIds[0],
        postedById: userId,
        lines: { create: [{ chartAccountId: akun.arMp, debit: 100_000, credit: 0 }, { chartAccountId: akun.ekuitas, debit: 0, credit: 100_000 }] },
      },
    });
    const baris = await hitungPiutangMarketplaceAwal(MULAI, { orderIds });
    expect(baris).toEqual([{ kanal: "TIKTOK", pesanan: 1, jumlah: 400_000 }]);
  });

  it("hutang: GRN sebelum mulai yang belum lunas dan belum berjurnal", async () => {
    expect(await hitungHutangPemasokAwal(MULAI, { grnIds })).toEqual([
      { supplierId: pemasokIds[0], kode: `SUP-SA-${token}-A`, nama: `Pemasok A ${token}`, grn: 1, jumlah: 4_860_000 },
    ]);
  });

  it("hutang: GRN tanpa PO baru menjadi utang sesudah dikonfirmasi admin; yang masih menunggu dan yang ditolak pemilik tidak ikut", async () => {
    grnIds.push(
      await grn("3", "2091-02-06", 700_000, { requiresNoPoConfirmation: true }),
      await grn("4", "2091-02-07", 300_000, { requiresNoPoConfirmation: true, noPoConfirmedAt: tgl("2091-02-08"), noPoConfirmedById: userId }),
      await grn("5", "2091-02-09", 900_000, { requiresOwnerApproval: true, ownerDeclinedAt: tgl("2091-02-10") }),
    );
    expect(await hitungHutangPemasokAwal(MULAI, { grnIds })).toEqual([
      { supplierId: pemasokIds[0], kode: `SUP-SA-${token}-A`, nama: `Pemasok A ${token}`, grn: 2, jumlah: 4_860_000 + 300_000 },
    ]);
  });

  it("posting piutang toko (storeId di baris), marketplace (kanal, koreksi wajib beralasan), dan hutang (tambah pemasok)", async () => {
    const ruang = `uji-hitung-${token}`;
    const uji = { ruang, tanggalMulai: MULAI, lingkup: { storeIds: [tokoPutusId, tokoKonsiId], orderIds, grnIds } };

    const toko = await postingSaldoAwal({ jenis: "AR_STORE", baris: [{ storeId: "bohong", jumlah: 1 }], olehUserId: userId, uji });
    expect(toko).toMatchObject({ ok: true, ekuitas: 4_000_000 });
    if (toko.ok) {
      const lines = await prisma.journalLine.findMany({ where: { journalId: toko.journalId! } });
      expect(lines.find((l) => l.chartAccountId === akun.arToko)).toMatchObject({ storeId: tokoPutusId });
      expect(Number(lines.find((l) => l.chartAccountId === akun.arToko)!.debit)).toBe(4_000_000);
    }

    const tanpaAlasan = await postingSaldoAwal({
      jenis: "AR_MARKETPLACE",
      baris: [{ kanal: "SHOPEE", jumlah: 90_000 }],
      olehUserId: userId,
      uji,
    });
    expect(tanpaAlasan).toEqual({ ok: false, kode: "ALASAN_KOREKSI_WAJIB" });
    const mp = await postingSaldoAwal({
      jenis: "AR_MARKETPLACE",
      baris: [{ kanal: "SHOPEE", jumlah: 90_000 }],
      catatan: "Satu pesanan Shopee dikembalikan pembeli",
      olehUserId: userId,
      uji,
    });
    expect(mp).toMatchObject({ ok: true, ekuitas: 490_000 });
    if (mp.ok) {
      const lines = await prisma.journalLine.findMany({ where: { journalId: mp.journalId!, chartAccountId: akun.arMp }, orderBy: { debit: "asc" } });
      expect(lines.map((l) => [l.channel, Number(l.debit)])).toEqual([
        ["SHOPEE", 90_000],
        ["TIKTOK", 400_000],
      ]);
      const rec = await prisma.openingBalanceImport.findUniqueOrThrow({ where: { id: mp.importId } });
      expect((rec.entries as { baris: unknown[] }).baris).toEqual([
        { kanal: "SHOPEE", pesanan: 1, jumlah: 90_000, dihitung: 100_000 },
        { kanal: "TIKTOK", pesanan: 1, jumlah: 400_000, dihitung: 400_000 },
      ]);
    }

    const ap = await postingSaldoAwal({
      jenis: "AP",
      baris: [{ supplierId: pemasokIds[1], jumlah: 1_000_000 }],
      catatan: "Nota pemasok B belum masuk sistem",
      olehUserId: userId,
      uji,
    });
    expect(ap).toMatchObject({ ok: true, ekuitas: -5_860_000 });
    expect(
      await postingSaldoAwal({ jenis: "AP", baris: [{ supplierId: "tidak-ada", jumlah: 1 }], catatan: "x", olehUserId: userId, uji }),
    ).toMatchObject({ ok: false, kode: "PEMASOK_TIDAK_DIKENAL" });
  }, 60_000);
});
