import { describe, expect, it } from "vitest";
import { seluruhnyaSebelumTanggalMulai } from "./gerbang";

const wib = (t: string) => new Date(`${t}T00:00:00.000+07:00`);

describe("seluruhnyaSebelumTanggalMulai — gerbang settlement", () => {
  it("periode yang berakhir sebelum hari tanggal mulai ditolak; yang berakhir pada/sesudahnya tidak", async () => {
    const mulai = wib("2026-08-01");
    expect(await seluruhnyaSebelumTanggalMulai(wib("2026-07-31"), mulai)).toBe(true);
    expect(await seluruhnyaSebelumTanggalMulai(wib("2026-08-01"), mulai)).toBe(false);
    expect(await seluruhnyaSebelumTanggalMulai(wib("2026-08-15"), mulai)).toBe(false);
  });

  it("tanpa tanggal mulai tidak ada yang ditolak", async () => {
    expect(await seluruhnyaSebelumTanggalMulai(wib("2020-01-01"), null)).toBe(false);
  });
});
