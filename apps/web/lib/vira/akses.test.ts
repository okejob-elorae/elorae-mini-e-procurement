import { describe, expect, it } from "vitest";
import { gateAllows, requireViraUse, type ViraActor, type ViraGate } from "./akses";
import { ViraAuthError } from "./errors";

const SETS = {
  none: [] as string[],
  x: ["x:view"],
  other: ["other:view"],
  star: ["*"],
};

type Row = { gate: ViraGate; none: boolean; x: boolean; other: boolean; star: boolean };

const ROWS: Array<[string, Row]> = [
  ["anyValidToken", { gate: { kind: "anyValidToken" }, none: true, x: true, other: true, star: true }],
  ["code x:view", { gate: { kind: "code", code: "x:view" }, none: false, x: true, other: false, star: true }],
  [
    "anyOf [x:view, y:view]",
    { gate: { kind: "anyOf", codes: ["x:view", "y:view"] }, none: false, x: true, other: false, star: true },
  ],
  [
    "anyOf []",
    { gate: { kind: "anyOf", codes: [] }, none: false, x: false, other: false, star: false },
  ],
  [
    "allOf [x:view]",
    { gate: { kind: "allOf", codes: ["x:view"] }, none: false, x: true, other: false, star: true },
  ],
  [
    "allOf [x:view, other:view]",
    { gate: { kind: "allOf", codes: ["x:view", "other:view"] }, none: false, x: false, other: false, star: true },
  ],
  [
    "izin (has other:view)",
    {
      gate: { kind: "izin", name: "lihatLain", check: (p) => p.includes("other:view") },
      none: false,
      x: false,
      other: true,
      star: false,
    },
  ],
];

describe("gateAllows", () => {
  for (const [label, row] of ROWS) {
    for (const set of ["none", "x", "other", "star"] as const) {
      it(`${label} × ${JSON.stringify(SETS[set])} → ${row[set]}`, () => {
        expect(gateAllows(row.gate, SETS[set])).toBe(row[set]);
      });
    }
  }

  it("izin passes the permissions straight to check", () => {
    const seen: string[][] = [];
    gateAllows({ kind: "izin", name: "spy", check: (p) => (seen.push(p), true) }, ["a:b"]);
    expect(seen).toEqual([["a:b"]]);
  });
});

describe("requireViraUse", () => {
  const actor = (permissions: string[]): ViraActor => ({ id: "u1", name: "User", permissions });

  it('["vira:use"] passes', () => {
    expect(() => requireViraUse(actor(["vira:use"]))).not.toThrow();
  });

  it('["*"] passes', () => {
    expect(() => requireViraUse(actor(["*"]))).not.toThrow();
  });

  it('["items:view"] throws "forbidden"', () => {
    let err: unknown;
    try {
      requireViraUse(actor(["items:view"]));
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ViraAuthError);
    expect((err as ViraAuthError).reason).toBe("forbidden");
  });
});
