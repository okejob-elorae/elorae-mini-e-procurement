import { describe, expect, it } from "vitest";
import { MEMBER_BAWAAN, type AturanMember } from "@/lib/spg/member";
import type { PromoKonter } from "@/lib/spg/promo-konter";
import {
  angkaDiskon,
  diskonUntukMesin,
  kekuranganJual,
  masalahPembeliBaru,
  memberDiketahui,
  memberKeranjang,
  nomorPerluCekMember,
  pembeliUntukKirim,
  pratinjauKeranjang,
  uraiSimpananKeranjang,
  type BarisKeranjang,
  type PembeliKeranjang,
} from "./keranjang";

const tanpaMember = { daftarMember: false, member: null } as const;

describe("uraiSimpananKeranjang", () => {
  it("restores lines, key, discount and shopper", () => {
    const s = uraiSimpananKeranjang(
      JSON.stringify({
        baris: [["i1::M", 2]],
        idempotencyKey: "k1",
        diskon: { jenis: "PERSEN", nilai: "5", alasan: "cacat" },
        pembeli: {
          jenis: "baru",
          nama: "Ani",
          hp: "0812",
          setuju: true,
          daftarMember: true,
          member: { hp: "62812", info: { status: "BUKAN", tingkatDaftar: "Member", diskonPersenDaftar: 5 } },
        },
      }),
    );
    expect(s).toEqual({
      baris: [["i1::M", 2]],
      idempotencyKey: "k1",
      diskon: { jenis: "PERSEN", nilai: "5", alasan: "cacat" },
      pembeli: {
        jenis: "baru",
        nama: "Ani",
        hp: "0812",
        setuju: true,
        daftarMember: true,
        member: { hp: "62812", info: { status: "BUKAN", tingkatDaftar: "Member", diskonPersenDaftar: 5 } },
      },
    });
  });

  it("reads a shopper saved before members existed as not registering, membership unknown", () => {
    const s = uraiSimpananKeranjang(
      JSON.stringify({ baris: [["i1::", 1]], idempotencyKey: "k1", pembeli: { jenis: "ada", id: "c1", nama: "Budi", hp: "62812" } }),
    );
    expect(s?.pembeli).toEqual({ jenis: "ada", id: "c1", nama: "Budi", hp: "62812", ...tanpaMember });
  });

  it("drops a broken member state but keeps the shopper", () => {
    const s = uraiSimpananKeranjang(
      JSON.stringify({
        baris: [],
        idempotencyKey: "k1",
        pembeli: { jenis: "ada", id: "c1", nama: "Budi", hp: "62812", daftarMember: "ya", member: { hp: "62812", info: { status: "EMAS" } } },
      }),
    );
    expect(s?.pembeli).toEqual({ jenis: "ada", id: "c1", nama: "Budi", hp: "62812", ...tanpaMember });
  });

  it("reads a cart saved before discounts and shoppers existed", () => {
    expect(uraiSimpananKeranjang(JSON.stringify({ baris: [["i1::", 1]], idempotencyKey: "k1" }))).toEqual({
      baris: [["i1::", 1]],
      idempotencyKey: "k1",
      diskon: null,
      pembeli: null,
    });
  });

  it("drops broken lines and broken parts, and refuses a cart without its key", () => {
    const s = uraiSimpananKeranjang(
      JSON.stringify({
        baris: [["a", 0], ["b", 1.5], [3, 1], ["c", 2]],
        idempotencyKey: "k1",
        diskon: { jenis: "GRATIS", nilai: "5", alasan: "" },
        pembeli: { jenis: "ada", nama: "Budi", hp: "62812" },
      }),
    );
    expect(s?.baris).toEqual([["c", 2]]);
    expect(s?.diskon).toBeNull();
    expect(s?.pembeli).toBeNull();
    expect(uraiSimpananKeranjang(JSON.stringify({ baris: [], idempotencyKey: "" }))).toBeNull();
    expect(uraiSimpananKeranjang("{rusak")).toBeNull();
    expect(uraiSimpananKeranjang(null)).toBeNull();
  });
});

