import { assertNotProdApply, classifyForBackfill } from "../../../../packages/db/src/backfill-reservations-classify";

describe("classifyForBackfill", () => {
  it("shipped order -> mark-consumed (onHand already correct)", () => {
    expect(classifyForBackfill({ isCanceled: false, fulfillmentStatus: "SHIPPED", status: "SHIPPED" }).action).toBe("mark-consumed");
  });
  it("cancelled order -> mark-released (old cancel already reversed onHand)", () => {
    expect(classifyForBackfill({ isCanceled: true, fulfillmentStatus: "PENDING", status: "CANCELLED" }).action).toBe("mark-released");
  });
  it("in-flight unshipped order -> reserve-and-restore (undo old deduct, reserve instead)", () => {
    expect(classifyForBackfill({ isCanceled: false, fulfillmentStatus: "PENDING", status: "PROCESSING" }).action).toBe("reserve-and-restore");
  });
  it("returned order -> mark-consumed (return happens after ship, onHand already correct)", () => {
    expect(classifyForBackfill({ isCanceled: false, fulfillmentStatus: "PENDING", status: "RETURNED" }).action).toBe("mark-consumed");
  });
});

describe("assertNotProdApply", () => {
  it("throws when --apply targets the prod SSH tunnel (port 3307)", () => {
    expect(() => assertNotProdApply("mysql://elorae:elorae@127.0.0.1:3307/elorae", true)).toThrow();
  });
  it("does not throw when --apply targets the local test DB (port 3308)", () => {
    expect(() => assertNotProdApply("mysql://elorae:elorae@127.0.0.1:3308/elorae", true)).not.toThrow();
  });
  it("does not throw on dry-run against the prod tunnel (no --apply)", () => {
    expect(() => assertNotProdApply("mysql://elorae:elorae@127.0.0.1:3307/elorae", false)).not.toThrow();
  });
});
