import { describe, expect, it } from "vitest";
import { alasanBelumBisaSimpan, bacaBukaAwal, drafAwal } from "./aturan-pengguna";

const draf = {
  id: null as string | null,
  nama: "Rina",
  email: "rina@elorae.com",
  roleId: "peran-gudang",
  tokoId: null as string | null,
  sandi: "rahasia123",
  ulangSandi: "rahasia123",
};

describe("alasanBelumBisaSimpan — isian pertama yang kurang, urut formulir", () => {
  it("isian lengkap → null", () => {
    expect(alasanBelumBisaSimpan(draf, { spg: false })).toBeNull();
  });

  it("nama kosong disebut lebih dulu dari peran kosong", () => {
    expect(alasanBelumBisaSimpan({ ...draf, nama: " ", roleId: "" }, undefined)).toBe("NAMA_WAJIB");
  });

  it("email tidak sah", () => {
    expect(alasanBelumBisaSimpan({ ...draf, email: "rina@" }, { spg: false })).toBe("EMAIL_TIDAK_VALID");
  });

  it("peran belum dipilih disebut sebelum sandi", () => {
    expect(alasanBelumBisaSimpan({ ...draf, roleId: "", sandi: "", ulangSandi: "" }, undefined)).toBe("PERAN_WAJIB");
  });

  it("peran SPG tanpa toko tetap", () => {
    expect(alasanBelumBisaSimpan({ ...draf, roleId: "peran-spg" }, { spg: true })).toBe("TOKO_WAJIB");
    expect(alasanBelumBisaSimpan({ ...draf, roleId: "peran-spg", tokoId: "toko-1" }, { spg: true })).toBeNull();
  });

  it("akun baru wajib sandi; sandi pendek dan ulangan yang beda disebut", () => {
    expect(alasanBelumBisaSimpan({ ...draf, sandi: "", ulangSandi: "" }, { spg: false })).toBe("SANDI_WAJIB");
    expect(alasanBelumBisaSimpan({ ...draf, sandi: "pendek", ulangSandi: "pendek" }, { spg: false })).toBe("SANDI_PENDEK");
    expect(alasanBelumBisaSimpan({ ...draf, ulangSandi: "rahasia124" }, { spg: false })).toBe("SANDI_TIDAK_SAMA");
  });

  it("mengubah akun: sandi kosong berarti tetap", () => {
    expect(alasanBelumBisaSimpan({ ...draf, id: "u1", sandi: "", ulangSandi: "" }, { spg: false })).toBeNull();
  });
});

describe("bacaBukaAwal — formulir yang dibuka dari alamat (rute Akun Profil lama)", () => {
  it("?baru=1 membuka formulir tambah, ?ubah=<id> formulir akun itu", () => {
    expect(bacaBukaAwal({ baru: "1" })).toEqual({ jenis: "baru" });
    expect(bacaBukaAwal({ ubah: "u1" })).toEqual({ jenis: "ubah", id: "u1" });
  });

  it("ubah menang atas baru; nilai kosong, berulang, atau lain diabaikan", () => {
    expect(bacaBukaAwal({ baru: "1", ubah: "u1" })).toEqual({ jenis: "ubah", id: "u1" });
    expect(bacaBukaAwal({ ubah: "  " })).toBeNull();
    expect(bacaBukaAwal({ ubah: ["a", "b"] })).toBeNull();
    expect(bacaBukaAwal({ baru: "ya" })).toBeNull();
    expect(bacaBukaAwal({})).toBeNull();
  });
});

describe("drafAwal — isi awal formulir", () => {
  const pengguna = [{ id: "u1", nama: "Rina", email: "rina@elorae.com", roleId: null, tokoId: "t1" }];

  it("tanpa permintaan → formulir tertutup", () => {
    expect(drafAwal(null, pengguna)).toBeNull();
  });

  it("baru → formulir kosong", () => {
    expect(drafAwal({ jenis: "baru" }, pengguna)).toEqual({ id: null, nama: "", email: "", roleId: "", tokoId: null, sandi: "", ulangSandi: "" });
  });

  it("ubah → isian akun itu, sandi kosong (tetap memakai sandi lama)", () => {
    expect(drafAwal({ jenis: "ubah", id: "u1" }, pengguna)).toEqual({
      id: "u1",
      nama: "Rina",
      email: "rina@elorae.com",
      roleId: "",
      tokoId: "t1",
      sandi: "",
      ulangSandi: "",
    });
  });

  it("akun yang tidak ada → hanya daftarnya, tanpa formulir", () => {
    expect(drafAwal({ jenis: "ubah", id: "tidak-ada" }, pengguna)).toBeNull();
  });
});
