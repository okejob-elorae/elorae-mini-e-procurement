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
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
      jubelioCourier: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        upsert: jest.fn().mockResolvedValue({}),
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

  it("sync: fetches Jubelio + upserts each row + returns count", async () => {
    http.get.mockResolvedValue([
      { courier_id: 1, courier_name: "JNE" },
      { courier_id: 2, courier_name: "J&T" },
    ]);

    const result = await svc.sync();

    expect(result).toEqual({ count: 2 });
    expect(http.get).toHaveBeenCalledWith("/wms/couriers");
    expect(prisma.jubelioCourier.upsert).toHaveBeenCalledTimes(2);

    const firstUpsert = prisma.jubelioCourier.upsert.mock.calls[0][0];
    expect(firstUpsert.where).toEqual({ id: 1 });
    expect(firstUpsert.create).toMatchObject({ id: 1, name: "JNE" });
    expect(firstUpsert.update).toMatchObject({ name: "JNE" });
  });

  it("sync: deletes rows missing from latest Jubelio response", async () => {
    http.get.mockResolvedValue([{ courier_id: 1, courier_name: "JNE" }]);

    await svc.sync();

    expect(prisma.jubelioCourier.deleteMany).toHaveBeenCalledWith({
      where: { id: { notIn: [1] } },
    });
  });

  it("sync: stamps syncedAt to a Date", async () => {
    http.get.mockResolvedValue([{ courier_id: 1, courier_name: "JNE" }]);

    await svc.sync();

    const upsertArgs = prisma.jubelioCourier.upsert.mock.calls[0][0];
    expect(upsertArgs.create.syncedAt).toBeInstanceOf(Date);
    expect(upsertArgs.update.syncedAt).toBeInstanceOf(Date);
  });
});
