import { describe, expect, it } from "vitest";
import { bacaLinkVideo, kenaliLink, linkVideoPanjang, waktuTayangDariId } from "./link-video";

/*
 * Pembaca link video TikTok dari teks tempelan (Kreatif → Performa video).
 * Pemilik menempel ratusan link sekaligus — satu per baris, atau tercampur
 * dengan teks WhatsApp — jadi pembacanya harus memungut setiap link, merapikan
 * bentuknya, membuang yang kembar, dan menyebut alasan untuk yang tidak bisa.
 */

const ID = "7689069333120634120";
const KANONIK = `https://www.tiktok.com/@lystianovilda/video/${ID}`;

describe("kenaliLink — link video panjang", () => {
  it("link lengkap dari pemilik", () => {
    expect(kenaliLink(KANONIK)).toEqual({ bentuk: "PANJANG", teks: KANONIK, videoId: ID, handle: "lystianovilda", url: KANONIK });
  });

  it("tanpa https://, tanpa www., m., parameter pelacak, dan huruf besar di handle → bentuk baku", () => {
    for (const teks of [
      `tiktok.com/@lystianovilda/video/${ID}`,
      `www.tiktok.com/@LystiaNovilda/video/${ID}?is_from_webapp=1&sender_device=pc`,
      `https://m.tiktok.com/@lystianovilda/video/${ID}?lang=id`,
      `http://www.tiktok.com/@lystianovilda/video/${ID}/`,
      `https://www.tiktok.com/@lystianovilda/video/${ID}#komentar`,
    ]) {
      expect(kenaliLink(teks)).toMatchObject({ bentuk: "PANJANG", videoId: ID, handle: "lystianovilda", url: KANONIK });
    }
  });

  it("handle bertitik dan bergaris bawah tetap utuh", () => {
    expect(kenaliLink("https://www.tiktok.com/@ujitempel.satu_2/video/7301234567890123456")).toMatchObject({
      handle: "ujitempel.satu_2",
      url: "https://www.tiktok.com/@ujitempel.satu_2/video/7301234567890123456",
    });
  });

  it("handle dengan tanda aneh atau id video yang bukan id TikTok → tidak dikenal", () => {
    expect(kenaliLink(`https://www.tiktok.com/@ab%20c/video/${ID}`)).toEqual({ ditolak: "LINK_TIDAK_DIKENAL" });
    expect(kenaliLink("https://www.tiktok.com/@abc/video/123")).toEqual({ ditolak: "LINK_TIDAK_DIKENAL" });
  });
});

describe("kenaliLink — link pendek", () => {
  it("vt., vm., dan tiktok.com/t/ ditandai pendek, dirapikan ke https", () => {
    expect(kenaliLink("https://vt.tiktok.com/ZSabc123/")).toEqual({ bentuk: "PENDEK", teks: "https://vt.tiktok.com/ZSabc123/", url: "https://vt.tiktok.com/ZSabc123/" });
    expect(kenaliLink("vm.tiktok.com/ZMabc9")).toMatchObject({ bentuk: "PENDEK", url: "https://vm.tiktok.com/ZMabc9/" });
    expect(kenaliLink("https://www.tiktok.com/t/ZTRabc12/")).toMatchObject({ bentuk: "PENDEK", url: "https://www.tiktok.com/t/ZTRabc12/" });
    expect(kenaliLink("tiktok.com/t/ZTRabc12")).toMatchObject({ bentuk: "PENDEK", url: "https://www.tiktok.com/t/ZTRabc12/" });
  });

  it("link m.tiktok.com/v/<id>.html (tanpa handle) juga dibuka seperti link pendek", () => {
    expect(kenaliLink(`https://m.tiktok.com/v/${ID}.html?u_code=x`)).toMatchObject({ bentuk: "PENDEK", url: `https://m.tiktok.com/v/${ID}.html` });
  });

  it("link pendek tanpa kode → tidak dikenal", () => {
    expect(kenaliLink("https://vt.tiktok.com/")).toEqual({ ditolak: "LINK_TIDAK_DIKENAL" });
  });
});

describe("kenaliLink — yang tidak didukung", () => {
  it("Instagram", () => {
    expect(kenaliLink("https://www.instagram.com/reel/C9abc/")).toEqual({ ditolak: "INSTAGRAM" });
    expect(kenaliLink("instagram.com/p/xyz")).toEqual({ ditolak: "INSTAGRAM" });
    expect(kenaliLink("instagr.am/p/xyz")).toEqual({ ditolak: "INSTAGRAM" });
  });

  it("posting foto TikTok, profil, dan halaman TikTok lain", () => {
    expect(kenaliLink(`https://www.tiktok.com/@lystianovilda/photo/${ID}`)).toEqual({ ditolak: "LINK_FOTO" });
    expect(kenaliLink("https://www.tiktok.com/@lystianovilda")).toEqual({ ditolak: "BUKAN_VIDEO" });
    expect(kenaliLink("https://www.tiktok.com/tag/ootd")).toEqual({ ditolak: "BUKAN_VIDEO" });
  });

  it("situs lain", () => {
    expect(kenaliLink("https://shopee.co.id/product/1/2")).toEqual({ ditolak: "BUKAN_TIKTOK" });
    expect(kenaliLink("www.youtube.com/watch?v=abc")).toEqual({ ditolak: "BUKAN_TIKTOK" });
    expect(kenaliLink("https://faketiktok.com/@a/video/7301234567890123456")).toEqual({ ditolak: "BUKAN_TIKTOK" });
  });
});

