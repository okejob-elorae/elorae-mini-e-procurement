import { describe, expect, it } from "vitest";
import { alasanBelumBisaSimpan, bacaBukaAwal, butuhMulaiSpg, drafAwal, muatanSimpan } from "./aturan-pengguna";

const draf = {
  id: null as string | null,
  nama: "Rina",
  email: "rina@elorae.com",
  roleId: "peran-gudang",
  tokoId: null as string | null,
  sandi: "rahasia123",
  ulangSandi: "rahasia123",
  mulai: "",
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
    expect(alasanBelumBisaSimpan({ ...draf, roleId: "peran-spg", tokoId: "toko-1", mulai: "2026-11-01" }, { spg: true })).toBeNull();
  });

  it("SPG baru dengan toko tetap wajib membawa tanggal mulai bekerja (B27), disebut sesudah toko dan sebelum sandi", () => {
    const spg = { ...draf, roleId: "peran-spg", tokoId: "toko-1" };
    expect(alasanBelumBisaSimpan(spg, { spg: true })).toBe("MULAI_WAJIB");
    expect(alasanBelumBisaSimpan({ ...spg, sandi: "", ulangSandi: "" }, { spg: true })).toBe("MULAI_WAJIB");
    expect(alasanBelumBisaSimpan({ ...spg, mulai: "2026-11-01" }, { spg: true })).toBeNull();
  });

  it("SPG lama: tanggal yang sudah tersimpan tidak diminta lagi; yang belum punya, diminta", () => {
    const spg = { ...draf, id: "u1", roleId: "peran-spg", tokoId: "toko-1", sandi: "", ulangSandi: "" };
    expect(alasanBelumBisaSimpan(spg, { spg: true }, { mulaiTersimpan: "2026-09-01", berhenti: null })).toBeNull();
    expect(alasanBelumBisaSimpan(spg, { spg: true }, { mulaiTersimpan: null, berhenti: null })).toBe("MULAI_WAJIB");
  });

  it("SPG yang sudah berhenti tidak wajib punya toko tetap dan tidak dimintai tanggal mulai", () => {
    const spg = { ...draf, id: "u1", roleId: "peran-spg", tokoId: null, sandi: "", ulangSandi: "" };
    expect(alasanBelumBisaSimpan(spg, { spg: true }, { mulaiTersimpan: null, berhenti: "2026-10-15" })).toBeNull();
    expect(butuhMulaiSpg(spg, { spg: true }, { mulaiTersimpan: null, berhenti: "2026-10-15" })).toBe(false);
  });

  it("peran bukan SPG tidak pernah dimintai tanggal mulai", () => {
    expect(butuhMulaiSpg({ tokoId: null }, { spg: false })).toBe(false);
    expect(butuhMulaiSpg({ tokoId: "toko-1" }, { spg: false })).toBe(false);
    expect(butuhMulaiSpg({ tokoId: "toko-1" }, { spg: true })).toBe(true);
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

describe("muatanSimpan — isian yang dikirim ke server", () => {
  it("tanggal mulai hanya ikut bila formulir memintanya", () => {
    expect(muatanSimpan({ ...draf, mulai: " 2026-11-01 " }, true).mulai).toBe("2026-11-01");
    expect(muatanSimpan({ ...draf, mulai: "2026-11-01" }, false).mulai).toBeNull();
    expect(muatanSimpan({ ...draf, mulai: "" }, true).mulai).toBeNull();
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
    expect(drafAwal({ jenis: "baru" }, pengguna)).toEqual({ id: null, nama: "", email: "", roleId: "", tokoId: null, sandi: "", ulangSandi: "", mulai: "" });
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
      mulai: "",
    });
  });

  it("akun yang tidak ada → hanya daftarnya, tanpa formulir", () => {
    expect(drafAwal({ jenis: "ubah", id: "tidak-ada" }, pengguna)).toBeNull();
  });
});
