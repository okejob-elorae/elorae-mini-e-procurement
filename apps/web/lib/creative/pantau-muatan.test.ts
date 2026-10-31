import { describe, expect, it } from "vitest";
import {
  bacaHasil,
  bacaMasalah,
  formatDariBentuk,
  handleCocok,
  handleDariLink,
  idKontenDariLink,
  kontenIdDariLink,
  linkPantau,
  linkTiktok,
  normalHandle,
  pangkasInt,
  platformHasil,
  platformLinkPantau,
  urlKontenKanonik,
  urlKontenPlatform,
  urlProfilPantau,
  videoIdDariLink,
} from "./pantau-muatan";

/*
 * Muatan dari ekstensi adalah masukan dari luar: angka harus bilangan bulat
 * aman ≥ 0 (yang melewati kolom Int dipangkas saat disimpan, tidak ditolak),
 * teks dibatasi, bentuk lain ditolak. Handle dicocokkan tanpa memandang huruf
 * besar/kecil dan "@".
 */

const profil = {
  jenis: "PROFIL",
  uniqueId: "kol.satu",
  secUid: "MS4wLjABAAAA",
  pengikut: 12_000,
  totalLike: 50_000,
  jumlahVideo: 40,
  posting: [{ id: "7301", dibuatPada: 1_050_000_000, disematkan: false, views: 1000, like: 50, komentar: 5, share: 2, save: 1 }],
};
const konten = { jenis: "KONTEN", videoId: "7301234567890123456", uniqueId: "kol.satu", views: 1000, like: 50, komentar: 5, share: 2, save: 1 };

describe("bacaHasil", () => {
  it("menerima HasilProfil dan HasilKonten yang sah", () => {
    const p = bacaHasil(profil);
    expect(p.ok && p.hasil.jenis).toBe("PROFIL");
    const k = bacaHasil({ ...konten, dibuatPada: 1_050_000_000 });
    expect(k).toEqual({ ok: true, hasil: { ...konten, dibuatPada: 1_050_000_000 } });
  });

  it("isian opsional profil boleh tidak ada", () => {
    const r = bacaHasil({ jenis: "PROFIL", uniqueId: "x", pengikut: 0, posting: [] });
    expect(r.ok).toBe(true);
  });

  it("menolak angka pecahan, negatif, bukan angka, atau di atas bilangan bulat aman", () => {
    for (const salah of [12.5, -1, "12000", Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 2, null]) {
      expect(bacaHasil({ ...profil, pengikut: salah }), String(salah)).toEqual({ ok: false, kode: "MUATAN_TIDAK_SAH" });
      expect(bacaHasil({ ...konten, views: salah }), String(salah)).toEqual({ ok: false, kode: "MUATAN_TIDAK_SAH" });
      expect(bacaHasil({ ...profil, posting: [{ ...profil.posting[0], views: salah }] }).ok, String(salah)).toBe(false);
    }
  });

  it("angka di atas batas kolom Int (video viral) DITERIMA; pemangkasannya urusan penyimpan", () => {
    const viral = { ...profil.posting[0], views: 5_000_000_000, like: 3_000_000_000 };
    const r = bacaHasil({ ...profil, posting: [viral] });
    expect(r.ok && r.hasil.jenis === "PROFIL" && r.hasil.posting[0].views).toBe(5_000_000_000);
    expect(bacaHasil({ ...konten, views: 2_147_483_648 }).ok).toBe(true);
    expect(bacaHasil({ ...profil, pengikut: 2_147_483_648 }).ok).toBe(true);
  });

  it("pangkasInt memangkas ke batas kolom Int", () => {
    expect(pangkasInt(5_000_000_000)).toBe(2_147_483_647);
    expect(pangkasInt(12)).toBe(12);
  });

  it("menolak posting yang cacat dan daftar posting yang terlalu panjang", () => {
    const cacat = { ...profil.posting[0], disematkan: "tidak" };
    expect(bacaHasil({ ...profil, posting: [cacat] }).ok).toBe(false);
    expect(bacaHasil({ ...profil, posting: [{ ...profil.posting[0], like: -3 }] }).ok).toBe(false);
    expect(bacaHasil({ ...profil, posting: "banyak" }).ok).toBe(false);
    const banyak = Array.from({ length: 201 }, (_, i) => ({ ...profil.posting[0], id: String(i) }));
    expect(bacaHasil({ ...profil, posting: banyak }).ok).toBe(false);
  });

  it("menolak jenis yang tidak dikenal, uniqueId kosong, dan videoId yang aneh", () => {
    expect(bacaHasil({ ...konten, jenis: "LIVE" }).ok).toBe(false);
    expect(bacaHasil({ ...profil, uniqueId: "  " }).ok).toBe(false);
    expect(bacaHasil({ ...konten, videoId: "../../etc" }).ok).toBe(false);
    expect(bacaHasil(null).ok).toBe(false);
    expect(bacaHasil([profil]).ok).toBe(false);
  });
});

