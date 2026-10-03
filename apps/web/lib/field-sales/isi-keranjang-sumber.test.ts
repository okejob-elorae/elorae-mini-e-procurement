import { describe, expect, it } from "vitest";
import { bacaSumberKeranjang, tulisSumberKeranjang } from "./isi-keranjang-sumber";

describe("bacaSumberKeranjang", () => {
  it("membaca permintaan dan rekomendasi, bolak-balik dengan tulisSumberKeranjang", () => {
    expect(bacaSumberKeranjang("permintaan:abc123")).toEqual({ jenis: "permintaan", id: "abc123" });
    expect(bacaSumberKeranjang("rekomendasi:cmx_9-Z")).toEqual({ jenis: "rekomendasi", id: "cmx_9-Z" });
    expect(tulisSumberKeranjang({ jenis: "permintaan", id: "abc" })).toBe("permintaan:abc");
  });

  it("menolak jenis lain, id kosong, atau karakter aneh", () => {
    for (const buruk of ["pesanan:abc", "permintaan:", "permintaan:a b", "permintaan:../x", "", null, undefined, "rekomendasi:" + "x".repeat(65)]) {
      expect(bacaSumberKeranjang(buruk)).toBeNull();
    }
  });
});
