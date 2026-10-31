import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PERMISSIONS } from "@/lib/rbac";
import {
  aksiPemasok,
  alamatMemilihTampilan,
  alamatSaringPemasok,
  bacaSaringPemasok,
  bisaDipilihDiPo,
  bolehMemutuskan,
  isActiveDariSaring,
  UKURAN_HALAMAN_PEMASOK,
} from "./status-pemasok";

describe("bisaDipilihDiPo", () => {
  it("hanya pemasok yang disetujui yang muncul di pilihan PO", () => {
    expect(bisaDipilihDiPo("ACTIVE")).toBe(true);
    expect(bisaDipilihDiPo("PENDING_APPROVAL")).toBe(false);
    expect(bisaDipilihDiPo("REJECTED")).toBe(false);
    expect(bisaDipilihDiPo(undefined)).toBe(false);
  });

  it("pemasok nonaktif tidak bisa dipilih di PO walau disetujui — sama dengan papan Lead time", () => {
    expect(bisaDipilihDiPo("ACTIVE", false)).toBe(false);
    expect(bisaDipilihDiPo("ACTIVE", true)).toBe(true);
    expect(bisaDipilihDiPo("ACTIVE", undefined)).toBe(true);
  });
});

describe("isActiveDariSaring", () => {
  it("aktif → true, nonaktif → false, kosong → tanpa saringan", () => {
    expect(isActiveDariSaring("aktif")).toBe(true);
    expect(isActiveDariSaring("nonaktif")).toBe(false);
    expect(isActiveDariSaring("")).toBeUndefined();
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
    expect(bacaSaringPemasok({ cari: " kain ", jenis: "t1", status: "PENDING_APPROVAL", aktif: "nonaktif", page: "2", pageSize: "25" })).toEqual({
      cari: "kain",
      jenis: "t1",
      status: "PENDING_APPROVAL",
      aktif: "nonaktif",
      page: 2,
      pageSize: 25,
      tampilan: "tabel",
    });
    expect(bacaSaringPemasok({ status: "AKTIF", aktif: "ya", page: "-3", pageSize: "7" })).toEqual({
      cari: "",
      jenis: "",
      status: "",
      aktif: "",
      page: 1,
      pageSize: UKURAN_HALAMAN_PEMASOK,
      tampilan: "tabel",
    });
    expect(bacaSaringPemasok({ tampilan: "papan" }).tampilan).toBe("papan");
    expect(bacaSaringPemasok({ tampilan: "kanban" }).tampilan).toBe("tabel");
    expect(alamatMemilihTampilan({ tampilan: "galeri" })).toBe(true);
    expect(alamatMemilihTampilan({})).toBe(false);
  });

  it("menulis hanya parameter yang terisi", () => {
    expect(alamatSaringPemasok("/backoffice/suppliers", { cari: "", jenis: "", status: "", aktif: "", page: 1, pageSize: UKURAN_HALAMAN_PEMASOK, tampilan: "tabel" })).toBe(
      "/backoffice/suppliers",
    );
    expect(
      alamatSaringPemasok("/backoffice/suppliers", { cari: "kain", jenis: "t1", status: "REJECTED", aktif: "aktif", page: 3, pageSize: 50, tampilan: "galeri" }),
    ).toBe("/backoffice/suppliers?cari=kain&jenis=t1&status=REJECTED&aktif=aktif&page=3&pageSize=50&tampilan=galeri");
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
  // Tabel, Galeri, dan Papan dirender di sini; tombol Setujui/Tolak tinggal di dalamnya.
  const tampilan = readFileSync(path.join(__dirname, "TampilanPemasok.tsx"), "utf8");

  it("Setujui/Tolak menurut izin, bukan nama peran", () => {
    expect(tampilan).toContain("bolehMemutuskan(s.status, izin)");
    expect(layar + tampilan).not.toMatch(/Role\.ADMIN|role ===/);
  });

  it("saringan keaktifan dikirim ke server dan pemasok nonaktif berlencana di ketiga tampilan", () => {
    expect(layar).toContain("isActive: isActiveDariSaring(saring.aktif)");
    expect(layar).toContain("bisaDipilihDiPo(selectedSupplier?.status, selectedSupplier?.isActive)");
    expect(tampilan).toContain("<LencanaNonaktif s={s} />");
    expect(tampilan.match(/<LencanaNonaktif s=\{s\} \/>/g)?.length).toBe(3);
  });

  it("tombol ikon Setujui/Tolak di papan punya title (tooltip), bukan hanya teks tersembunyi", () => {
    expect(tampilan).toContain("title={kecil ? t('setujuiNama', { name: s.name }) : undefined}");
    expect(tampilan).toContain("title={kecil ? t('tolakNama', { name: s.name }) : undefined}");
  });

  it("tambah, ubah, dan hapus dijaga aksiPemasok", () => {
    expect(layar).toContain("aksiPemasok(izin)");
    for (const syarat of [/aksi\.tambah\s*\?/, /aksi\.ubah\s*\?/, /aksi\.hapus\s*\?/]) expect(layar).toMatch(syarat);
    expect(tampilan).toContain("aksi.ubah ?");
    expect(tampilan).toContain("aksi.hapus ?");
  });
});
