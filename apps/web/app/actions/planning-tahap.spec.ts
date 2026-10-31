import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Tambah/ubah tahap Plan Kerja dengan bulan target dan varian (2026-10-07).
 * Dulu varian tahap manual tidak bisa diisi sama sekali, sehingga "Buat WO"
 * dari tahap itu selalu ditolak TAHAP_TANPA_VARIAN. Kini varian dipilih dari
 * varian barang jadi jenis (leaf) itu dan divalidasi di server; bulan 1–12.
 * Tanpa basis data: transaksi serializable dan prisma ditiru.
 */

type Tahap = {
  id: string;
  planCategoryId: string;
  name: string;
  targetQty: number;
  targetMonth: number | null;
  variantSku: string | null;
  supplierId: string | null;
  fabricNotes: string | null;
  colorNotes: string | null;
  workOrderId: string | null;
};

const keadaan = vi.hoisted(() => ({
  izin: ["*"] as string[],
  plan: { status: "DRAFT", isLocked: false },
  barang: { id: "fg1", type: "FINISHED_GOOD", variants: null as unknown } as null | {
    id: string;
    type: string;
    variants: unknown;
  },
  kategoriAda: true,
  /** Jenis pemasok per id (TAILOR = penjahit). */
  pemasok: { v1: "TAILOR", v2: "TAILOR", kain: "FABRIC" } as Record<string, string>,
  tahap: new Map<string, Tahap>(),
  wo: null as null | { docNumber: string; status: string },
  jejak: [] as Array<Record<string, unknown>>,
  diubah: [] as Array<{ id: string; data: Record<string, unknown> }>,
  woDibuat: [] as unknown[],
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: "u1", permissions: keadaan.izin } })),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(async () => {}) }));
vi.mock("@/app/actions/production", () => ({
  createWorkOrder: vi.fn(async (data: unknown) => {
    keadaan.woDibuat.push(data);
    return { id: "wo-baru", docNumber: "WO/2026/0100" };
  }),
}));

const tx = vi.hoisted(() => ({
  planCategory: {
    findUnique: async () => {
      if (!keadaan.kategoriAda) return null;
      return {
        planYear: { ...keadaan.plan },
        item: keadaan.barang ? { variants: keadaan.barang.variants } : null,
      };
    },
  },
  planStage: {
    count: async () => keadaan.tahap.size,
    create: async ({ data }: { data: Omit<Tahap, "id" | "workOrderId"> }) => {
      const baru: Tahap = { ...data, id: `t${keadaan.tahap.size + 1}`, workOrderId: null };
      keadaan.tahap.set(baru.id, baru);
      return baru;
    },
    findUnique: async ({ where }: { where: { id: string } }) => {
      const t = keadaan.tahap.get(where.id);
      if (!t) return null;
      return {
        ...t,
        planCategory: {
          planYear: { ...keadaan.plan },
          item: keadaan.barang ? { variants: keadaan.barang.variants } : null,
        },
        workOrder: t.workOrderId ? keadaan.wo : null,
      };
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      keadaan.diubah.push({ id: where.id, data });
      const t = keadaan.tahap.get(where.id)!;
      Object.assign(t, data);
      return t;
    },
  },
  supplier: {
    findUnique: async ({ where }: { where: { id: string } }) =>
      keadaan.pemasok[where.id] ? { type: { code: keadaan.pemasok[where.id] } } : null,
  },
  auditLog: {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      keadaan.jejak.push(data);
      return data;
    },
  },
}));

vi.mock("@/lib/db/tx-retry", () => ({
  runSerializable: (cb: (t: typeof tx) => Promise<unknown>) => cb(tx),
}));

vi.mock("@elorae/db", async (importOriginal) => {
  const asli = await importOriginal<Record<string, unknown>>();
  return {
    ...asli,
    prisma: {
      // "Buat WO dari tahap" membaca di luar transaksi.
      planStage: {
        findUnique: async ({ where }: { where: { id: string } }) => {
          const t = keadaan.tahap.get(where.id);
          return t ? { ...t, planCategory: { itemId: keadaan.barang?.id ?? null, code: "KMJ" } } : null;
        },
        update: async () => ({}),
      },
      workOrder: { findUnique: async () => keadaan.wo },
      item: { findUnique: async () => keadaan.barang },
    },
  };
});

