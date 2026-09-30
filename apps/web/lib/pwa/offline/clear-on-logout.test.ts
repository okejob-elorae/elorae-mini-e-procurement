import { describe, expect, it } from "vitest";
import { countTotal, logoutBlockReason } from "./clear-on-logout";

const empty = { orders: 0, photos: 0, failedPhotos: 0, completions: 0 };

describe("logoutBlockReason", () => {
  it("allows logout when every queue is empty", () => {
    expect(logoutBlockReason(empty)).toBeNull();
  });

  it("blocks as unsynced when any order, completion or live photo row exists", () => {
    expect(logoutBlockReason({ ...empty, orders: 1 })).toBe("unsynced");
    expect(logoutBlockReason({ ...empty, photos: 2 })).toBe("unsynced");
    expect(logoutBlockReason({ ...empty, completions: 3 })).toBe("unsynced");
  });

  it("reports failedPhotosOnly when failed photos are the only rows", () => {
    expect(logoutBlockReason({ ...empty, failedPhotos: 2 })).toBe("failedPhotosOnly");
  });

  it("stays unsynced when failed photos sit beside any other row", () => {
    expect(logoutBlockReason({ ...empty, failedPhotos: 2, photos: 1 })).toBe("unsynced");
    expect(logoutBlockReason({ ...empty, failedPhotos: 1, orders: 1 })).toBe("unsynced");
    expect(logoutBlockReason({ ...empty, failedPhotos: 1, completions: 1 })).toBe("unsynced");
  });
});

describe("countTotal", () => {
  it("sums every queue including failed photos", () => {
    expect(countTotal({ orders: 1, photos: 2, failedPhotos: 4, completions: 3 })).toBe(10);
  });
});
