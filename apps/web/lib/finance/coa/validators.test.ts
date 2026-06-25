import { describe, it, expect } from "vitest";
import {
  validateCreate,
  validateReparent,
  validateDeactivate,
} from "./validators";

const aRoot = { id: "a", code: "1", type: "ASET" as const, depth: 1, isActive: true, parentId: null };
const aLancar = { id: "b", code: "11", type: "ASET" as const, depth: 2, isActive: true, parentId: "a" };
const kas = { id: "c", code: "1101", type: "ASET" as const, depth: 3, isActive: true, parentId: "b" };
const beban = { id: "d", code: "6", type: "BEBAN" as const, depth: 1, isActive: true, parentId: null };

describe("validateCreate", () => {
  it("accepts a valid child under an active parent", () => {
    expect(validateCreate({ code: "12", name: "Aset Tetap", parentId: "a" }, aRoot)).toEqual({ ok: true });
  });
  it("rejects code that does not start with parent code", () => {
    expect(validateCreate({ code: "21", name: "x", parentId: "a" }, aRoot)).toMatchObject({ ok: false, code: "code_prefix_mismatch" });
  });
  it("rejects code shorter than parent code + 1", () => {
    expect(validateCreate({ code: "1", name: "x", parentId: "a" }, aRoot)).toMatchObject({ ok: false, code: "code_too_short" });
  });
  it("rejects code longer than 8 chars", () => {
    expect(validateCreate({ code: "123456789", name: "x", parentId: null, type: "ASET" }, null)).toMatchObject({ ok: false, code: "code_too_long" });
  });
  it("rejects non-digit code", () => {
    expect(validateCreate({ code: "1A", name: "x", parentId: "a" }, aRoot)).toMatchObject({ ok: false, code: "code_format_invalid" });
  });
  it("rejects depth > 4", () => {
    const deep = { ...kas, code: "110101", depth: 4, parentId: "c" };
    expect(validateCreate({ code: "11010101", name: "x", parentId: "x" }, deep)).toMatchObject({ ok: false, code: "max_depth_exceeded" });
  });
  it("rejects creation under inactive parent", () => {
    expect(validateCreate({ code: "12", name: "x", parentId: "a" }, { ...aRoot, isActive: false })).toMatchObject({ ok: false, code: "parent_inactive" });
  });
  it("requires type when parentId is null", () => {
    expect(validateCreate({ code: "9", name: "x", parentId: null }, null)).toMatchObject({ ok: false, code: "root_type_required" });
  });
  it("ignores client type when parent given (inherit + lock)", () => {
    expect(validateCreate({ code: "12", name: "x", parentId: "a", type: "BEBAN" }, aRoot)).toEqual({ ok: true });
  });
});

describe("validateReparent", () => {
  it("accepts leaf reparent under same-type new parent", () => {
    const newParent = { id: "e", code: "12", type: "ASET" as const, depth: 2, isActive: true, parentId: "a" };
    expect(validateReparent(kas, newParent, [aRoot, aLancar, kas, newParent])).toEqual({ ok: true });
  });
  it("rejects reparent if account has children", () => {
    expect(validateReparent(aLancar, aRoot, [aRoot, aLancar, kas])).toMatchObject({ ok: false, code: "has_children_reparent_forbidden" });
  });
  it("rejects reparent to self (cycle)", () => {
    // kas is a leaf; reparenting it under itself is a direct self-cycle.
    expect(validateReparent(kas, kas, [aRoot, aLancar, kas])).toMatchObject({ ok: false, code: "cycle_detected" });
  });
  it("rejects reparent across types", () => {
    expect(validateReparent(kas, beban, [aRoot, aLancar, kas, beban])).toMatchObject({ ok: false, code: "reparent_type_mismatch" });
  });
});

describe("validateDeactivate", () => {
  it("accepts deactivate when no active children", () => {
    expect(validateDeactivate(kas, 0)).toEqual({ ok: true });
  });
  it("rejects deactivate when active children exist", () => {
    expect(validateDeactivate(aRoot, 3)).toMatchObject({ ok: false, code: "has_active_children" });
  });
});
