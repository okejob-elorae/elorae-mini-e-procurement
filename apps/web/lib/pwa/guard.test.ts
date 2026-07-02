import { describe, it, expect } from "vitest";
import { pwaAccessGuard } from "./guard";

describe("pwaAccessGuard", () => {
  it("renders for a salesman with pwa:access", () => {
    expect(pwaAccessGuard(["pwa:access"])).toBe("render");
  });

  it("redirects wildcard admin to backoffice (same rule as landing)", () => {
    expect(pwaAccessGuard(["*"])).toBe("redirect-backoffice");
    expect(pwaAccessGuard(["*", "pwa:access"])).toBe("redirect-backoffice");
  });

  it("redirects a backoffice user without pwa:access", () => {
    expect(pwaAccessGuard(["items:view"])).toBe("redirect-backoffice");
  });

  it("redirects on empty permissions", () => {
    expect(pwaAccessGuard([])).toBe("redirect-backoffice");
  });

  it("redirects on undefined permissions (defensive)", () => {
    expect(pwaAccessGuard(undefined)).toBe("redirect-backoffice");
  });
});
