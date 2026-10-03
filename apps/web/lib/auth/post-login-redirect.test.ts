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

describe("computePostLoginRedirect — kembali ke halaman yang diminta", () => {
  it("returns the requested page inside the user's own area", () => {
    expect(computePostLoginRedirect(["pwa:access"], "/pwa/spg/sale")).toBe("/pwa/spg/sale");
    expect(computePostLoginRedirect(["*"], "/backoffice/sales-orders?status=NEW")).toBe("/backoffice/sales-orders?status=NEW");
    expect(computePostLoginRedirect(["inventory_opname:count"], "/gudang-retur")).toBe("/gudang-retur");
  });

  it("ignores a page outside the user's area", () => {
    expect(computePostLoginRedirect(["pwa:access"], "/backoffice/dashboard")).toBe("/pwa");
    expect(computePostLoginRedirect(["*"], "/pwa/spg/sale")).toBe("/backoffice");
  });

  it("never follows an outside address, the login page itself or the api", () => {
    for (const buruk of ["https://jahat.example/pwa", "//jahat.example/pwa", "/\\jahat.example", "/login", "/login/redirect", "/api/auth/signout", "pwa", "", null, undefined]) {
      expect(computePostLoginRedirect(["pwa:access"], buruk)).toBe("/pwa");
    }
    expect(computePostLoginRedirect(["*"], "/backofficeX")).toBe("/backoffice");
    expect(computePostLoginRedirect(["pwa:access"], "/pwaX/curi")).toBe("/pwa");
  });
});
