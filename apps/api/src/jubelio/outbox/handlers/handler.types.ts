import type { JubelioOutbox } from "@elorae/db";
import type { HandlerOutcome } from "../../handlers/handler.types";

export type { HandlerOutcome };

export interface OutboxHandler {
  handle(row: JubelioOutbox): Promise<HandlerOutcome>;
}
