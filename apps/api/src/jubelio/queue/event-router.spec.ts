import { Test } from "@nestjs/testing";
import { JubelioEventRouter } from "./event-router";
import { StockWebhookHandler } from "../handlers/stock.handler";
import { SalesOrderWebhookHandler } from "../handlers/salesorder.handler";
import { SalesReturnWebhookHandler } from "../handlers/salesreturn.handler";
import { ProductWebhookHandler } from "../handlers/product.handler";
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
  let salesOrderHandler: { handle: jest.Mock };
  let salesReturnHandler: { handle: jest.Mock };
  let productHandler: { handle: jest.Mock };

  beforeEach(async () => {
    stockHandler = { handle: jest.fn().mockResolvedValue({ kind: "processed" }) };
    salesOrderHandler = { handle: jest.fn() };
    salesReturnHandler = { handle: jest.fn() };
    productHandler = { handle: jest.fn() };
    const mod = await Test.createTestingModule({
      providers: [
        JubelioEventRouter,
        { provide: StockWebhookHandler, useValue: stockHandler },
        { provide: SalesOrderWebhookHandler, useValue: salesOrderHandler },
        { provide: SalesReturnWebhookHandler, useValue: salesReturnHandler },
        { provide: ProductWebhookHandler, useValue: productHandler },
      ],
    }).compile();
    router = mod.get(JubelioEventRouter);
  });

  it("routes `stock` to StockWebhookHandler", async () => {
    const result = await router.route(row("stock"));
    expect(stockHandler.handle).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ kind: "processed" });
  });

  it("routes salesorder to SalesOrderWebhookHandler", async () => {
    salesOrderHandler.handle.mockResolvedValue({ kind: "processed" });
    const result = await router.route(row("salesorder"));
    expect(salesOrderHandler.handle).toHaveBeenCalled();
    expect(result).toEqual({ kind: "processed" });
  });

  it("routes salesreturn to SalesReturnWebhookHandler", async () => {
    salesReturnHandler.handle.mockResolvedValue({ kind: "skipped", reason: "awaiting_samples" });
    const result = await router.route(row("salesreturn"));
    expect(salesReturnHandler.handle).toHaveBeenCalled();
    expect(result.kind).toBe("skipped");
  });

  it("routes product to ProductWebhookHandler", async () => {
    productHandler.handle.mockResolvedValue({ kind: "processed" });
    const result = await router.route(row("product"));
    expect(productHandler.handle).toHaveBeenCalled();
    expect(result).toEqual({ kind: "processed" });
  });

  it("routes unknown event type to SKIPPED unknown_event:<x>", async () => {
    const result = await router.route(row("mystery"));
    expect(result).toEqual({ kind: "skipped", reason: `${SKIP_REASONS.UNKNOWN_EVENT}:mystery` });
  });
});
