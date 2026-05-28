import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { InternalSignGuard } from "./internal-sign.guard";

@Module({
  imports: [ConfigModule],
  providers: [{ provide: APP_GUARD, useClass: InternalSignGuard }],
})
export class AuthModule {}
