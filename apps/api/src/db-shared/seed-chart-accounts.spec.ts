import { seedChartAccounts } from "../../../../packages/db/prisma/seed-chart-accounts";

type MockAccount = {
  id: string;
  code: string;
  name: string;
  type: string;
  parentId: string | null;
  depth: number;
  isActive: boolean;
};

function buildPrismaMock() {
  const store = new Map<string, MockAccount>();
  let idSeq = 0;

  const chartAccount = {
    findMany: jest.fn(async () => Array.from(store.values())),

    findUnique: jest.fn(async (args: { where: { code?: string; id?: string } }) => {
      if (args.where.code !== undefined) {
        return store.get(args.where.code) ?? null;
      }
      if (args.where.id !== undefined) {
        for (const row of store.values()) {
          if (row.id === args.where.id) return row;
        }
        return null;
      }
      return null;
    }),

    create: jest.fn(async (args: { data: Omit<MockAccount, "id"> }) => {
      const id = `id_${++idSeq}`;
      const row: MockAccount = { id, ...args.data } as MockAccount;
      store.set(row.code, row);
      return row;
    }),

    update: jest.fn(async (args: { where: { id: string }; data: Partial<MockAccount> }) => {
      for (const [code, row] of store.entries()) {
        if (row.id === args.where.id) {
          const updated = { ...row, ...args.data };
          store.set(code, updated);
          return updated;
        }
      }
      throw new Error(`update: record not found id=${args.where.id}`);
    }),

    deleteMany: jest.fn(async () => {
      store.clear();
      return { count: 0 };
    }),

    count: jest.fn(async () => store.size),
  };

  const prisma = { chartAccount };
  return { prisma, store };
}

describe("seedChartAccounts", () => {
  it("seeds the placeholder template idempotently", async () => {
    const { prisma, store } = buildPrismaMock();

    const r1 = await seedChartAccounts(prisma as any);
    expect(r1.created).toBeGreaterThan(0);
    expect(r1.updated).toBe(0);

    const countAfterFirst = store.size;

    const r2 = await seedChartAccounts(prisma as any);
    expect(r2.created).toBe(0);
    expect(r2.updated).toBe(countAfterFirst);

    expect(store.size).toBe(countAfterFirst);
  });

  it("links parents by code prefix and increments depth", async () => {
    const { prisma, store } = buildPrismaMock();

    await seedChartAccounts(prisma as any);

    const root = store.get("1");
    const child = store.get("11");
    const grandchild = store.get("1101");

    expect(root).not.toBeNull();
    expect(root!.depth).toBe(1);
    expect(root!.parentId).toBeNull();

    expect(child).not.toBeNull();
    expect(child!.parentId).toBe(root!.id);
    expect(child!.depth).toBe(2);

    expect(grandchild).not.toBeNull();
    expect(grandchild!.parentId).toBe(child!.id);
    expect(grandchild!.depth).toBe(3);
  });

  it("preserves manual deactivation across re-runs", async () => {
    const { prisma, store } = buildPrismaMock();

    await seedChartAccounts(prisma as any);

    const root = store.get("1")!;
    store.set("1", { ...root, isActive: false });

    await seedChartAccounts(prisma as any);

    const after = store.get("1")!;
    expect(after.isActive).toBe(false);
  });

  it("rejects malformed input with duplicate codes", async () => {
    const { prisma } = buildPrismaMock();

    await expect(
      seedChartAccounts(prisma as any, {
        accounts: [
          { code: "1", name: "Aset", type: "ASET" },
          { code: "1", name: "Dup", type: "ASET" },
        ],
      }),
    ).rejects.toThrow(/duplicate/i);
  });
});
