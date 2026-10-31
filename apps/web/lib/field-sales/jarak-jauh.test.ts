import { describe, it, expect, vi } from "vitest";
import { ATURAN_JARAK_JAUH_BAWAAN, bacaAturanJarakJauh, bacaSaluran, KUNCI_JARAK_JAUH, periksaJarakJauh } from "./jarak-jauh";
import { izinJarakJauh } from "./jarak-jauh-toko";

describe("bacaSaluran", () => {
  it("accepts the three channels only", () => {
    expect(bacaSaluran("WA")).toBe("WA");
    expect(bacaSaluran("TELEPON")).toBe("TELEPON");
    expect(bacaSaluran("LAINNYA")).toBe("LAINNYA");
    expect(bacaSaluran(["WA", "X"])).toBe("WA");
    expect(bacaSaluran("wa")).toBeNull();
    expect(bacaSaluran("SMS")).toBeNull();
    expect(bacaSaluran(undefined)).toBeNull();
  });
});

describe("bacaAturanJarakJauh", () => {
  it("defaults: allowed, own stores only", () => {
    expect(ATURAN_JARAK_JAUH_BAWAAN).toEqual({ aktif: true, hanyaTokoSendiri: true });
    expect(bacaAturanJarakJauh(null)).toEqual(ATURAN_JARAK_JAUH_BAWAAN);
    expect(bacaAturanJarakJauh("bukan json")).toEqual(ATURAN_JARAK_JAUH_BAWAAN);
    expect(bacaAturanJarakJauh("[1]")).toEqual(ATURAN_JARAK_JAUH_BAWAAN);
  });
  it("reads each field on its own, falling back per field", () => {
    expect(bacaAturanJarakJauh(JSON.stringify({ aktif: false }))).toEqual({ aktif: false, hanyaTokoSendiri: true });
    expect(bacaAturanJarakJauh(JSON.stringify({ hanyaTokoSendiri: false, aktif: "ya" }))).toEqual({ aktif: true, hanyaTokoSendiri: false });
  });
});

describe("periksaJarakJauh", () => {
  it("disabled refuses everyone", () => {
    expect(periksaJarakJauh({ aktif: false, hanyaTokoSendiri: false }, { salesmanId: "u1", pemegangToko: "u1" })).toBe("JARAK_JAUH_NONAKTIF");
  });
  it("own-stores-only refuses a store held by someone else or by nobody", () => {
    const aturan = { aktif: true, hanyaTokoSendiri: true };
    expect(periksaJarakJauh(aturan, { salesmanId: "u1", pemegangToko: "u2" })).toBe("BUKAN_TOKO_SENDIRI");
    expect(periksaJarakJauh(aturan, { salesmanId: "u1", pemegangToko: null })).toBe("BUKAN_TOKO_SENDIRI");
    expect(periksaJarakJauh(aturan, { salesmanId: "u1", pemegangToko: "u1" })).toBeNull();
  });
  it("any store when own-stores-only is off", () => {
    expect(periksaJarakJauh({ aktif: true, hanyaTokoSendiri: false }, { salesmanId: "u1", pemegangToko: null })).toBeNull();
  });
});

describe("izinJarakJauh (stub client)", () => {
  it("reads the owner setting and the store holder", async () => {
    const klien = {
      systemSetting: { findUnique: vi.fn().mockResolvedValue({ value: JSON.stringify({ aktif: true, hanyaTokoSendiri: true }) }) },
      store: { findUnique: vi.fn().mockResolvedValue({ salesmanId: "u2" }) },
    };
    expect(await izinJarakJauh("s1", "u1", klien as never)).toEqual({ boleh: false, alasan: "BUKAN_TOKO_SENDIRI" });
    expect(klien.systemSetting.findUnique).toHaveBeenCalledWith({ where: { key: KUNCI_JARAK_JAUH }, select: { value: true } });
    expect(await izinJarakJauh("s1", "u2", klien as never)).toEqual({ boleh: true });
  });
});
