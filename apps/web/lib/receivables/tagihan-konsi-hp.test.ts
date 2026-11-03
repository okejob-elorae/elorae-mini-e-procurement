import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { fakturSiapJanji, fakturToko, janjiBerjalanDiToko, returSaya, tokoLapangan } from "./pwa-queries";
import { bahanKlaimBaru } from "./claim-queries";
import { daftarTugasTagih, tautanPesanKlaim, tugasTagihSaya } from "./tugas-tagih-queries";
import { putuskanKlaim, tautkanUlangPotongan } from "./writer";

/**
 * Tagihan konsinyasi di HP salesman, terhadap basis data sungguhan.
 *
 * Jawaban pemilik 2026-11-02: P18 "berikan selengkapnya saja" (nominal tagihan
 * konsi tampil di HP salesman), P31 "pemegang toko" (hanya untuk pemegang toko
 * SEKARANG), P57 (nilai nota retur toko konsi di daftar retur sales). Tagihan
 * siklusnya diseed langsung — penulis kunci siklus diuji di
 * `lib/konsinyasi/tagihan-siklus.test.ts`.
 *
 * Teardown hanya lewat `seededId()`; BKM, kontrabon, dan tugas dihapus
 * sebelum piutangnya, piutang SEBELUM siklusnya.
 */

const tag = `TKH-${Math.random().toString(36).slice(2, 8)}`;
let tokoId = "";
let siklusId = "";
let piutangId = "";
let returId = "";
let salesA = "";
let salesB = "";
let klaimId = "";
let kontrabonId = "";
let tugasId = "";

beforeEach(async () => {
  tokoId = "";
  siklusId = "";
  piutangId = "";
  returId = "";
  salesA = "";
  salesB = "";
  klaimId = "";
  kontrabonId = "";
  tugasId = "";
  salesA = (await prisma.user.create({ data: { email: `${tag.toLowerCase()}-a@uji.test`, name: `${tag} A` } })).id;
  salesB = (await prisma.user.create({ data: { email: `${tag.toLowerCase()}-b@uji.test`, name: `${tag} B` } })).id;
  tokoId = (
    await prisma.store.create({
      data: { code: tag, name: `${tag} Konsi`, address: "uji", termsType: "KONSI", salesmanId: salesA, paymentTempo: 30 },
    })
  ).id;
  siklusId = (
    await prisma.consignmentCycle.create({
      data: { noKonsi: `${tag}/KNS`, storeId: tokoId, periodYear: 2091, periodMonth: 3, noNota: `${tag}/NOTA`, lockedAt: new Date() },
    })
  ).id;
  piutangId = (
    await prisma.receivable.create({
      data: {
        invoiceNo: `${tag}/KNS`,
        storeId: tokoId,
        consignmentCycleId: siklusId,
        isConsignment: true,
        source: "DELIVERY",
        salesmanId: salesA,
        invoiceDate: new Date("2091-03-31T00:00:00+07:00"),
        dueDate: new Date("2091-05-10T00:00:00+07:00"),
        amount: 2_345_000,
        outstanding: 2_345_000,
        originalAmount: 2_345_000,
        outstandingAmount: 2_345_000,
      },
    })
  ).id;
  returId = (
    await prisma.storeReturn.create({
      data: { noNrt: `${tag}-NRT`, storeId: tokoId, salesmanId: salesA, claimDate: new Date(), claimedAmount: 876_000 },
    })
  ).id;
});

afterEach(async () => {
  // Jejak verifikasi dan penautan potongan ditulis penulisnya sendiri.
  if (klaimId) {
    await prisma.auditLog.deleteMany({ where: { entityType: "PaymentClaim", entityId: seededId(klaimId) } });
    const potongan = await prisma.paymentClaimDeduction.findMany({ where: { paymentClaimId: seededId(klaimId) }, select: { id: true } });
    await prisma.auditLog.deleteMany({ where: { entityType: "PaymentClaimDeduction", entityId: { in: potongan.map((p) => seededId(p.id)) } } });
  }
  // Tautan BKM–piutang, potongan, dan kontrabon–piutang ikut terhapus (onDelete Cascade).
  if (klaimId) await prisma.paymentClaim.delete({ where: { id: seededId(klaimId) } });
  if (kontrabonId) await prisma.collectionNote.delete({ where: { id: seededId(kontrabonId) } });
  if (tugasId) await prisma.collectionTask.delete({ where: { id: seededId(tugasId) } });
  if (returId) await prisma.storeReturn.delete({ where: { id: returId } });
  if (piutangId) await prisma.receivable.delete({ where: { id: piutangId } });
  if (siklusId) await prisma.consignmentCycle.delete({ where: { id: siklusId } });
  if (tokoId) await prisma.store.delete({ where: { id: tokoId } });
  await prisma.user.deleteMany({ where: { id: { in: [salesA, salesB].filter(Boolean).map(seededId) } } });
});

