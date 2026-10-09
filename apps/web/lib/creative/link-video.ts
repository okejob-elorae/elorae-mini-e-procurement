/**
 * Pembaca link video TikTok dari teks tempelan — murni, aman untuk klien.
 *
 * Kreatif → Performa video (2026-10-09): pemilik memantau views dan angka
 * lain per video untuk KOL dan afiliasinya (sampai 10.000 orang), jadi
 * menambah video harus SATU langkah: tempel link — satu per baris, atau
 * tercampur dengan teks WhatsApp — dan setiap link dipungut, dirapikan ke
 * bentuk baku, dan yang kembar dibuang.
 *
 *   - Link panjang `tiktok.com/@<handle>/video/<id>` (dengan atau tanpa
 *     https://, www., m., parameter pelacak) → bentuk baku
 *     `https://www.tiktok.com/@<handle>/video/<id>` — bentuk yang dibuka
 *     ekstensi pemantau (`urlKontenKanonik`).
 *   - Link pendek `vt.tiktok.com/…`, `vm.tiktok.com/…`, `tiktok.com/t/…`
 *     (dan `m.tiktok.com/v/<id>.html`, yang tidak memuat handle) ditandai
 *     PENDEK: server membukanya dulu (`link-video-pendek.ts`) untuk membaca
 *     alamat tujuannya.
 *   - Instagram, posting foto TikTok, halaman TikTok lain, dan situs lain
 *     dilaporkan dengan alasannya. Teks biasa tanpa link diabaikan — itu
 *     obrolan WhatsApp, bukan kesalahan.
 *
 * Waktu unggah dibaca dari id videonya sendiri: 32 bit teratas id video
 * TikTok adalah detik unix saat video diunggah (`waktuTayangDariId`).
 */

import { normalHandle, urlKontenKanonik } from "./pantau-muatan";

export const JENIS_ORANG_VIDEO = ["KOL", "AFILIASI"] as const;
export type JenisOrangVideo = (typeof JENIS_ORANG_VIDEO)[number];

/** Link video paling banyak per tempelan (sesudah yang kembar dibuang). */
export const BATAS_LINK_TEMPEL = 500;
/** Panjang teks tempelan paling panjang (karakter). */
export const MAKS_TEKS_TEMPEL = 200_000;
/** Panjang teks link yang disebut kembali di laporan. */
const MAKS_TEKS_LINK = 300;

export type AlasanLinkDitolak = "INSTAGRAM" | "LINK_FOTO" | "BUKAN_VIDEO" | "BUKAN_TIKTOK" | "LINK_TIDAK_DIKENAL";

/**
 * Alasan satu link gagal ditambahkan, untuk laporan tempel. Setiap kode punya
 * teks di `kreatifRuang.performa.alasan.<KODE>` (kedua bahasa).
 */
export type AlasanGagalTempel = AlasanLinkDitolak | "LINK_PENDEK_GAGAL" | "KOL_DIBLOKIR" | "GAGAL";

export const ALASAN_GAGAL_TEMPEL: readonly AlasanGagalTempel[] = [
  "INSTAGRAM",
  "LINK_FOTO",
  "BUKAN_VIDEO",
  "BUKAN_TIKTOK",
  "LINK_TIDAK_DIKENAL",
  "LINK_PENDEK_GAGAL",
  "KOL_DIBLOKIR",
  "GAGAL",
];

export type LinkVideoPanjang = { bentuk: "PANJANG"; teks: string; videoId: string; handle: string; url: string };
export type LinkVideoPendek = { bentuk: "PENDEK"; teks: string; url: string };
export type LinkVideo = LinkVideoPanjang | LinkVideoPendek;

export type HasilBacaLink = {
  /** Link yang bisa diproses, urut seperti di teks; kembar sudah dibuang. */
  link: LinkVideo[];
  /** Link yang tidak didukung, sekali per teks link. */
  ditolak: { teks: string; alasan: AlasanLinkDitolak }[];
  /** Banyaknya link kembar yang dibuang. */
  kembar: number;
};

/** Tanpa literal BigInt (`…n`): target TypeScript aplikasi ini di bawah ES2020. */
const MAKS_U64 = BigInt("18446744073709551615");
const GESER_32 = BigInt(32);

/** Waktu unggah video dari id-nya (32 bit teratas = detik unix); `null` bila bukan id video TikTok. */
export function waktuTayangDariId(videoId: string): Date | null {
  if (!/^\d{15,20}$/.test(videoId)) return null;
  const n = BigInt(videoId);
  if (n > MAKS_U64) return null;
  const detik = Number(n >> GESER_32);
  return detik > 0 ? new Date(detik * 1000) : null;
}

/** Handle TikTok: huruf, angka, titik, garis bawah. */
const POLA_HANDLE = /^[a-z0-9._]{1,64}$/;

