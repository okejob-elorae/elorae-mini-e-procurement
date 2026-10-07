import { describe, expect, it } from "vitest";
import { alasanBelumBisaSimpan, kunciNamaPeran } from "./aturan-pengguna";

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

describe("kunciNamaPeran", () => {
  it("peran bawaan diberi nama tampilan", () => {
    expect(kunciNamaPeran("PRODUCTION")).toBe("roleName.PRODUCTION");
    expect(kunciNamaPeran("ADMIN")).toBe("roleName.ADMIN");
  });

  it("peran buatan sendiri tampil apa adanya", () => {
    expect(kunciNamaPeran("ADMIN_GUDANG")).toBeNull();
    expect(kunciNamaPeran("toString")).toBeNull();
  });
});