describe("tagihan konsinyasi di HP pemegang toko (P18/P31)", () => {
  it("Tagihan: toko konsi tampil dengan sisa tagihannya", async () => {
    const toko = (await tokoLapangan(salesA)).find((t) => t.storeId === tokoId);
    expect(toko).toMatchObject({ sisa: 2_345_000, jumlahFaktur: 1 });
  });

  it("faktur toko: bertanda konsinyasi, membawa nomor nota dan nominalnya", async () => {
    const r = await fakturToko(salesA, tokoId);
    expect(r?.baris).toHaveLength(1);
    expect(r!.baris[0]).toMatchObject({ konsi: true, asal: "SIKLUS_KONSI", nomorNotaKonsi: `${tag}/NOTA`, outstanding: 2_345_000 });
    expect(JSON.stringify(r)).toContain("2345000");
  });

  it("janji bayar: tagihan konsi bisa dijanjikan", async () => {
    const r = await fakturSiapJanji(salesA, tokoId);
    expect(r?.faktur.map((f) => f.id)).toEqual([piutangId]);
  });

  it("formulir BKM: toko ditandai konsi dan nota retur toko konsi tidak ditawarkan sebagai potongan", async () => {
    const b = await bahanKlaimBaru({ penagihId: salesA });
    expect(b.toko.find((t) => t.id === tokoId)).toMatchObject({ konsi: true });
    expect(b.returPerToko[tokoId]).toBeUndefined();
    expect(b.piutangPerToko[tokoId]?.map((p) => p.id)).toEqual([piutangId]);
  });
});

describe("tagihan konsinyasi TIDAK sampai ke sales lain (P31)", () => {
  it("sales yang bukan pemegang toko tidak melihat apa pun", async () => {
    expect((await tokoLapangan(salesB)).some((t) => t.storeId === tokoId)).toBe(false);
    expect(await fakturToko(salesB, tokoId)).toBeNull();
    const janji = await fakturSiapJanji(salesB, tokoId);
    expect(janji?.faktur ?? []).toEqual([]);
    const b = await bahanKlaimBaru({ penagihId: salesB });
    expect(b.toko.some((t) => t.id === tokoId)).toBe(false);
  });

  it("begitu toko dirotasi, pemegang baru yang melihatnya — penjual lama tidak lagi", async () => {
    await prisma.store.update({ where: { id: seededId(tokoId) }, data: { salesmanId: salesB } });
    expect((await tokoLapangan(salesB)).some((t) => t.storeId === tokoId)).toBe(true);
    expect((await tokoLapangan(salesA)).some((t) => t.storeId === tokoId)).toBe(false);
  });

  it("pemegang toko dikosongkan: tidak ada HP yang melihatnya — penjual saat dikunci pun tidak", async () => {
    // P47: toko konsi pasti punya pemegang, jadi ini kesalahan data — dan kesalahan data
    // tidak boleh membuka nominal konsi lewat jalur penjual (P31).
    await prisma.store.update({ where: { id: seededId(tokoId) }, data: { salesmanId: null } });
    for (const s of [salesA, salesB]) {
      expect((await tokoLapangan(s)).some((t) => t.storeId === tokoId)).toBe(false);
      expect(await fakturToko(s, tokoId)).toBeNull();
      expect((await fakturSiapJanji(s, tokoId))?.faktur ?? []).toEqual([]);
    }
  });

  it("tugas tagih yang ditugaskan sebelum rotasi tidak membawa tagihan konsi ke pemegang lama", async () => {
    tugasId = (
      await prisma.collectionTask.create({
        data: { assigneeId: salesA, storeId: tokoId, receivableIds: [piutangId], createdById: salesB, note: "uji" },
      })
    ).id;
    expect((await tugasTagihSaya(salesA)).find((t) => t.id === tugasId)?.totalSisa).toBe(2_345_000);

    await prisma.store.update({ where: { id: seededId(tokoId) }, data: { salesmanId: salesB } });
    const hpLama = await tugasTagihSaya(salesA);
    expect(hpLama.some((t) => t.id === tugasId)).toBe(false);
    expect(JSON.stringify(hpLama)).not.toContain(`${tag}/KNS`);
    // Layar kantor tetap melihat tugas itu utuh, supaya bisa dibatalkan atau dialihkan.
    const kantor = (await daftarTugasTagih({ storeId: tokoId })).find((t) => t.id === tugasId);
    expect(kantor?.faktur.map((f) => f.id)).toEqual([piutangId]);
    expect(kantor?.hilang).toBe(0);
  });

  it("kontrabon yang memegang tagihan konsi: hanya untuk pemegang toko", async () => {
    kontrabonId = (
      await prisma.collectionNote.create({
        data: {
          docNo: `${tag}/KB`,
          storeId: tokoId,
          salesmanId: salesA,
          handoverDate: new Date("2091-04-01T00:00:00+07:00"),
          promisedDate: new Date("2091-04-20T00:00:00+07:00"),
          amount: 2_345_000,
          receivableLinks: { create: [{ receivableId: piutangId, amount: 2_345_000 }] },
        },
      })
    ).id;
    expect((await janjiBerjalanDiToko(tokoId, salesA)).map((j) => j.id)).toEqual([kontrabonId]);
    expect(await janjiBerjalanDiToko(tokoId, salesB)).toEqual([]);
    // Pemanggil yang tidak menyebut penontonnya tidak pernah mendapat nominal konsi.
    expect(await janjiBerjalanDiToko(tokoId)).toEqual([]);
  });
});

