import { Inject, Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@elorae/db";
import { PRISMA, type PrismaService } from "../../db/prisma.module";
import { kunciDuplikatWebhook } from "./kunci-duplikat";

export const SUPPORTED_WEBHOOK_EVENTS = ["salesorder", "stock", "salesreturn", "product"] as const;
export type JubelioWebhookEventName = (typeof SUPPORTED_WEBHOOK_EVENTS)[number];

export type PersistInput = {
  event: JubelioWebhookEventName;
  rawBody: string;
  signature: string;
  eventId?: string;
};

export type PersistOutcome = {
  id: string;
  duplicate: boolean;
};

@Injectable()
export class JubelioWebhooksService {
  private readonly logger = new Logger(JubelioWebhooksService.name);

  constructor(@Inject(PRISMA) private readonly prisma: PrismaService) {}

  async persist(input: PersistInput): Promise<PersistOutcome> {
    // Lihat kunciDuplikatWebhook: webhook stok/produk membawa badan yang sama
    // untuk setiap perubahan, jadi hash badan saja membuang perubahan kedua.
    const hash = kunciDuplikatWebhook({
      event: input.event,
      rawBody: input.rawBody,
      eventId: input.eventId,
      diterimaPada: new Date(),
    });
    const rawPayload = this.safeParse(input.rawBody);

    try {
      const row = await this.prisma.jubelioWebhookEvent.create({
        data: {
          event: input.event,
          eventId: input.eventId ?? null,
          signature: input.signature,
          payloadHash: hash,
          rawPayload,
          status: "RECEIVED",
        },
        select: { id: true },
      });
      this.logger.log(`Webhook ${input.event} stored id=${row.id} hash=${hash.slice(0, 12)}`);
      return { id: row.id, duplicate: false };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        const existing = await this.prisma.jubelioWebhookEvent.findUnique({
          where: { event_payloadHash: { event: input.event, payloadHash: hash } },
          select: { id: true },
        });
        this.logger.warn(`Duplicate webhook ${input.event} hash=${hash.slice(0, 12)} — skipped`);
        return { id: existing!.id, duplicate: true };
      }
      throw err;
    }
  }

  private safeParse(body: string): Prisma.InputJsonValue {
    try {
      return JSON.parse(body) as Prisma.InputJsonValue;
    } catch {
      return { raw: body } as Prisma.InputJsonValue;
    }
  }
}
