import { describe, expect, it } from "vitest";
import { POSTING_ROLES, type PostingRole } from "@/lib/constants/journal-roles";
import { PERAN_WAJIB } from "../_kesiapan/kesiapan";
import {
  KELOMPOK_PERAN,
  kelompokkanPeran,
  saringPeran,
  type SaringPeran,
} from "./kelompok-peran";

describe("KELOMPOK_PERAN", () => {
  it("puts every posting role in exactly one area", () => {
    const semua = KELOMPOK_PERAN.flatMap((k) => k.peran);
    for (const peran of POSTING_ROLES) {
      expect(semua.filter((p) => p === peran), peran).toHaveLength(1);
    }
  });

  it("names no role that does not exist", () => {
    const dikenal = new Set<string>(POSTING_ROLES);
    for (const k of KELOMPOK_PERAN) {
      for (const p of k.peran) expect(dikenal.has(p), `${k.id}: ${p}`).toBe(true);
    }
  });

  it("has unique area ids and no empty area", () => {
    const ids = KELOMPOK_PERAN.map((k) => k.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const k of KELOMPOK_PERAN) expect(k.peran.length, k.id).toBeGreaterThan(0);
  });
});

describe("kelompokkanPeran", () => {
  it("keeps the area order and leaves no role behind", () => {
    const hasil = kelompokkanPeran(POSTING_ROLES);
    expect(hasil.map((k) => k.id)).toEqual(KELOMPOK_PERAN.map((k) => k.id));
    expect(hasil.flatMap((k) => k.peran).sort()).toEqual([...POSTING_ROLES].sort());
  });

  it("drops an area with nothing left after a filter", () => {
    const hasil = kelompokkanPeran(["BANK", "CASH", "AP"]);
    expect(hasil.map((k) => k.id)).toEqual(["PERSEDIAAN", "KAS_BANK"]);
    expect(hasil.find((k) => k.id === "KAS_BANK")?.peran).toEqual(["BANK", "CASH"]);
  });

  it("collects a role no area knows yet under LAINNYA instead of hiding it", () => {
    const baru = "PERAN_BARU_NANTI" as PostingRole;
    const hasil = kelompokkanPeran(["BANK", baru]);
    expect(hasil.at(-1)).toEqual({ id: "LAINNYA", peran: [baru] });
  });
});

describe("saringPeran", () => {
  const terpetakan = new Set<PostingRole>(["INVENTORY", "BANK", "KOL_EXPENSE"]);
  const opsi = { wajib: PERAN_WAJIB, terpetakan: (p: PostingRole) => terpetakan.has(p) };

  it("SEMUA keeps every role in its order", () => {
    expect(saringPeran(POSTING_ROLES, "SEMUA", opsi)).toEqual([...POSTING_ROLES]);
  });

  it("WAJIB keeps only the required roles", () => {
    const hasil = saringPeran(POSTING_ROLES, "WAJIB", opsi);
    expect(hasil).toEqual(POSTING_ROLES.filter((p) => PERAN_WAJIB.includes(p)));
    expect(hasil).toContain("BANK");
    expect(hasil).not.toContain("KOL_EXPENSE");
  });

  it("BELUM keeps only roles without an account", () => {
    const hasil = saringPeran(POSTING_ROLES, "BELUM", opsi);
    expect(hasil).not.toContain("INVENTORY");
    expect(hasil).not.toContain("BANK");
    expect(hasil).not.toContain("KOL_EXPENSE");
    expect(hasil).toContain("AP");
    expect(hasil).toHaveLength(POSTING_ROLES.length - 3);
  });

  it("treats an unknown filter as SEMUA", () => {
    expect(saringPeran(["BANK", "AP"], "LAIN" as SaringPeran, opsi)).toEqual(["BANK", "AP"]);
  });
});
