import { describe, test } from "node:test";
import assert from "node:assert/strict";
import * as k from "../lib/kalender.js";

describe("kalender", () => {
  test("bacaTanggal menolak tanggal yang tidak ada", () => {
    assert.deepEqual(k.bacaTanggal("2026-02-28"), { tahun: 2026, bulan: 2, hari: 28 });
    assert.equal(k.bacaTanggal("2026-02-30"), null);
    assert.equal(k.bacaTanggal("9/10/2026"), null);
    assert.equal(k.bacaTanggal(null), null);
  });

  test("hari ini memakai WIB, bukan zona komputer", () => {
    // 9 Okt 2026 18:00 UTC = 10 Okt 01:00 WIB.
    assert.equal(k.hariIniWib(Date.UTC(2026, 9, 9, 18)), "2026-10-10");
    assert.equal(k.hariIniWib(Date.UTC(2026, 9, 9, 16, 59)), "2026-10-09");
  });

  test("urutkanRentang dan jumlahHari (kedua ujung ikut)", () => {
    assert.deepEqual(k.urutkanRentang("2026-10-09", "2026-10-01"), { dari: "2026-10-01", sampai: "2026-10-09" });
    assert.equal(k.jumlahHari("2026-10-01", "2026-10-09"), 9);
    assert.equal(k.jumlahHari("2026-10-09", "2026-10-09"), 1);
    assert.equal(k.jumlahHari("", "2026-10-09"), 0);
  });

  test("pilihan cepat dihitung dari hari ini; minggu mulai Senin", () => {
    const hariIni = "2026-10-09"; // Jumat
    assert.deepEqual(k.rentangCepat("mingguLalu", hariIni), { dari: "2026-09-28", sampai: "2026-10-04" });
    assert.deepEqual(k.rentangCepat("tujuhHari", hariIni), { dari: "2026-10-03", sampai: "2026-10-09" });
    assert.deepEqual(k.rentangCepat("tigaPuluhHari", hariIni), { dari: "2026-09-10", sampai: "2026-10-09" });
    assert.deepEqual(k.rentangCepat("bulanIni", hariIni), { dari: "2026-10-01", sampai: "2026-10-09" });
    assert.deepEqual(k.rentangCepat("bulanLalu", hariIni), { dari: "2026-09-01", sampai: "2026-09-30" });
    assert.deepEqual(k.rentangCepat("tigaBulanLalu", hariIni), { dari: "2026-07-01", sampai: "2026-09-30" });
    assert.deepEqual(k.rentangCepat("tahunIni", hariIni), { dari: "2026-01-01", sampai: "2026-10-09" });
    assert.deepEqual(k.rentangCepat("bulanLalu", "2026-01-15"), { dari: "2025-12-01", sampai: "2025-12-31" });
    assert.equal(k.rentangCepat("tidakAda", hariIni), null);
    for (const p of k.PILIHAN_CEPAT) assert.ok(k.rentangCepat(p.kunci, hariIni), p.kunci);
  });

  test("gridBulan: Senin dulu, sel di luar bulan kosong, kelipatan 7", () => {
    const g = k.gridBulan(2026, 9); // 1 Sep 2026 = Selasa
    assert.deepEqual(g[0], [null, "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06"]);
    assert.equal(g.flat().filter(Boolean).length, 30);
    assert.equal(g.flat().length % 7, 0);
    assert.deepEqual(g.at(-1), ["2026-09-28", "2026-09-29", "2026-09-30", null, null, null, null]);
    assert.equal(k.gridBulan(2026, 2).flat().filter(Boolean).length, 28);
  });

  test("geserBulan melewati pergantian tahun", () => {
    assert.deepEqual(k.geserBulan({ tahun: 2026, bulan: 1 }, -1), { tahun: 2025, bulan: 12 });
    assert.deepEqual(k.geserBulan({ tahun: 2026, bulan: 12 }, 1), { tahun: 2027, bulan: 1 });
  });

  test("label tanggal dan rentang seperti isian Elorae", () => {
    assert.equal(k.labelTanggal("2026-10-09"), "9 Okt 2026");
    assert.equal(k.labelTanggal("2026-10-09", { tahun: false }), "9 Okt");
    assert.equal(k.labelRentang("2026-09-01", "2026-09-30"), "1–30 Sep 2026");
    assert.equal(k.labelRentang("2026-09-28", "2026-10-04", { tahun: false }), "28 Sep – 4 Okt");
    assert.equal(k.labelRentang("2025-12-28", "2026-01-04"), "28 Des 2025 – 4 Jan 2026");
    assert.equal(k.labelRentang("2026-10-09", "2026-10-09"), "9 Okt 2026");
  });

  test("tata letak menurut ruang di samping panel", () => {
    assert.equal(k.tataLetakKalender(900), "dua");
    assert.equal(k.tataLetakKalender(600), "satu");
    assert.equal(k.tataLetakKalender(300), "sempit");
  });
});