describe("bacaHasil — kolom brand opsional (teks, sebutan, tagar, iklan, penulis)", () => {
  const tambahan = { teks: "Outfit dari @Eloraé #OOTD", sebutan: ["Elorae.Official", "@toko.lain"], tagar: ["#OOTD", "EloraeStyle"], iklan: true, penulis: "Kol.Satu" };

  it("muatan lama tanpa kolom itu tetap diterima, tanpa kolom tambahan", () => {
    const p = bacaHasil(profil);
    expect(p.ok && p.hasil.jenis === "PROFIL" && Object.keys(p.hasil.posting[0]).sort()).toEqual(
      ["dibuatPada", "disematkan", "id", "komentar", "like", "save", "share", "views"].sort(),
    );
    expect(bacaHasil(konten)).toEqual({ ok: true, hasil: konten });
  });

  it("dibaca dan dirapikan di posting profil dan hasil konten", () => {
    const p = bacaHasil({ ...profil, posting: [{ ...profil.posting[0], ...tambahan }] });
    const harap = { teks: "Outfit dari @Eloraé #OOTD", sebutan: ["elorae.official", "toko.lain"], tagar: ["ootd", "eloraestyle"], iklan: true, penulis: "kol.satu" };
    expect(p.ok && p.hasil.jenis === "PROFIL" && p.hasil.posting[0]).toMatchObject(harap);
    const k = bacaHasil({ ...konten, ...tambahan });
    expect(k.ok && k.hasil).toMatchObject(harap);
  });

  it("teks dipotong 500 tanda; daftar dipotong ke batasnya; isian yang terlalu panjang atau kosong dibuang", () => {
    const k = bacaHasil({
      ...konten,
      teks: "x".repeat(900),
      sebutan: [...Array.from({ length: 40 }, (_, i) => `brand${i}`), "y".repeat(101), ""],
      tagar: Array.from({ length: 60 }, (_, i) => `t${i}`),
    });
    if (!k.ok || k.hasil.jenis !== "KONTEN") throw new Error("ditolak");
    expect(k.hasil.teks).toHaveLength(500);
    expect(k.hasil.sebutan).toHaveLength(30);
    expect(k.hasil.tagar).toHaveLength(50);
  });

  it("menolak TIPE yang salah, bukan kolom yang tidak ada", () => {
    for (const salah of [{ teks: 5 }, { sebutan: "elorae" }, { sebutan: [1] }, { tagar: {} }, { tagar: [null] }, { iklan: "ya" }, { penulis: 7 }, { penulis: "x".repeat(101) }]) {
      expect(bacaHasil({ ...konten, ...salah }), JSON.stringify(salah)).toEqual({ ok: false, kode: "MUATAN_TIDAK_SAH" });
      expect(bacaHasil({ ...profil, posting: [{ ...profil.posting[0], ...salah }] }).ok, JSON.stringify(salah)).toBe(false);
    }
    // null = tidak dikirim.
    const k = bacaHasil({ ...konten, teks: null, sebutan: null, tagar: null, iklan: null, penulis: null });
    expect(k).toEqual({ ok: true, hasil: konten });
  });
});

describe("bacaMasalah", () => {
  it("menerima kode yang dikenal, pesan dipangkas", () => {
    expect(bacaMasalah({ kode: "CAPTCHA" })).toEqual({ ok: true, masalah: { kode: "CAPTCHA", tugasId: null, pesan: null } });
    const r = bacaMasalah({ kode: "GAGAL_MUAT", tugasId: "t1", pesan: "x".repeat(5000) });
    expect(r.ok && r.masalah.pesan?.length).toBe(1000);
  });

  it("menolak kode lain", () => {
    expect(bacaMasalah({ kode: "LAINNYA" })).toEqual({ ok: false, kode: "MUATAN_TIDAK_SAH" });
    expect(bacaMasalah({})).toEqual({ ok: false, kode: "MUATAN_TIDAK_SAH" });
  });
});