describe("pesan WhatsApp ke toko konsinyasi sesudah BKM terverifikasi", () => {
  it("konfirmasi menyebut tagihan konsinyasinya lunas", async () => {
    klaimId = (
      await prisma.paymentClaim.create({
        data: {
          docNo: `${tag}/BKM`,
          storeId: tokoId,
          salesmanId: salesA,
          createdById: salesA,
          claimedTransferAt: new Date("2091-04-25T00:00:00+07:00"),
          method: "transfer",
          invoiceAmount: 2_345_000,
          receivedAmount: 2_345_000,
          status: "TERVERIFIKASI",
          receivableLinks: { create: [{ receivableId: piutangId, settledAmount: 2_345_000 }] },
        },
      })
    ).id;
    const t = (await tautanPesanKlaim([klaimId])).get(klaimId);
    expect(t?.jenis).toBe("KONFIRMASI");
    const pesan = decodeURIComponent(t!.url.split("?text=")[1]);
    expect(pesan).toMatch(new RegExp(`lunas:\\n• ${tag}/KNS`));
  });
});

describe("nilai nota retur toko konsinyasi (P57)", () => {
  it("HP salesman (nilaiKonsi) membawa nilainya; tanpa itu (HP SPG) tetap kosong", async () => {
    const salesman = (await returSaya(salesA, { termasukSpgTokoSaya: true, nilaiKonsi: true })).find((r) => r.id === returId);
    expect(salesman?.nilaiKlaim).toBe(876_000);
    const spg = (await returSaya(salesA)).find((r) => r.id === returId);
    expect(spg?.nilaiKlaim).toBeNull();
  });
});

