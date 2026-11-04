import { describe, expect, it } from "vitest";
import { kelompokkanRun } from "./kelompok-run";

const r = (id: string, status: string, sebab = "api") => ({ id, status, sebab });

describe("kelompokkanRun", () => {
  it("kegagalan berurutan dengan sebab sama menjadi satu kelompok", () => {
    const g = kelompokkanRun([r("1", "FAILED"), r("2", "FAILED"), r("3", "FAILED")], (x) => x.sebab);
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ jenis: "gagalBeruntun", sebab: "api" });
    expect(g[0].jenis === "gagalBeruntun" && g[0].runs.map((x) => x.id)).toEqual(["1", "2", "3"]);
  });

  it("run berhasil atau sebab lain memutus kelompok; gagal tunggal tetap baris biasa", () => {
    const g = kelompokkanRun(
      [r("1", "FAILED"), r("2", "COMPLETED"), r("3", "FAILED"), r("4", "FAILED", "snapshot"), r("5", "FAILED", "snapshot")],
      (x) => x.sebab,
    );
    expect(g.map((x) => (x.jenis === "tunggal" ? x.run.id : `[${x.runs.map((y) => y.id).join(",")}]`))).toEqual([
      "1",
      "2",
      "3",
      "[4,5]",
    ]);
  });

  it("daftar kosong tetap kosong", () => {
    expect(kelompokkanRun([], () => "")).toEqual([]);
  });
});