const { createPlanStage, updatePlanStage, createWorkOrderFromStage } = await import("./planning");

const VARIAN = JSON.stringify([
  { sku: "KMJ-01-M", size: "M" },
  { sku: "KMJ-01-L", size: "L" },
]);

function tahapAda(sebagian: Partial<Tahap> = {}): Tahap {
  const t: Tahap = {
    id: "ada",
    planCategoryId: "c1",
    name: "Gelombang 1",
    targetQty: 600,
    targetMonth: 3,
    variantSku: null,
    supplierId: "v1",
    fabricNotes: null,
    colorNotes: null,
    workOrderId: null,
    ...sebagian,
  };
  keadaan.tahap.set(t.id, t);
  return t;
}

beforeEach(() => {
  keadaan.izin = ["*"];
  keadaan.plan = { status: "DRAFT", isLocked: false };
  keadaan.barang = { id: "fg1", type: "FINISHED_GOOD", variants: VARIAN };
  keadaan.kategoriAda = true;
  keadaan.tahap = new Map();
  keadaan.wo = null;
  keadaan.jejak = [];
  keadaan.diubah = [];
  keadaan.woDibuat = [];
});

describe("createPlanStage", () => {
  it("menyimpan bulan target dan varian barang jadi jenis itu, jejak di transaksi yang sama", async () => {
    const hasil = await createPlanStage({
      planCategoryId: "c1",
      name: "Tahap Maret",
      targetQty: 1200,
      targetMonth: 3,
      variantSku: " KMJ-01-L ",
      supplierId: "v1",
    });
    expect(hasil).toEqual({ ok: true, id: "t1" });
    expect(keadaan.tahap.get("t1")).toMatchObject({ targetMonth: 3, variantSku: "KMJ-01-L", supplierId: "v1" });
    expect(keadaan.jejak).toEqual([
      expect.objectContaining({
        action: "CREATE",
        entityType: "PlanStage",
        entityId: "t1",
        changes: { after: expect.objectContaining({ variantSku: "KMJ-01-L", targetMonth: 3 }) },
      }),
    ]);
  });

  it("varian kosong atau spasi disimpan null", async () => {
    expect(await createPlanStage({ planCategoryId: "c1", name: "A", targetQty: 10, variantSku: "  " })).toEqual({
      ok: true,
      id: "t1",
    });
    expect(keadaan.tahap.get("t1")?.variantSku).toBeNull();
  });

  it("varian yang bukan milik barang jenis itu ditolak, tanpa menulis apa pun", async () => {
    expect(
      await createPlanStage({ planCategoryId: "c1", name: "A", targetQty: 10, variantSku: "LAIN-XL" })
    ).toEqual({ ok: false, code: "VARIAN_TIDAK_SAH" });
    keadaan.barang = null;
    expect(
      await createPlanStage({ planCategoryId: "c1", name: "A", targetQty: 10, variantSku: "KMJ-01-M" })
    ).toEqual({ ok: false, code: "BARANG_BELUM_DIHUBUNGKAN" });
    expect(keadaan.tahap.size).toBe(0);
    expect(keadaan.jejak).toEqual([]);
  });

  it("bulan di luar 1–12 dan isian rusak → ISIAN_TIDAK_SAH", async () => {
    for (const targetMonth of [0, 13, 2.5]) {
      expect(await createPlanStage({ planCategoryId: "c1", name: "A", targetQty: 10, targetMonth })).toEqual({
        ok: false,
        code: "ISIAN_TIDAK_SAH",
      });
    }
    expect(await createPlanStage({ planCategoryId: "c1", name: "", targetQty: 10 })).toEqual({
      ok: false,
      code: "ISIAN_TIDAK_SAH",
    });
    expect(keadaan.tahap.size).toBe(0);
  });

  it("penolakan lain dikembalikan sebagai kode", async () => {
    expect(
      await createPlanStage({ planCategoryId: "c1", name: "A", targetQty: 10, supplierId: "kain" })
    ).toEqual({ ok: false, code: "PENJAHIT_TIDAK_SAH" });

    keadaan.plan = { status: "ACTIVE", isLocked: true };
    expect(await createPlanStage({ planCategoryId: "c1", name: "A", targetQty: 10 })).toEqual({
      ok: false,
      code: "PLAN_TERKUNCI",
    });

    keadaan.kategoriAda = false;
    expect(await createPlanStage({ planCategoryId: "c1", name: "A", targetQty: 10 })).toEqual({
      ok: false,
      code: "KATEGORI_TIDAK_ADA",
    });

    keadaan.izin = ["production_planning:view"];
    expect(await createPlanStage({ planCategoryId: "c1", name: "A", targetQty: 10 })).toEqual({
      ok: false,
      code: "TANPA_AKSES",
    });
    expect(keadaan.tahap.size).toBe(0);
  });

  it("tahap manual dengan varian → Buat WO berhasil (dulu selalu TAHAP_TANPA_VARIAN)", async () => {
    const hasil = await createPlanStage({
      planCategoryId: "c1",
      name: "Manual",
      targetQty: 240,
      targetMonth: 5,
      variantSku: "KMJ-01-M",
      supplierId: "v1",
    });
    expect(hasil.ok).toBe(true);
    expect(await createWorkOrderFromStage("t1")).toEqual({ ok: true, id: "wo-baru", docNumber: "WO/2026/0100" });
    expect(keadaan.woDibuat).toEqual([
      expect.objectContaining({ plannedQty: 240, skuBreakdown: [{ variantSku: "KMJ-01-M", ratioPercent: 100 }] }),
    ]);
  });
});

