import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { getClaimsAwaitingVerification } from "./action-items";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

/**
 * Baris "BKM menunggu verifikasi" di Beranda hanya menghitung BKM yang BOLEH
 * diputuskan penontonnya: yang ia laporkan (salesmanId) atau catat (createdById)
 * sendiri menunggu admin keuangan lain (PEMERIKSA_SAMA). Basis data dipakai
 * bersama, jadi angkanya dibandingkan lewat selisih dengan penonton tanpa id.
 */
d("getClaimsAwaitingVerification (test bed only)", () => {
  let tag = "";
  let storeId = "";
  let salesId = "";
  let adminId = "";
  let claimIds: string[] = [];

  beforeEach(async () => {
    tag = `KMV-${Math.random().toString(36).slice(2, 10)}`;
    storeId = "";
    salesId = "";
    adminId = "";
    claimIds = [];
    const store = await prisma.store.create({
      data: { code: tag, name: `Toko ${tag}`, address: "-", termsType: "PUTUS", isActive: true },
    });
    storeId = store.id;
    salesId = (await prisma.user.create({ data: { email: `${tag}-s@test.local`, name: "Sales" } })).id;
    adminId = (await prisma.user.create({ data: { email: `${tag}-a@test.local`, name: "Admin" } })).id;
  });

  afterEach(async () => {
    await prisma.paymentClaim.deleteMany({ where: { id: { in: seededIds(claimIds) } } });
    await prisma.user.deleteMany({ where: { id: { in: seededIds([salesId, adminId].filter(Boolean)) } } });
    if (storeId) await prisma.store.delete({ where: { id: seededId(storeId) } });
  });

  async function klaim(n: number, salesmanId: string, createdById: string, nilai: number, status: "DIKIRIM" | "DITOLAK" = "DIKIRIM") {
    const k = await prisma.paymentClaim.create({
      data: {
        docNo: `${tag}-${n}`,
        storeId,
        salesmanId,
        createdById,
        claimedTransferAt: new Date(),
        invoiceAmount: nilai,
        receivedAmount: nilai,
        status,
      },
    });
    claimIds.push(k.id);
  }

  it("BKM yang dilaporkan atau dicatat penonton sendiri dipisah dari yang bisa ia putuskan", async () => {
    const sebelumAdmin = await getClaimsAwaitingVerification(adminId);
    const sebelumUmum = await getClaimsAwaitingVerification(null);

    await klaim(1, salesId, salesId, 100_000); // dilaporkan sales — admin boleh memutuskan
    await klaim(2, salesId, adminId, 250_000); // dicatat admin dari kantor — milik admin
    await klaim(3, adminId, adminId, 40_000); // dilaporkan admin sendiri — milik admin
    await klaim(4, salesId, adminId, 999_000, "DITOLAK"); // sudah diputuskan — tidak dihitung

    const admin = await getClaimsAwaitingVerification(adminId);
    const umum = await getClaimsAwaitingVerification(null);

    expect(admin.milikSendiri.count - sebelumAdmin.milikSendiri.count).toBe(2);
    expect(admin.milikSendiri.amount - sebelumAdmin.milikSendiri.amount).toBe(290_000);
    expect(admin.bisaDiputuskan.count - sebelumAdmin.bisaDiputuskan.count).toBe(1);
    expect(admin.bisaDiputuskan.amount - sebelumAdmin.bisaDiputuskan.amount).toBe(100_000);

    // Tanpa penonton semuanya "bisa diputuskan"; dua baris admin berjumlah sama dengan itu.
    expect(umum.milikSendiri).toEqual({ count: 0, amount: 0 });
    expect(umum.bisaDiputuskan.count - sebelumUmum.bisaDiputuskan.count).toBe(3);
    expect(admin.bisaDiputuskan.count + admin.milikSendiri.count).toBe(umum.bisaDiputuskan.count);
  });
});
