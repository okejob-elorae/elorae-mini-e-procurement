/*
 * Pemilik link Instagram/YouTube yang ditempel di Performa video — KHUSUS SERVER (tanpa Prisma,
 * `fetch` bisa disuntikkan: tes tidak pernah memanggil Instagram atau YouTube).
 *
 * Link YouTube (watch/shorts/youtu.be) dan link "Salin link" Instagram tidak memuat nama akun
 * pemiliknya, padahal konten harus dicatat di KOL yang benar. Server membuka halaman kontennya
 * sekali, TANPA kuki, paling lama `BATAS_BUKA_PEMILIK_MS`, dan membaca:
 *
 *   - YouTube (diukur 2026-10-10): `ownerProfileUrl` ("http://www.youtube.com/@YouTube") dan
 *     `publishDate` di `ytInitialPlayerResponse.microformat.playerMicroformatRenderer`; cadangan
 *     `<link itemprop="url" href=".../@handle">` dan `<meta itemprop="datePublished">`. Halaman
 *     hanya dipercaya bila memuat `"videoId":"<id>"` yang diminta (bukan halaman persetujuan kuki
 *     atau galat).
 *   - Instagram (BELUM diukur — Instagram menjawab pengunjung tanpa masuk dengan halaman terbatas,
 *     sering halaman masuk): nama akun dari tag meta (`og:url` yang memuat `/<akun>/p|reel/`,
 *     judul "Nama (@akun)", deskripsi "… - akun on/pada …"). Tidak ketemu → gagal; laporan tempel
 *     menyebut "buka postingnya di Chrome dengan ekstensi menyala, atau tempel link dari halaman
 *     profil (instagram.com/<akun>/reel/…)".
 *
 * Hanya alamat www.youtube.com / www.instagram.com yang dibangun di sini sendiri yang diambil —
 * teks tempelan tidak bisa membuat server mengambil alamat lain.
 */

export const BATAS_BUKA_PEMILIK_MS = 8000;
/** Halaman yang dibuka bersamaan. */
const PARALEL_BAWAAN = 4;
/** Badan halaman yang dibaca paling banyak (YouTube ±1 MB). */
const MAKS_BADAN = 3_000_000;
const AGEN =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export type PemilikKonten = { handle: string; tayangAt: Date | null };
export type HasilPemilik = ({ ok: true } & PemilikKonten) | { ok: false };
export type OpsiBukaPemilik = { fetch?: typeof fetch; batasMs?: number };

const GAGAL: HasilPemilik = { ok: false };

/** Teks JSON yang di-escape di HTML ("\/", "&", "/") → teks biasa. */
function lepasEscape(t: string): string {
  return t.replace(/\\u([0-9a-fA-F]{4})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16))).replace(/\\\//g, "/");
}

function handleDariUrlYoutube(url: string): string | null {
  const m = /\/@([^/?#"'\s\\]+)/.exec(lepasEscape(url));
  if (!m) return null;
  let h = m[1];
  try {
    h = decodeURIComponent(h);
  } catch {
    // biarkan
  }
  h = h.trim().toLowerCase();
  return h && h.length <= 100 ? h : null;
}

function tanggal(teks: string | undefined): Date | null {
  if (!teks) return null;
  const ms = Date.parse(lepasEscape(teks));
  return Number.isFinite(ms) ? new Date(ms) : null;
}

/** Pemilik dan tanggal tayang dari HTML halaman video YouTube; `null` bila bukan halaman video `id`. */
export function uraiPemilikYoutube(html: string, id: string): PemilikKonten | null {
  if (!html.includes(`"videoId":"${id}"`)) return null;
  const pemilik =
    /"ownerProfileUrl"\s*:\s*"([^"]+)"/.exec(html)?.[1] ??
    /<link\s+itemprop=["']url["']\s+href=["']([^"']*\/@[^"']+)["']/i.exec(html)?.[1] ??
    null;
  const handle = pemilik ? handleDariUrlYoutube(pemilik) : null;
  if (!handle) return null;
  const terbit =
    /"publishDate"\s*:\s*"([^"]+)"/.exec(html)?.[1] ?? /<meta\s+itemprop=["']datePublished["']\s+content=["']([^"']+)["']/i.exec(html)?.[1];
  return { handle, tayangAt: tanggal(terbit) };
}

const AKUN_IG = "[A-Za-z0-9._]{1,30}";
const BUKAN_AKUN_IG = new Set(["p", "reel", "reels", "tv", "explore", "accounts", "stories"]);

