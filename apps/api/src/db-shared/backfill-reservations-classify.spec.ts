import { classifyForBackfill } from "../../../../packages/db/src/backfill-reservations-classify";

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
});