describe("handle dan link TikTok", () => {
  it("normalHandle membuang @, spasi, dan huruf besar; juga dari URL profil", () => {
    expect(normalHandle(" @@Kol.Satu ")).toBe("kol.satu");
    expect(normalHandle("https://www.tiktok.com/@Kol.Satu?lang=id")).toBe("kol.satu");
    expect(normalHandle("")).toBe("");
  });

  it("handleCocok tanpa memandang huruf besar/kecil dan @", () => {
    expect(handleCocok("KOL.satu", ["@kol.satu"])).toBe(true);
    expect(handleCocok("kol.dua", ["@kol.satu"])).toBe(false);
    expect(handleCocok("", [""])).toBe(false);
  });

  it("videoId dan handle dibaca dari link video/foto", () => {
    expect(videoIdDariLink("https://www.tiktok.com/@kol.satu/video/7301234567890123456?is_from_webapp=1")).toBe("7301234567890123456");
    expect(videoIdDariLink("tiktok.com/@kol.satu/photo/7301234567890123457")).toBe("7301234567890123457");
    expect(videoIdDariLink("https://vt.tiktok.com/ZSabc/")).toBeNull();
    expect(handleDariLink("https://www.tiktok.com/@Kol.Satu/video/1")).toBe("kol.satu");
    expect(handleDariLink("https://vt.tiktok.com/ZSabc/")).toBeNull();
  });

  it("urlKontenKanonik: link panjang dirapikan ke www.tiktok.com/@handle/video/<id>; link pendek dibiarkan", () => {
    expect(urlKontenKanonik("tiktok.com/@Kol.Satu/video/7301?is_from_webapp=1&sender_device=pc")).toBe("https://www.tiktok.com/@kol.satu/video/7301");
    expect(urlKontenKanonik("https://m.tiktok.com/@kol.satu/photo/99")).toBe("https://www.tiktok.com/@kol.satu/photo/99");
    expect(urlKontenKanonik(" https://vt.tiktok.com/ZSabc/ ")).toBe("https://vt.tiktok.com/ZSabc/");
  });

  it("linkTiktok hanya untuk tiktok.com dan subdomainnya", () => {
    expect(linkTiktok("https://www.tiktok.com/@a/video/1")).toBe(true);
    expect(linkTiktok("tiktok.com/@a")).toBe(true);
    expect(linkTiktok("https://vt.tiktok.com/x")).toBe(true);
    expect(linkTiktok("https://tiktok.com.penipu.id/@a")).toBe(false);
    expect(linkTiktok("https://www.instagram.com/reel/x")).toBe(false);
    expect(linkTiktok(null)).toBe(false);
  });
});

