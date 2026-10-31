import { describe, expect, it } from "vitest";
import { dokumenJurnal } from "@/lib/finance/jurnal-tertunda";
import {
  SEBAB_DIKENAL,
  jenisDanIdSumber,
  kunciSebab,
  perluPemetaanAkun,
  STATUS_TERTUNDA,
  bacaStatusJurnal,
  postingUlangOtomatis,
} from "./sebab";

describe("kunciSebab — kode kegagalan → kunci teks bahasa Indonesia", () => {
  it("setiap kode yang ditulis penulis JOURNAL_PENDING punya kuncinya sendiri", () => {
    for (const kode of [
      "UNMAPPED_ROLE",
      "UNBALANCED",
      "NON_POSTABLE_ACCOUNT",
      "ERROR",
      "NOTHING_TO_POST",
      "AP_ACCOUNT_MISMATCH",
      "GRN_APPROVAL_PENDING",
      "GRN_JOURNALS_INCOMPLETE",
      "GRN_REVERSAL_MISSING",
      "PAYMENT_SUPERSEDED",
      "PO_IS_PAID",
      "ORIGINAL_SALE_NOT_JOURNALED_YET",
      "ORIGINAL_SALE_UNLINKED",
      "ORIGINAL_SALE_OUTSIDE_LEDGER",
      "GL_CUTOVER_NOT_CONFIGURED",
    ]) {
      expect(kunciSebab(kode)).toBe(kode);
    }
    expect(new Set(SEBAB_DIKENAL).size).toBe(SEBAB_DIKENAL.length);
  });

  it("kode tak dikenal atau kosong → LAIN (tidak pernah menampilkan kode mentah)", () => {
    expect(kunciSebab("KODE_BARU")).toBe("LAIN");
    expect(kunciSebab(null)).toBe("LAIN");
    expect(kunciSebab("")).toBe("LAIN");
  });
});

describe("perluPemetaanAkun", () => {
  it("hanya sebab yang diperbaiki di Pemetaan Akun", () => {
    expect(perluPemetaanAkun("UNMAPPED_ROLE")).toBe(true);
    expect(perluPemetaanAkun("NON_POSTABLE_ACCOUNT")).toBe(true);
    expect(perluPemetaanAkun("AP_ACCOUNT_MISMATCH")).toBe(true);
    expect(perluPemetaanAkun("GRN_JOURNALS_INCOMPLETE")).toBe(false);
    expect(perluPemetaanAkun(null)).toBe(false);
  });
});

describe("jenisDanIdSumber", () => {
  it("dokumen biasa memakai jenis sumber jurnalnya", () => {
    expect(jenisDanIdSumber(dokumenJurnal("GRN", "g1"))).toEqual({ jenis: "GRN", id: "g1" });
  });

  it("pembayaran pemasok → jenis jurnal pembayaran/pembatalannya, id PO", () => {
    expect(jenisDanIdSumber({ tipe: "pembayaranPemasok", arah: "payment", poId: "po1" })).toEqual({
      jenis: "SUPPLIER_PAYMENT",
      id: "po1",
    });
    expect(jenisDanIdSumber({ tipe: "pembayaranPemasok", arah: "reversal", poId: "po1" })).toEqual({
      jenis: "SUPPLIER_PAYMENT_REVERSAL",
      id: "po1",
    });
  });

  it("bentuk tak dikenal → null", () => {
    expect(jenisDanIdSumber(null)).toBeNull();
  });
});

describe("bacaStatusJurnal — KONTRAK alamat ?status=tertunda (ditautkan Beranda)", () => {
  it("hanya `tertunda` yang membuka tab tertunda", () => {
    expect(STATUS_TERTUNDA).toBe("tertunda");
    expect(bacaStatusJurnal("tertunda")).toBe("tertunda");
    expect(bacaStatusJurnal("TERTUNDA")).toBe("tertunda");
    expect(bacaStatusJurnal(undefined)).toBe("terposting");
    expect(bacaStatusJurnal("lain")).toBe("terposting");
  });
});

describe("postingUlangOtomatis", () => {
  it("hanya jurnal penjualan marketplace (sapuan 5 menit)", () => {
    expect(postingUlangOtomatis("SALESORDER_REVENUE")).toBe(true);
    expect(postingUlangOtomatis("SALESORDER_COGS")).toBe(true);
    expect(postingUlangOtomatis("SALESRETURN_REVENUE")).toBe(false);
    expect(postingUlangOtomatis(null)).toBe(false);
  });
});
