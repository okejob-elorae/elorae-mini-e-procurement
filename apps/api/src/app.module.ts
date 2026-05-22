import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PrismaModule } from "./db/prisma.module";
import { HealthModule } from "./health/health.module";
import { JubelioModule } from "./jubelio/jubelio.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [".env", "../../.env", "../web/.env"],
    }),
    PrismaModule,
    HealthModule,
    JubelioModule,
  ],
})
export class AppModule {}