describe("angkaDiskon / diskonUntukMesin", () => {
  it("reads rupiah with thousands dots and percent with a decimal comma", () => {
    expect(angkaDiskon({ jenis: "RUPIAH", nilai: "10.000" })).toBe(10_000);
    expect(angkaDiskon({ jenis: "RUPIAH", nilai: "10 000" })).toBe(10_000);
    expect(angkaDiskon({ jenis: "PERSEN", nilai: "12,5" })).toBe(12.5);
    expect(angkaDiskon({ jenis: "PERSEN", nilai: "7" })).toBe(7);
  });

  it("returns null for empty input and NaN for something that is not a number", () => {
    expect(angkaDiskon({ jenis: "PERSEN", nilai: "  " })).toBeNull();
    expect(angkaDiskon({ jenis: "PERSEN", nilai: "5%" })).toBeNaN();
    expect(angkaDiskon({ jenis: "RUPIAH", nilai: "Rp5000" })).toBeNaN();
  });

  it("gives the engine no discount for an empty, zero, or unreadable amount", () => {
    expect(diskonUntukMesin(null)).toBeNull();
    expect(diskonUntukMesin({ jenis: "PERSEN", nilai: "", alasan: "" })).toBeNull();
    expect(diskonUntukMesin({ jenis: "PERSEN", nilai: "0", alasan: "" })).toBeNull();
    expect(diskonUntukMesin({ jenis: "PERSEN", nilai: "abc", alasan: "" })).toBeNull();
    expect(diskonUntukMesin({ jenis: "RUPIAH", nilai: "5.000", alasan: "" })).toEqual({ jenis: "RUPIAH", nilai: 5_000 });
  });
});

describe("masalahPembeliBaru — same rules as the server", () => {
  it("needs a name, a WhatsApp-able mobile number, and consent — in that order", () => {
    expect(masalahPembeliBaru({ nama: " ", hp: "081234567890", setuju: true })).toBe("NAMA");
    expect(masalahPembeliBaru({ nama: "Ani", hp: "022-123456", setuju: true })).toBe("HP");
    expect(masalahPembeliBaru({ nama: "Ani", hp: "0812", setuju: true })).toBe("HP");
    expect(masalahPembeliBaru({ nama: "Ani", hp: "0812 3456 7890", setuju: false })).toBe("SETUJU");
    expect(masalahPembeliBaru({ nama: "Ani", hp: "0812 3456 7890", setuju: true })).toBeNull();
  });
});

describe("pembeliUntukKirim", () => {
  const program = { aktif: true };

  it("sends an existing customer by id and a complete new shopper trimmed", () => {
    expect(pembeliUntukKirim({ jenis: "ada", id: "c1", nama: "Budi", hp: "62812", ...tanpaMember }, program)).toEqual({ id: "c1", nama: "Budi" });
    expect(pembeliUntukKirim({ jenis: "baru", nama: " Ani ", hp: " 081234567890 ", setuju: true, ...tanpaMember }, program)).toEqual({
      nama: "Ani",
      hp: "081234567890",
      setuju: true,
    });
  });

  it("never sends a new shopper without consent", () => {
    expect(pembeliUntukKirim({ jenis: "baru", nama: "Ani", hp: "081234567890", setuju: false, ...tanpaMember }, program)).toBeNull();
  });

  it("asks to register only while the programme is open and the number is not (known to be) a member", () => {
    const baru = { jenis: "baru", nama: "Ani", hp: "081234567890", setuju: true, daftarMember: true, member: null } as const;
    expect(pembeliUntukKirim(baru, program)).toEqual({ nama: "Ani", hp: "081234567890", setuju: true, daftarMember: true });
    expect(pembeliUntukKirim(baru, { aktif: false })).toEqual({ nama: "Ani", hp: "081234567890", setuju: true });
    const sudah = { ...baru, member: { hp: "6281234567890", info: { status: "MEMBER", tingkat: "Gold", diskonPersen: 10 } } } as const;
    expect(pembeliUntukKirim(sudah, program)).not.toHaveProperty("daftarMember");
    const nonaktif = { ...baru, member: { hp: "6281234567890", info: { status: "NONAKTIF" } } } as const;
    expect(pembeliUntukKirim(nonaktif, program)).not.toHaveProperty("daftarMember");
    // Keadaan member untuk nomor LAMA tidak berlaku: nomornya diketik ulang → belum diketahui.
    const nomorLain = { ...sudah, hp: "081299998888" } as const;
    expect(pembeliUntukKirim(nomorLain, program)).toEqual({ nama: "Ani", hp: "081299998888", setuju: true, daftarMember: true });
    expect(pembeliUntukKirim({ jenis: "ada", id: "c1", nama: "Budi", hp: "6281234567890", daftarMember: true, member: null }, program)).toEqual({
      id: "c1",
      nama: "Budi",
      daftarMember: true,
    });
  });
});

