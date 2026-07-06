import { describe, it, expect } from "vitest";
import { attachVisitPhoto, VisitOwnershipError } from "./visit-photo-writer";

type Opts = { existing?: { id: string; url: string } | null; owned?: boolean };
function fakeTx(opts: Opts) {
  let created: unknown = null;
  const tx = {
    visitPhoto: {
      findUnique: async () => opts.existing ?? null,
      create: async ({ data }: { data: { url: string } }) => { created = { id: "new-id", url: data.url }; return created; },
    },
    storeVisit: {
      findFirst: async () => (opts.owned ? { id: "v1" } : null),
    },
  };
  return { tx, getCreated: () => created };
}
const base = { visitId: "v1", salesmanId: "s1", clientId: "c1", url: "https://r2/x.jpg", r2Key: "visit-photos/v1/c1.jpg", capturedAt: new Date(0) };

describe("attachVisitPhoto", () => {
  it("returns the existing row on clientId replay, never creates", async () => {
    const { tx, getCreated } = fakeTx({ existing: { id: "old", url: "https://r2/old.jpg" }, owned: true });
    const r = await attachVisitPhoto(tx as never, base);
    expect(r).toEqual({ id: "old", url: "https://r2/old.jpg" });
    expect(getCreated()).toBeNull();
  });
  it("throws VisitOwnershipError when the visit is not the salesman's", async () => {
    const { tx } = fakeTx({ existing: null, owned: false });
    await expect(attachVisitPhoto(tx as never, base)).rejects.toBeInstanceOf(VisitOwnershipError);
  });
  it("creates + returns when new and owned", async () => {
    const { tx } = fakeTx({ existing: null, owned: true });
    const r = await attachVisitPhoto(tx as never, base);
    expect(r).toEqual({ id: "new-id", url: "https://r2/x.jpg" });
  });
});
