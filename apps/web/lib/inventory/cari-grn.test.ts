import { afterEach, describe, expect, it } from "vitest";
import { syaratCariGrn } from "./cari-grn";

const URL_ASLI = process.env.DATABASE_URL;
afterEach(() => {
  process.env.DATABASE_URL = URL_ASLI;
});

describe("syaratCariGrn", () => {
  it("kosong → tanpa syarat", () => {
    expect(syaratCariGrn("")).toBeNull();
    expect(syaratCariGrn("  ")).toBeNull();
    expect(syaratCariGrn(null)).toBeNull();
  });

  it("nomor GRN, pemasok (nama/kode), dan nomor PO dicari di server", () => {
    process.env.DATABASE_URL = "mysql://x@localhost:1/db";
    expect(syaratCariGrn(" 0002 ")).toEqual({
      OR: [
        { docNumber: { contains: "0002" } },
        { supplier: { name: { contains: "0002" } } },
        { supplier: { code: { contains: "0002" } } },
        { po: { docNumber: { contains: "0002" } } },
      ],
    });
  });
});
