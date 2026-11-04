import { describe, expect, it } from "vitest";
import { adaSaringanKinerja, alamatPelunasanKinerja, alamatPesananKinerja, bacaSaringanKinerja } from "./saringan-kinerja";

describe("bacaSaringanKinerja", () => {
  it("rentang hari WIB → batas instan setengah terbuka [awal hari pertama, awal hari sesudah hari terakhir)", () => {
    const s = bacaSaringanKinerja({ dari: "2026-07-01", sampai: "2026-10-08", salesman: "u-1" });
    expect(s.dari).toBe("2026-07-01");
    expect(s.sampai).toBe("2026-10-08");
    expect(s.salesmanId).toBe("u-1");
    // 00.00 WIB = 17.00 UTC hari sebelumnya.
    expect(s.dibuatSejak?.toISOString()).toBe("2026-06-30T17:00:00.000Z");
    expect(s.dibuatSebelum?.toISOString()).toBe("2026-10-08T17:00:00.000Z");
    expect(adaSaringanKinerja(s)).toBe(true);
  });

  it("satu hari: kedua ujung hari yang sama mencakup 24 jam", () => {
    const s = bacaSaringanKinerja({ dari: "2026-10-08", sampai: "2026-10-08" });
    expect(s.dibuatSebelum!.getTime() - s.dibuatSejak!.getTime()).toBe(86_400_000);
  });

  it("rentang terbalik ditukar; nilai tidak sah diabaikan", () => {
    const tukar = bacaSaringanKinerja({ dari: "2026-10-08", sampai: "2026-10-01" });
    expect([tukar.dari, tukar.sampai]).toEqual(["2026-10-01", "2026-10-08"]);

    const salah = bacaSaringanKinerja({ dari: "2026-02-30", sampai: "kemarin", salesman: "x".repeat(65) });
    expect(salah).toMatchObject({ dari: null, sampai: null, salesmanId: null, dibuatSejak: null, dibuatSebelum: null });
    expect(adaSaringanKinerja(salah)).toBe(false);
  });

  it("satu ujung saja tetap menyaring ke satu arah; parameter berulang memakai yang pertama", () => {
    const s = bacaSaringanKinerja({ sampai: ["2026-10-08", "2026-12-01"] });
    expect(s.dibuatSejak).toBeNull();
    expect(s.dibuatSebelum?.toISOString()).toBe("2026-10-08T17:00:00.000Z");
    expect(adaSaringanKinerja(s)).toBe(true);
  });

  it("alamat yang dibuat Kinerja sales lapangan terbaca kembali sama persis", () => {
    const alamat = alamatPesananKinerja({ dari: "2026-07-01", sampai: "2026-10-08" }, "u 1&x");
    const url = new URL(alamat, "http://x");
    expect(url.pathname).toBe("/backoffice/field-sales-orders");
    expect(url.searchParams.get("status")).toBe("AKTIF");
    const s = bacaSaringanKinerja(Object.fromEntries(url.searchParams));
    expect([s.dari, s.sampai, s.salesmanId]).toEqual(["2026-07-01", "2026-10-08", "u 1&x"]);
    expect(new URL(alamatPesananKinerja({ dari: "2026-10-08", sampai: "2026-10-08" }), "http://x").searchParams.has("salesman")).toBe(false);
  });
});

describe("alamatPelunasanKinerja", () => {
  it("membawa status terverifikasi dan rentang hari WIB, opsional nama sales", () => {
    const tim = new URL(alamatPelunasanKinerja({ dari: "2026-07-01", sampai: "2026-10-08" }), "http://x");
    expect(tim.pathname).toBe("/backoffice/pelunasan");
    expect(Object.fromEntries(tim.searchParams)).toEqual({ status: "TERVERIFIKASI", dari: "2026-07-01", sampai: "2026-10-08" });
    const satu = new URL(alamatPelunasanKinerja({ dari: "2026-10-08", sampai: "2026-10-08" }, " Budi & Co "), "http://x");
    expect(satu.searchParams.get("cari")).toBe("Budi & Co");
  });
});

