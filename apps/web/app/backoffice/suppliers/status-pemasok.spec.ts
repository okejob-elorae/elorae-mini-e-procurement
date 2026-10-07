import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PERMISSIONS } from "@/lib/rbac";
import {
  aksiPemasok,
  alamatSaringPemasok,
  bacaSaringPemasok,
  bisaDipilihDiPo,
  bolehMemutuskan,
  UKURAN_HALAMAN_PEMASOK,
} from "./status-pemasok";

describe("bisaDipilihDiPo", () => {
  it("hanya pemasok yang disetujui yang muncul di pilihan PO", () => {
    expect(bisaDipilihDiPo("ACTIVE")).toBe(true);
    expect(bisaDipilihDiPo("PENDING_APPROVAL")).toBe(false);
    expect(bisaDipilihDiPo("REJECTED")).toBe(false);
    expect(bisaDipilihDiPo(undefined)).toBe(false);
  });
});

describe("bolehMemutuskan — menurut izin, bukan nama peran", () => {
  it("pemegang suppliers:approve boleh menyetujui pemasok yang menunggu", () => {
    expect(bolehMemutuskan("PENDING_APPROVAL", [PERMISSIONS.SUPPLIERS_APPROVE])).toBe(true);
  });

  it("admin wildcard boleh", () => {
    expect(bolehMemutuskan("PENDING_APPROVAL", ["*"])).toBe(true);
  });

  it("tanpa izin tidak boleh, walau bisa melihat pemasok", () => {
    expect(bolehMemutuskan("PENDING_APPROVAL", [PERMISSIONS.SUPPLIERS_VIEW, PERMISSIONS.SUPPLIERS_EDIT])).toBe(false);
  });

  it("pemasok yang sudah diputuskan tidak bisa diputuskan lagi", () => {
    expect(bolehMemutuskan("ACTIVE", ["*"])).toBe(false);
    expect(bolehMemutuskan("REJECTED", ["*"])).toBe(false);
  });
});

describe("saringan pemasok di alamat", () => {
  it("membaca saringan yang sah dan membuang yang asing", () => {
    expect(bacaSaringPemasok({ cari: " kain ", jenis: "t1", status: "PENDING_APPROVAL", page: "2", pageSize: "25" })).toEqual({
      cari: "kain",
      jenis: "t1",
      status: "PENDING_APPROVAL",
      page: 2,
      pageSize: 25,
    });
    expect(bacaSaringPemasok({ status: "AKTIF", page: "-3", pageSize: "7" })).toEqual({
      cari: "",
      jenis: "",
      status: "",
      page: 1,
      pageSize: UKURAN_HALAMAN_PEMASOK,
    });
  });

  it("menulis hanya parameter yang terisi", () => {
    expect(alamatSaringPemasok("/backoffice/suppliers", { cari: "", jenis: "", status: "", page: 1, pageSize: UKURAN_HALAMAN_PEMASOK })).toBe(
      "/backoffice/suppliers",
    );
    expect(
      alamatSaringPemasok("/backoffice/suppliers", { cari: "kain", jenis: "t1", status: "REJECTED", page: 3, pageSize: 50 }),
    ).toBe("/backoffice/suppliers?cari=kain&jenis=t1&status=REJECTED&page=3&pageSize=50");
  });
});

describe("aksiPemasok — tombol tambah/ubah/hapus menurut izin aksi servernya", () => {
  it("pemegang lihat saja tidak ditawari tombol apa pun", () => {
    expect(aksiPemasok([PERMISSIONS.SUPPLIERS_VIEW])).toEqual({ tambah: false, ubah: false, hapus: false });
  });

  it("izin dipetakan satu per satu; admin wildcard semua", () => {
    expect(aksiPemasok([PERMISSIONS.SUPPLIERS_VIEW, PERMISSIONS.SUPPLIERS_CREATE])).toEqual({ tambah: true, ubah: false, hapus: false });
    expect(aksiPemasok([PERMISSIONS.SUPPLIERS_EDIT, PERMISSIONS.SUPPLIERS_DELETE])).toEqual({ tambah: false, ubah: true, hapus: true });
    expect(aksiPemasok(["*"])).toEqual({ tambah: true, ubah: true, hapus: true });
  });
});

describe("layar pemasok memakai aturan di atas", () => {
  const layar = readFileSync(path.join(__dirname, "SuppliersPageClient.tsx"), "utf8");

  it("Setujui/Tolak menurut izin, bukan nama peran", () => {
    expect(layar).toContain("bolehMemutuskan(supplier.status, izin)");
    expect(layar).not.toMatch(/Role\.ADMIN|role ===/);
  });

  it("tambah, ubah, dan hapus dijaga aksiPemasok", () => {
    expect(layar).toContain("aksiPemasok(izin)");
    for (const syarat of ["aksi.tambah ?", "aksi.ubah ?", "aksi.hapus ?"]) expect(layar).toContain(syarat);
  });
});
