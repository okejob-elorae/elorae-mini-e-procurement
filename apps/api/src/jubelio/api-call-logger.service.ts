import { createHash } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { PRISMA, type PrismaService } from "../db/prisma.module";

export type ApiCallLogInput = {
  method: string;
  path: string;
  body?: string;
  statusCode?: number;
  latencyMs: number;
  ok: boolean;
  rateLimited?: boolean;
  errorMessage?: string;
  requestBody?: string;
  responseBody?: string;
};

const BODY_CAP = 32 * 1024;

function cap(s: string | undefined): string | null {
  if (!s) return null;
  return s.length > BODY_CAP ? `${s.slice(0, BODY_CAP)}…[truncated ${s.length - BODY_CAP}b]` : s;
}

@Injectable()
export class JubelioApiCallLogger {
  private readonly logger = new Logger(JubelioApiCallLogger.name);

  constructor(@Inject(PRISMA) private readonly prisma: PrismaService) {}

  record(input: ApiCallLogInput): void {
    const payloadHash = input.body
      ? createHash("sha256").update(input.body).digest("hex")
      : null;

    this.prisma.jubelioApiCall
      .create({
        data: {
          method: input.method,
          path: input.path,
          payloadHash,
          statusCode: input.statusCode ?? null,
          latencyMs: input.latencyMs,
          ok: input.ok,
          rateLimited: input.rateLimited ?? false,
          errorMessage: input.errorMessage ?? null,
          requestBody: cap(input.requestBody),
          responseBody: cap(input.responseBody),
        },
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`Failed to log Jubelio API call ${input.method} ${input.path}: ${message}`);
      });
  }
}
