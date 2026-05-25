import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { AdminModule } from "./admin/admin.module";
import { PrismaModule } from "./db/prisma.module";
import { HealthModule } from "./health/health.module";
import { JubelioModule } from "./jubelio/jubelio.module";
import { JubelioWebhooksModule } from "./jubelio/webhooks/webhooks.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [".env", "../../.env", "../web/.env"],
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AdminModule,
    HealthModule,
    JubelioModule,
    JubelioWebhooksModule,
  ],
})
export class AppModule {}
