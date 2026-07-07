import { describe, it, expect } from "vitest";
import { scaledDimensions } from "./compress";

describe("scaledDimensions", () => {
  it("scales a landscape image down to the max longest edge", () => {
    expect(scaledDimensions(4000, 3000, 1600)).toEqual({ w: 1600, h: 1200 });
  });
  it("scales a portrait image by its longest edge", () => {
    expect(scaledDimensions(3000, 4000, 1600)).toEqual({ w: 1200, h: 1600 });
  });
  it("leaves an already-small image untouched", () => {
    expect(scaledDimensions(1000, 800, 1600)).toEqual({ w: 1000, h: 800 });
  });
  it("handles a square image", () => {
    expect(scaledDimensions(2000, 2000, 1600)).toEqual({ w: 1600, h: 1600 });
  });
});