describe("updatePlanStage", () => {
  it("mengisi varian tahap lama: hanya kolom yang berubah ditulis, jejak sebelum/sesudah", async () => {
    tahapAda();
    expect(await updatePlanStage("ada", { variantSku: "KMJ-01-M", targetMonth: 3 })).toEqual({ ok: true, id: "ada" });
    expect(keadaan.diubah).toEqual([{ id: "ada", data: { variantSku: "KMJ-01-M" } }]);
    expect(keadaan.jejak).toEqual([
      expect.objectContaining({
        action: "UPDATE",
        entityId: "ada",
        changes: { before: { variantSku: null }, after: { variantSku: "KMJ-01-M" } },
      }),
    ]);
  });

  it("tanpa perubahan nyata → ok tanpa menulis", async () => {
    tahapAda({ variantSku: "KMJ-01-M" });
    expect(await updatePlanStage("ada", { variantSku: "KMJ-01-M", targetMonth: 3, name: "Gelombang 1" })).toEqual({
      ok: true,
      id: "ada",
    });
    expect(keadaan.diubah).toEqual([]);
    expect(keadaan.jejak).toEqual([]);
  });

  it("varian dikosongkan dengan string kosong → null", async () => {
    tahapAda({ variantSku: "KMJ-01-M" });
    expect(await updatePlanStage("ada", { variantSku: "" })).toEqual({ ok: true, id: "ada" });
    expect(keadaan.diubah).toEqual([{ id: "ada", data: { variantSku: null } }]);
  });

  it("varian asing, bulan 13, dan tahap hilang ditolak", async () => {
    tahapAda();
    expect(await updatePlanStage("ada", { variantSku: "LAIN-XL" })).toEqual({ ok: false, code: "VARIAN_TIDAK_SAH" });
    expect(await updatePlanStage("ada", { targetMonth: 13 })).toEqual({ ok: false, code: "ISIAN_TIDAK_SAH" });
    expect(await updatePlanStage("hilang", { targetMonth: 4 })).toEqual({ ok: false, code: "TAHAP_TIDAK_ADA" });
    expect(await updatePlanStage("", { targetMonth: 4 })).toEqual({ ok: false, code: "ISIAN_TIDAK_SAH" });
    expect(keadaan.diubah).toEqual([]);
  });

  it("plan aktif dan terkunci: bulan, varian, dan penjahit tetap boleh; nama dan qty tidak", async () => {
    keadaan.plan = { status: "ACTIVE", isLocked: true };
    tahapAda();
    expect(await updatePlanStage("ada", { targetMonth: 7, variantSku: "KMJ-01-L", supplierId: "v2" })).toEqual({
      ok: true,
      id: "ada",
    });
    expect(keadaan.jejak).toEqual([expect.objectContaining({ metadata: { planTerkunci: true } })]);
    expect(await updatePlanStage("ada", { name: "Ganti nama" })).toEqual({ ok: false, code: "PLAN_TERKUNCI" });
    expect(await updatePlanStage("ada", { targetQty: 1, targetMonth: 8 })).toEqual({
      ok: false,
      code: "PLAN_TERKUNCI",
    });
    expect(keadaan.tahap.get("ada")).toMatchObject({ targetMonth: 7, variantSku: "KMJ-01-L", name: "Gelombang 1" });
  });

  it("WO hidup membekukan varian (dan penjahit saat plan terkunci); WO batal tidak", async () => {
    tahapAda({ workOrderId: "w1", variantSku: "KMJ-01-M" });
    keadaan.wo = { docNumber: "WO/2026/0007", status: "IN_PRODUCTION" };
    expect(await updatePlanStage("ada", { variantSku: "KMJ-01-L" })).toEqual({
      ok: false,
      code: "SUDAH_ADA_WO",
      docNumber: "WO/2026/0007",
    });
    // Plan masih draf: penjahit boleh diganti seperti sebelumnya.
    expect(await updatePlanStage("ada", { supplierId: "v2" })).toEqual({ ok: true, id: "ada" });

    keadaan.plan = { status: "ACTIVE", isLocked: true };
    expect(await updatePlanStage("ada", { supplierId: "v1" })).toEqual({
      ok: false,
      code: "SUDAH_ADA_WO",
      docNumber: "WO/2026/0007",
    });
    // Bulan tetap boleh.
    expect(await updatePlanStage("ada", { targetMonth: 9 })).toEqual({ ok: true, id: "ada" });

    keadaan.wo = { docNumber: "WO/2026/0007", status: "CANCELLED" };
    expect(await updatePlanStage("ada", { variantSku: "KMJ-01-L" })).toEqual({ ok: true, id: "ada" });
  });

  it("penjahit harus berjenis TAILOR; tanpa izin kelola → TANPA_AKSES", async () => {
    tahapAda();
    expect(await updatePlanStage("ada", { supplierId: "kain" })).toEqual({ ok: false, code: "PENJAHIT_TIDAK_SAH" });
    expect(await updatePlanStage("ada", { supplierId: null })).toEqual({ ok: true, id: "ada" });
    keadaan.izin = ["production_planning:view"];
    expect(await updatePlanStage("ada", { targetMonth: 2 })).toEqual({ ok: false, code: "TANPA_AKSES" });
  });
});

