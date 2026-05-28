import { Test } from "@nestjs/testing";
import { OutboxRouter } from "./outbox-router";
import { StockPushHandler } from "./handlers/stock-push.handler";
import { PRISMA } from "../../db/prisma.module";
import { JubelioHttpService } from "../http.service";
import { OUTBOX_SKIP_REASONS } from "./outbox-status";

function row(entityType: string) {
  return {
    id: "r1",
    entityType,
    entityId: "item_1",
    payload: {},
  } as any;
}

describe("OutboxRouter", () => {
  let router: OutboxRouter;
  let stockHandler: { handle: jest.Mock };

  beforeEach(async () => {
    stockHandler = { handle: jest.fn().mockResolvedValue({ kind: "processed" }) };
    const mod = await Test.createTestingModule({
      providers: [
        OutboxRouter,
        { provide: StockPushHandler, useValue: stockHandler },
        { provide: PRISMA, useValue: {} },
        { provide: JubelioHttpService, useValue: {} },
      ],
    }).compile();
    router = mod.get(OutboxRouter);
  });

  it("routes stock_push to StockPushHandler", async () => {
    const result = await router.route(row("stock_push"));
    expect(stockHandler.handle).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ kind: "processed" });
  });

  it("returns SKIPPED unknown_entity_type for an unknown entityType", async () => {
    const result = await router.route(row("mystery_push"));
    expect(stockHandler.handle).not.toHaveBeenCalled();
    expect(result).toEqual({
      kind: "skipped",
      reason: `${OUTBOX_SKIP_REASONS.UNKNOWN_ENTITY_TYPE}:mystery_push`,
    });
  });
});
