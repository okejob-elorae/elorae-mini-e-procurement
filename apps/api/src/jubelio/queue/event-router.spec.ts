import { Test } from "@nestjs/testing";
import { JubelioEventRouter } from "./event-router";
import { StockWebhookHandler } from "../handlers/stock.handler";
import { UnhandledEventHandler } from "../handlers/unhandled.handler";
import { PRISMA } from "../../db/prisma.module";
import { SKIP_REASONS } from "./webhook-status";

function row(event: string) {
  return {
    id: "r1",
    event,
    rawPayload: {},
  } as any;
}

describe("JubelioEventRouter", () => {
  let router: JubelioEventRouter;
  let stockHandler: { handle: jest.Mock };

  beforeEach(async () => {
    stockHandler = { handle: jest.fn().mockResolvedValue({ kind: "processed" }) };
    const mod = await Test.createTestingModule({
      providers: [
        JubelioEventRouter,
        { provide: StockWebhookHandler, useValue: stockHandler },
        UnhandledEventHandler,
        { provide: PRISMA, useValue: {} },
      ],
    }).compile();
    router = mod.get(JubelioEventRouter);
  });

  it("routes `stock` to StockWebhookHandler", async () => {
    const result = await router.route(row("stock"));
    expect(stockHandler.handle).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ kind: "processed" });
  });

  it.each(["salesorder", "salesreturn", "product"])(
    "routes `%s` to SKIPPED unhandled_event_type",
    async (event) => {
      const result = await router.route(row(event));
      expect(stockHandler.handle).not.toHaveBeenCalled();
      expect(result).toEqual({ kind: "skipped", reason: SKIP_REASONS.UNHANDLED_EVENT_TYPE });
    },
  );

  it("routes unknown event type to SKIPPED unknown_event:<x>", async () => {
    const result = await router.route(row("mystery"));
    expect(result).toEqual({ kind: "skipped", reason: `${SKIP_REASONS.UNKNOWN_EVENT}:mystery` });
  });
});
