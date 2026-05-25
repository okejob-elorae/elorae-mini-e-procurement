import {
  BadRequestException,
  Controller,
  HttpCode,
  Logger,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type { RawBodyRequest } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { AdminNotificationService } from "../../admin/notification.service";
import { JubelioConfig } from "../jubelio.config";
import { verifyJubelioSignature } from "./signature";
import {
  JubelioWebhooksService,
  SUPPORTED_WEBHOOK_EVENTS,
  type JubelioWebhookEventName,
} from "./webhooks.service";

const WEBHOOK_EVENT_SET = new Set<string>(SUPPORTED_WEBHOOK_EVENTS);

@ApiTags("jubelio-webhooks")
@Controller("webhooks/jubelio")
export class JubelioWebhooksController {
  private readonly logger = new Logger(JubelioWebhooksController.name);

  constructor(
    private readonly service: JubelioWebhooksService,
    private readonly config: JubelioConfig,
    private readonly admin: AdminNotificationService,
  ) {}

  @Post(":event")
  @HttpCode(200)
  @ApiOperation({
    summary: "Receive a Jubelio webhook",
    description:
      "Accepts inbound webhooks for salesorder | stock | salesreturn | product. " +
      "Verifies the `webhook-signature` header (sha256(rawBody + secret)), persists the " +
      "raw payload, and acks 200. Processing happens asynchronously.",
  })
  async receive(
    @Param("event") event: string,
    @Req() req: RawBodyRequest<Request>,
  ): Promise<{ id: string; duplicate: boolean }> {
    if (!WEBHOOK_EVENT_SET.has(event)) {
      throw new BadRequestException(`Unknown Jubelio webhook event: ${event}`);
    }
    const typedEvent = event as JubelioWebhookEventName;

    const rawBody = req.rawBody?.toString("utf8");
    if (!rawBody) {
      throw new BadRequestException("Missing request body");
    }

    const signatureHeader =
      (req.headers["webhook-signature"] as string | undefined) ??
      (req.headers["x-webhook-signature"] as string | undefined);

    const valid = verifyJubelioSignature(rawBody, this.config.webhookSecret, signatureHeader);
    if (!valid) {
      this.logger.warn(`Signature mismatch on webhook ${typedEvent}`);
      void this.admin.write({
        category: "JUBELIO_WEBHOOK_SIGNATURE_FAIL",
        severity: "WARN",
        title: "Jubelio webhook signature mismatch",
        message: `Received ${typedEvent} webhook with invalid signature; rejected with 401.`,
        metadata: { event: typedEvent, headerPresent: Boolean(signatureHeader) },
      });
      throw new UnauthorizedException("Invalid webhook signature");
    }

    const eventId =
      typeof req.headers["webhook-event-id"] === "string"
        ? (req.headers["webhook-event-id"] as string)
        : undefined;

    return this.service.persist({
      event: typedEvent,
      rawBody,
      signature: signatureHeader ?? "",
      eventId,
    });
  }
}
