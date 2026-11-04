import { describe, expect, it } from "vitest";
import {
  BRAND_BAWAAN,
  bacaBrand,
  barisBrandPosting,
  brandDariPosting,
  handleDariTeks,
  jenisBrand,
  jenisUntukDeteksi,
  kunciBrand,
  labelBrand,
  MAKS_CAPTION_BRAND,
  menandaiElorae,
  normalBrand,
  normalTagar,
  postingMilik,
  tagarPosting,
  validasiBrand,
  type PengaturanBrand,
} from "./brand-collab";

/*
 * Aturan murni riwayat brand KOL (D1) dan deteksi "menandai Elorae" (D2).
 * Sumber utama brand = handle yang ditandai di data TikTok (`sebutan`, dari
 * `textExtra[].userUniqueId` type 0); cadangan pola `@handle` di caption hanya
 * bila daftarnya tidak dikirim sama sekali.
 */

const PG: PengaturanBrand = { ...BRAND_BAWAAN, tagarElorae: ["eloraestyle"], kompetitor: [{ handle: "toko.lain", nama: "Toko Lain" }] };

describe("normalBrand dan normalTagar", () => {
  it("handle tanpa @, spasi, dan huruf besar; URL profil TikTok juga dibaca", () => {
    expect(normalBrand(" @Elorae.Official ")).toBe("elorae.official");
    expect(normalBrand("https://www.tiktok.com/@Elorae.Official?lang=id")).toBe("elorae.official");
    expect(normalBrand("toko_a-b")).toBe("toko_a-b");
  });

  it("bentuk yang pasti bukan handle → kosong", () => {
    expect(normalBrand("dua kata")).toBe("");
    expect(normalBrand("")).toBe("");
    expect(normalBrand("x".repeat(101))).toBe("");
    expect(normalBrand(12 as unknown as string)).toBe("");
  });

  it("tagar tanpa #, huruf kecil; huruf non-Latin boleh", () => {
    expect(normalTagar("#EloraeStyle")).toBe("eloraestyle");
    expect(normalTagar("ootdhijab")).toBe("ootdhijab");
    expect(normalTagar("#café")).toBe("café");
    expect(normalTagar("dua kata")).toBe("");
  });
});

describe("handleDariTeks (cadangan caption)", () => {
  it("membaca @handle; titik di akhir kalimat dibuang", () => {
    expect(handleDariTeks("Pakai outfit dari @Elorae.Official. Thanks @Toko_A!")).toEqual(["elorae.official", "toko_a"]);
  });

  it("nama tampilan beraksen (@Eloraé) bukan handle — tidak ditebak", () => {
    expect(handleDariTeks("Outfit dari @Eloraé keren")).toEqual([]);
  });

  it("alamat surel bukan sebutan", () => {
    expect(handleDariTeks("kerja sama: halo@kol.com")).toEqual([]);
  });
});

describe("brandDariPosting", () => {
  it("memakai `sebutan` bila dikirim — caption tidak ditebak", () => {
    expect(brandDariPosting({ sebutan: ["elorae.official"], teks: "makasih @Eloraé dan @lain" }, [])).toEqual(["elorae.official"]);
    expect(brandDariPosting({ sebutan: [], teks: "makasih @lain" }, [])).toEqual([]);
  });

  it("tanpa `sebutan` → pola @handle di caption", () => {
    expect(brandDariPosting({ teks: "makasih @Toko.Lain" }, [])).toEqual(["toko.lain"]);
  });

  it("akun KOL itu sendiri tidak pernah dihitung sebagai brand; kembar dibuang", () => {
    expect(brandDariPosting({ sebutan: ["Kol.Satu", "elorae.official", "@Elorae.Official"] }, ["@kol.satu"])).toEqual(["elorae.official"]);
  });
});

