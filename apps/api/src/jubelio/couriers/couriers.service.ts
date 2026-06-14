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
    const ids = rows.map((r) => r.courier_id);

    await this.prisma.$transaction(async (tx) => {
      await tx.jubelioCourier.deleteMany({ where: { id: { notIn: ids } } });
      for (const r of rows) {
        await tx.jubelioCourier.upsert({
          where: { id: r.courier_id },
          create: { id: r.courier_id, name: r.courier_name, syncedAt: now },
          update: { name: r.courier_name, syncedAt: now },
        });
      }
    });

    this.logger.log(`Synced ${rows.length} couriers from Jubelio`);
    return { count: rows.length };
  }
}