describe("bacaHasil — Instagram dan YouTube (platform)", () => {
  const igKonten = { platform: "INSTAGRAM", jenis: "KONTEN", videoId: "C9xYz_AbC-1", uniqueId: "Kol.Satu", like: 120, komentar: 8, bentuk: "REEL" };
  const ytKonten = { platform: "YOUTUBE", jenis: "KONTEN", videoId: "dQw4w9WgXcQ", uniqueId: "kolsatu", views: 1_500_000, bentuk: "SHORTS" };

  it("tanpa platform = TikTok, dan hasilnya tidak membawa kolom platform (bentuk lama tidak berubah)", () => {
    const k = bacaHasil(konten);
    expect(k.ok && platformHasil(k.hasil)).toBe("TIKTOK");
    expect(k.ok && "platform" in k.hasil).toBe(false);
    expect(bacaHasil({ ...konten, platform: "TIKTOK" })).toEqual({ ok: true, hasil: konten });
  });

  it("Instagram: angka yang tidak terbaca boleh tidak ada (bukan 0); shortcode huruf besar/kecil dipertahankan", () => {
    const r = bacaHasil(igKonten);
    expect(r).toEqual({ ok: true, hasil: { platform: "INSTAGRAM", jenis: "KONTEN", videoId: "C9xYz_AbC-1", uniqueId: "Kol.Satu", like: 120, komentar: 8, bentuk: "REEL" } });
    expect(r.ok && r.hasil.jenis === "KONTEN" && "share" in r.hasil).toBe(false);
  });

  it("Instagram tanpa satu pun dari views/like/komentar, atau YouTube tanpa views → ditolak", () => {
    expect(bacaHasil({ ...igKonten, like: undefined, komentar: undefined }).ok).toBe(false);
    expect(bacaHasil({ ...ytKonten, views: undefined }).ok).toBe(false);
    expect(bacaHasil({ ...ytKonten, views: null, like: 5 }).ok).toBe(false);
  });

  it("TikTok tetap mewajibkan kelima angka", () => {
    expect(bacaHasil({ ...konten, share: undefined }).ok).toBe(false);
  });

  it("id konten diperiksa per platform; bentuk harus milik platformnya; platform lain ditolak", () => {
    expect(bacaHasil({ ...ytKonten, videoId: "pendek" }).ok).toBe(false);
    expect(bacaHasil({ ...igKonten, videoId: "abc" }).ok).toBe(false);
    expect(bacaHasil({ ...igKonten, bentuk: "SHORTS" }).ok).toBe(false);
    expect(bacaHasil({ ...ytKonten, bentuk: "REEL" }).ok).toBe(false);
    expect(bacaHasil({ ...igKonten, platform: "THREADS" }).ok).toBe(false);
    expect(bacaHasil({ ...igKonten, platform: 3 }).ok).toBe(false);
    expect(bacaHasil({ ...igKonten, like: -1 }).ok).toBe(false);
  });

  it("profil YouTube: pengikut perkiraan dan id kanal; posting kosong boleh", () => {
    const r = bacaHasil({ platform: "YOUTUBE", jenis: "PROFIL", uniqueId: "kolsatu", pengikut: 46_500_000, pengikutPerkiraan: true, idPlatform: "UCabc", posting: [] });
    expect(r).toEqual({ ok: true, hasil: { platform: "YOUTUBE", jenis: "PROFIL", uniqueId: "kolsatu", pengikut: 46_500_000, pengikutPerkiraan: true, idPlatform: "UCabc", posting: [] } });
    expect(bacaHasil({ platform: "YOUTUBE", jenis: "PROFIL", uniqueId: "x", pengikut: 1, pengikutPerkiraan: "ya", posting: [] }).ok).toBe(false);
  });

  it("profil Instagram: posting dengan shortcode, tanpa share/simpan", () => {
    const r = bacaHasil({
      platform: "INSTAGRAM",
      jenis: "PROFIL",
      uniqueId: "kol.satu",
      pengikut: 686_570_511,
      posting: [{ id: "C9xYz_AbC-1", dibuatPada: 1_050_000_000, disematkan: false, views: 9000, like: 100, komentar: 4, bentuk: "REEL", sebutan: ["elorae.official"] }],
    });
    expect(r.ok && r.hasil.jenis === "PROFIL" && r.hasil.posting[0]).toEqual({
      id: "C9xYz_AbC-1",
      dibuatPada: 1_050_000_000,
      disematkan: false,
      views: 9000,
      like: 100,
      komentar: 4,
      bentuk: "REEL",
      sebutan: ["elorae.official"],
    });
  });
});

