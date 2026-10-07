import { describe, expect, it } from "vitest";
import { liburTetapTahun } from "@/lib/production/hari-kerja";
import { gabungLibur, samaHari, samaLibur } from "./hari-kerja-aturan";

describe("gabungLibur", () => {
  it("menambah libur tanggal tetap tanpa menggandakan, nama yang diketik tim tetap", () => {
    const lama = [
      { tanggal: "2026-12-25", nama: "Natal (kantor)" },
      { tanggal: "2026-03-20", nama: "Idulfitri 1447 H" },
    ];
    const hasil = gabungLibur(lama, liburTetapTahun(2026));
    expect(hasil.map((l) => l.tanggal)).toEqual([
      "2026-01-01",
      "2026-03-20",
      "2026-05-01",
      "2026-06-01",
      "2026-08-17",
      "2026-12-25",
    ]);
    expect(hasil.find((l) => l.tanggal === "2026-12-25")?.nama).toBe("Natal (kantor)");
  });

  it("menekan dua kali tidak menambah apa pun; dua tahun bergabung urut", () => {
    const sekali = gabungLibur([], liburTetapTahun(2026));
    expect(gabungLibur(sekali, liburTetapTahun(2026))).toEqual(sekali);
    const dua = gabungLibur(sekali, liburTetapTahun(2027));
    expect(dua).toHaveLength(10);
    expect(dua.at(-1)?.tanggal).toBe("2027-12-25");
  });

  it("duplikat di dalam masukan baru pun hanya masuk sekali", () => {
    expect(
      gabungLibur([], [
        { tanggal: "2026-08-17", nama: "A" },
        { tanggal: "2026-08-17", nama: "B" },
      ]),
    ).toEqual([{ tanggal: "2026-08-17", nama: "A" }]);
  });
});

describe("pembanding perubahan", () => {
  it("samaHari tidak peduli urutan", () => {
    expect(samaHari([1, 2, 3, 4, 5], new Set([5, 4, 3, 2, 1]))).toBe(true);
    expect(samaHari([1, 2, 3, 4, 5], new Set([1, 2, 3, 4, 5, 6]))).toBe(false);
    expect(samaHari([1, 2, 3, 4, 5], new Set([0, 2, 3, 4, 5]))).toBe(false);
  });

  it("samaLibur membandingkan tanggal dan nama", () => {
    const a = [{ tanggal: "2026-08-17", nama: "Kemerdekaan" }];
    expect(samaLibur(a, [{ tanggal: "2026-08-17", nama: "Kemerdekaan" }])).toBe(true);
    expect(samaLibur(a, [{ tanggal: "2026-08-17", nama: "HUT RI" }])).toBe(false);
    expect(samaLibur(a, [])).toBe(false);
  });
});
