import { Injectable } from "@nestjs/common";
import { SKIP_REASONS } from "../queue/webhook-status";
import type { HandlerOutcome, WebhookEventHandler } from "./handler.types";

@Injectable()
export class UnhandledEventHandler implements WebhookEventHandler {
  async handle(): Promise<HandlerOutcome> {
    return { kind: "skipped", reason: SKIP_REASONS.UNHANDLED_EVENT_TYPE };
  }
}