describe("link Instagram dan YouTube", () => {
  it("platformLinkPantau / linkPantau mengenali TikTok, Instagram, YouTube (termasuk youtu.be), bukan situs lain", () => {
    expect(platformLinkPantau("instagram.com/reel/C9x12")).toBe("INSTAGRAM");
    expect(platformLinkPantau("https://youtu.be/dQw4w9WgXcQ")).toBe("YOUTUBE");
    expect(platformLinkPantau("https://m.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("YOUTUBE");
    expect(platformLinkPantau("https://www.threads.net/@a/post/x")).toBeNull();
    expect(linkPantau("https://fakeyoutube.com/watch?v=dQw4w9WgXcQ")).toBe(false);
  });

  it("idKontenDariLink: reel, posting, posting ber-akun, shorts, watch, youtu.be; selain itu null", () => {
    expect(idKontenDariLink("https://www.instagram.com/reel/C9xYz_AbC-1/?igsh=abc")).toEqual({ platform: "INSTAGRAM", id: "C9xYz_AbC-1", bentuk: "REEL", handle: null });
    expect(idKontenDariLink("instagram.com/p/DAbcdEfGh12")).toEqual({ platform: "INSTAGRAM", id: "DAbcdEfGh12", bentuk: "POST", handle: null });
    expect(idKontenDariLink("https://www.instagram.com/Kol.Satu/reel/C9xYz_AbC-1/")).toEqual({ platform: "INSTAGRAM", id: "C9xYz_AbC-1", bentuk: "REEL", handle: "kol.satu" });
    expect(idKontenDariLink("https://www.instagram.com/kol.satu/")).toBeNull();
    expect(idKontenDariLink("https://www.instagram.com/stories/kol.satu/123/")).toBeNull();
    expect(idKontenDariLink("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10")).toEqual({ platform: "YOUTUBE", id: "dQw4w9WgXcQ", bentuk: "VIDEO", handle: null });
    expect(idKontenDariLink("youtube.com/shorts/dQw4w9WgXcQ")).toEqual({ platform: "YOUTUBE", id: "dQw4w9WgXcQ", bentuk: "SHORTS", handle: null });
    expect(idKontenDariLink("https://youtu.be/dQw4w9WgXcQ?si=x")).toEqual({ platform: "YOUTUBE", id: "dQw4w9WgXcQ", bentuk: "VIDEO", handle: null });
    expect(idKontenDariLink("https://www.youtube.com/@kolsatu/videos")).toBeNull();
    expect(idKontenDariLink("https://www.youtube.com/watch?v=pendek")).toBeNull();
    expect(idKontenDariLink("https://www.tiktok.com/@kol.satu/video/7301234567890123456")).toEqual({
      platform: "TIKTOK",
      id: "7301234567890123456",
      bentuk: "VIDEO",
      handle: "kol.satu",
    });
    expect(kontenIdDariLink("https://youtu.be/dQw4w9WgXcQ", "INSTAGRAM")).toBeNull();
  });

  it("urlKontenKanonik dan urlKontenPlatform: link baku per platform", () => {
    expect(urlKontenKanonik("https://www.instagram.com/kol.satu/reel/C9xYz_AbC-1/?igsh=abc")).toBe("https://www.instagram.com/reel/C9xYz_AbC-1/");
    expect(urlKontenKanonik("instagram.com/tv/C9xYz_AbC-1")).toBe("https://www.instagram.com/p/C9xYz_AbC-1/");
    expect(urlKontenKanonik("https://youtu.be/dQw4w9WgXcQ?si=x")).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(urlKontenKanonik("https://m.youtube.com/shorts/dQw4w9WgXcQ?feature=share")).toBe("https://www.youtube.com/shorts/dQw4w9WgXcQ");
    expect(urlKontenPlatform("TIKTOK", "7301", { handle: "@Kol.Satu" })).toBe("https://www.tiktok.com/@kol.satu/video/7301");
    expect(urlKontenPlatform("INSTAGRAM", "C9xYz_AbC-1", { bentuk: "REEL" })).toBe("https://www.instagram.com/reel/C9xYz_AbC-1/");
  });

  it("handle dari link dan URL profil per platform", () => {
    expect(handleDariLink("https://www.instagram.com/Kol.Satu/p/C9xYz_AbC-1/")).toBe("kol.satu");
    expect(handleDariLink("https://www.instagram.com/p/C9xYz_AbC-1/")).toBeNull();
    expect(handleDariLink("https://www.youtube.com/@KolSatu")).toBe("kolsatu");
    expect(normalHandle("https://www.instagram.com/Kol.Satu/?hl=id")).toBe("kol.satu");
    expect(normalHandle("https://www.instagram.com/p/C9xYz")).toBe("https://www.instagram.com/p/c9xyz");
    expect(normalHandle("https://www.youtube.com/@KolSatu/videos")).toBe("kolsatu");
    expect(urlProfilPantau("INSTAGRAM", "@Kol.Satu")).toBe("https://www.instagram.com/kol.satu/");
    expect(urlProfilPantau("YOUTUBE", "KolSatu")).toBe("https://www.youtube.com/@kolsatu");
  });

  it("formatDariBentuk: reel → REELS, posting Instagram → FEED, YouTube → VIDEO", () => {
    expect(formatDariBentuk("INSTAGRAM", "REEL")).toBe("REELS");
    expect(formatDariBentuk("INSTAGRAM", "POST")).toBe("FEED");
    expect(formatDariBentuk("INSTAGRAM", undefined)).toBe("FEED");
    expect(formatDariBentuk("YOUTUBE", "SHORTS")).toBe("VIDEO");
  });
});
