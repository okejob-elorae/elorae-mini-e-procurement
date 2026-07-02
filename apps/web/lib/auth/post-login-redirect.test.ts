import { describe, it, expect } from "vitest";
import { computePostLoginRedirect } from "./post-login-redirect";

describe("computePostLoginRedirect", () => {
  it("returns /pwa when permissions contain pwa:access and no wildcard", () => {
    expect(computePostLoginRedirect(["pwa:access"])).toBe("/pwa");
  });

  it("returns /backoffice for wildcard admin even with pwa:access present", () => {
    expect(computePostLoginRedirect(["*", "pwa:access"])).toBe("/backoffice");
  });

  it("returns /backoffice for wildcard-only admin", () => {
    expect(computePostLoginRedirect(["*"])).toBe("/backoffice");
  });

  it("returns /backoffice for a backoffice user without pwa:access", () => {
    expect(computePostLoginRedirect(["items:view", "suppliers:view"])).toBe(
      "/backoffice"
    );
  });

  it("returns /backoffice for empty permissions", () => {
    expect(computePostLoginRedirect([])).toBe("/backoffice");
  });
});
