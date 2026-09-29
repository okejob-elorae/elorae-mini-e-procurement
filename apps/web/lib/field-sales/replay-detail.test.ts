import { describe, it, expect } from "vitest";
import { recordedQtyByShipmentLine } from "./replay-detail";

describe("recordedQtyByShipmentLine", () => {
  it("maps each shipment line to its order line's recorded quantity", () => {
    const result = recordedQtyByShipmentLine(
      [
        { id: "s1", orderLineId: "o1", plannedQty: 4 },
        { id: "s2", orderLineId: "o2", plannedQty: 4 },
      ],
      { lines: [{ orderLineId: "o1", qty: 3 }, { orderLineId: "o2", qty: 1 }] },
    );
    expect(result).toEqual(new Map([["s1", 3], ["s2", 1]]));
  });

  it("gives a shipment line the recorded delivery lacks 0", () => {
    const result = recordedQtyByShipmentLine(
      [
        { id: "s1", orderLineId: "o1", plannedQty: 4 },
        { id: "s2", orderLineId: "o2", plannedQty: 4 },
      ],
      { lines: [{ orderLineId: "o1", qty: 3 }] },
    );
    expect(result.get("s2")).toBe(0);
  });

  it("gives a shared order line's recorded sum to its FIRST shipment line only", () => {
    const result = recordedQtyByShipmentLine(
      [
        { id: "s1", orderLineId: "o1", plannedQty: 5 },
        { id: "s2", orderLineId: "o1", plannedQty: 5 },
        { id: "s3", orderLineId: "o2", plannedQty: 5 },
      ],
      { lines: [{ orderLineId: "o1", qty: 4 }, { orderLineId: "o2", qty: 2 }] },
    );
    expect(result).toEqual(new Map([["s1", 4], ["s2", 0], ["s3", 2]]));
  });

  it("carries a shared sum past a first line planned for less, never above any line's plan", () => {
    const result = recordedQtyByShipmentLine(
      [
        { id: "s1", orderLineId: "o1", plannedQty: 2 },
        { id: "s2", orderLineId: "o1", plannedQty: 3 },
      ],
      { lines: [{ orderLineId: "o1", qty: 4 }] },
    );
    expect(result).toEqual(new Map([["s1", 2], ["s2", 2]]));
  });
});
