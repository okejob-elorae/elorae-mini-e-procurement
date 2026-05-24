import { Inject, Injectable, Logger } from "@nestjs/common";
import { PRISMA, type PrismaService } from "../db/prisma.module";

export type AdminNotificationSeverity = "INFO" | "WARN" | "ERROR" | "CRITICAL";

export type AdminNotificationInput = {
  category: string;
  severity: AdminNotificationSeverity;
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
};

@Injectable()
export class AdminNotificationService {
  private readonly logger = new Logger(AdminNotificationService.name);

  constructor(@Inject(PRISMA) private readonly prisma: PrismaService) {}

  async write(input: AdminNotificationInput): Promise<void> {
    try {
      await this.prisma.adminNotification.create({
        data: {
          category: input.category,
          severity: input.severity,
          title: input.title,
          message: input.message,
          metadata: input.metadata ?? undefined,
        },
      });
      this.logger.log(`[${input.severity}] ${input.category}: ${input.title}`);
    } catch (err) {
      // Never let alerting failure block the caller. Just log loudly.
      this.logger.error(
        `Failed to persist admin notification [${input.category}]: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }
}
