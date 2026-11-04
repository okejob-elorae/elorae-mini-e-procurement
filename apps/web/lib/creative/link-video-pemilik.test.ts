import { describe, expect, it } from "vitest";
import { bukaPemilikInstagram, bukaPemilikYoutube, bukaSemuaPemilik, uraiPemilikInstagram, uraiPemilikYoutube } from "./link-video-pemilik";

/*
 * Pemilik link YouTube/Instagram yang ditempel. `fetch` disuntikkan: tes tidak pernah memanggil
 * YouTube atau Instagram. Bentuk YouTube mengikuti yang diukur 2026-10-10 (`ownerProfileUrl`,
 * `publishDate`); bentuk Instagram TEBAKAN (tag meta), ditandai demikian.
 */

const ID = "dQw4w9WgXcQ";
const htmlYoutube = (id = ID) =>
  `<html><script>var ytInitialPlayerResponse = {"videoDetails":{"videoId":"${id}","author":"YouTube","viewCount":"1234"},` +
  `"microformat":{"playerMicroformatRenderer":{"ownerProfileUrl":"http://www.youtube.com/@YouTube","publishDate":"2024-05-01T05:00:07-07:00"}}};</script></html>`;

const jawab = (html: string, status = 200) =>
  (async () => new Response(html, { status, headers: { "content-type": "text/html" } })) as unknown as typeof fetch;

describe("uraiPemilikYoutube (bentuk terukur)", () => {
  it("handle dari ownerProfileUrl (huruf kecil) dan tanggal dari publishDate", () => {
    expect(uraiPemilikYoutube(htmlYoutube(), ID)).toEqual({ handle: "youtube", tayangAt: new Date("2024-05-01T12:00:07Z") });
  });

  it("garis miring yang di-escape dan handle beraksen terbaca; cadangan <link itemprop=url>", () => {
    const escape = `"videoId":"${ID}" "ownerProfileUrl":"http:\\/\\/www.youtube.com\\/@Kol%C3%A9Satu"`;
    expect(uraiPemilikYoutube(escape, ID)?.handle).toBe("kolésatu");
    const cadangan = `"videoId":"${ID}" <link itemprop="url" href="http://www.youtube.com/@KolDua"><meta itemprop="datePublished" content="2024-06-02">`;
    expect(uraiPemilikYoutube(cadangan, ID)).toEqual({ handle: "koldua", tayangAt: new Date("2024-06-02T00:00:00Z") });
  });

  it("halaman video lain, halaman persetujuan kuki, atau tanpa pemilik → null", () => {
    expect(uraiPemilikYoutube(htmlYoutube("aaaaaaaaaaa"), ID)).toBeNull();
    expect(uraiPemilikYoutube("<html>Before you continue to YouTube</html>", ID)).toBeNull();
    expect(uraiPemilikYoutube(`"videoId":"${ID}"`, ID)).toBeNull();
  });
});

describe("uraiPemilikInstagram (bentuk TEBAKAN — belum diukur)", () => {
  it("og:url yang memuat akun, judul (@akun), atau deskripsi '- akun on'", () => {
    expect(uraiPemilikInstagram(`<meta property="og:url" content="https://www.instagram.com/Kol.Satu/reel/C9xYz_AbC-1/">`, "C9xYz_AbC-1")?.handle).toBe("kol.satu");
    expect(uraiPemilikInstagram(`C9xYz_AbC-1 <meta property="og:title" content="Kol Satu (&#064;kol.satu) • Instagram reel">`, "C9xYz_AbC-1")?.handle).toBe("kol.satu");
    expect(
      uraiPemilikInstagram(`C9xYz_AbC-1 <meta name="description" content="120 likes, 8 comments - kol_satu on October 1, 2026: &quot;OOTD&quot;">`, "C9xYz_AbC-1")?.handle,
    ).toBe("kol_satu");
  });

  it("halaman masuk tanpa tanda akun, atau halaman posting lain → null", () => {
    expect(uraiPemilikInstagram(`<title>Login • Instagram</title> C9xYz_AbC-1`, "C9xYz_AbC-1")).toBeNull();
    expect(uraiPemilikInstagram(`<meta property="og:url" content="https://www.instagram.com/kol/reel/LAIN/">`, "C9xYz_AbC-1")).toBeNull();
    expect(uraiPemilikInstagram(`C9xYz_AbC-1 <meta property="og:url" content="https://www.instagram.com/p/C9xYz_AbC-1/">`, "C9xYz_AbC-1")).toBeNull();
  });
});

describe("bukaPemilik*", () => {
  it("YouTube: membuka www.youtube.com/watch?v=<id> tanpa kuki", async () => {
    let diminta: { url: string; init?: RequestInit } | null = null;
    const f = (async (url: string, init?: RequestInit) => {
      diminta = { url, init };
      return new Response(htmlYoutube(), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await bukaPemilikYoutube(ID, { fetch: f })).toMatchObject({ ok: true, handle: "youtube" });
    expect(diminta!.url).toBe(`https://www.youtube.com/watch?v=${ID}`);
    expect(diminta!.init?.credentials).toBe("omit");
  });

  it("gagal jaringan, HTTP galat, atau id tidak sah → ok:false", async () => {
    const lempar = (async () => {
      throw new Error("putus");
    }) as unknown as typeof fetch;
    expect(await bukaPemilikYoutube(ID, { fetch: lempar })).toEqual({ ok: false });
    expect(await bukaPemilikYoutube(ID, { fetch: jawab("x", 500) })).toEqual({ ok: false });
    expect(await bukaPemilikYoutube("bukan-id", { fetch: jawab(htmlYoutube()) })).toEqual({ ok: false });
    expect(await bukaPemilikInstagram("C9xYz_AbC-1", { fetch: jawab("<title>Login</title>") })).toEqual({ ok: false });
  });

  it("bukaSemuaPemilik: satu permintaan per platform+id", async () => {
    let panggil = 0;
    const f = (async () => {
      panggil += 1;
      return new Response(htmlYoutube(), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await bukaSemuaPemilik(
      [
        { platform: "YOUTUBE", id: ID },
        { platform: "YOUTUBE", id: ID },
      ],
      { fetch: f },
    );
    expect(panggil).toBe(1);
    expect(r.get(`YOUTUBE:${ID}`)).toMatchObject({ ok: true, handle: "youtube" });
  });
});
