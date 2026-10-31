import { describe, expect, it } from "vitest";
import {
  bacaRiwayatPengiriman,
  bandingkanFormulir,
  ISIAN_KOSONG,
  periksaIsianFormulir,
  type DataKolSekarang,
  type IsianFormulirKol,
} from "./formulir-kol-aturan";
import { UKURAN_KOSONG } from "./kol-aturan";

const lengkap: IsianFormulirKol = {
  ...ISIAN_KOSONG,
  recipientName: "  Rossa  Farahdiba ",
  phone: "0812-3456-7890",
  address: "Jl. Mawar No. 5\nRT 01/RW 02, Kec. Tebet",
  city: "Jakarta Selatan",
  postalCode: "12 810",
  setuju: true,
};

describe("periksaIsianFormulir", () => {
  it("isian wajib lengkap → nilai rapi; WA dinormalkan; kolom opsional kosong tidak ikut", () => {
    const r = periksaIsianFormulir(lengkap);
    if (!r.ok) throw new Error(JSON.stringify(r.galat));
    expect(r.nilai).toEqual({
      recipientName: "Rossa Farahdiba",
      phone: "0812-3456-7890",
      waNormal: "6281234567890",
      email: null,
      address: "Jl. Mawar No. 5\nRT 01/RW 02, Kec. Tebet",
      city: "Jakarta Selatan",
      province: null,
      postalCode: "12810",
      ukuran: {},
      sensitif: {},
    });
  });

  it("menyebut setiap kolom yang salah sekaligus", () => {
    const r = periksaIsianFormulir({ ...ISIAN_KOSONG, phone: "12345", email: "bukan-email", postalCode: "1234", tinggi: "300" });
    expect(r).toEqual({
      ok: false,
      galat: {
        recipientName: "WAJIB",
        phone: "WA_TIDAK_SAH",
        email: "EMAIL_TIDAK_SAH",
        address: "WAJIB",
        city: "WAJIB",
        postalCode: "KODE_POS_TIDAK_SAH",
        tinggi: "TINGGI_TIDAK_SAH",
        setuju: "BELUM_SETUJU",
      },
    });
  });

  it("ukuran: '160 cm' terbaca; hijab ya/tidak; yang kosong tidak ikut", () => {
    const r = periksaIsianFormulir({ ...lengkap, atasan: "M", tinggi: "160 cm", hijab: "ya" });
    if (!r.ok) throw new Error("gagal");
    expect(r.nilai.ukuran).toEqual({ atasan: "M", tinggiCm: 160, hijab: true });
  });

  it("rekening harus lengkap tiga-tiganya; NIK/NPWP boleh sendiri", () => {
    const r = periksaIsianFormulir({ ...lengkap, bankName: "BCA", nik: "3174 0000 0000 0001" });
    expect(r).toEqual({ ok: false, galat: { bankAccount: "REKENING_TIDAK_LENGKAP", bankHolder: "REKENING_TIDAK_LENGKAP" } });
    const r2 = periksaIsianFormulir({ ...lengkap, npwp: "01.234.567.8-901.000" });
    expect(r2.ok && r2.nilai.sensitif).toEqual({ npwp: "01.234.567.8-901.000" });
  });

  it("terlalu panjang ditolak, bukan dipotong diam-diam", () => {
    const r = periksaIsianFormulir({ ...lengkap, city: "x".repeat(121) });
    expect(r).toEqual({ ok: false, galat: { city: "TERLALU_PANJANG" } });
  });
});

describe("bandingkanFormulir", () => {
  const sekarang: DataKolSekarang = {
    recipientName: "rossa farahdiba",
    phone: "6281234567890",
    email: null,
    address: "Jl. Melati 1",
    city: null,
    province: null,
    postalCode: null,
    ukuran: { ...UKURAN_KOSONG, atasan: "L" },
  };

  it("sama (abai huruf besar/spasi, WA sebagai nomor) tidak dihitung; yang beda menimpa; yang kosong sebelumnya tidak menimpa", () => {
    const r = periksaIsianFormulir({ ...lengkap, atasan: "M", hijab: "tidak" });
    if (!r.ok) throw new Error("gagal");
    expect(bandingkanFormulir(sekarang, r.nilai)).toEqual([
      { kolom: "address", sebelum: "Jl. Melati 1", sesudah: "Jl. Mawar No. 5\nRT 01/RW 02, Kec. Tebet", menimpa: true },
      { kolom: "city", sebelum: null, sesudah: "Jakarta Selatan", menimpa: false },
      { kolom: "postalCode", sebelum: null, sesudah: "12810", menimpa: false },
      { kolom: "atasan", sebelum: "L", sesudah: "M", menimpa: true },
      { kolom: "hijab", sebelum: null, sesudah: "tidak", menimpa: false },
    ]);
  });
});

describe("bacaRiwayatPengiriman", () => {
  it("isi rusak atau kolom asing dibaca kosong, tidak melempar", () => {
    expect(bacaRiwayatPengiriman("{bukan json")).toEqual({ perubahan: [], sensitif: [], npwpBaru: false });
    expect(
      bacaRiwayatPengiriman(JSON.stringify({ perubahan: [{ kolom: "asing", sesudah: "x" }, { kolom: "city", sebelum: null, sesudah: "Bogor", menimpa: false }], sensitif: ["nik", "pin"], npwpBaru: true })),
    ).toEqual({ perubahan: [{ kolom: "city", sebelum: null, sesudah: "Bogor", menimpa: false }], sensitif: ["nik"], npwpBaru: true });
  });
});
