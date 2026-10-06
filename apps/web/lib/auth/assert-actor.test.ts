import { describe, expect, it } from "vitest";
import { ActorMismatchError, assertActor } from "./assert-actor";

describe("assertActor", () => {
  it("passes when the claimed id is the session user", () => {
    expect(() => assertActor("u1", "u1")).not.toThrow();
  });

  it("refuses a claimed id that is not the session user", () => {
    expect(() => assertActor("u1", "u2")).toThrow(ActorMismatchError);
  });

  it("refuses an empty claimed id", () => {
    expect(() => assertActor("u1", "")).toThrow(ActorMismatchError);
  });
});