describe("teks penolakan tahap", () => {
  it("setiap kode punya teks di kedua bahasa (jadwalProduksi.plan.tolak)", async () => {
    // Record<KodeTolakTahap, …> → tsc menagih kode baru di sini.
    const KODE: Record<import("./planning").KodeTolakTahap, true> = {
      TANPA_AKSES: true,
      ISIAN_TIDAK_SAH: true,
      KATEGORI_TIDAK_ADA: true,
      TAHAP_TIDAK_ADA: true,
      PLAN_TERKUNCI: true,
      PENJAHIT_TIDAK_SAH: true,
      BARANG_BELUM_DIHUBUNGKAN: true,
      VARIAN_TIDAK_SAH: true,
      SUDAH_ADA_WO: true,
      GAGAL: true,
    };
    for (const bahasa of ["id", "en"] as const) {
      const pesan = (await import(`@/lib/i18n/messages/${bahasa}.json`)).default as {
        jadwalProduksi: { plan: { tolak: Record<string, string> } };
      };
      for (const kode of Object.keys(KODE)) {
        expect(pesan.jadwalProduksi.plan.tolak[kode], `${bahasa}:${kode}`).toEqual(expect.any(String));
      }
      expect(pesan.jadwalProduksi.plan.tolak.SUDAH_ADA_WO).toContain("{docNumber}");
    }
  });
});
