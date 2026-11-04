import { afterEach, describe, expect, it } from "vitest";
import { bacaTanggalMulaiTagihan, tagihanSesudahMulaiBuku } from "./gerbang-tanggal-mulai";

// Tanggal faktur disimpan sebagai tengah malam WIB (17.00 UTC hari sebelumnya).
const wib = (ymd: string) => new Date(`${ymd}T00:00:00+07:00`);

describe("tagihanSesudahMulaiBuku", () => {
  it("tanpa tanggal mulai tidak ada yang tertahan — sebelum pembukuan berjalan semua tagihan adalah tagihan lama", () => {
    expect(tagihanSesudahMulaiBuku(wib("2030-01-01"), null)).toBe(false);
  });

  it("tagihan PADA tanggal mulai dan sesudahnya tertahan, sehari sebelumnya tidak (dibaca per hari WIB)", () => {
    expect(tagihanSesudahMulaiBuku(wib("2026-11-30"), "2026-12-01")).toBe(false);
    expect(tagihanSesudahMulaiBuku(wib("2026-12-01"), "2026-12-01")).toBe(true);
    expect(tagihanSesudahMulaiBuku(wib("2027-01-15"), "2026-12-01")).toBe(true);
  });

  it("jam 23.30 WIB tanggal 30 masih hari tanggal 30, walau di UTC sudah tanggal yang sama sore harinya", () => {
    expect(tagihanSesudahMulaiBuku(new Date("2026-11-30T23:30:00+07:00"), "2026-12-01")).toBe(false);
  });
});

describe("bacaTanggalMulaiTagihan di bawah vitest", () => {
  const asli = process.env.UJI_TANGGAL_MULAI_BUKU;
  afterEach(() => {
    if (asli === undefined) delete process.env.UJI_TANGGAL_MULAI_BUKU;
    else process.env.UJI_TANGGAL_MULAI_BUKU = asli;
  });

  it("tidak membaca pengaturan basis data bersama kecuali diminta — tes lain bebas tanggal", async () => {
    delete process.env.UJI_TANGGAL_MULAI_BUKU;
    const tx = { systemSetting: { findUnique: async () => ({ value: "2026-08-01" }) } };
    expect(await bacaTanggalMulaiTagihan(tx as never)).toBeNull();
  });

  it("memakai UJI_TANGGAL_MULAI_BUKU, atau pengaturan sungguhan bila 'setelan'", async () => {
    const tx = { systemSetting: { findUnique: async () => ({ value: "2026-08-01" }) } };
    process.env.UJI_TANGGAL_MULAI_BUKU = "2003-05-01";
    expect(await bacaTanggalMulaiTagihan(tx as never)).toBe("2003-05-01");
    process.env.UJI_TANGGAL_MULAI_BUKU = "setelan";
    expect(await bacaTanggalMulaiTagihan(tx as never)).toBe("2026-08-01");
  });

  it("isian pengaturan yang bukan tanggal sah dianggap belum ada", async () => {
    process.env.UJI_TANGGAL_MULAI_BUKU = "setelan";
    const tx = { systemSetting: { findUnique: async () => ({ value: "kemarin" }) } };
    expect(await bacaTanggalMulaiTagihan(tx as never)).toBeNull();
  });
});
