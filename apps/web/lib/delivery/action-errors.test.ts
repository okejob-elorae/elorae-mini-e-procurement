import { describe, it, expect, vi, afterEach } from "vitest";
import { mapError } from "./action-errors";
import { DeliveryShipmentError } from "./errors";
import { DeliveryError } from "@/lib/field-sales/errors";

describe("mapError", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes a DeliveryShipmentError code through", () => {
    expect(mapError(new DeliveryShipmentError("INVALID_CARRIER"), "t")).toEqual({
      ok: false,
      reason: "INVALID_CARRIER",
    });
  });

  it("passes a DeliveryError code through without a replay", () => {
    expect(mapError(new DeliveryError("OVER_DELIVER"), "t")).toEqual({
      ok: false,
      reason: "OVER_DELIVER",
    });
  });

  it("serializes the replay of a DeliveryError", () => {
    const error = new DeliveryError("REPLAY_MISMATCH", [], {
      deliveryId: "d1",
      docNo: "DLV/1",
      invoiceDate: new Date("2026-03-01T00:00:00.000+07:00"),
      dueDate: new Date("2026-03-15T00:00:00.000+07:00"),
      lines: [{ orderLineId: "l1", qty: 3 }],
    });
    expect(mapError(error, "t")).toEqual({
      ok: false,
      reason: "REPLAY_MISMATCH",
      replay: {
        deliveryId: "d1",
        docNo: "DLV/1",
        invoiceDate: "2026-03-01",
        dueDate: "2026-03-15",
        lines: [{ orderLineId: "l1", qty: 3 }],
      },
    });
  });

  it("maps anything else to UNEXPECTED and logs under the caller's tag", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const boom = new Error("boom");
    expect(mapError(boom, "pwa/deliveries")).toEqual({ ok: false, reason: "UNEXPECTED" });
    expect(spy).toHaveBeenCalledWith("[pwa/deliveries] unexpected failure", boom);
  });
});
