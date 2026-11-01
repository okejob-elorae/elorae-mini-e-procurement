import { describe, expect, it } from "vitest";
import { peranLamaDari, peranLamaSesi } from "./peran-lama";

describe("peranLamaDari", () => {
  it("a system role is ADMIN whatever it is called", () => {
    expect(peranLamaDari({ name: "ADMIN", isSystem: true })).toBe("ADMIN");
    expect(peranLamaDari({ name: "Pemilik", isSystem: true })).toBe("ADMIN");
  });

  it("a non-system role named ADMIN is NOT admin — admin follows the full-access flag, never the name", () => {
    expect(peranLamaDari({ name: "ADMIN", isSystem: false })).toBe("USER");
  });

  it("keeps the three old staff names, as Akun Profil did", () => {
    expect(peranLamaDari({ name: "PURCHASER", isSystem: false })).toBe("PURCHASER");
    expect(peranLamaDari({ name: "WAREHOUSE", isSystem: false })).toBe("WAREHOUSE");
    expect(peranLamaDari({ name: "PRODUCTION", isSystem: false })).toBe("PRODUCTION");
  });

  it("every other role, a missing name, or no role at all is USER", () => {
    expect(peranLamaDari({ name: "SPG", isSystem: false })).toBe("USER");
    expect(peranLamaDari({ name: "Keuangan", isSystem: false })).toBe("USER");
    expect(peranLamaDari({ name: "purchaser", isSystem: false })).toBe("USER");
    expect(peranLamaDari({ name: null, isSystem: false })).toBe("USER");
    expect(peranLamaDari(null)).toBe("USER");
    expect(peranLamaDari(undefined)).toBe("USER");
  });
});

describe("peranLamaSesi", () => {
  it("someone promoted to admin through Pengguna is ADMIN in the session even when the column still says USER", () => {
    // Isi sesi Budi: peran baru ADMIN (wildcard), nama peran ADMIN.
    expect(peranLamaSesi({ roleName: "ADMIN", permissions: ["*"] })).toBe("ADMIN");
  });

  it("a demoted admin stops being ADMIN in the session as soon as the wildcard is gone", () => {
    expect(peranLamaSesi({ roleName: "PRODUCTION", permissions: ["work_orders:view"] })).toBe("PRODUCTION");
    expect(peranLamaSesi({ roleName: "Produksi", permissions: ["work_orders:view"] })).toBe("USER");
  });

  it("an account without a role definition is never ADMIN, even when its old column name reads ADMIN", () => {
    // Tanpa RoleDefinition, segarkan-sesi.ts memakai kolom lama sebagai roleName dan izin kosong.
    expect(peranLamaSesi({ roleName: "ADMIN", permissions: [] })).toBe("USER");
    expect(peranLamaSesi({ roleName: undefined, permissions: undefined })).toBe("USER");
  });
});
