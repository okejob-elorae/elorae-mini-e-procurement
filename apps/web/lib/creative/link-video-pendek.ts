import { linkVideoPanjang } from "./link-video";

/*
 * Pembuka link pendek TikTok (`vt.tiktok.com/…`, `vm.tiktok.com/…`,
 * `tiktok.com/t/…`, `m.tiktok.com/v/<id>.html`) — KHUSUS SERVER.
 *
 * Link pendek tidak memuat handle maupun id video; alamat aslinya baru
 * diketahui sesudah pengalihannya diikuti. Pengalihan dibaca MANUAL lebih
 * dulu, supaya setiap lompatan bisa diperiksa: hanya alamat TikTok yang
 * diikuti (link yang ditempel orang tidak bisa membuat server ini mengambil
 * alamat lain). Runtime yang tidak memberi pengalihan manual (respons
 * "opaqueredirect" atau galat) jatuh ke `redirect: "follow"` dan membaca
 * alamat akhirnya dari `res.url`.
 *
 * Tanpa cookie, paling lama `BATAS_BUKA_PENDEK_MS` untuk SEMUA lompatan.
 * Gagal → laporan tempel menyebut "link pendek tidak bisa dibuka — salin link
 * lengkap dari TikTok". `fetch` bisa disuntikkan: tes tidak pernah memanggil
 * TikTok.
 */

export const BATAS_BUKA_PENDEK_MS = 5000;
/** Pengalihan paling banyak yang diikuti satu link. */
const MAKS_LOMPAT = 5;
/** Link pendek yang dibuka bersamaan. */
const PARALEL_BAWAAN = 6;
/** TikTok menjawab pengalihan yang sama untuk peramban biasa; tanpa ini sebagian link dijawab halaman kosong. */
const AGEN =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export type HasilBukaPendek = { ok: true; videoId: string; handle: string; url: string } | { ok: false };
export type OpsiBukaPendek = { fetch?: typeof fetch; batasMs?: number };

const GAGAL: HasilBukaPendek = { ok: false };

function alamatTiktok(alamat: string): boolean {
  try {
    const u = new URL(alamat);
    const host = u.hostname.toLowerCase();
    return (u.protocol === "https:" || u.protocol === "http:") && (host === "tiktok.com" || host.endsWith(".tiktok.com"));
  } catch {
    return false;
  }
}

function hasil(alamat: string | null | undefined): HasilBukaPendek {
  const p = alamat ? linkVideoPanjang(alamat) : null;
  return p ? { ok: true, ...p } : GAGAL;
}

/** Badan respons tidak dibaca — dilepas supaya sambungannya bebas. */
function lepas(res: Response) {
  res.body?.cancel().catch(() => {});
}

export async function bukaLinkPendek(url: string, opsi: OpsiBukaPendek = {}): Promise<HasilBukaPendek> {
  if (!alamatTiktok(url)) return GAGAL;
  const ambil = opsi.fetch ?? fetch;
  const sinyal = AbortSignal.timeout(opsi.batasMs ?? BATAS_BUKA_PENDEK_MS);
  const permintaan = (redirect: RequestRedirect): RequestInit => ({
    method: "GET",
    redirect,
    credentials: "omit",
    cache: "no-store",
    headers: { "user-agent": AGEN, accept: "text/html,*/*" },
    signal: sinyal,
  });

  let kini = url;
  let ikutOtomatis = false;
  for (let lompat = 0; lompat < MAKS_LOMPAT; lompat++) {
    if (linkVideoPanjang(kini)) return hasil(kini);
    let res: Response;
    try {
      res = await ambil(kini, permintaan("manual"));
    } catch {
      if (sinyal.aborted) return GAGAL;
      ikutOtomatis = true;
      break;
    }
    lepas(res);
    if (res.type === "opaqueredirect" || res.status === 0) {
      ikutOtomatis = true;
      break;
    }
    const lokasi = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!lokasi) return GAGAL;
    let berikut: string;
    try {
      berikut = new URL(lokasi, kini).toString();
    } catch {
      return GAGAL;
    }
    if (!alamatTiktok(berikut)) return GAGAL;
    kini = berikut;
  }
  if (!ikutOtomatis) return hasil(kini);

  try {
    const res = await ambil(url, permintaan("follow"));
    lepas(res);
    return hasil(res.url);
  } catch {
    return GAGAL;
  }
}

/** Buka banyak link pendek, paling banyak `paralel` bersamaan. Hasil per alamat. */
export async function bukaSemuaLinkPendek(
  urls: readonly string[],
  opsi: OpsiBukaPendek & { paralel?: number } = {},
): Promise<Map<string, HasilBukaPendek>> {
  const unik = [...new Set(urls)];
  const peta = new Map<string, HasilBukaPendek>();
  let berikut = 0;
  const pekerja = async () => {
    while (berikut < unik.length) {
      const url = unik[berikut++];
      peta.set(url, await bukaLinkPendek(url, opsi).catch(() => GAGAL));
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(opsi.paralel ?? PARALEL_BAWAAN, unik.length)) }, pekerja));
  return peta;
}
