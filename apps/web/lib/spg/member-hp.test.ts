import { describe, expect, it } from "vitest";
import { MEMBER_BAWAAN, type AturanMember, type KeadaanMember } from "./member";
import { anggotaPratinjau, memberPembeliDari, mintaDaftarMember, uraiMemberPembeli } from "./member-hp";

const aturan: AturanMember = {
  ...MEMBER_BAWAAN,
  diskonAktif: true,
  bagianTokoPersen: 20,
  tingkat: [
    { kode: "MEMBER", nama: "Member", minBelanja: 0, diskonPersen: 0 },
    { kode: "SILVER", nama: "Silver", minBelanja: 1_500_000, diskonPersen: 5 },
  ],
};

const keadaan = (ubah: Partial<KeadaanMember> = {}): KeadaanMember => ({
  memberId: "m1",
  aktif: true,
  tingkat: "Silver",
  kodeTingkat: "SILVER",
  diskonPersen: 5,
  belanjaPeriode: 2_000_000,
  berikut: null,
  sejak: "1 Okt 2026",
  ...ubah,
});

describe("memberPembeliDari — only tier and discount reach the phone", () => {
  it("an active member carries its tier and the discount actually applied", () => {
    const m = memberPembeliDari(keadaan(), 0, aturan);
    expect(m).toEqual({ status: "MEMBER", tingkat: "Silver", diskonPersen: 5 });
    // Tidak ada belanja, id member, atau tanggal di muatan HP.
    expect(Object.keys(m).sort()).toEqual(["diskonPersen", "status", "tingkat"]);
  });

  it("a deactivated member is just NONAKTIF", () => {
    expect(memberPembeliDari(keadaan({ aktif: false, diskonPersen: 0 }), 0, aturan)).toEqual({ status: "NONAKTIF" });
  });

  it("a non-member gets the tier its past spend would give on registering", () => {
    expect(memberPembeliDari(undefined, 1_600_000, aturan)).toEqual({ status: "BUKAN", tingkatDaftar: "Silver", diskonPersenDaftar: 5 });
    expect(memberPembeliDari(undefined, 0, aturan)).toEqual({ status: "BUKAN", tingkatDaftar: "Member", diskonPersenDaftar: 0 });
    expect(memberPembeliDari(undefined, 1_600_000, { ...aturan, diskonAktif: false })).toEqual({
      status: "BUKAN",
      tingkatDaftar: "Silver",
      diskonPersenDaftar: 0,
    });
  });
});

describe("uraiMemberPembeli", () => {
  it("reads the three shapes and rejects anything else", () => {
    expect(uraiMemberPembeli({ status: "MEMBER", tingkat: "Gold", diskonPersen: 10 })).toEqual({ status: "MEMBER", tingkat: "Gold", diskonPersen: 10 });
    expect(uraiMemberPembeli({ status: "NONAKTIF", extra: 1 })).toEqual({ status: "NONAKTIF" });
    expect(uraiMemberPembeli({ status: "BUKAN", tingkatDaftar: "Member", diskonPersenDaftar: 0 })).toEqual({
      status: "BUKAN",
      tingkatDaftar: "Member",
      diskonPersenDaftar: 0,
    });
    expect(uraiMemberPembeli({ status: "MEMBER", tingkat: "Gold", diskonPersen: 150 })).toBeNull();
    expect(uraiMemberPembeli({ status: "MEMBER", tingkat: "", diskonPersen: 5 })).toBeNull();
    expect(uraiMemberPembeli("MEMBER")).toBeNull();
    expect(uraiMemberPembeli(null)).toBeNull();
  });
});

describe("anggotaPratinjau / mintaDaftarMember", () => {
  it("copies the consignment store share and promo stacking from the settings", () => {
    expect(anggotaPratinjau({ member: { status: "MEMBER", tingkat: "Silver", diskonPersen: 5 }, daftarMember: false, aturan })).toEqual({
      tingkat: "Silver",
      diskonPersen: 5,
      gabungPromo: false,
      bagianTokoPersen: 20,
    });
  });

  it("registers only a number that is not (known to be) a member, while the programme is open", () => {
    expect(mintaDaftarMember({ member: null, daftarMember: true, aturan })).toBe(true);
    expect(mintaDaftarMember({ member: { status: "BUKAN", tingkatDaftar: "Member", diskonPersenDaftar: 0 }, daftarMember: true, aturan })).toBe(true);
    expect(mintaDaftarMember({ member: { status: "MEMBER", tingkat: "Silver", diskonPersen: 5 }, daftarMember: true, aturan })).toBe(false);
    expect(mintaDaftarMember({ member: { status: "NONAKTIF" }, daftarMember: true, aturan })).toBe(false);
    expect(mintaDaftarMember({ member: null, daftarMember: false, aturan })).toBe(false);
    expect(mintaDaftarMember({ member: null, daftarMember: true, aturan: { aktif: false } })).toBe(false);
  });
});
