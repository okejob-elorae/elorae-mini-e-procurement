import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tes penulis rotasi toko tanpa basis data. Yang dijaga: lingkup kosong tidak
 * pernah memindahkan apa pun, toko yang sudah dipegang tujuan tidak ditulis
 * ulang, dan SETIAP toko yang berpindah meninggalkan jejak sebelum/sesudah —
 * kolomnya hanya menyimpan pemegang terakhir. Balapannya dengan formulir toko
 * (P47) diuji terhadap basis data di `penanggung-jawab-balapan.test.ts`; di sini
 * cukup dipastikan transaksinya lewat `runSerializable`.
 */

const state = {
  toko: [] as { id: string; salesmanId: string | null; termsType: "PUTUS" | "KONSI" }[],
  salesAda: true,
  diperbarui: [] as { where: unknown; data: unknown }[],
  jejak: [] as Record<string, unknown>[],
  dicari: [] as unknown[],
  serializable: 0,
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
    /* Transaksi biasa tidak boleh dipakai lagi: penjaga KONSI_WAJIB_PEMEGANG baca-lalu-tulis. */
    $transaction: () => {
      throw new Error("pindahkanToko harus lewat runSerializable");
    },
  },
}));

vi.mock("@/lib/db/tx-retry", () => ({
  runSerializable: (cb: (c: unknown) => Promise<unknown>) => {
    state.serializable += 1;
    return cb(tx);
  },
}));

const { pindahkanToko, gantiPemegangToko, AKSI_PINDAH_TOKO } = await import("./penanggung-jawab-writer");

beforeEach(() => {
  state.toko = [
    { id: "s1", salesmanId: "lama", termsType: "PUTUS" },
    { id: "s2", salesmanId: null, termsType: "PUTUS" },
    { id: "s3", salesmanId: "baru", termsType: "PUTUS" },
  ];
  state.salesAda = true;
  state.diperbarui = [];
  state.jejak = [];
  state.dicari = [];
  state.serializable = 0;
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

  it("reads and writes inside runSerializable, never a plain transaction", async () => {
    await pindahkanToko({ lingkup: { groupId: "g1" }, keSalesmanId: "baru", olehUserId: "admin" });
    expect(state.serializable).toBe(1);
    expect(state.diperbarui).toHaveLength(1);
  });

  it("refuses to clear the holder of a scope holding a KONSI store, and writes nothing (P47)", async () => {
    state.toko = [
      { id: "k1", salesmanId: "lama", termsType: "KONSI" },
      { id: "p1", salesmanId: "lama", termsType: "PUTUS" },
    ];
    expect(await pindahkanToko({ lingkup: { dari: "lama" }, keSalesmanId: null, olehUserId: "admin" })).toEqual({
      ok: false,
      alasan: "KONSI_WAJIB_PEMEGANG",
    });
    expect(state.diperbarui).toHaveLength(0);
    expect(state.jejak).toHaveLength(0);
  });

  it("moves a scope holding a KONSI store to another salesperson", async () => {
    state.toko = [
      { id: "k1", salesmanId: "lama", termsType: "KONSI" },
      { id: "p1", salesmanId: "lama", termsType: "PUTUS" },
    ];
    expect(await pindahkanToko({ lingkup: { dari: "lama" }, keSalesmanId: "baru", olehUserId: "admin" })).toEqual({
      ok: true,
      jumlah: 2,
    });
    expect(state.diperbarui[0]).toEqual({ where: { id: { in: ["k1", "p1"] } }, data: { salesmanId: "baru" } });
  });

  it("still clears the holder of a PUTUS-only scope", async () => {
    state.toko = [{ id: "p1", salesmanId: "lama", termsType: "PUTUS" }];
    expect(await pindahkanToko({ lingkup: { dari: "lama" }, keSalesmanId: null, olehUserId: "admin" })).toEqual({
      ok: true,
      jumlah: 1,
    });
  });

  it("does not refuse a KONSI store that already has no holder when clearing others", async () => {
    /* Nothing moves for it, so it cannot be "emptied" by this call. */
    state.toko = [
      { id: "k0", salesmanId: null, termsType: "KONSI" },
      { id: "p1", salesmanId: "lama", termsType: "PUTUS" },
    ];
    expect(await pindahkanToko({ lingkup: { groupId: "g1" }, keSalesmanId: null, olehUserId: "admin" })).toEqual({
      ok: true,
      jumlah: 1,
    });
  });

  it("reports zero and writes nothing when every store already has that holder", async () => {
    state.toko = [{ id: "s3", salesmanId: "baru", termsType: "PUTUS" }];
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
