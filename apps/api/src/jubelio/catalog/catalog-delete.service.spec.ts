import { Test } from "@nestjs/testing";
import { JubelioCatalogDeleteService } from "./catalog-delete.service";
import { PRISMA } from "../../db/prisma.module";
import { JubelioHttpService } from "../http.service";

describe("JubelioCatalogDeleteService", () => {
  let svc: JubelioCatalogDeleteService;
  let prisma: any;
  let http: { delete: jest.Mock };

  beforeEach(async () => {
    prisma = {
      jubelioProductMapping: { deleteMany: jest.fn() },
    };
    http = { delete: jest.fn() };
    const mod = await Test.createTestingModule({
      providers: [
        JubelioCatalogDeleteService,
        { provide: PRISMA, useValue: prisma },
        { provide: JubelioHttpService, useValue: http },
      ],
    }).compile();
    svc = mod.get(JubelioCatalogDeleteService);
  });

  it("calls Jubelio DELETE with the group id list and drops local mappings", async () => {
    prisma.jubelioProductMapping.deleteMany.mockResolvedValue({ count: 2 });
    http.delete.mockResolvedValue({ status: "ok" });

    const result = await svc.deleteByGroupId(42);

    expect(http.delete).toHaveBeenCalledWith("/inventory/items/", expect.objectContaining({
      body: JSON.stringify({ ids: [42] }),
      headers: { "Content-Type": "application/json" },
    }));
    expect(prisma.jubelioProductMapping.deleteMany).toHaveBeenCalledWith({
      where: { jubelioItemGroupId: 42 },
    });
    expect(result).toEqual({ deletedMappings: 2, jubelioGroupId: 42 });
  });

  it("returns 0 mappings when Jubelio delete succeeded but no local mappings existed", async () => {
    prisma.jubelioProductMapping.deleteMany.mockResolvedValue({ count: 0 });
    http.delete.mockResolvedValue({ status: "ok" });

    const result = await svc.deleteByGroupId(99);

    expect(http.delete).toHaveBeenCalled();
    expect(result).toEqual({ deletedMappings: 0, jubelioGroupId: 99 });
  });

  it("does NOT drop local mappings when Jubelio call throws", async () => {
    http.delete.mockRejectedValue(new Error("503 Service Unavailable"));

    await expect(svc.deleteByGroupId(7)).rejects.toThrow("503");
    expect(prisma.jubelioProductMapping.deleteMany).not.toHaveBeenCalled();
  });
});
