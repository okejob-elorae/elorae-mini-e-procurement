import { describe, expect, it } from "vitest";
import { bacaBalasanWa } from "./tempel-data-kol";

describe("bacaBalasanWa", () => {
  it("balasan template 'alamat' Elorae: label per baris, alamat bersambung, kecamatan digabung", () => {
    const teks = `Halo kak, ini datanya ya 🙏
Nama penerima: Rossa Farahdiba
No. HP: 0812-3456-7890
Alamat lengkap: Jl. Mawar No. 5
RT 01 RW 02
Kecamatan: Tebet
Kota: Jakarta Selatan
Kode pos: 12810
Ukuran: M / 28`;
    expect(bacaBalasanWa(teks)).toEqual({
      isi: {
        recipientName: "Rossa Farahdiba",
        phone: "0812-3456-7890",
        address: "Jl. Mawar No. 5\nRT 01 RW 02, Kec. Tebet",
        city: "Jakarta Selatan",
        postalCode: "12810",
        atasan: "M",
        bawahan: "28",
      },
      tidakTerbaca: ["Halo kak, ini datanya ya 🙏"],
    });
  });

  it("format bebas: bullet, huruf tebal, nomor urut, '=' dan sinonim", () => {
    const teks = `1. *Nama* : Ocha
2. *WA* = +62 813 1111 2222
• Email: ocha@mail.com
- Kab/Kota : Bogor
- Prov: Jawa Barat
- Kodepos 16110
- TB: 158 cm
- Hijab: iya
- Size baju: L
- Celana: 30`;
    expect(bacaBalasanWa(teks).isi).toEqual({
      recipientName: "Ocha",
      phone: "+62 813 1111 2222",
      email: "ocha@mail.com",
      city: "Bogor",
      province: "Jawa Barat",
      postalCode: "16110",
      tinggi: "158",
      hijab: "ya",
      atasan: "L",
      bawahan: "30",
    });
  });

  it("tanpa label: email, nomor WA dan kode pos dikenali dari bentuknya", () => {
    const r = bacaBalasanWa("ocha@mail.com\n0857 1234 5678\n16110\nmakasih kak");
    expect(r.isi).toEqual({ email: "ocha@mail.com", phone: "0857 1234 5678", postalCode: "16110" });
    expect(r.tidakTerbaca).toEqual(["makasih kak"]);
  });

  it("isian pertama yang menang; nilai kosong dilewati; hijab 'tidak'", () => {
    const r = bacaBalasanWa("Nama:\nNama: Bella\nNama: Orang lain\nBerhijab: nggak");
    expect(r.isi).toEqual({ recipientName: "Bella", hijab: "tidak" });
  });

  it("tanpa pemisah hanya untuk label angka: 'Nama saya Ocha' tidak terbaca sebagai nama", () => {
    expect(bacaBalasanWa("Nama saya Ocha\nTB 160").isi).toEqual({ tinggi: "160" });
  });

  it("kalimat yang kebetulan memakai titik dua tidak dianggap label", () => {
    const r = bacaBalasanWa("Catatan kak: kirim sore saja ya");
    expect(r.isi).toEqual({});
    expect(r.tidakTerbaca).toEqual(["Catatan kak: kirim sore saja ya"]);
  });
});