describe("memberDiketahui / nomorPerluCekMember", () => {
  const info = { status: "MEMBER", tingkat: "Silver", diskonPersen: 5 } as const;

  it("uses the server's state only for the number it was read for", () => {
    const p: PembeliKeranjang = { jenis: "baru", nama: "Ani", hp: "0812 3456 7890", setuju: true, daftarMember: false, member: { hp: "6281234567890", info } };
    expect(memberDiketahui(p)).toEqual(info);
    expect(nomorPerluCekMember(p)).toBeNull();
    expect(memberDiketahui({ ...p, hp: "081299998888" })).toBeNull();
    expect(nomorPerluCekMember({ ...p, hp: "081299998888" })).toBe("6281299998888");
  });

  it("does not ask about a number that cannot be a WhatsApp number yet", () => {
    expect(nomorPerluCekMember({ jenis: "baru", nama: "", hp: "0812", setuju: false, ...tanpaMember })).toBeNull();
    expect(nomorPerluCekMember(null)).toBeNull();
  });
});

describe("memberKeranjang — the engine input the sale writer computes", () => {
  const aturan: AturanMember = {
    ...MEMBER_BAWAAN,
    diskonAktif: true,
    tingkat: [
      { kode: "MEMBER", nama: "Member", minBelanja: 0, diskonPersen: 5 },
      { kode: "GOLD", nama: "Gold", minBelanja: 1_000_000, diskonPersen: 10 },
    ],
  };
  const dasar = { jenis: "baru", nama: "Ani", hp: "081234567890", setuju: true } as const;

  it("a known member gets the server's tier and discount", () => {
    const m = memberKeranjang({ ...dasar, daftarMember: false, member: { hp: "6281234567890", info: { status: "MEMBER", tingkat: "Gold", diskonPersen: 10 } } }, aturan);
    expect(m).toEqual({ anggota: { tingkat: "Gold", diskonPersen: 10, gabungPromo: false, bagianTokoPersen: 0 }, mendaftar: false, minBelanjaDaftar: 0 });
  });

  it("a deactivated member is no member at all, even when asked to register", () => {
    expect(memberKeranjang({ ...dasar, daftarMember: true, member: { hp: "6281234567890", info: { status: "NONAKTIF" } } }, aturan)).toMatchObject({
      anggota: null,
      mendaftar: false,
    });
  });

  it("registering uses the tier the server reported, or the first tier when it could not be asked", () => {
    const bukan = memberKeranjang(
      { ...dasar, daftarMember: true, member: { hp: "6281234567890", info: { status: "BUKAN", tingkatDaftar: "Gold", diskonPersenDaftar: 10 } } },
      aturan,
    );
    expect(bukan).toMatchObject({ anggota: { tingkat: "Gold", diskonPersen: 10 }, mendaftar: true });
    expect(memberKeranjang({ ...dasar, daftarMember: true, member: null }, aturan)).toMatchObject({ anggota: { tingkat: "Member", diskonPersen: 5 }, mendaftar: true });
    // Tanpa centang daftar, bukan member tetap bukan member.
    expect(memberKeranjang({ ...dasar, daftarMember: false, member: null }, aturan)).toMatchObject({ anggota: null, mendaftar: false });
    // Program ditutup: tidak ada yang didaftarkan.
    expect(memberKeranjang({ ...dasar, daftarMember: true, member: null }, { ...aturan, aktif: false })).toMatchObject({ anggota: null, mendaftar: false });
    // Nomor yang belum sah belum bisa jadi member.
    expect(memberKeranjang({ ...dasar, hp: "0812", daftarMember: true, member: null }, aturan)).toMatchObject({ anggota: null, mendaftar: false });
  });

  it("member discount switched off by the office: still a member, discount 0", () => {
    expect(memberKeranjang({ ...dasar, daftarMember: true, member: null }, { ...aturan, diskonAktif: false })).toMatchObject({
      anggota: { tingkat: "Member", diskonPersen: 0 },
      mendaftar: true,
    });
  });
});

