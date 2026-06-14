import { Inject, Injectable, Logger } from "@nestjs/common";
import { PRISMA, type PrismaService } from "../../db/prisma.module";
import { JubelioHttpService } from "../http.service";

type JubelioCourierRow = {
  courier_id: number;
  courier_name: string;
};

@Injectable()
export class JubelioCouriersService {
  private readonly logger = new Logger(JubelioCouriersService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaService,
    private readonly http: JubelioHttpService,
  ) {}

  async sync(): Promise<{ count: number }> {
    const rows = await this.http.get<JubelioCourierRow[]>("/wms/couriers");
    const now = new Date();

    // Cache table — no FK consumers, momentary empty window between delete and
    // create is acceptable. Two queries total (delete-all + createMany) — avoids
    // both the 5s interactive-tx timeout and the 10-conn mariadb pool exhaustion
    // that per-row upserts would hit.
    await this.prisma.jubelioCourier.deleteMany({});
    await this.prisma.jubelioCourier.createMany({
      data: rows.map((r) => ({
        id: r.courier_id,
        name: r.courier_name,
        syncedAt: now,
      })),
    });

    this.logger.log(`Synced ${rows.length} couriers from Jubelio`);
    return { count: rows.length };
  }
}