function isiMeta(html: string, nama: string): string[] {
  const hasil: string[] = [];
  const pola = new RegExp(`<meta\\b[^>]*(?:property|name)=["']${nama}["'][^>]*>`, "gi");
  for (const m of html.matchAll(pola)) {
    const isi = /\bcontent=["']([^"']*)["']/i.exec(m[0])?.[1];
    if (isi) hasil.push(isi.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#064;/g, "@").replace(/&#x40;/gi, "@"));
  }
  return hasil;
}

/**
 * Nama akun pemilik dari HTML halaman posting Instagram (tanpa masuk). BELUM diukur pada halaman
 * sungguhan: hanya tag meta yang menyebut akunnya secara terang yang dipakai; selain itu `null`.
 */
export function uraiPemilikInstagram(html: string, kode: string): PemilikKonten | null {
  if (!html.includes(kode)) return null;
  const sah = (h: string | undefined) => (h && !BUKAN_AKUN_IG.has(h.toLowerCase()) ? h.toLowerCase() : null);
  for (const url of isiMeta(html, "og:url")) {
    const m = new RegExp(`instagram\\.com/(${AKUN_IG})/(?:p|reel|reels|tv)/`, "i").exec(url);
    const h = sah(m?.[1]);
    if (h) return { handle: h, tayangAt: null };
  }
  for (const judul of [...isiMeta(html, "og:title"), ...isiMeta(html, "twitter:title")]) {
    const h = sah(new RegExp(`\\(@(${AKUN_IG})\\)`).exec(judul)?.[1]);
    if (h) return { handle: h, tayangAt: null };
  }
  for (const desk of [...isiMeta(html, "og:description"), ...isiMeta(html, "description")]) {
    const h = sah(new RegExp(`\\s-\\s(${AKUN_IG})\\s(?:on|pada)\\s`, "i").exec(desk)?.[1]);
    if (h) return { handle: h, tayangAt: null };
  }
  return null;
}

async function ambilHtml(url: string, opsi: OpsiBukaPemilik): Promise<string | null> {
  const ambil = opsi.fetch ?? fetch;
  try {
    const res = await ambil(url, {
      method: "GET",
      redirect: "follow",
      credentials: "omit",
      cache: "no-store",
      headers: { "user-agent": AGEN, accept: "text/html,*/*", "accept-language": "id-ID,id;q=0.9,en;q=0.8" },
      signal: AbortSignal.timeout(opsi.batasMs ?? BATAS_BUKA_PEMILIK_MS),
    });
    if (!res.ok) {
      res.body?.cancel().catch(() => {});
      return null;
    }
    const teks = await res.text();
    return teks.slice(0, MAKS_BADAN);
  } catch {
    return null;
  }
}

export async function bukaPemilikYoutube(id: string, opsi: OpsiBukaPemilik = {}): Promise<HasilPemilik> {
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return GAGAL;
  const html = await ambilHtml(`https://www.youtube.com/watch?v=${id}`, opsi);
  const r = html ? uraiPemilikYoutube(html, id) : null;
  return r ? { ok: true, ...r } : GAGAL;
}

export async function bukaPemilikInstagram(kode: string, opsi: OpsiBukaPemilik = {}): Promise<HasilPemilik> {
  if (!/^[A-Za-z0-9_-]{5,40}$/.test(kode)) return GAGAL;
  const html = await ambilHtml(`https://www.instagram.com/p/${kode}/`, opsi);
  const r = html ? uraiPemilikInstagram(html, kode) : null;
  return r ? { ok: true, ...r } : GAGAL;
}

export type PermintaanPemilik = { platform: "INSTAGRAM" | "YOUTUBE"; id: string };

/** Buka banyak sekaligus, paling banyak `paralel` bersamaan. Hasil per `<PLATFORM>:<id>`. */
export async function bukaSemuaPemilik(
  daftar: readonly PermintaanPemilik[],
  opsi: OpsiBukaPemilik & { paralel?: number } = {},
): Promise<Map<string, HasilPemilik>> {
  const unik = [...new Map(daftar.map((d) => [`${d.platform}:${d.id}`, d])).values()];
  const peta = new Map<string, HasilPemilik>();
  let berikut = 0;
  const pekerja = async () => {
    while (berikut < unik.length) {
      const d = unik[berikut++];
      const r = await (d.platform === "YOUTUBE" ? bukaPemilikYoutube(d.id, opsi) : bukaPemilikInstagram(d.id, opsi)).catch(() => GAGAL);
      peta.set(`${d.platform}:${d.id}`, r);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(opsi.paralel ?? PARALEL_BAWAAN, unik.length)) }, pekerja));
  return peta;
}
