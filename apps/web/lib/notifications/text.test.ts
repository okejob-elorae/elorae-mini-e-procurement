import { describe, it, expect } from "vitest";
import { capNotificationText, NOTIFICATION_TEXT_MAX } from "./text";

describe("capNotificationText", () => {
  it("returns text that fits unchanged, up to exactly the limit", () => {
    expect(capNotificationText("Perhitungan stok bulanan")).toBe("Perhitungan stok bulanan");
    const exact = "a".repeat(NOTIFICATION_TEXT_MAX);
    expect(capNotificationText(exact)).toBe(exact);
  });

  it("cuts overlong text to the limit, ending in an ellipsis", () => {
    const capped = capNotificationText("a".repeat(NOTIFICATION_TEXT_MAX + 1));
    expect(Array.from(capped)).toHaveLength(NOTIFICATION_TEXT_MAX);
    expect(capped.endsWith("…")).toBe(true);
    expect(capped.slice(0, -1)).toBe("a".repeat(NOTIFICATION_TEXT_MAX - 1));
  });

  it("honours a custom limit", () => {
    expect(capNotificationText("abcdef", 4)).toBe("abc…");
  });

  it("counts code points, never splitting a surrogate pair", () => {
    const emoji = "😀";
    expect(capNotificationText(emoji.repeat(4), 4)).toBe(emoji.repeat(4));
    const capped = capNotificationText(emoji.repeat(5), 4);
    expect(capped).toBe(`${emoji.repeat(3)}…`);
    expect(Array.from(capped)).toHaveLength(4);
  });
});
