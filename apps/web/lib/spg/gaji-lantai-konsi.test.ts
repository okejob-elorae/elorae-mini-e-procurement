import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { bayarKomisi, kunciAngka } from "@/lib/konsinyasi/writer";
import { pasanganPerluCatatan } from "./absen-catatan-hadir-queries";
import { bulanPesertaSpg } from "./gaji-pokok-queries";
import { hapusGajiUji, siapkanGajiUji } from "./gaji-pokok-uji";
import { REF_KOMISI_KONSI } from "./hilang";
import { daftarKomisiKantor } from "./komisi-queries";
import { pembayaranAkhir } from "./koreksi-akhir";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

/**
 * Bulan siklus pertama konsinyasi sebagai lantai bulan gaji SPG toko konsi (P59: bulan sebelumnya
 * ada di luar sistem dan tidak pernah bisa dikunci), terhadap basis data sungguhan. Dewi mulai
 * bekerja Juni, berhenti akhir September; siklus pertama di sistem September. Tanpa lantai, Juni–
 * Agustus menahan pembayaran terakhirnya selamanya (`SIKLUS_BELUM_DIBUKA`) dan sisa bebannya tidak
 * pernah menjadi utang (P6a). Bulan siklus pertama dipasang lewat hook tes `UJI_BULAN_SIKLUS_PERTAMA`.
 * Semua baris diseed di sini; penghapusan lewat `seededId(s)`.
 */
