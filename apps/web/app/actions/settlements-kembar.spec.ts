import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";

/*
 * Aksi jurnal settlement dipanggil langsung (tanpa tombol yang sudah dimatikan) untuk
 * kembaran: penjaga server harus menolaknya dengan SETTLEMENT_KEMBAR tanpa menulis apa pun.
 * auth/rbac dipalsukan; settlement dan jurnal memakai basis data uji sungguhan.
 */
const { mockAuth } = vi.hoisted(() => ({ mockAuth: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { postSettlementJournalAction } from "./settlements";

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("postSettlementJournalAction — settlement kembar (basis data uji)", () => {
  let token = "";
  let adminId = "";
  let settlementIds: string[] = [];

  async function buatSettlement(createdAt: Date, fileName: string): Promise<string> {
    const s = await prisma.settlement.create({
      data: {
        marketplace: "SHOPEE",
        seller: `aksi-kembar-${token}`,
        periodFrom: new Date("2026-07-01T00:00:00+07:00"),
        periodTo: new Date("2026-07-31T00:00:00+07:00"),
        fileName,
        uploadedById: adminId,
        status: "MATCHED",
        totalPendapatan: 1000,
        totalPengeluaran: 60,
        totalDilepas: 940,
        parsedNetTotal: 940,
        checksumOk: true,
        checksumVariance: 0,
        summaryRaw: {},
        sellerFeesRaw: [],
        adjustmentsRaw: [],
        createdAt,
      },
      select: { id: true },
    });
    settlementIds.push(s.id);
    return s.id;
  }

  beforeEach(async () => {
    token = "";
    adminId = "";
    settlementIds = [];
    token = Math.floor(Math.random() * 10_000_000).toString();
    const user = await prisma.user.create({
      data: { email: `test-aksi-settlement-kembar-${token}@test.local`, name: "Uji Aksi Kembar" },
    });
    adminId = user.id;
    mockAuth.mockReset();
    mockAuth.mockResolvedValue({ user: { id: adminId, permissions: ["*"] } });
  });

  afterEach(async () => {
    const jurnal = await prisma.journal.findMany({
      where: { sourceType: "SETTLEMENT", sourceId: { in: seededIds(settlementIds) } },
      select: { id: true },
    });
    const jurnalIds = jurnal.map((j) => j.id);
    await prisma.journalLine.deleteMany({ where: { journalId: { in: seededIds(jurnalIds) } } });
    await prisma.journal.deleteMany({ where: { id: { in: seededIds(jurnalIds) } } });
    await prisma.settlement.deleteMany({ where: { id: { in: seededIds(settlementIds) } } });
    if (adminId) await prisma.user.delete({ where: { id: seededId(adminId) } });
  });

  it("menolak kembaran yang diunggah belakangan dan tidak menulis jurnal maupun status", async () => {
    const asli = await buatSettlement(new Date("2026-08-01T03:00:00Z"), "asli.xlsx");
    const kembar = await buatSettlement(new Date("2026-08-02T03:00:00Z"), "kembar.xlsx");

    const hasil = await postSettlementJournalAction(kembar);

    expect(hasil).toMatchObject({ ok: false, code: "SETTLEMENT_KEMBAR", pertamaId: asli });
    expect(
      await prisma.journal.count({ where: { sourceType: "SETTLEMENT", sourceId: seededId(kembar) } }),
    ).toBe(0);
    const s = await prisma.settlement.findUniqueOrThrow({ where: { id: kembar }, select: { status: true } });
    expect(s.status).toBe("MATCHED");
  });
});
