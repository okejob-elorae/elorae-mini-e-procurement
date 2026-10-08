import { describe, expect, it } from "vitest";
import { butirSaldoAwal, ringkasSaldoAwal } from "./kesiapan";

describe("butirSaldoAwal", () => {
  it("belum ada / sebagian / tanggal mulai lama", () => {
    expect(butirSaldoAwal(ringkasSaldoAwal([], "2026-08-01"))).toEqual({ ok: false, kunci: "openingNone", n: 0, total: 5 });
    expect(butirSaldoAwal(ringkasSaldoAwal([{ kind: "ACCOUNTS", status: "POSTED", tanggalMulai: "2026-08-01" }], "2026-08-01"))).toEqual({
      ok: true,
      kunci: "openingSome",
      n: 1,
      total: 5,
    });
    expect(butirSaldoAwal(ringkasSaldoAwal([{ kind: "AP", status: "POSTED", tanggalMulai: "2026-07-01" }], "2026-08-01")).kunci).toBe("openingStale");
  });
});

describe("ringkasSaldoAwal", () => {
  it("tanpa catatan apa pun: semua BELUM", () => {
    const r = ringkasSaldoAwal([], "2026-08-01");
    expect(r.jumlahDiposting).toBe(0);
    expect(r.total).toBe(5);
    expect(Object.values(r.jenis).every((s) => s === "BELUM")).toBe(true);
  });

  it("posting mengalahkan draf; posting untuk tanggal mulai lain = BEDA_TANGGAL; jenis berawalan ruang uji tidak terbaca", () => {
    const r = ringkasSaldoAwal(
      [
        { kind: "ACCOUNTS", status: "POSTED", tanggalMulai: "2026-08-01" },
        { kind: "ACCOUNTS", status: "DRAFT", tanggalMulai: "2026-08-01" },
        { kind: "INVENTORY", status: "DRAFT", tanggalMulai: "2026-08-01" },
        { kind: "AP", status: "POSTED", tanggalMulai: "2026-07-01" },
        { kind: "AR_STORE", status: "REVERSED", tanggalMulai: "2026-08-01" },
        { kind: "uji123:AR_MARKETPLACE", status: "POSTED", tanggalMulai: "2026-08-01" },
      ],
      "2026-08-01",
    );
    expect(r.jenis).toEqual({ ACCOUNTS: "DIPOSTING", INVENTORY: "DRAF", AR_STORE: "BELUM", AR_MARKETPLACE: "BELUM", AP: "BEDA_TANGGAL" });
    expect(r.jumlahDiposting).toBe(2);
    expect(r.adaBedaTanggal).toBe(true);
  });
});