describe("penjaga penulis BKM pada tagihan konsinyasi", () => {
  /** BKM sales pemegang atas tagihan siklus; diputuskan oleh `salesB` (bukan pelapornya). */
  const seedBkm = async (opsi: { giro?: boolean; potongan?: { storeReturnId: string | null } } = {}) => {
    klaimId = (
      await prisma.paymentClaim.create({
        data: {
          docNo: `${tag}/BKM-G`,
          storeId: tokoId,
          salesmanId: salesA,
          createdById: salesA,
          claimedTransferAt: new Date("2091-04-25T00:00:00+07:00"),
          method: opsi.giro ? "giro" : "transfer",
          ...(opsi.giro
            ? { giroNo: `${tag}-G1`, giroBank: "BCA", giroEffectiveDate: new Date("2091-04-30T00:00:00+07:00"), giroStatus: "MENUNGGU" }
            : {}),
          invoiceAmount: 1_000_000,
          deductionTotal: opsi.potongan ? 100_000 : 0,
          receivedAmount: opsi.potongan ? 900_000 : 1_000_000,
          receivableLinks: { create: [{ receivableId: piutangId, settledAmount: 1_000_000 }] },
          ...(opsi.potongan
            ? { deductions: { create: [{ name: "Retur", amount: 100_000, storeReturnId: opsi.potongan.storeReturnId }] } }
            : {}),
        },
      })
    ).id;
    return klaimId;
  };

  const keadaanKlaim = (id: string) =>
    prisma.paymentClaim.findUniqueOrThrow({ where: { id: seededId(id) }, select: { status: true, verifiedAt: true, giroStatus: true } });

  it("verifikasi BKM atas tagihan yang sudah dibatalkan atau dihapusbukukan ditolak PIUTANG_DIBATALKAN, tanpa menulis apa pun", async () => {
    const id = await seedBkm();
    for (const status of ["VOIDED", "WRITTEN_OFF"] as const) {
      await prisma.receivable.update({ where: { id: seededId(piutangId) }, data: { status } });
      expect(await putuskanKlaim({ paymentClaimId: id, keputusan: "TERVERIFIKASI", olehUserId: salesB })).toEqual({
        ok: false,
        alasan: "PIUTANG_DIBATALKAN",
      });
      expect(await keadaanKlaim(id)).toMatchObject({ status: "DIKIRIM", verifiedAt: null });
    }
    // Pembanding: tagihan yang masih hidup tetap bisa diverifikasi — penolakannya karena pembatalan.
    await prisma.receivable.update({ where: { id: seededId(piutangId) }, data: { status: "OUTSTANDING" } });
    expect(await putuskanKlaim({ paymentClaimId: id, keputusan: "TERVERIFIKASI", olehUserId: salesB })).toMatchObject({ ok: true });
  });

  it("giro cair atas tagihan yang sudah dibatalkan ditolak PIUTANG_DIBATALKAN dan gironya tetap menunggu", async () => {
    const id = await seedBkm({ giro: true });
    await prisma.receivable.update({ where: { id: seededId(piutangId) }, data: { status: "VOIDED" } });
    expect(await putuskanKlaim({ paymentClaimId: id, keputusan: "TERVERIFIKASI", giro: "CAIR", olehUserId: salesB })).toEqual({
      ok: false,
      alasan: "PIUTANG_DIBATALKAN",
    });
    expect(await keadaanKlaim(id)).toMatchObject({ status: "DIKIRIM", verifiedAt: null, giroStatus: "MENUNGGU" });
  });

  it("menautkan nota retur ke potongan BKM tagihan konsinyasi ditolak RETUR_TOKO_KONSI; melepas tautan selalu boleh", async () => {
    const id = await seedBkm({ potongan: { storeReturnId: null } });
    const p = await prisma.paymentClaimDeduction.findFirstOrThrow({ where: { paymentClaimId: seededId(id) }, select: { id: true } });
    expect(await tautkanUlangPotongan({ deductionId: p.id, storeReturnId: returId, alasan: "salah tautan", olehUserId: salesB })).toEqual({
      ok: false,
      alasan: "RETUR_TOKO_KONSI",
    });
    const sesudahTolak = await prisma.paymentClaimDeduction.findUniqueOrThrow({ where: { id: seededId(p.id) }, select: { storeReturnId: true } });
    expect(sesudahTolak.storeReturnId).toBeNull();
    expect(await prisma.auditLog.count({ where: { entityType: "PaymentClaimDeduction", entityId: seededId(p.id) } })).toBe(0);

    // Tautan lama yang terlanjur ada (sebelum penjaga ini) bisa dilepas.
    await prisma.paymentClaimDeduction.update({ where: { id: seededId(p.id) }, data: { storeReturnId: returId } });
    expect(await tautkanUlangPotongan({ deductionId: p.id, storeReturnId: null, alasan: "lepas retur konsi", olehUserId: salesB })).toMatchObject({
      ok: true,
    });
    const sesudahLepas = await prisma.paymentClaimDeduction.findUniqueOrThrow({ where: { id: seededId(p.id) }, select: { storeReturnId: true } });
    expect(sesudahLepas.storeReturnId).toBeNull();
  });
});
