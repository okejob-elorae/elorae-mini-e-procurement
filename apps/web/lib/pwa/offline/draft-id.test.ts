import { describe, expect, it } from "vitest";
import { createDraftIdHolder } from "./draft-id";

function counter() {
  let n = 0;
  return () => `id-${++n}`;
}

describe("createDraftIdHolder", () => {
  it("returns the same id for the same draft signature", () => {
    const holder = createDraftIdHolder(counter());
    expect(holder.get("a")).toBe("id-1");
    expect(holder.get("a")).toBe("id-1");
  });

  it("mints a new id when the draft changes", () => {
    const holder = createDraftIdHolder(counter());
    expect(holder.get("a")).toBe("id-1");
    expect(holder.get("b")).toBe("id-2");
  });

  it("mints a new id after reset even for the same signature", () => {
    const holder = createDraftIdHolder(counter());
    expect(holder.get("a")).toBe("id-1");
    holder.reset();
    expect(holder.get("a")).toBe("id-2");
  });
});