describe("jenisBrand", () => {
  it("iklan TikTok → BERBAYAR", () => {
    expect(jenisBrand({ iklan: true })).toBe("BERBAYAR");
  });

  it("tagar atau kata di caption yang menandai iklan → BERBAYAR", () => {
    expect(jenisBrand({ tagar: ["ad"] })).toBe("BERBAYAR");
    expect(jenisBrand({ tagar: ["Endorse"] })).toBe("BERBAYAR");
    expect(jenisBrand({ teks: "Paid partnership dengan brand ini" })).toBe("BERBAYAR");
    expect(jenisBrand({ teks: "kerja sama berbayar ya guys" })).toBe("BERBAYAR");
    expect(jenisBrand({ teks: "ini #sponsored" })).toBe("BERBAYAR");
  });

  it("penanda kolaborasi → KOLABORASI; BERBAYAR menang bila keduanya ada", () => {
    expect(jenisBrand({ tagar: ["collab"] })).toBe("KOLABORASI");
    expect(jenisBrand({ teks: "dapat PR package #gifted" })).toBe("KOLABORASI");
    expect(jenisBrand({ tagar: ["gifted", "ad"] })).toBe("BERBAYAR");
  });

  it("selain itu TAG — tagar yang hanya MEMUAT kata penanda tidak dihitung", () => {
    expect(jenisBrand({ tagar: ["adidas", "partnerku"], teks: "ada apa hari ini" })).toBe("TAG");
    expect(jenisBrand({})).toBe("TAG");
  });
});

describe("menandaiElorae", () => {
  it("menandai salah satu akun Elorae", () => {
    expect(menandaiElorae({ sebutan: ["elorae.official"] }, PG, ["kol.satu"])).toBe(true);
    expect(menandaiElorae({ sebutan: ["toko.lain"] }, PG, ["kol.satu"])).toBe(false);
  });

  it("memakai salah satu tagar Elorae (juga dari caption bila tagar tidak dikirim)", () => {
    expect(menandaiElorae({ tagar: ["EloraeStyle"] }, PG, [])).toBe(true);
    expect(menandaiElorae({ teks: "ootd #eloraestyle" }, PG, [])).toBe(true);
    expect(menandaiElorae({ tagar: ["elorae"] }, PG, [])).toBe(false);
  });

  it("akun Elorae sendiri tidak 'menandai Elorae' di videonya sendiri", () => {
    expect(menandaiElorae({ sebutan: ["elorae.official"] }, PG, ["elorae.official"])).toBe(false);
    expect(menandaiElorae({ tagar: ["eloraestyle"] }, PG, ["elorae.official"])).toBe(false);
  });
});

describe("jenisUntukDeteksi", () => {
  it("Afiliasi hanya bila semua kolaborasi berjalan KOMISI; tanpa kolaborasi berjalan → KOL", () => {
    expect(jenisUntukDeteksi(["KOMISI", "KOMISI"])).toBe("AFILIASI");
    expect(jenisUntukDeteksi(["KOMISI", "BERBAYAR"])).toBe("KOL");
    expect(jenisUntukDeteksi([])).toBe("KOL");
  });
});

describe("tagarPosting dan postingMilik", () => {
  it("tagar dari daftar; tanpa daftar dari caption", () => {
    expect(tagarPosting({ tagar: ["#OOTD", "ootd"] })).toEqual(["ootd"]);
    expect(tagarPosting({ teks: "hari ini #OOTD #Elorae_Style" })).toEqual(["ootd", "elorae_style"]);
  });

  it("posting milik pemilik profil bila penulisnya tidak disebut atau sama", () => {
    expect(postingMilik({}, "kol.satu")).toBe(true);
    expect(postingMilik({ penulis: "@Kol.Satu" }, "kol.satu")).toBe(true);
    expect(postingMilik({ penulis: "orang.lain" }, "kol.satu")).toBe(false);
  });
});

