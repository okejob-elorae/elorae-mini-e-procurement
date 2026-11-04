import { describe, expect, it } from "vitest";
import { hitungSisaPiutang, keadaanPiutang } from "./rules";

/**
 * Dua aturan uang yang dulu dihitung dengan cara keliru.
 *
 * 1. Janji bayar dibandingkan per HARI KALENDER WIB. `promisedDate` disimpan
 *    tengah malam WIB, jadi membandingkan instan membuat faktur "lewat janji"
 *    sejak 00.01 di hari janjinya sendiri — sales dimarahi pada hari toko
 *    memang berjanji membayar.
 * 2. Bagian yang sudah dibayar SEBELUM impor ikut mengurangi sisa. Tanpa itu
 *    faktur Rp10 jt bersisa Rp4 jt kembali tampil Rp10 jt dan toko ditagih ulang.
 */

const wib = (teks: string) => new Date(`${teks}+07:00`);

describe("keadaanPiutang — janji bayar per hari kalender WIB", () => {
  const JANJI = wib("2026-09-10T00:00:00");
  const dasar = {
    sisa: 4_000_000,
    klaimMenunggu: null,
    nilaiTertahan: 0,
    kontrabon: { docNo: "TT/2026/0001", janjiBayar: JANJI },
  };

  it.each(["00:30:00", "12:00:00", "23:59:59"])("hari janjinya sendiri pukul %s WIB belum lewat", (jam) => {
    expect(keadaanPiutang({ ...dasar, hariIni: wib(`2026-09-10T${jam}`) })).toBe("tt");
  });

  it("lewat sejak 00.00 WIB keesokan harinya", () => {
    expect(keadaanPiutang({ ...dasar, hariIni: wib("2026-09-11T00:00:00") })).toBe("lewat");
    expect(keadaanPiutang({ ...dasar, hariIni: wib("2026-09-11T00:30:00") })).toBe("lewat");
  });

  it("sehari sebelum janji tetap tt", () => {
    expect(keadaanPiutang({ ...dasar, hariIni: wib("2026-09-09T23:59:59") })).toBe("tt");
  });
});

describe("hitungSisaPiutang — bagian yang dibayar sebelum impor", () => {
  it("faktur Rp10 jt yang bersisa Rp4 jt saat diimpor tetap Rp4 jt", () => {
    expect(hitungSisaPiutang(10_000_000, [], 6_000_000)).toBe(4_000_000);
  });

  it("klaim terverifikasi sesudah impor mengurangi dari Rp4 jt, bukan dari Rp10 jt", () => {
    expect(
      hitungSisaPiutang(
        10_000_000,
        [
          {
            status: "TERVERIFIKASI",
            nilaiFaktur: 1_500_000,
            potonganRetur: [],
            nilaiDilunasiPiutangIni: 1_500_000,
          },
        ],
        6_000_000,
      ),
    ).toBe(2_500_000);
  });

  it("klaim yang masih DIKIRIM tetap tidak mengurangi apa pun (Aturan 1)", () => {
    expect(
      hitungSisaPiutang(
        10_000_000,
        [{ status: "DIKIRIM", nilaiFaktur: 4_000_000, potonganRetur: [], nilaiDilunasiPiutangIni: 4_000_000 }],
        6_000_000,
      ),
    ).toBe(4_000_000);
  });

  it("tanpa argumen ketiga perilakunya tetap seperti dulu", () => {
    expect(hitungSisaPiutang(10_000_000, [])).toBe(10_000_000);
  });
});
