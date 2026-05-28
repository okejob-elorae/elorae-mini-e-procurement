import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { BullModule } from "@nestjs/bullmq";
import { AdminModule } from "./admin/admin.module";
import { PrismaModule } from "./db/prisma.module";
import { HealthModule } from "./health/health.module";
import { JubelioCatalogModule } from "./jubelio/catalog/catalog.module";
import { JubelioModule } from "./jubelio/jubelio.module";
import { JubelioWebhooksModule } from "./jubelio/webhooks/webhooks.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [".env", "../../.env", "../web/.env"],
    }),
    ScheduleModule.forRoot(),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: { url: config.get<string>("REDIS_URL") ?? "redis://localhost:6379" },
      }),
    }),
    PrismaModule,
    AdminModule,
    HealthModule,
    JubelioModule,
    JubelioCatalogModule,
    JubelioWebhooksModule,
  ],
})
export class AppModule {}
