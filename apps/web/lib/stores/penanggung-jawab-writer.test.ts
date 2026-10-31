import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tes penulis rotasi toko tanpa basis data. Yang dijaga: lingkup kosong tidak
 * pernah memindahkan apa pun, toko yang sudah dipegang tujuan tidak ditulis
 * ulang, dan SETIAP toko yang berpindah meninggalkan jejak sebelum/sesudah —
 * kolomnya hanya menyimpan pemegang terakhir.
 */

const state = {
  toko: [] as { id: string; salesmanId: string | null }[],
  salesAda: true,
  diperbarui: [] as { where: unknown; data: unknown }[],
  jejak: [] as Record<string, unknown>[],
  dicari: [] as unknown[],
};

const tx = {
  store: {
    findMany: vi.fn(async (a: { where: unknown }) => {
      state.dicari.push(a.where);
      return state.toko;
    }),
    findUnique: vi.fn(async () => state.toko[0] ?? null),
    update: vi.fn(async (a: { where: unknown; data: unknown }) => {
      state.diperbarui.push(a);
      return {};
    }),
    updateMany: vi.fn(async (a: { where: unknown; data: unknown }) => {
      state.diperbarui.push(a);
      return { count: 0 };
    }),
  },
  auditLog: {
    createMany: vi.fn(async (a: { data: Record<string, unknown>[] }) => {
      state.jejak.push(...a.data);
      return { count: a.data.length };
    }),
    create: vi.fn(async (a: { data: Record<string, unknown> }) => {
      state.jejak.push(a.data);
      return {};
    }),
  },
};

vi.mock("@elorae/db", () => ({
  prisma: {
    user: { count: vi.fn(async () => (state.salesAda ? 1 : 0)) },
    $transaction: (cb: (c: unknown) => Promise<unknown>) => cb(tx),
  },
}));

const { pindahkanToko, gantiPemegangToko, AKSI_PINDAH_TOKO } = await import("./penanggung-jawab-writer");

beforeEach(() => {
  state.toko = [
    { id: "s1", salesmanId: "lama" },
    { id: "s2", salesmanId: null },
    { id: "s3", salesmanId: "baru" },
  ];
  state.salesAda = true;
  state.diperbarui = [];
  state.jejak = [];
  state.dicari = [];
});

describe("pindahkanToko", () => {
  it("refuses an empty scope without touching anything", async () => {
    expect(await pindahkanToko({ lingkup: {}, keSalesmanId: "baru", olehUserId: "admin" })).toEqual({
      ok: false,
      alasan: "LINGKUP_KOSONG",
    });
    expect(state.diperbarui).toHaveLength(0);
    expect(state.dicari).toHaveLength(0);
  });

  it("refuses a target salesperson that does not exist", async () => {
    state.salesAda = false;
    expect(await pindahkanToko({ lingkup: { groupId: "g1" }, keSalesmanId: "hantu", olehUserId: "admin" })).toEqual({
      ok: false,
      alasan: "SALES_TIDAK_DITEMUKAN",
    });
    expect(state.diperbarui).toHaveLength(0);
  });

  it("moves only stores not already held by the target, including stores nobody held", async () => {
    const hasil = await pindahkanToko({ lingkup: { groupId: "g1" }, keSalesmanId: "baru", olehUserId: "admin" });
    expect(hasil).toEqual({ ok: true, jumlah: 2 });
    expect(state.diperbarui[0]).toEqual({ where: { id: { in: ["s1", "s2"] } }, data: { salesmanId: "baru" } });
  });

  it("writes one audit row per moved store with the holder before and after", async () => {
    await pindahkanToko({ lingkup: { groupId: "g1" }, keSalesmanId: "baru", olehUserId: "admin" });
    expect(state.jejak.map((j) => [j.entityId, j.changes])).toEqual([
      ["s1", { before: { salesmanId: "lama" }, after: { salesmanId: "baru" } }],
      ["s2", { before: { salesmanId: null }, after: { salesmanId: "baru" } }],
    ]);
    expect(state.jejak.every((j) => j.action === AKSI_PINDAH_TOKO && j.userId === "admin")).toBe(true);
  });

  it("can clear the holder (null) without looking up a salesperson", async () => {
    state.salesAda = false;
    const hasil = await pindahkanToko({ lingkup: { dari: "lama" }, keSalesmanId: null, olehUserId: "admin" });
    expect(hasil.ok).toBe(true);
    expect(state.diperbarui[0]).toEqual({ where: { id: { in: ["s1", "s3"] } }, data: { salesmanId: null } });
  });

  it("reports zero and writes nothing when every store already has that holder", async () => {
    state.toko = [{ id: "s3", salesmanId: "baru" }];
    expect(await pindahkanToko({ lingkup: { dari: "baru" }, keSalesmanId: "baru", olehUserId: "admin" })).toEqual({
      ok: true,
      jumlah: 0,
    });
    expect(state.diperbarui).toHaveLength(0);
    expect(state.jejak).toHaveLength(0);
  });
});

describe("gantiPemegangToko", () => {
  it("audits a single store's change inside the caller's transaction", async () => {
    await gantiPemegangToko(tx as never, { storeId: "s1", sebelum: "lama", sesudah: "baru", olehUserId: "admin" });
    expect(state.jejak).toEqual([
      expect.objectContaining({
        action: AKSI_PINDAH_TOKO,
        entityId: "s1",
        changes: { before: { salesmanId: "lama" }, after: { salesmanId: "baru" } },
      }),
    ]);
  });

  it("writes no audit row when the holder did not change", async () => {
    await gantiPemegangToko(tx as never, { storeId: "s1", sebelum: "lama", sesudah: "lama", olehUserId: "admin" });
    expect(state.jejak).toHaveLength(0);
  });
});