function denganSkema(teks: string): URL | null {
  try {
    return new URL(/^https?:\/\//i.test(teks) ? teks : `https://${teks}`);
  } catch {
    return null;
  }
}

const hostTiktok = (host: string) => host === "tiktok.com" || host.endsWith(".tiktok.com");
const hostInstagram = (host: string) =>
  host === "instagram.com" || host.endsWith(".instagram.com") || host === "instagr.am" || host.endsWith(".instagr.am");

function bacaJalurPanjang(u: URL): { videoId: string; handle: string; url: string } | "TIDAK_SAH" | null {
  const m = /^\/@([^/]+)\/video\/([^/]+)\/?$/i.exec(u.pathname);
  if (!m) return null;
  const handle = normalHandle(m[1]);
  const videoId = m[2];
  if (!POLA_HANDLE.test(handle) || waktuTayangDariId(videoId) === null) return "TIDAK_SAH";
  return { videoId, handle, url: urlKontenKanonik(`https://www.tiktok.com/@${handle}/video/${videoId}`) };
}

/**
 * Link video panjang dari sebuah alamat (mis. alamat tujuan link pendek);
 * `null` bila bukan link video TikTok yang sah.
 */
export function linkVideoPanjang(alamat: string): { videoId: string; handle: string; url: string } | null {
  const u = denganSkema(alamat.trim());
  if (!u || !hostTiktok(u.hostname.toLowerCase())) return null;
  const p = bacaJalurPanjang(u);
  return p && p !== "TIDAK_SAH" ? p : null;
}

/** Kenali satu link (sudah dipungut dari teks). */
export function kenaliLink(calon: string): LinkVideo | { ditolak: AlasanLinkDitolak } {
  const teks = calon.trim().slice(0, MAKS_TEKS_LINK);
  const u = denganSkema(calon.trim());
  if (!u) return { ditolak: "LINK_TIDAK_DIKENAL" };
  const host = u.hostname.toLowerCase();
  if (hostInstagram(host)) return { ditolak: "INSTAGRAM" };
  if (!hostTiktok(host)) return { ditolak: "BUKAN_TIKTOK" };

  const panjang = bacaJalurPanjang(u);
  if (panjang === "TIDAK_SAH") return { ditolak: "LINK_TIDAK_DIKENAL" };
  if (panjang) return { bentuk: "PANJANG", teks, ...panjang };
  if (/^\/@[^/]+\/photo\//i.test(u.pathname)) return { ditolak: "LINK_FOTO" };

  if (host === "vt.tiktok.com" || host === "vm.tiktok.com") {
    const kode = /^\/([A-Za-z0-9]+)\/?$/.exec(u.pathname);
    return kode ? { bentuk: "PENDEK", teks, url: `https://${host}/${kode[1]}/` } : { ditolak: "LINK_TIDAK_DIKENAL" };
  }
  const t = /^\/t\/([A-Za-z0-9]+)\/?$/.exec(u.pathname);
  if (t) return { bentuk: "PENDEK", teks, url: `https://www.tiktok.com/t/${t[1]}/` };
  const v = /^\/v\/(\d{15,20})\.html$/i.exec(u.pathname);
  if (v) return { bentuk: "PENDEK", teks, url: `https://m.tiktok.com/v/${v[1]}.html` };
  return { ditolak: "BUKAN_VIDEO" };
}

/** Tanda pembuka/penutup yang menempel pada link di teks WhatsApp: kurung, kutip, *tebal*, _miring_, ~coret~, tanda baca. */
const PEMBUKA = /^[([{<"'*_~`]+/;
const PENUTUP = /[)\]}>"'*_~`.,;:!?…]+$/;
/** Host yang dikenali walau ditulis tanpa https:// — kiri-nya harus batas kata, supaya "faketiktok.com" tidak terbaca. */
const HOST_TANPA_SKEMA = /(?:^|[^a-z0-9.-])((?:[a-z0-9-]+\.)*(?:tiktok\.com|instagram\.com|instagr\.am))(?=[/?#]|$)/i;

/** Link dari satu potongan teks (tanpa spasi), atau `null` bila potongan itu bukan link. */
function pungutLink(potongan: string): string | null {
  let t = potongan;
  const http = t.search(/https?:\/\//i);
  if (http >= 0) {
    t = t.slice(http);
  } else {
    const m = HOST_TANPA_SKEMA.exec(t);
    if (m) t = t.slice(m.index + m[0].length - m[1].length);
    else if (/^www\./i.test(t.replace(PEMBUKA, ""))) t = t.replace(PEMBUKA, "");
    else return null;
  }
  t = t.replace(PEMBUKA, "").replace(PENUTUP, "");
  return t || null;
}

/** Semua link video di teks tempelan, dirapikan dan tanpa kembar. */
export function bacaLinkVideo(teks: string): HasilBacaLink {
  const link: LinkVideo[] = [];
  const ditolak: HasilBacaLink["ditolak"] = [];
  const sudah = new Set<string>();
  const sudahDitolak = new Set<string>();
  let kembar = 0;
  for (const potongan of (teks ?? "").split(/\s+/)) {
    if (!potongan) continue;
    const calon = pungutLink(potongan);
    if (!calon) continue;
    const r = kenaliLink(calon);
    if ("ditolak" in r) {
      const k = calon.slice(0, MAKS_TEKS_LINK);
      if (sudahDitolak.has(k)) continue;
      sudahDitolak.add(k);
      ditolak.push({ teks: k, alasan: r.ditolak });
      continue;
    }
    const kunci = r.bentuk === "PANJANG" ? `v:${r.videoId}` : `p:${r.url}`;
    if (sudah.has(kunci)) {
      kembar += 1;
      continue;
    }
    sudah.add(kunci);
    link.push(r);
  }
  return { link, ditolak, kembar };
}
