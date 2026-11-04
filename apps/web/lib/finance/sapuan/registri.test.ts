import { describe, expect, it } from "vitest";
import { daftarkanSumberSapuan, semuaSumberSapuan, type SumberSapuan } from "./registri";

const sumber = (sourceType: string, label = sourceType): SumberSapuan => ({
  sourceType,
  label,
  cariTanpaJurnal: async () => [],
  posting: async () => ({ ok: false, code: "NOTHING_TO_POST" }),
});

describe("registri sapuan", () => {
  it("mendaftar berurutan; sourceType yang sama menggantikan (aman untuk HMR); kosong ditolak", () => {
    const awal = semuaSumberSapuan().length;
    daftarkanSumberSapuan(sumber("UJI_SAPUAN_A"));
    daftarkanSumberSapuan(sumber("UJI_SAPUAN_B"));
    daftarkanSumberSapuan(sumber("UJI_SAPUAN_A", "A baru"));
    const semua = semuaSumberSapuan();
    expect(semua.length).toBe(awal + 2);
    expect(semua.slice(-2).map((s) => [s.sourceType, s.label])).toEqual([
      ["UJI_SAPUAN_A", "A baru"],
      ["UJI_SAPUAN_B", "UJI_SAPUAN_B"],
    ]);
    expect(() => daftarkanSumberSapuan(sumber("  "))).toThrow();
  });

  it("semuaSumberSapuan mengembalikan salinan, bukan larik dalamnya", () => {
    const a = semuaSumberSapuan() as SumberSapuan[];
    a.length = 0;
    expect(semuaSumberSapuan().length).toBeGreaterThan(0);
  });
});
