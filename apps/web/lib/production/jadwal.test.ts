import { describe, expect, it } from "vitest";
import { HARI_KERJA_PRODUKSI_BAWAAN, kalenderKerja } from "./hari-kerja";
import { keadaanLangkah, mulaiDariTenggat, ringkasJadwal, susunTanggal, totalHariJadwal } from "./jadwal";

const KAL = kalenderKerja(HARI_KERJA_PRODUKSI_BAWAAN, []);
const belum = (d: number) => ({ durationDays: d, status: "BELUM" as const, doneDate: null });

describe("susunTanggal — rantai proses satu tahap", () => {
  it("chains steps forward from the start, each starting where the last ended", () => {
    // Senin 5 Okt: 10 hari kerja → 19 Okt; 3 → 22 Okt; 2 → 26 Okt (lewati Sabtu/Minggu).
    expect(susunTanggal([belum(10), belum(3), belum(2)], "2026-10-05", KAL)).toEqual([
      "2026-10-19",
      "2026-10-22",
      "2026-10-26",
    ]);
  });

  it("a finished step re-anchors on its real date and moves every later step", () => {
    const langkah = [
      { durationDays: 10, status: "SELESAI" as const, doneDate: "2026-10-14" },
      belum(3),
      belum(2),
    ];
    expect(susunTanggal(langkah, "2026-10-05", KAL)).toEqual(["2026-10-14", "2026-10-19", "2026-10-21"]);
  });

  it("a late finish pushes the rest later", () => {
    const langkah = [{ durationDays: 10, status: "SELESAI" as const, doneDate: "2026-10-23" }, belum(3)];
    expect(susunTanggal(langkah, "2026-10-05", KAL)).toEqual(["2026-10-23", "2026-10-28"]);
  });

  it("a step merely in progress does not move anything", () => {
    const langkah = [{ durationDays: 10, status: "PROSES" as const, doneDate: null }, belum(3)];
    expect(susunTanggal(langkah, "2026-10-05", KAL)).toEqual(["2026-10-19", "2026-10-22"]);
  });

  it("zero-day steps (an approval) end on the same day as the previous step", () => {
    expect(susunTanggal([belum(2), belum(0)], "2026-10-05", KAL)).toEqual(["2026-10-07", "2026-10-07"]);
  });
});

describe("mundur dari tenggat", () => {
  it("finds the start so the chain lands exactly on the deadline", () => {
    const langkah = [belum(10), belum(3), belum(2)];
    const mulai = mulaiDariTenggat(totalHariJadwal(langkah), "2026-10-26", KAL);
    expect(mulai).toBe("2026-10-05");
    expect(susunTanggal(langkah, mulai, KAL).at(-1)).toBe("2026-10-26");
  });
});

describe("keadaanLangkah", () => {
  it("late only after the day has passed (WIB), never on the day itself", () => {
    expect(keadaanLangkah("BELUM", "2026-10-06", "2026-10-07")).toBe("TELAT");
    expect(keadaanLangkah("PROSES", "2026-10-07", "2026-10-07")).toBe("HARI_INI");
    expect(keadaanLangkah("BELUM", "2026-10-08", "2026-10-07")).toBe("MENDATANG");
    expect(keadaanLangkah("SELESAI", "2026-10-01", "2026-10-07")).toBe("SELESAI");
  });
});

describe("ringkasJadwal", () => {
  it("summarises a stage: done count, late count, next step and the finish date", () => {
    const r = ringkasJadwal(
      [
        { name: "Matching warna", status: "SELESAI", targetDate: "2026-10-05" },
        { name: "Kirim kain", status: "BELUM", targetDate: "2026-10-06" },
        { name: "Produksi", status: "BELUM", targetDate: "2026-10-20" },
      ],
      "2026-10-07",
    );
    expect(r).toEqual({
      jumlah: 3,
      selesai: 1,
      telat: 1,
      berikutnya: { name: "Kirim kain", targetDate: "2026-10-06", keadaan: "TELAT" },
      selesaiPada: "2026-10-20",
    });
  });

  it("an empty schedule has nothing next", () => {
    expect(ringkasJadwal([], "2026-10-07")).toEqual({ jumlah: 0, selesai: 0, telat: 0, berikutnya: null, selesaiPada: null });
  });
});
