import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";

/*
 * Dasbor Plan Kerja — angka "Sudah ada PO" (2026-10-07), terhadap basis data
 * uji: qty tahap yang punya ≥ 1 PO tidak batal, per jenis (induk = jumlah
 * turunan) dan total; null bagi penonton tanpa `purchase_orders:view`. Sesi
 * ditiru; plan, kategori, tahap, dan PO diseed dengan tahun dan kode acak, dan
 * dibersihkan lewat id yang diseed saja.
 */

const keadaan = vi.hoisted(() => ({ izin: ["production_planning:view", "purchase_orders:view"] as string[] }));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "u-dasbor", permissions: keadaan.izin } })) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/app/actions/production", () => ({ createWorkOrder: vi.fn() }));

const { getPlanDashboard } = await import("./planning");

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

const tag = `DPO-${Math.random().toString(36).slice(2, 9)}`;

d("getPlanDashboard — Sudah ada PO (test bed only)", () => {
  let user = "";
  let jenis = "";
  let pemasok = "";
  let planYear = "";
  let induk = "";
  let anakA = "";
  let anakB = "";
  const tahapIds: string[] = [];
  const poIds: string[] = [];

  beforeAll(async () => {
    user = jenis = pemasok = planYear = induk = anakA = anakB = "";
    user = (await prisma.user.create({ data: { email: `${tag}@test.local`.toLowerCase(), name: `Dasbor ${tag}` } })).id;
    jenis = (await prisma.supplierType.create({ data: { code: tag, name: `Jenis ${tag}` } })).id;
    pemasok = (await prisma.supplier.create({ data: { code: tag, name: `Kain ${tag}`, typeId: jenis, status: "ACTIVE" } })).id;
    let tahun = 2050 + Math.floor(Math.random() * 50);
    while (await prisma.planYear.findUnique({ where: { year: tahun }, select: { id: true } })) tahun = 2050 + ((tahun - 2049) % 50);
    planYear = (await prisma.planYear.create({ data: { year: tahun, createdById: user } })).id;
    induk = (await prisma.planCategory.create({ data: { planYearId: planYear, code: `${tag}-K`, name: `Kaos ${tag}` } })).id;
    anakA = (await prisma.planCategory.create({ data: { planYearId: planYear, code: `${tag}-KP`, name: `Pendek ${tag}`, parentId: induk } })).id;
    anakB = (await prisma.planCategory.create({ data: { planYearId: planYear, code: `${tag}-KL`, name: `Panjang ${tag}`, parentId: induk } })).id;

    const tahap = async (planCategoryId: string, targetQty: number) => {
      const t = await prisma.planStage.create({ data: { planCategoryId, name: `Tahap ${tag} ${tahapIds.length + 1}`, targetQty } });
      tahapIds.push(t.id);
      return t.id;
    };
    const po = async (planStageId: string, status: "DRAFT" | "SUBMITTED" | "CANCELLED") => {
      const p = await prisma.purchaseOrder.create({
        data: { docNumber: `PO-${tag}-${poIds.length + 1}`, supplierId: pemasok, status, createdById: user, planStageId },
      });
      poIds.push(p.id);
    };
    const a1 = await tahap(anakA, 1000);
    const a2 = await tahap(anakA, 500);
    const b1 = await tahap(anakB, 300);
    await tahap(anakB, 200);
    await po(a1, "SUBMITTED");
    await po(a2, "CANCELLED");
    await po(b1, "DRAFT");
    await po(b1, "SUBMITTED");
  });

  afterAll(async () => {
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: seededIds(poIds) } } });
    await prisma.planStage.deleteMany({ where: { id: { in: seededIds(tahapIds) } } });
    await prisma.planCategory.deleteMany({ where: { id: { in: seededIds([anakA, anakB].filter(Boolean)) } } });
    await prisma.planCategory.deleteMany({ where: { id: seededId(induk) } });
    await prisma.planYear.deleteMany({ where: { id: seededId(planYear) } });
    await prisma.supplier.deleteMany({ where: { id: seededId(pemasok) } });
    await prisma.supplierType.deleteMany({ where: { id: seededId(jenis) } });
    await prisma.user.deleteMany({ where: { id: seededId(user) } });
  });

  it("per jenis dan total: tahap dengan PO tidak batal (DRAFT ikut), dihitung sekali; induk menjumlah turunannya", async () => {
    keadaan.izin = ["production_planning:view", "purchase_orders:view"];
    const dasbor = await getPlanDashboard(planYear);
    const per = Object.fromEntries(dasbor.rows.map((r) => [r.id, r.sudahAdaPo]));
    expect(per[anakA]).toBe(1000);
    expect(per[anakB]).toBe(300);
    expect(per[induk]).toBe(1300);
    expect(dasbor.kpi.sudahAdaPo).toBe(1300);
  });

  it("tanpa purchase_orders:view: angka PO null, bukan nol", async () => {
    keadaan.izin = ["production_planning:view"];
    const dasbor = await getPlanDashboard(planYear);
    expect(dasbor.kpi.sudahAdaPo).toBeNull();
    expect(dasbor.rows.filter((r) => [induk, anakA, anakB].includes(r.id)).map((r) => r.sudahAdaPo)).toEqual([null, null, null]);
  });
});
