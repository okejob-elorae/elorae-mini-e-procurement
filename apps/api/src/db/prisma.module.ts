import { Global, Module } from "@nestjs/common";
import { prisma } from "@elorae/db";

export const PRISMA = Symbol("PRISMA");
export type PrismaService = typeof prisma;

@Global()
@Module({
  providers: [{ provide: PRISMA, useValue: prisma }],
  exports: [PRISMA],
})
export class PrismaModule {}
