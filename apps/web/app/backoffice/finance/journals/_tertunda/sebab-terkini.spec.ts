import { describe, expect, it } from "vitest";
import { langkahPostingUlang, sebabTerkini } from "./sebab";

describe("sebabTerkini — sebab tertunda dibaca ulang terhadap pemetaan sekarang", () => {
  it("peran yang kini sudah dipetakan tidak lagi disebut belum dipetakan", () => {
    expect(sebabTerkini("UNMAPPED_ROLE", true)).toBe("UNMAPPED_ROLE_SUDAH");
    expect(sebabTerkini("UNMAPPED_ROLE", false)).toBe("UNMAPPED_ROLE");
    expect(sebabTerkini("UNMAPPED_ROLE", null)).toBe("UNMAPPED_ROLE");
  });

  it("sebab lain tidak terpengaruh; kode tak dikenal = LAIN", () => {
    expect(sebabTerkini("UNBALANCED", true)).toBe("UNBALANCED");
    expect(sebabTerkini("APA_INI", null)).toBe("LAIN");
  });
});

describe("langkahPostingUlang", () => {
  it("per jenis dokumen", () => {
    expect(langkahPostingUlang("SALESORDER_REVENUE")).toBe("OTOMATIS");
    expect(langkahPostingUlang("SUPPLIER_PAYMENT")).toBe("BAYAR_PEMASOK");
    expect(langkahPostingUlang("SUPPLIER_PAYMENT_REVERSAL")).toBe("BALIK_BAYAR_PEMASOK");
    expect(langkahPostingUlang("GRN")).toBe("DOKUMEN");
    expect(langkahPostingUlang(null)).toBe("DOKUMEN");
  });
});
