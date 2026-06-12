import { deriveStatus } from "./status-derive";

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
