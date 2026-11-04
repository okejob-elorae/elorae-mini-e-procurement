import { describe, expect, it } from "vitest";
import { bacaPeriodeTren, tulisPeriodeTren } from "./tren";

describe("bacaPeriodeTren", () => {
  it("bawaan 30 hari tanpa parameter atau dengan nilai asing", () => {
    expect(bacaPeriodeTren({})).toEqual({ jenis: "hari", hari: 30 });
    expect(bacaPeriodeTren({ rentang: "45" })).toEqual({ jenis: "hari", hari: 30 });
    expect(bacaPeriodeTren({ rentang: "abc" })).toEqual({ jenis: "hari", hari: 30 });
  });

  it("membaca 7/30/90 dari ?rentang=", () => {
    expect(bacaPeriodeTren({ rentang: "7" })).toEqual({ jenis: "hari", hari: 7 });
    expect(bacaPeriodeTren({ rentang: "90" })).toEqual({ jenis: "hari", hari: 90 });
  });

  it("rentang pilihan yang sah menang atas ?rentang=", () => {
    expect(bacaPeriodeTren({ rentang: "7", dari: "2026-09-01", sampai: "2026-09-30" })).toEqual({
      jenis: "pilih",
      mulai: "2026-09-01",
      akhir: "2026-09-30",
      panjang: 30,
    });
  });

  it("rentang pilihan yang tidak sah diabaikan (terbalik, tanggal tidak ada, sebelah saja)", () => {
    expect(bacaPeriodeTren({ dari: "2026-09-30", sampai: "2026-09-01", rentang: "90" })).toEqual({ jenis: "hari", hari: 90 });
    expect(bacaPeriodeTren({ dari: "2026-02-30", sampai: "2026-03-05" })).toEqual({ jenis: "hari", hari: 30 });
    expect(bacaPeriodeTren({ dari: "2026-09-01" })).toEqual({ jenis: "hari", hari: 30 });
  });
});

describe("tulisPeriodeTren", () => {
  it("30 hari tidak ditulis; parameter lain alamat tetap", () => {
    const p = new URLSearchParams("saluran=putus&rentang=90&dari=2026-01-01&sampai=2026-01-31");
    tulisPeriodeTren(p, { jenis: "hari", hari: 30 });
    expect(p.toString()).toBe("saluran=putus");
  });

  it("menulis ?rentang= dan menghapus rentang pilihan", () => {
    const p = new URLSearchParams("dari=2026-01-01&sampai=2026-01-31");
    tulisPeriodeTren(p, { jenis: "hari", hari: 7 });
    expect(p.toString()).toBe("rentang=7");
  });

  it("menulis ?dari=&sampai= dan menghapus ?rentang=; bolak-balik lewat bacaPeriodeTren", () => {
    const p = new URLSearchParams("rentang=90");
    const periode = { jenis: "pilih", mulai: "2026-08-01", akhir: "2026-08-31", panjang: 31 } as const;
    tulisPeriodeTren(p, periode);
    expect(p.toString()).toBe("dari=2026-08-01&sampai=2026-08-31");
    expect(bacaPeriodeTren({ rentang: p.get("rentang"), dari: p.get("dari"), sampai: p.get("sampai") })).toEqual(periode);
  });
});
