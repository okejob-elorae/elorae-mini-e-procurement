import { describe, expect, it } from "vitest";
import { allocateOldestFirst } from "./allocate";

describe("allocateOldestFirst", () => {
  it("fills the oldest invoice first", () => {
    const out = allocateOldestFirst(500, [
      { receivableId: "new", dueDate: new Date("2026-06-01"), outstandingAmount: 1000 },
      { receivableId: "old", dueDate: new Date("2026-01-01"), outstandingAmount: 1000 },
    ]);
    expect(out).toEqual([{ receivableId: "old", amount: 500 }]);
  });

  it("spills into the next invoice once the oldest is full", () => {
    const out = allocateOldestFirst(1500, [
      { receivableId: "old", dueDate: new Date("2026-01-01"), outstandingAmount: 1000 },
      { receivableId: "new", dueDate: new Date("2026-06-01"), outstandingAmount: 1000 },
    ]);
    expect(out).toEqual([
      { receivableId: "old", amount: 1000 },
      { receivableId: "new", amount: 500 },
    ]);
  });

  it("omits invoices that receive nothing", () => {
    const out = allocateOldestFirst(300, [
      { receivableId: "old", dueDate: new Date("2026-01-01"), outstandingAmount: 1000 },
      { receivableId: "new", dueDate: new Date("2026-06-01"), outstandingAmount: 1000 },
    ]);
    expect(out.map((a) => a.receivableId)).toEqual(["old"]);
  });

  it("stops at the available outstanding rather than over-allocating", () => {
    const out = allocateOldestFirst(5000, [
      { receivableId: "only", dueDate: new Date("2026-01-01"), outstandingAmount: 1000 },
    ]);
    expect(out).toEqual([{ receivableId: "only", amount: 1000 }]);
  });

  it("returns nothing for a zero amount", () => {
    expect(
      allocateOldestFirst(0, [
        { receivableId: "old", dueDate: new Date("2026-01-01"), outstandingAmount: 1000 },
      ]),
    ).toEqual([]);
  });

  it("sorts invoices regardless of input order", () => {
    const out = allocateOldestFirst(500, [
      { receivableId: "new", dueDate: new Date("2026-06-01"), outstandingAmount: 1000 },
      { receivableId: "oldest", dueDate: new Date("2026-01-01"), outstandingAmount: 1000 },
      { receivableId: "middle", dueDate: new Date("2026-03-01"), outstandingAmount: 1000 },
    ]);
    expect(out).toEqual([{ receivableId: "oldest", amount: 500 }]);
  });

  it("breaks ties on dueDate deterministically by receivableId", () => {
    const sameDate = new Date("2026-01-01");
    const out1 = allocateOldestFirst(500, [
      { receivableId: "z", dueDate: sameDate, outstandingAmount: 1000 },
      { receivableId: "a", dueDate: sameDate, outstandingAmount: 1000 },
    ]);
    const out2 = allocateOldestFirst(500, [
      { receivableId: "a", dueDate: sameDate, outstandingAmount: 1000 },
      { receivableId: "z", dueDate: sameDate, outstandingAmount: 1000 },
    ]);
    expect(out1).toEqual(out2);
    expect(out1).toEqual([{ receivableId: "a", amount: 500 }]);
  });
});