describe("pratinjauKeranjang with a member", () => {
  const baris: BarisKeranjang[] = [{ kunci: "i1::", row: { itemId: "i1", categoryId: null, price: 100_000 }, qty: 1 }];
  const promos: PromoKonter[] = [];
  const dasar = { baris, promos, storeId: "t1", waktu: new Date("2026-10-20T03:00:00Z"), aturan: { aktif: true, maksPersen: 20, alasanWajib: false, bagianTokoPersen: 0 }, diskon: null };
  const anggota = { tingkat: "Silver", diskonPersen: 10, gabungPromo: false, bagianTokoPersen: 0 };

  it("shows the member discount and its tier", () => {
    const p = pratinjauKeranjang({ ...dasar, member: { anggota, mendaftar: false, minBelanjaDaftar: 0 } });
    expect(p?.hasil.member).toEqual({ tingkat: "Silver", potongan: 10_000 });
    expect(p?.hasil.total).toBe(90_000);
    expect(p?.daftarKurang).toBeNull();
  });

  it("below the minimum spend to register: no member, no member price, and it says how much is missing", () => {
    const p = pratinjauKeranjang({ ...dasar, member: { anggota, mendaftar: true, minBelanjaDaftar: 150_000 } });
    expect(p?.hasil.member).toBeNull();
    expect(p?.hasil.total).toBe(100_000);
    expect(p?.daftarKurang).toEqual({ minimal: 150_000, kurang: 50_000 });
    // Yang sudah member tidak terkena belanja minimal pendaftaran.
    expect(pratinjauKeranjang({ ...dasar, member: { anggota, mendaftar: false, minBelanjaDaftar: 150_000 } })?.hasil.total).toBe(90_000);
  });

  it("the minimum is checked on the value after the SPG discount, before the member discount — like the writer", () => {
    const dengan = { ...dasar, diskon: { jenis: "RUPIAH" as const, nilai: "5.000", alasan: "" } };
    // 100.000 − 10.000 member − 5.000 SPG = 85.000; sebelum diskon member = 95.000.
    expect(pratinjauKeranjang({ ...dengan, member: { anggota, mendaftar: true, minBelanjaDaftar: 95_000 } })?.hasil.total).toBe(85_000);
    const kurang = pratinjauKeranjang({ ...dengan, member: { anggota, mendaftar: true, minBelanjaDaftar: 95_001 } });
    expect(kurang?.hasil.total).toBe(95_000);
    expect(kurang?.daftarKurang).toEqual({ minimal: 95_001, kurang: 1 });
  });
});

describe("kekuranganJual", () => {
  const tanpa = { diskon: null, alasanWajib: true, galatMesin: null, pembeli: null } as const;

  it("lets a plain cart through", () => {
    expect(kekuranganJual(tanpa)).toBeNull();
  });

  it("names the discount problem first, in form order", () => {
    expect(kekuranganJual({ ...tanpa, diskon: { jenis: "PERSEN", nilai: "", alasan: "" } })).toBe("DISKON_KOSONG");
    expect(kekuranganJual({ ...tanpa, diskon: { jenis: "PERSEN", nilai: "x", alasan: "" } })).toBe("DISKON_TIDAK_VALID");
    expect(
      kekuranganJual({ ...tanpa, diskon: { jenis: "PERSEN", nilai: "50", alasan: "" }, galatMesin: "DISKON_MANUAL_LEWAT_BATAS" }),
    ).toBe("DISKON_MANUAL_LEWAT_BATAS");
    expect(kekuranganJual({ ...tanpa, diskon: { jenis: "PERSEN", nilai: "5", alasan: " " } })).toBe("ALASAN_DISKON_WAJIB");
    expect(kekuranganJual({ ...tanpa, alasanWajib: false, diskon: { jenis: "PERSEN", nilai: "5", alasan: "" } })).toBeNull();
  });

  it("then the new shopper", () => {
    expect(
      kekuranganJual({
        ...tanpa,
        diskon: { jenis: "PERSEN", nilai: "5", alasan: "" },
        pembeli: { jenis: "baru", nama: "", hp: "", setuju: false, ...tanpaMember },
      }),
    ).toBe("ALASAN_DISKON_WAJIB");
    expect(kekuranganJual({ ...tanpa, pembeli: { jenis: "baru", nama: "Ani", hp: "081234567890", setuju: false, ...tanpaMember } })).toBe(
      "PEMBELI_SETUJU",
    );
    expect(kekuranganJual({ ...tanpa, pembeli: { jenis: "ada", id: "c1", nama: "Budi", hp: "62812", ...tanpaMember } })).toBeNull();
  });
});
