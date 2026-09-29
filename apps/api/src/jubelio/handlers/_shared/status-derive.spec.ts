import { deriveStatus, isCanceledOrder, isReturnedOrder, isShippedOrder } from "./status-derive";

describe("deriveStatus", () => {
  it("CANCELLED when is_canceled true", () => {
    expect(deriveStatus({ is_canceled: true })).toBe("CANCELLED");
  });

  it("CANCELLED when internal_status is CANCELED (Jubelio spelling)", () => {
    expect(deriveStatus({ internal_status: "CANCELED" })).toBe("CANCELLED");
  });

  it("CANCELLED takes precedence over marked_as_complete", () => {
    expect(deriveStatus({ is_canceled: true, marked_as_complete: true })).toBe("CANCELLED");
  });

  it("COMPLETED when marked_as_complete true", () => {
    expect(deriveStatus({ marked_as_complete: true })).toBe("COMPLETED");
  });

  it("COMPLETED when internal_status COMPLETED", () => {
    expect(deriveStatus({ internal_status: "COMPLETED" })).toBe("COMPLETED");
  });

  it("COMPLETED when completed_date set", () => {
    expect(deriveStatus({ completed_date: "2026-06-11T00:00:00Z" })).toBe("COMPLETED");
  });

  it("SHIPPED when wms_status SHIPPED", () => {
    expect(deriveStatus({ wms_status: "SHIPPED" })).toBe("SHIPPED");
  });

  it("SHIPPED when is_shipped true", () => {
    expect(deriveStatus({ is_shipped: true })).toBe("SHIPPED");
  });

  it("SHIPPED when internal_status SHIPPED (wms_status READY_TO_SHIP)", () => {
    expect(deriveStatus({ internal_status: "SHIPPED", wms_status: "READY_TO_SHIP" })).toBe("SHIPPED");
  });

  it("COMPLETED overrides internal_status SHIPPED when completed_date set", () => {
    expect(deriveStatus({ internal_status: "SHIPPED", completed_date: "2026-09-20T00:00:00Z" })).toBe("COMPLETED");
  });

  it("PROCESSING for wms_status PROCESSING", () => {
    expect(deriveStatus({ wms_status: "PROCESSING" })).toBe("PROCESSING");
  });

  it("PROCESSING for wms_status PICKED", () => {
    expect(deriveStatus({ wms_status: "PICKED" })).toBe("PROCESSING");
  });

  it("PROCESSING for wms_status PACKED", () => {
    expect(deriveStatus({ wms_status: "PACKED" })).toBe("PROCESSING");
  });

  it("PROCESSING for wms_status READY_TO_PACK", () => {
    expect(deriveStatus({ wms_status: "READY_TO_PACK" })).toBe("PROCESSING");
  });

  it("PROCESSING for wms_status READY_TO_SHIP", () => {
    expect(deriveStatus({ wms_status: "READY_TO_SHIP" })).toBe("PROCESSING");
  });

  it("PROCESSING for internal_status PROCESSING", () => {
    expect(deriveStatus({ internal_status: "PROCESSING" })).toBe("PROCESSING");
  });

  it("NEW when nothing else applies (empty input)", () => {
    expect(deriveStatus({})).toBe("NEW");
  });

  it("NEW when wms_status NEW", () => {
    expect(deriveStatus({ wms_status: "NEW" })).toBe("NEW");
  });

  it("COMPLETED overrides SHIPPED when both signaled", () => {
    expect(deriveStatus({ wms_status: "SHIPPED", marked_as_complete: true })).toBe("COMPLETED");
  });
});

describe("isCanceledOrder", () => {
  it("true when is_canceled true", () => {
    expect(isCanceledOrder({ is_canceled: true })).toBe(true);
  });

  it("true when internal_status CANCELED even though is_canceled is false", () => {
    expect(isCanceledOrder({ is_canceled: false, internal_status: "CANCELED" })).toBe(true);
  });

  it("false for an active order", () => {
    expect(isCanceledOrder({ is_canceled: false, internal_status: "PROCESSING" })).toBe(false);
  });
});

describe("isReturnedOrder", () => {
  it("true when internal_status RETURNED", () => {
    expect(isReturnedOrder({ internal_status: "RETURNED" })).toBe(true);
  });

  it("true when wms_status RETURNED", () => {
    expect(isReturnedOrder({ wms_status: "RETURNED" })).toBe(true);
  });

  it("false for a shipped or open order", () => {
    expect(isReturnedOrder({ internal_status: "PROCESSING", wms_status: "SHIPPED" })).toBe(false);
  });
});

describe("isShippedOrder", () => {
  it("true when wms_status SHIPPED", () => {
    expect(isShippedOrder({ wms_status: "SHIPPED" })).toBe(true);
  });

  it("true when is_shipped true", () => {
    expect(isShippedOrder({ is_shipped: true })).toBe(true);
  });

  it("true when internal_status SHIPPED even though wms_status is READY_TO_SHIP", () => {
    expect(isShippedOrder({ internal_status: "SHIPPED", wms_status: "READY_TO_SHIP" })).toBe(true);
  });

  it("false for an order still being processed", () => {
    expect(isShippedOrder({ internal_status: "PROCESSING", wms_status: "READY_TO_SHIP" })).toBe(false);
  });
});