d("lantai bulan siklus pertama untuk gaji SPG toko konsi (test bed only)", () => {
  const tag = `GLK${Math.random().toString(36).slice(2, 8)}`;
  const sebelumnya = process.env.UJI_BULAN_SIKLUS_PERTAMA;
  let toko = "";
  let dewi = "";
  let kantor = "";
  let siklus = "";
  let beban = "";

  beforeEach(async () => {
    toko = "";
    dewi = "";
    kantor = "";
    siklus = "";
    beban = "";
    process.env.UJI_BULAN_SIKLUS_PERTAMA = "2026-09";
    kantor = (await prisma.user.create({ data: { email: `${tag}-kantor@test.local`, name: `Kantor ${tag}` } })).id;
    // Toko konsi selalu punya salesman pemegang (P47).
    toko = (await prisma.store.create({ data: { code: `${tag}-K`, name: `Toko ${tag}`, address: "uji", termsType: "KONSI", salesmanId: kantor } })).id;
    dewi = (
      await prisma.user.create({
        data: { email: `${tag}-dewi@test.local`, name: `Dewi ${tag}`, spgStartedOn: "2026-06-01", spgEndedOn: "2026-09-30", spgEndedStoreId: toko },
      })
    ).id;
    // Gaji bulanan sejak Juni; September punya dasar hari yang pasti (gaji Rp 0, bukan pokok tes ini).
    await prisma.spgSalary.create({ data: { userId: dewi, effectiveFrom: "2026-06", monthlyAmount: 3_500_000, createdById: kantor } });
    await siapkanGajiUji({ userId: dewi, storeId: toko, bulan: "2026-09", jumlah: 0, olehUserId: kantor });
    siklus = (await prisma.consignmentCycle.create({ data: { noKonsi: `${tag}/K`, storeId: toko, periodYear: 2026, periodMonth: 9 } })).id;
    for (const source of ["SPG", "TOKO"] as const) {
      await prisma.consignmentReport.create({ data: { cycleId: siklus, source, reportedAt: new Date(), items: { create: [{ itemName: `${tag} Blus`, qty: 0 }] } } });
    }
    // Beban retur pembeli yang lebih besar dari pembayarannya: sisanya harus menjadi utang SPG.
    beban = (
      await prisma.spgCharge.create({
        data: {
          spgUserId: dewi,
          storeId: toko,
          sourceKind: "KONSI",
          source: "RETUR_PEMBELI",
          sourceId: `${tag}-retur`,
          sourceDocNo: `${tag}/SPG/1`,
          spgSaleId: `${tag}-nota`,
          reportedAt: new Date("2026-09-20T03:00:00Z"),
          computedAmount: 50_000,
          amount: 50_000,
          note: "uji",
          createdById: kantor,
        },
      })
    ).id;
  });

  afterEach(async () => {
    if (sebelumnya === undefined) delete process.env.UJI_BULAN_SIKLUS_PERTAMA;
    else process.env.UJI_BULAN_SIKLUS_PERTAMA = sebelumnya;
    await prisma.auditLog.deleteMany({ where: { userId: seededId(kantor) } });
    await prisma.spgChargeDeduction.deleteMany({ where: { chargeId: seededId(beban) } });
    await prisma.spgCharge.deleteMany({ where: { id: seededId(beban) } });
    const utang = await prisma.spgDebt.findMany({ where: { spgUserId: seededId(dewi) }, select: { id: true } });
    await prisma.spgDebtSettlement.deleteMany({ where: { debtId: { in: seededIds(utang.map((u) => u.id)) } } });
    await prisma.spgDebt.deleteMany({ where: { spgUserId: seededId(dewi) } });
    await prisma.spgCommissionCorrection.deleteMany({ where: { spgUserId: seededId(dewi) } });
    await prisma.receivable.deleteMany({ where: { consignmentCycleId: seededId(siklus) } });
    await prisma.consignmentReportItem.deleteMany({ where: { report: { cycleId: seededId(siklus) } } });
    await prisma.consignmentReport.deleteMany({ where: { cycleId: seededId(siklus) } });
    await prisma.consignmentSold.deleteMany({ where: { cycleId: seededId(siklus) } });
    await prisma.consignmentCommission.deleteMany({ where: { cycleId: seededId(siklus) } });
    await prisma.consignmentCycle.deleteMany({ where: { id: seededId(siklus) } });
    await hapusGajiUji([dewi]);
    await prisma.store.deleteMany({ where: { id: seededId(toko) } });
    await prisma.user.deleteMany({ where: { id: { in: seededIds([dewi, kantor].filter(Boolean)) } } });
  });

  it("bulan sebelum siklus pertama bukan bulan gaji; pembayaran September menjadi yang terakhir dan sisa bebannya menjadi utang SPG", async () => {
    expect(await bulanPesertaSpg(prisma, dewi)).toEqual([{ storeId: toko, bulan: "2026-09" }]);

    const kunci = await kunciAngka({ cycleId: siklus, olehUserId: kantor, baris: [{ itemName: `${tag} Blus`, qty: 0, price: 0 }] });
    expect(kunci).toMatchObject({ ok: true, jumlahSpg: 1 });
    const baris = await prisma.consignmentCommission.findFirstOrThrow({ where: { cycleId: seededId(siklus), spgUserId: seededId(dewi) }, select: { id: true } });

    // Tanpa lantai (siklus pertama "0000-01"), Juni yang tidak pernah bisa dikunci menahannya.
    delete process.env.UJI_BULAN_SIKLUS_PERTAMA;
    expect(await pembayaranAkhir(prisma, { userId: dewi, refType: REF_KOMISI_KONSI, refId: baris.id })).toEqual({ akhir: false, sebab: "SIKLUS_BELUM_DIBUKA" });
    process.env.UJI_BULAN_SIKLUS_PERTAMA = "2026-09";
    expect(await pembayaranAkhir(prisma, { userId: dewi, refType: REF_KOMISI_KONSI, refId: baris.id })).toEqual({ akhir: true, sebab: null });

    // Pembayaran terakhir: Rp 0 dibayarkan, beban Rp 50.000 yang tidak tertutup menjadi utang (P6a).
    expect(await bayarKomisi({ commissionId: baris.id, olehUserId: kantor })).toMatchObject({ ok: true, dibayar: 0, utang: 50_000 });
    const utang = await prisma.spgDebt.findMany({ where: { spgUserId: seededId(dewi) }, select: { kind: true, amount: true, status: true, sourceKey: true } });
    expect(utang.map((u) => [u.kind, Number(u.amount), u.status, u.sourceKey])).toEqual([["RETUR_PEMBELI", 50_000, "TERBUKA", beban]]);
    expect((await prisma.spgCharge.findUniqueOrThrow({ where: { id: seededId(beban) }, select: { status: true } })).status).toBe("DIUTANGKAN");
  });

  it("catatan check-in toko tidak diminta untuk bulan sebelum siklus pertama", async () => {
    const sekarang = new Date("2026-11-05T09:00:00+07:00");
    expect(await pasanganPerluCatatan(sekarang, { userIds: [dewi] })).toEqual([]);
    // Tanpa lantai: Juni–Agustus (gaji bulanan sudah diatur, tanpa jadwal maupun catatan) diminta.
    delete process.env.UJI_BULAN_SIKLUS_PERTAMA;
    expect((await pasanganPerluCatatan(sekarang, { userIds: [dewi] })).map((p) => p.bulan).sort()).toEqual(["2026-06", "2026-07", "2026-08"]);
  });

  it("antrean 'menunggu kunci' kantor tidak memuat bulan sebelum siklus pertama (P59)", async () => {
    const sekarang = new Date("2026-11-05T09:00:00+07:00");
    const bulanToko = async () =>
      (await daftarKomisiKantor("2026-11", sekarang)).konsiMenungguKunci
        .filter((k) => k.storeId === toko)
        .map((k) => k.bulanJual)
        .sort();
    // Juni–Agustus di luar sistem: hanya September (siklusnya belum dikunci) yang menunggu.
    expect(await bulanToko()).toEqual(["2026-09"]);
    // Tanpa lantai, setiap bulan masa tugasnya menunggu kunci — termasuk bulan yang tidak pernah bisa dikunci.
    delete process.env.UJI_BULAN_SIKLUS_PERTAMA;
    expect(await bulanToko()).toEqual(["2026-06", "2026-07", "2026-08", "2026-09"]);
  });
});
