import { describe, expect, it } from "vitest";
import { bisaDibuka, cariEntri, cocokPencarian, jangkarEntri, untukHp } from "./jenis";

const daftar = [
  { rute: "/backoffice/stores" },
  { rute: "/backoffice/stores/usulan" },
  { rute: "/backoffice/stores/[id]" },
  { rute: "/backoffice/stores/[id]/target-stok" },
  { rute: "/pwa" },
  { rute: "/pwa/stores/[id]" },
  { rute: "/backoffice/docs/[...slug]" },
];

describe("cariEntri", () => {
  it("memilih entri statis sebelum yang dinamis", () => {
    expect(cariEntri("/backoffice/stores/usulan", daftar)?.rute).toBe("/backoffice/stores/usulan");
    expect(cariEntri("/backoffice/stores/abc123", daftar)?.rute).toBe("/backoffice/stores/[id]");
  });

  it("mencocokkan panjang rute persis, bukan awalannya", () => {
    expect(cariEntri("/backoffice/stores/abc/target-stok", daftar)?.rute).toBe("/backoffice/stores/[id]/target-stok");
    expect(cariEntri("/backoffice/stores/abc/lain", daftar)).toBeNull();
    expect(cariEntri("/backoffice/suppliers", daftar)).toBeNull();
  });

  it("mengabaikan query, jangkar dan garis miring akhir", () => {
    expect(cariEntri("/backoffice/stores/?q=x#y", daftar)?.rute).toBe("/backoffice/stores");
    expect(cariEntri("/pwa", daftar)?.rute).toBe("/pwa");
    expect(cariEntri("/pwa/", daftar)?.rute).toBe("/pwa");
  });

  it("menangani segmen penampung sisa", () => {
    expect(cariEntri("/backoffice/docs/a/b/c", daftar)?.rute).toBe("/backoffice/docs/[...slug]");
  });
});

describe("jangkarEntri", () => {
  it("membuat jangkar yang terbaca dan tidak bertabrakan antara kantor dan HP", () => {
    expect(jangkarEntri("/backoffice/barang-hilang/[id]")).toBe("barang-hilang-id");
    expect(jangkarEntri("/backoffice/stores")).toBe("stores");
    expect(jangkarEntri("/pwa/stores")).toBe("hp-stores");
    expect(jangkarEntri("/pwa")).toBe("hp-beranda");
    expect(jangkarEntri("/backoffice/dashboard")).toBe("dashboard");
  });
});

describe("lain-lain", () => {
  it("rute dinamis tidak bisa dibuka langsung", () => {
    expect(bisaDibuka("/backoffice/stores")).toBe(true);
    expect(bisaDibuka("/backoffice/stores/[id]")).toBe(false);
  });

  it("mengenali rute HP", () => {
    expect(untukHp({ rute: "/pwa" })).toBe(true);
    expect(untukHp({ rute: "/pwa/stores" })).toBe(true);
    expect(untukHp({ rute: "/pwacadangan" })).toBe(false);
    expect(untukHp({ rute: "/backoffice/stores" })).toBe(false);
  });

  it("pencarian menuntut setiap kata, tanpa beda huruf besar/kecil", () => {
    expect(cocokPencarian("Barang hilang di toko konsinyasi", "hilang KONSI")).toBe(true);
    expect(cocokPencarian("Barang hilang di toko konsinyasi", "hilang putus")).toBe(false);
    expect(cocokPencarian("apa saja", "  ")).toBe(true);
  });
});
