import { describe, expect, it } from "vitest";
import { bisaDiterapkan, saringKelasToko, type BarisSaringKelas } from "./saring-kelas";

const baris: BarisSaringKelas[] = [
  { storeId: "a", code: "TK-001", name: "Toko Sinar Jaya", kelas: null, usulan: "A" },
  { storeId: "b", code: "TK-002", name: "Toko Mekar Sari", kelas: null, usulan: null },
  { storeId: "c", code: "TK-003", name: "Butik Anggrek", kelas: "B", usulan: "B" },
  { storeId: "d", code: "TK-004", name: "Toko Melati", kelas: "C", usulan: "A" },
];

describe("bisaDiterapkan", () => {
  it("is true only when a suggestion exists and differs from the current class", () => {
    expect(bisaDiterapkan({ kelas: null, usulan: "A" })).toBe(true);
    expect(bisaDiterapkan({ kelas: "C", usulan: "A" })).toBe(true);
    expect(bisaDiterapkan({ kelas: "B", usulan: "B" })).toBe(false);
    expect(bisaDiterapkan({ kelas: null, usulan: null })).toBe(false);
    expect(bisaDiterapkan({ kelas: "A", usulan: null })).toBe(false);
  });
});

describe("saringKelasToko", () => {
  it("with the differs-only filter, shows the applicable rows and counts what it hid and why", () => {
    const h = saringKelasToko(baris, "", true);
    expect(h.tampil.map((b) => b.storeId)).toEqual(["a", "d"]);
    expect(h.cocokCari).toBe(4);
    expect(h.tanpaBeli).toBe(1);
    expect(h.sudahSesuai).toBe(1);
  });

  it("without the filter, shows every row and hides nothing", () => {
    const h = saringKelasToko(baris, "", false);
    expect(h.tampil).toHaveLength(4);
    expect(h.cocokCari).toBe(4);
    expect(h.tanpaBeli).toBe(0);
    expect(h.sudahSesuai).toBe(0);
  });

  it("counts hidden rows only among those matching the search", () => {
    const h = saringKelasToko(baris, "  toko ", true);
    expect(h.tampil.map((b) => b.storeId)).toEqual(["a", "d"]);
    expect(h.cocokCari).toBe(3);
    expect(h.tanpaBeli).toBe(1);
    expect(h.sudahSesuai).toBe(0);
  });

  it("searches name and code case-insensitively", () => {
    expect(saringKelasToko(baris, "tk-003", false).tampil.map((b) => b.storeId)).toEqual(["c"]);
    expect(saringKelasToko(baris, "ANGGREK", false).tampil.map((b) => b.storeId)).toEqual(["c"]);
    expect(saringKelasToko(baris, "tidak ada", true)).toEqual({ tampil: [], cocokCari: 0, tanpaBeli: 0, sudahSesuai: 0 });
  });
});