describe("barisBrandPosting", () => {
  it("satu baris per brand, kunci PLATFORM:postId:brand, caption dipotong", () => {
    const teks = "x".repeat(800);
    const b = barisBrandPosting(
      { id: "7301", dibuatPada: 1_700_000_000, views: 1200, teks, sebutan: ["elorae.official", "toko.lain"], tagar: ["gifted"] },
      { platform: "TIKTOK", handle: "kol.satu", handleSendiri: ["kol.satu"] },
    );
    expect(b.map((x) => x.kunci)).toEqual(["TIKTOK:7301:elorae.official", "TIKTOK:7301:toko.lain"]);
    expect(b[0]).toMatchObject({
      brandHandle: "elorae.official",
      jenis: "KOLABORASI",
      postId: "7301",
      postUrl: "https://www.tiktok.com/@kol.satu/video/7301",
      postedAt: new Date(1_700_000_000_000),
      views: 1200,
    });
    expect(b[0].caption).toHaveLength(MAKS_CAPTION_BRAND);
  });

  it("tanpa brand → tanpa baris; angka di atas kolom Int dipangkas", () => {
    expect(barisBrandPosting({ id: "1", teks: "tanpa sebutan" }, { platform: "TIKTOK", handle: "a", handleSendiri: [] })).toEqual([]);
    const [v] = barisBrandPosting({ id: "2", views: 5_000_000_000, sebutan: ["b"] }, { platform: "TIKTOK", handle: "a", handleSendiri: [] });
    expect(v.views).toBe(2_147_483_647);
  });

  it("kunciBrand", () => {
    expect(kunciBrand("TIKTOK", "99", "Elorae.Official")).toBe("TIKTOK:99:elorae.official");
  });
});

describe("pengaturan kreatif.brand", () => {
  it("baris kosong atau rusak → bawaan di kode", () => {
    expect(bacaBrand(null)).toEqual(BRAND_BAWAAN);
    expect(bacaBrand("{rusak")).toEqual(BRAND_BAWAAN);
    expect(BRAND_BAWAAN).toEqual({ akunElorae: ["elorae.official"], tagarElorae: [], kompetitor: [], otomatisKePerforma: true });
  });

  it("isian yang sah dipakai, yang cacat jatuh ke bawaan per kolom", () => {
    const r = bacaBrand(JSON.stringify({ akunElorae: ["@Elorae.ID"], tagarElorae: "bukan daftar", kompetitor: [{ handle: "@Toko.Lain", nama: "Toko Lain" }], otomatisKePerforma: false }));
    expect(r).toEqual({ akunElorae: ["elorae.id"], tagarElorae: [], kompetitor: [{ handle: "toko.lain", nama: "Toko Lain" }], otomatisKePerforma: false });
  });

  it("validasi: rapikan, buang kembar; tolak handle/tagar cacat, terlalu banyak, dan bentrok Elorae vs kompetitor", () => {
    const v = validasiBrand({ akunElorae: ["@Elorae.Official", "elorae.official"], tagarElorae: ["#EloraeStyle"], kompetitor: [{ handle: "Toko.Lain", nama: " Toko " }], otomatisKePerforma: true });
    expect(v).toEqual({ ok: true, pengaturan: { akunElorae: ["elorae.official"], tagarElorae: ["eloraestyle"], kompetitor: [{ handle: "toko.lain", nama: "Toko" }], otomatisKePerforma: true } });
    expect(validasiBrand({ ...BRAND_BAWAAN, akunElorae: ["dua kata"] })).toMatchObject({ ok: false, kode: "HANDLE_TIDAK_SAH", nilai: "dua kata" });
    expect(validasiBrand({ ...BRAND_BAWAAN, tagarElorae: ["a b"] })).toMatchObject({ ok: false, kode: "TAGAR_TIDAK_SAH" });
    expect(validasiBrand({ ...BRAND_BAWAAN, akunElorae: Array.from({ length: 21 }, (_, i) => `a${i}`) })).toMatchObject({ ok: false, kode: "TERLALU_BANYAK" });
    expect(validasiBrand({ ...BRAND_BAWAAN, kompetitor: [{ handle: "elorae.official", nama: "" }] })).toMatchObject({ ok: false, kode: "BENTROK" });
    expect(validasiBrand({ ...BRAND_BAWAAN, otomatisKePerforma: "ya" })).toMatchObject({ ok: false, kode: "TIDAK_VALID" });
    expect(validasiBrand(null)).toMatchObject({ ok: false, kode: "TIDAK_VALID" });
  });

  it("labelBrand: Elorae lebih dulu, lalu kompetitor", () => {
    expect(labelBrand("Elorae.Official", PG)).toBe("ELORAE");
    expect(labelBrand("toko.lain", PG)).toBe("KOMPETITOR");
    expect(labelBrand("lain.lagi", PG)).toBeNull();
  });
});
