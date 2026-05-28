import { Inject, Injectable, Logger } from "@nestjs/common";
import { PRISMA, type PrismaService } from "../../db/prisma.module";
import { JubelioHttpService } from "../http.service";

export type CatalogDeleteResult = {
  jubelioGroupId: number;
  deletedMappings: number;
};

@Injectable()
export class JubelioCatalogDeleteService {
  private readonly logger = new Logger(JubelioCatalogDeleteService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaService,
    private readonly http: JubelioHttpService,
  ) {}

  async deleteByGroupId(jubelioGroupId: number): Promise<CatalogDeleteResult> {
    await this.http.delete("/inventory/items/", {
      body: JSON.stringify({ ids: [jubelioGroupId] }),
      headers: { "Content-Type": "application/json" },
    });

    const result = await this.prisma.jubelioProductMapping.deleteMany({
      where: { jubelioItemGroupId: jubelioGroupId },
    });

    this.logger.log(`Deleted Jubelio group ${jubelioGroupId} + ${result.count} local mappings`);
    return { jubelioGroupId, deletedMappings: result.count };
  }
}
