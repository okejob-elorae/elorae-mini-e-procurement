import { describe, expect, it } from "vitest";
import { dibayarkanTersimpan, jumlahDiterima, payloadGajiHp } from "./komisi-hp";
import type { KomisiResmiHp } from "./komisi-queries";

/*
 * Muatan layar Gaji & komisi SPG di HP. Angka yang diterima datang dari pemuatnya
 * (`ringkasGajiSaya`: gaji pokok + komisi + koreksi − pengurang), tidak dihitung ulang di sini.
 * Baris yang pembayarannya DITAHAN (P60) tidak membawa rupiah sama sekali — tidak juga di JSON-nya
 * — hanya sebab dan harinya.
 */

describe("jumlahDiterima", () => {
  it("total dikurangi potongan beban barang hilang", () => {
    expect(jumlahDiterima({ total: 150_000, potonganHilang: 20_000 })).toBe(130_000);
  });

  it("potongan yang lebih besar dari totalnya tidak membuat angka minus", () => {
    expect(jumlahDiterima({ total: 10_000, potonganHilang: 25_000 })).toBe(0);
  });

  it("dibulatkan ke sen", () => {
    expect(jumlahDiterima({ total: 0.3, potonganHilang: 0.1 })).toBe(0.2);
  });
});

describe("dibayarkanTersimpan — yang dibayarkan baris yang sudah dibayar", () => {
  const nol = { potonganHilang: 0, potonganRetur: 0, potonganUtang: 0, kembali: 0, koreksi: 0 };

  it("koreksi plus masuk dulu, baru pengurang diambil (urutan rencana bayar): gaji 0 + komisi 10.000 + koreksi 20.000 − hilang 25.000 = 5.000", () => {
    expect(dibayarkanTersimpan({ ...nol, total: 10_000, koreksi: 20_000, potonganHilang: 25_000 })).toBe(5_000);
  });

  it("contoh pemilik (P11): gaji 1.000.000 + komisi 40.000 + koreksi 17.500 − hilang 50.000 = 1.007.500", () => {
    expect(dibayarkanTersimpan({ ...nol, total: 1_040_000, koreksi: 17_500, potonganHilang: 50_000 })).toBe(1_007_500);
  });

  it("beban retur pembeli dan utang dikurangkan, pengembalian beban ditambahkan, koreksi minus mengurangi", () => {
    expect(dibayarkanTersimpan({ total: 1_000_000, potonganHilang: 0, potonganRetur: 30_000, potonganUtang: 20_000, kembali: 5_000, koreksi: -2_500 })).toBe(952_500);
  });

  it("tidak di bawah nol, dan dihitung dalam sen", () => {
    expect(dibayarkanTersimpan({ ...nol, total: 0, potonganHilang: 0 })).toBe(0);
    expect(dibayarkanTersimpan({ ...nol, total: 0.3, potonganHilang: 0.1 })).toBe(0.2);
  });
});

describe("payloadGajiHp", () => {
  const resmi: KomisiResmiHp = {
    kunci: "putus:r1",
    jenis: "PUTUS",
    bulanJual: "2026-10",
    bulanBayar: "2026-11",
    toko: "Toko Uji",
    gaji: 3_365_385,
    rincianGaji: {
      bulanKerja: "2026-10",
      gajiBulanan: 3_500_000,
      penuh: true,
      hariAwal: "2026-10-01",
      hariAkhir: "2026-10-31",
      sumberPembagi: "JADWAL",
      pembagi: 26,
      hariKerjaStandar: [1, 2, 3, 4, 5, 6],
      tarifHarian: 134_615,
      hariTerjadwal: 26,
      hariIzin: 0,
      hariTidakMasuk: 1,
      tanggalTidakMasuk: ["2026-10-14"],
      hariMasukLibur: 0,
      tanggalMasukLibur: [],
      tanggalLuarRadius: [],
      hariDariCatatan: 0,
      gajiPokok: 3_365_385,
    },
    komisi: 30_000,
    komisiLama: 22_500,
    total: 3_395_385,
    potonganHilang: 2_500,
    potonganRetur: 1_000,
    potonganUtang: 0,
    dariKomisi: 3_500,
    dariGaji: 0,
    potong: 15,
    ditetapkan: "2026-11-03T03:00:00.000Z",
    dibayar: null,
    koreksi: [{ bulanJual: "2026-09", toko: "Toko Uji", jumlah: 17_500, gaji: 0, diterapkan: false, dibawa: 0 }],
    diterima: 3_409_385,
    ditahan: null,
    hariTahan: [],
  };
  const f = { bulan: (p: string) => `bulan ${p}`, tanggal: (iso: string) => iso.slice(0, 10), hari: (d: string) => `hari ${d}` };

  it("membawa gaji pokok dengan rinciannya, komisi, pengurang, dan koreksi dari pemuatnya", () => {
    const p = payloadGajiHp({ perkiraan: null, resmi: [resmi], koreksiMenunggu: [{ bulanJual: "2026-08", toko: "Toko Uji", jumlah: -2_500 }] }, false, f);
    expect(p.resmi[0]).toMatchObject({
      gaji: 3_365_385,
      rincianGaji: { pembagi: 26, tarifHarian: 134_615, hariTidakMasuk: 1, tanggalTidakMasuk: ["hari 2026-10-14"] },
      diterima: 3_409_385,
      komisiLama: 22_500,
      potonganRetur: 1_000,
      koreksi: [{ bulanLabel: "bulan 2026-09", toko: "Toko Uji", jumlah: 17_500, gaji: 0, diterapkan: false, dibawa: 0 }],
      ditahan: null,
      hariTahanLabel: [],
    });
    expect(p.koreksiMenunggu).toEqual([{ bulanLabel: "bulan 2026-08", toko: "Toko Uji", jumlah: -2_500 }]);
  });

  it("baris yang ditahan tidak membawa rupiah apa pun, hanya sebab dan harinya", () => {
    const tahan: KomisiResmiHp = { ...resmi, ditahan: "CATATAN_HADIR_BELUM_DIMASUKKAN", hariTahan: ["2026-10-03"] };
    const p = payloadGajiHp({ perkiraan: null, resmi: [tahan] }, false, f).resmi[0];
    expect(p).toMatchObject({ gaji: 0, rincianGaji: null, komisi: 0, total: 0, diterima: 0, potonganRetur: 0, koreksi: [], potong: null, komisiLama: null });
    expect(p.ditahan).toBe("CATATAN_HADIR_BELUM_DIMASUKKAN");
    expect(p.hariTahanLabel).toEqual(["hari 2026-10-03"]);
    expect(JSON.stringify(p)).not.toContain("3365385");
  });

  it("tanpa koreksi menunggu: daftar kosong", () => {
    expect(payloadGajiHp({ perkiraan: null, resmi: [] }, true, f).koreksiMenunggu).toEqual([]);
  });
});
