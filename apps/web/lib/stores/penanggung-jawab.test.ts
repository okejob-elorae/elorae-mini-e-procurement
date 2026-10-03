import { describe, expect, it } from "vitest";
import { bolehPegangToko, lingkupPindah, penagihPiutang } from "./penanggung-jawab";

describe("bolehPegangToko", () => {
  it("lets anyone in while the owner has not switched the lock on", () => {
    expect(bolehPegangToko({ terkunci: false, penanggungJawabId: "u2", userId: "u1" })).toBe(true);
    expect(bolehPegangToko({ terkunci: false, penanggungJawabId: null, userId: "u1" })).toBe(true);
  });

  it("with the lock on, only the responsible salesperson gets in", () => {
    expect(bolehPegangToko({ terkunci: true, penanggungJawabId: "u1", userId: "u1" })).toBe(true);
    expect(bolehPegangToko({ terkunci: true, penanggungJawabId: "u2", userId: "u1" })).toBe(false);
  });

  it("with the lock on, a store nobody holds is closed to everyone", () => {
    // Toko tanpa penanggung jawab justru yang harus terlihat sebagai pekerjaan
    // admin — bukan toko bebas yang boleh didatangi siapa saja.
    expect(bolehPegangToko({ terkunci: true, penanggungJawabId: null, userId: "u1" })).toBe(false);
  });
});

describe("penagihPiutang", () => {
  it("the current holder of the store collects, even invoices someone else sold", () => {
    expect(penagihPiutang({ penanggungJawabId: "baru", penjualId: "lama" })).toBe("baru");
  });

  it("falls back to the seller while the store has no holder", () => {
    expect(penagihPiutang({ penanggungJawabId: null, penjualId: "lama" })).toBe("lama");
  });
});

describe("lingkupPindah", () => {
  it("refuses an empty scope — one click must never move every store", () => {
    expect(lingkupPindah({})).toEqual({ ok: false, alasan: "LINGKUP_KOSONG" });
    expect(lingkupPindah({ storeIds: [] })).toEqual({ ok: false, alasan: "LINGKUP_KOSONG" });
  });

  it("scopes by area", () => {
    expect(lingkupPindah({ groupId: "g1" })).toEqual({ ok: true, where: { AND: [{ groupId: "g1" }] } });
  });

  it("scopes by the current holder, or by stores nobody holds", () => {
    expect(lingkupPindah({ dari: "u1" })).toEqual({ ok: true, where: { AND: [{ salesmanId: "u1" }] } });
    expect(lingkupPindah({ dari: "TANPA" })).toEqual({ ok: true, where: { AND: [{ salesmanId: null }] } });
  });

  it("combines area, holder and picked stores with AND", () => {
    expect(lingkupPindah({ groupId: "g1", dari: "u1", storeIds: ["s1", "s2"] })).toEqual({
      ok: true,
      where: { AND: [{ groupId: "g1" }, { salesmanId: "u1" }, { id: { in: ["s1", "s2"] } }] },
    });
  });
});
