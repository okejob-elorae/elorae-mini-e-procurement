import { describe, expect, it } from "vitest";
import { bacaHasil, bacaMasalah, handleCocok, handleDariLink, linkTiktok, normalHandle, pangkasInt, urlKontenKanonik, videoIdDariLink } from "./pantau-muatan";

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
