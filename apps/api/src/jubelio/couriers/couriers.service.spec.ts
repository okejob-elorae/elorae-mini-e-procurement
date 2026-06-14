import { Test } from "@nestjs/testing";
import { JubelioCouriersService } from "./couriers.service";
import { PRISMA } from "../../db/prisma.module";
import { JubelioHttpService } from "../http.service";

describe("JubelioCouriersService", () => {
  let svc: JubelioCouriersService;
  let prisma: any;
  let http: { get: jest.Mock };

  beforeEach(async () => {
    prisma = {
      jubelioCourier: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    http = { get: jest.fn() };

    const mod = await Test.createTestingModule({
      providers: [
        JubelioCouriersService,
        { provide: PRISMA, useValue: prisma },
        { provide: JubelioHttpService, useValue: http },
      ],
    }).compile();

    svc = mod.get(JubelioCouriersService);
  });

  it("sync: fetches Jubelio + clears table + bulk inserts rows + returns count", async () => {
    http.get.mockResolvedValue([
      { courier_id: 1, courier_name: "JNE" },
      { courier_id: 2, courier_name: "J&T" },
    ]);

    const result = await svc.sync();

    expect(result).toEqual({ count: 2 });
    expect(http.get).toHaveBeenCalledWith("/wms/couriers");
    expect(prisma.jubelioCourier.deleteMany).toHaveBeenCalledWith({});
    expect(prisma.jubelioCourier.createMany).toHaveBeenCalledTimes(1);

    const createArgs = prisma.jubelioCourier.createMany.mock.calls[0][0];
    expect(createArgs.data).toHaveLength(2);
    expect(createArgs.data[0]).toMatchObject({ id: 1, name: "JNE" });
    expect(createArgs.data[1]).toMatchObject({ id: 2, name: "J&T" });
  });

  it("sync: stamps syncedAt to a Date on every row", async () => {
    http.get.mockResolvedValue([
      { courier_id: 1, courier_name: "JNE" },
      { courier_id: 2, courier_name: "J&T" },
    ]);

    await svc.sync();

    const createArgs = prisma.jubelioCourier.createMany.mock.calls[0][0];
    expect(createArgs.data[0].syncedAt).toBeInstanceOf(Date);
    expect(createArgs.data[1].syncedAt).toBeInstanceOf(Date);
  });

  it("sync: handles empty Jubelio response (clears table, createMany with empty data)", async () => {
    http.get.mockResolvedValue([]);

    const result = await svc.sync();

    expect(result).toEqual({ count: 0 });
    expect(prisma.jubelioCourier.deleteMany).toHaveBeenCalledWith({});
    expect(prisma.jubelioCourier.createMany).toHaveBeenCalledWith({ data: [] });
  });
});
