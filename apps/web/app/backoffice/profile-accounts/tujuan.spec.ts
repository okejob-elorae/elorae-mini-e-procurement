import { describe, expect, it } from "vitest";
import { tujuanAkunProfil } from "./tujuan";

describe("tujuanAkunProfil — Akun Profil yang ditutup meneruskan ke Pengaturan", () => {
  it("the account list and the old roles tab go to Pengguna and Peran & izin", () => {
    expect(tujuanAkunProfil({ jenis: "daftar" })).toBe("/backoffice/settings/users");
    expect(tujuanAkunProfil({ jenis: "peran" })).toBe("/backoffice/settings/rbac");
  });

  it("creating and editing an account land on Pengguna with the form already open", () => {
    expect(tujuanAkunProfil({ jenis: "baru" })).toBe("/backoffice/settings/users?baru=1");
    expect(tujuanAkunProfil({ jenis: "ubah", id: "cku1" })).toBe("/backoffice/settings/users?ubah=cku1");
  });

  it("an odd id is encoded, and an empty one falls back to the plain list", () => {
    expect(tujuanAkunProfil({ jenis: "ubah", id: "a b&c" })).toBe("/backoffice/settings/users?ubah=a%20b%26c");
    expect(tujuanAkunProfil({ jenis: "ubah", id: "" })).toBe("/backoffice/settings/users");
  });
});
