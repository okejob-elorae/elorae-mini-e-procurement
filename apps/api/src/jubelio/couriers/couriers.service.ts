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

    // Cache table — no FK consumers, partial replay is safe. Drop the $transaction
    // wrapper (was timing out at 5s default with 56 sequential upserts on TiDB)
    // and run delete + upserts concurrently.
    await this.prisma.jubelioCourier.deleteMany({ where: { id: { notIn: ids } } });
    await Promise.all(
      rows.map((r) =>
        this.prisma.jubelioCourier.upsert({
          where: { id: r.courier_id },
          create: { id: r.courier_id, name: r.courier_name, syncedAt: now },
          update: { name: r.courier_name, syncedAt: now },
        }),
      ),
    );

    this.logger.log(`Synced ${rows.length} couriers from Jubelio`);
    return { count: rows.length };
  }
}
