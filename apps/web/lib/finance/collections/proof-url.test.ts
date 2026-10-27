import { describe, it, expect } from "vitest";
import { urlFromKey } from "@/lib/r2";
import { collectionProofUrl } from "./proof-url";

describe("collectionProofUrl", () => {
  it("derives the URL from a key directly under the receivable's folder", () => {
    const key = "collection-proofs/rec1/client1.jpg";
    expect(collectionProofUrl({ receivableId: "rec1", proofR2Key: key })).toBe(urlFromKey(key));
  });

  it.each([
    ["an absent key", null],
    ["another receivable's folder", "collection-proofs/rec2/client1.jpg"],
    ["a traversal path", "collection-proofs/rec1/../rec2/client1.jpg"],
    ["a foreign prefix", "settlement-proofs/rec1/client1.jpg"],
  ])("returns null for %s", (_label, key) => {
    expect(collectionProofUrl({ receivableId: "rec1", proofR2Key: key })).toBeNull();
  });

  it("never reads a stored proofUrl", () => {
    const row = { receivableId: "rec1", proofR2Key: null, proofUrl: "https://evil.example/x.jpg" };
    expect(collectionProofUrl(row)).toBeNull();
  });
});
