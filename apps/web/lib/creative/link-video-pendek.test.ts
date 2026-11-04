import { describe, expect, it, vi } from "vitest";
import { bukaLinkPendek, bukaSemuaLinkPendek } from "./link-video-pendek";

/*
 * Pembuka link pendek TikTok (vt./vm./tiktok.com/t/): mengikuti pengalihannya
 * sampai alamat video lengkap, tanpa cookie, paling lama 5 detik. Tes ini
 * TIDAK PERNAH memanggil TikTok — `fetch` selalu disuntikkan.
 */

const ID = "7689069333120634120";
const KANONIK = `https://www.tiktok.com/@lystianovilda/video/${ID}`;
const PENDEK = "https://vt.tiktok.com/ZSabc123/";

type Panggilan = { url: string; init: RequestInit };

function alihkan(ke: string, status = 301): Response {
  return new Response(null, { status, headers: { location: ke } });
}

/** `fetch` palsu yang menjawab urutan respons dan mencatat setiap panggilan. */
function fetchPalsu(jawaban: Array<Response | ((p: Panggilan) => Response | Promise<Response>)>) {
  const panggilan: Panggilan[] = [];
  const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const p = { url: String(url), init: init ?? {} };
    panggilan.push(p);
    const j = jawaban.shift();
    if (!j) throw new Error("tidak ada jawaban lagi");
    return typeof j === "function" ? j(p) : j;
  });
  return { f: f as unknown as typeof fetch, panggilan };
}

/** Respons hasil `redirect: "follow"`: `url` adalah alamat akhirnya. */
function sesudahIkut(urlAkhir: string): Response {
  const r = new Response("<html></html>", { status: 200 });
  Object.defineProperty(r, "url", { value: urlAkhir });
  return r;
}

describe("bukaLinkPendek", () => {
  it("satu pengalihan ke link lengkap → bentuk baku; tanpa cookie, pengalihan dibaca manual", async () => {
    const { f, panggilan } = fetchPalsu([alihkan(`https://www.tiktok.com/@LystiaNovilda/video/${ID}?_r=1&_t=xyz`)]);
    expect(await bukaLinkPendek(PENDEK, { fetch: f })).toEqual({ ok: true, videoId: ID, handle: "lystianovilda", url: KANONIK });
    expect(panggilan).toHaveLength(1);
    expect(panggilan[0].url).toBe(PENDEK);
    expect(panggilan[0].init.redirect).toBe("manual");
    expect(panggilan[0].init.credentials).toBe("omit");
    expect(new Headers(panggilan[0].init.headers).has("cookie")).toBe(false);
    expect(panggilan[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  it("beberapa pengalihan, termasuk alamat relatif dan m.tiktok.com/v/<id>.html", async () => {
    const { f, panggilan } = fetchPalsu([
      alihkan(`https://m.tiktok.com/v/${ID}.html?u_code=1`, 302),
      alihkan(`/@lystianovilda/video/${ID}`, 302),
    ]);
    expect(await bukaLinkPendek(PENDEK, { fetch: f })).toMatchObject({ ok: true, url: KANONIK });
    expect(panggilan.map((p) => p.url)).toEqual([PENDEK, `https://m.tiktok.com/v/${ID}.html?u_code=1`]);
  });

  it("pengalihan ke situs lain tidak diikuti", async () => {
    const { f, panggilan } = fetchPalsu([alihkan("https://contoh.example/@a/video/7301234567890123456")]);
    expect(await bukaLinkPendek(PENDEK, { fetch: f })).toEqual({ ok: false });
    expect(panggilan).toHaveLength(1);
  });

  it("runtime yang tidak memberi pengalihan manual → diikuti otomatis dan alamat akhirnya dibaca", async () => {
    const opak = new Response(null, { status: 200 });
    Object.defineProperty(opak, "type", { value: "opaqueredirect" });
    Object.defineProperty(opak, "status", { value: 0 });
    const { f, panggilan } = fetchPalsu([opak, sesudahIkut(`https://www.tiktok.com/@lystianovilda/video/${ID}?is_from_webapp=1`)]);
    expect(await bukaLinkPendek(PENDEK, { fetch: f })).toMatchObject({ ok: true, url: KANONIK });
    expect(panggilan.map((p) => p.init.redirect)).toEqual(["manual", "follow"]);
    expect(panggilan[1].init.credentials).toBe("omit");
  });

  it("pengalihan manual yang melempar galat juga jatuh ke ikut otomatis", async () => {
    const { f } = fetchPalsu([
      () => {
        throw new TypeError("redirect mode manual tidak didukung");
      },
      sesudahIkut(KANONIK),
    ]);
    expect(await bukaLinkPendek(PENDEK, { fetch: f })).toMatchObject({ ok: true, videoId: ID });
  });

  it("halaman yang tidak mengalihkan ke video (404, beranda) → gagal, tanpa mengulang permintaan", async () => {
    const { f, panggilan } = fetchPalsu([new Response("tidak ada", { status: 404 })]);
    expect(await bukaLinkPendek(PENDEK, { fetch: f })).toEqual({ ok: false });
    expect(panggilan).toHaveLength(1);
    const beranda = fetchPalsu([alihkan("https://www.tiktok.com/"), new Response("", { status: 200 })]);
    expect(await bukaLinkPendek(PENDEK, { fetch: beranda.f })).toEqual({ ok: false });
    expect(beranda.panggilan).toHaveLength(2);
  });

  it("TikTok yang tidak menjawab dihentikan sesudah batas waktunya", async () => {
    const menggantung = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_, tolak) => init?.signal?.addEventListener("abort", () => tolak(new DOMException("aborted", "AbortError")))),
    ) as unknown as typeof fetch;
    const mulai = Date.now();
    expect(await bukaLinkPendek(PENDEK, { fetch: menggantung, batasMs: 50 })).toEqual({ ok: false });
    expect(Date.now() - mulai).toBeLessThan(2000);
  });

  it("alamat yang bukan link pendek TikTok tidak pernah diambil", async () => {
    const { f, panggilan } = fetchPalsu([]);
    expect(await bukaLinkPendek("https://contoh.example/x", { fetch: f })).toEqual({ ok: false });
    expect(panggilan).toHaveLength(0);
  });
});

describe("bukaSemuaLinkPendek", () => {
  it("membuka banyak link sekaligus, paling banyak N bersamaan, hasil per alamat", async () => {
    let jalan = 0;
    let puncak = 0;
    const f = vi.fn(async (url: string | URL | Request) => {
      jalan += 1;
      puncak = Math.max(puncak, jalan);
      await new Promise((r) => setTimeout(r, 5));
      jalan -= 1;
      const kode = String(url).split("/").filter(Boolean).at(-1)!;
      return kode === "ZSgagal" ? new Response(null, { status: 404 }) : alihkan(`https://www.tiktok.com/@kol.${kode.toLowerCase()}/video/${ID}`);
    }) as unknown as typeof fetch;
    const urls = ["ZSa", "ZSb", "ZSc", "ZSd", "ZSgagal"].map((k) => `https://vt.tiktok.com/${k}/`);
    const hasil = await bukaSemuaLinkPendek(urls, { fetch: f, paralel: 2 });
    expect(puncak).toBeLessThanOrEqual(2);
    expect(hasil.get("https://vt.tiktok.com/ZSa/")).toMatchObject({ ok: true, handle: "kol.zsa" });
    expect(hasil.get("https://vt.tiktok.com/ZSgagal/")).toEqual({ ok: false });
    expect(hasil.size).toBe(5);
  });
});
