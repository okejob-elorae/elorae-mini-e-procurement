import { describe, expect, it } from "vitest";
import { hasPermission } from "@/lib/rbac";
import { VIRA_WRITE_PERMISSION } from "./config";

describe("vira:write permission", () => {
  it('hasPermission(["*"], "vira:write") === true', () => {
    expect(hasPermission(["*"], VIRA_WRITE_PERMISSION)).toBe(true);
  });

  it('hasPermission(["vira:use"], "vira:write") === false', () => {
    expect(hasPermission(["vira:use"], VIRA_WRITE_PERMISSION)).toBe(false);
  });
});