describe("bacaLinkVideo — teks tempelan", () => {
  it("satu link per baris, baris kosong diabaikan", () => {
    const r = bacaLinkVideo(`${KANONIK}\n\n  https://www.tiktok.com/@kol.dua/video/7301234567890123456  \n`);
    expect(r.link.map((l) => (l.bentuk === "PANJANG" ? l.videoId : l.url))).toEqual([ID, "7301234567890123456"]);
    expect(r.ditolak).toEqual([]);
    expect(r.kembar).toBe(0);
  });

  it("tercampur teks WhatsApp: tanda baca, tebal/miring, dan link yang menempel pada kata", () => {
    const teks = [
      "Kak ini videonya ya 🙏 https://vt.tiktok.com/ZSabc123/ makasih",
      "*Video 2:* tiktok.com/@kol.dua/video/7301234567890123456,",
      "(lihat juga: https://www.tiktok.com/@kol.tiga/video/7301234567890123457)",
      "videonya:https://vm.tiktok.com/ZMx9/",
      "Halo kak, dll.ya, Rp.100.000 — terima kasih.",
    ].join("\n");
    const r = bacaLinkVideo(teks);
    expect(r.link.map((l) => (l.bentuk === "PANJANG" ? l.url : `pendek ${l.url}`))).toEqual([
      "pendek https://vt.tiktok.com/ZSabc123/",
      "https://www.tiktok.com/@kol.dua/video/7301234567890123456",
      "https://www.tiktok.com/@kol.tiga/video/7301234567890123457",
      "pendek https://vm.tiktok.com/ZMx9/",
    ]);
    expect(r.ditolak).toEqual([]);
  });

  it("video yang sama ditempel dua kali (beda parameter/huruf) dihitung sekali; link pendek kembar juga", () => {
    const r = bacaLinkVideo(
      [KANONIK, `tiktok.com/@LystiaNovilda/video/${ID}?is_from_webapp=1`, "https://vt.tiktok.com/ZSabc/", "vt.tiktok.com/ZSabc"].join("\n"),
    );
    expect(r.link).toHaveLength(2);
    expect(r.kembar).toBe(2);
  });

  it("yang tidak didukung dilaporkan dengan alasannya, sekali per link", () => {
    const r = bacaLinkVideo(
      ["https://www.instagram.com/reel/C9abc/", "https://www.instagram.com/reel/C9abc/", "https://shopee.co.id/x", KANONIK].join(" "),
    );
    expect(r.link).toHaveLength(1);
    expect(r.ditolak).toEqual([
      { teks: "https://www.instagram.com/reel/C9abc/", alasan: "INSTAGRAM" },
      { teks: "https://shopee.co.id/x", alasan: "BUKAN_TIKTOK" },
    ]);
  });

  it("teks tanpa link sama sekali → kosong", () => {
    expect(bacaLinkVideo("halo kak\nterima kasih")).toEqual({ link: [], ditolak: [], kembar: 0 });
    expect(bacaLinkVideo("")).toEqual({ link: [], ditolak: [], kembar: 0 });
  });
});

describe("linkVideoPanjang", () => {
  it("dipakai pembuka link pendek untuk membaca alamat tujuannya", () => {
    expect(linkVideoPanjang(`https://www.tiktok.com/@LystiaNovilda/video/${ID}?_r=1&_t=abc`)).toEqual({
      videoId: ID,
      handle: "lystianovilda",
      url: KANONIK,
    });
    expect(linkVideoPanjang("https://vt.tiktok.com/ZSabc/")).toBeNull();
    expect(linkVideoPanjang("https://evil.example/@a/video/7301234567890123456")).toBeNull();
  });
});

describe("waktuTayangDariId", () => {
  it("32 bit teratas id video TikTok = detik unix saat diunggah", () => {
    expect(waktuTayangDariId(ID)?.toISOString()).toBe("2026-09-24T11:56:01.000Z");
  });

  it("bukan id video → null", () => {
    expect(waktuTayangDariId("abc")).toBeNull();
    expect(waktuTayangDariId("12")).toBeNull();
    expect(waktuTayangDariId("999999999999999999999")).toBeNull();
    expect(waktuTayangDariId("000000000000000000")).toBeNull();
  });
});
