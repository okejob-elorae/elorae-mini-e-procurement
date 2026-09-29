import { describe, expect, it } from "vitest";
import { buildR2Key, InvalidR2KeyError, isSafeR2KeySegment } from "./r2-key";

describe("buildR2Key", () => {
  it("builds keys for every realistic fragment shape", () => {
    const cuid = "cm9x2k1a30000abcdefghijklm";
    const uuid = "3b241101-e2bb-4255-8caf-4136c566a962";
    const local = `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    expect(buildR2Key("collection-proofs", [cuid, uuid], "jpg")).toBe(`collection-proofs/${cuid}/${uuid}.jpg`);
    expect(buildR2Key("visit-photos", [cuid, local], "webp")).toBe(`visit-photos/${cuid}/${local}.webp`);
    expect(buildR2Key("delivery-pod-proofs", [cuid, "goods"], "png")).toBe(`delivery-pod-proofs/${cuid}/goods.png`);
    expect(buildR2Key("settlement-proofs", [uuid, "program-3"], "jpg")).toBe(`settlement-proofs/${uuid}/program-3.jpg`);
    expect(buildR2Key("items", ["_pending", uuid], "jpeg")).toBe(`items/_pending/${uuid}.jpeg`);
    expect(buildR2Key("delivery-proofs", [cuid, String(Date.now())], "jpg")).toMatch(/^delivery-proofs\/[a-z0-9]+\/\d+\.jpg$/);
  });

  it.each([
    ["../x"],
    ["a/b"],
    ["a.b"],
    ["."],
    [".."],
    [""],
    ["a".repeat(65)],
    ["a b"],
    ["a\tb"],
    ["%2F"],
    ["a\\b"],
  ])("rejects segment %j", (bad) => {
    expect(() => buildR2Key("items", [bad], "jpg")).toThrow(InvalidR2KeyError);
  });

  it("accepts a 64-char segment", () => {
    expect(buildR2Key("items", ["a".repeat(64)], "jpg")).toBe(`items/${"a".repeat(64)}.jpg`);
  });

  it.each([["JPG"], ["j.pg"], [""], ["abcdef"], ["j"]])("rejects ext %j", (bad) => {
    expect(() => buildR2Key("items", ["ok"], bad)).toThrow(InvalidR2KeyError);
  });

  it("rejects an empty segments array", () => {
    expect(() => buildR2Key("items", [], "jpg")).toThrow(InvalidR2KeyError);
  });

  it("names the failing fragment", () => {
    try {
      buildR2Key("items", ["ok", "../x"], "jpg");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidR2KeyError);
      expect((e as InvalidR2KeyError).fragment).toBe("segment");
      expect((e as InvalidR2KeyError).value).toBe("../x");
      expect((e as Error).message).toContain("../x");
    }
    try {
      buildR2Key("items", ["ok"], "JPG");
      expect.unreachable();
    } catch (e) {
      expect((e as InvalidR2KeyError).fragment).toBe("ext");
      expect((e as InvalidR2KeyError).value).toBe("JPG");
    }
  });
});

describe("isSafeR2KeySegment", () => {
  it("accepts safe strings", () => {
    expect(isSafeR2KeySegment("abc_DEF-123")).toBe(true);
  });

  it("rejects non-strings and unsafe strings", () => {
    expect(isSafeR2KeySegment(null)).toBe(false);
    expect(isSafeR2KeySegment(undefined)).toBe(false);
    expect(isSafeR2KeySegment(42)).toBe(false);
    expect(isSafeR2KeySegment({})).toBe(false);
    expect(isSafeR2KeySegment("a/b")).toBe(false);
    expect(isSafeR2KeySegment("")).toBe(false);
  });
});
