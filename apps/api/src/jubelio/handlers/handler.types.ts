import type { JubelioWebhookEvent } from "@elorae/db";

export type HandlerOutcome =
  | { kind: "processed" }
  | { kind: "skipped"; reason: string };

export interface WebhookEventHandler {
  handle(row: JubelioWebhookEvent): Promise<HandlerOutcome>;
}
