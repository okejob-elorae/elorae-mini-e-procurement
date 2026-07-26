import { Test } from "@nestjs/testing";
import { ResyncSeedService } from "./resync-seed.service";
import { PRISMA } from "../../db/prisma.module";
import { RESYNC_STATUS } from "./resync-status";

describe("ResyncSeedService", () => {
  let service: ResyncSeedService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      jubelioSalesOrderResync: {
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const mod = await Test.createTestingModule({
      providers: [ResyncSeedService, { provide: PRISMA, useValue: prisma }],
    }).compile();
    service = mod.get(ResyncSeedService);
  });

  it("seeds one PENDING row per unique, trimmed salesorderNo under a fresh batchId", async () => {
    prisma.jubelioSalesOrderResync.createMany.mockResolvedValue({ count: 2 });

    const result = await service.seedBatch({ salesorderNos: [" SP-1 ", "SP-2", "SP-1"] });

    expect(result.seeded).toBe(2);
    expect(typeof result.batchId).toBe("string");
    expect(result.batchId.length).toBeGreaterThan(0);

    const arg = prisma.jubelioSalesOrderResync.createMany.mock.calls[0][0];
    expect(arg.data).toHaveLength(2);
    expect(arg.data.every((r: any) => r.batchId === result.batchId)).toBe(true);
    expect(arg.data.every((r: any) => r.status === RESYNC_STATUS.PENDING)).toBe(true);
    expect(arg.data.map((r: any) => r.salesorderNo)).toEqual(["SP-1", "SP-2"]);
    expect(arg.skipDuplicates).toBe(true);
  });

  it("returns seeded=0 and does not call createMany when the list is empty after filtering blanks", async () => {
    const result = await service.seedBatch({ salesorderNos: ["", "   "] });

    expect(result.seeded).toBe(0);
    expect(prisma.jubelioSalesOrderResync.createMany).not.toHaveBeenCalled();
  });

  it("produces a different batchId per call", async () => {
    const r1 = await service.seedBatch({ salesorderNos: ["SP-1"] });
    const r2 = await service.seedBatch({ salesorderNos: ["SP-1"] });

    expect(r1.batchId).not.toBe(r2.batchId);
  });
});
