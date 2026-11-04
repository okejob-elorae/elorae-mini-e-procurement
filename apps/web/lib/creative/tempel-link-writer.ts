import type { Prisma } from "@elorae/db";
import { cariTeks, samaTeks } from "@/lib/db/cari-teks";
import { runSerializable } from "@/lib/db/tx-retry";
import { denganNomorUnik } from "@/lib/receivables/nomor";
import { hariIniWib } from "@/lib/tanggal-isian";
import { sinkronJurnalKolAman } from "./jurnal-kol";
import { simpanProfilKolDiTx } from "./kol-writer";
import { simpanKontenKolDiTx } from "./konten-kol-writer";
import {
  BATAS_LINK_TEMPEL,
  bacaLinkVideo,
  JENIS_ORANG_VIDEO,
  MAKS_TEKS_TEMPEL,
  waktuTayangDariId,
  waktuTayangInstagram,
  type AlasanGagalTempel,
  type JenisOrangVideo,
} from "./link-video";
import { bukaSemuaLinkPendek, type OpsiBukaPendek } from "./link-video-pendek";
import { bukaSemuaPemilik, type OpsiBukaPemilik, type PermintaanPemilik } from "./link-video-pemilik";
import { tugasSegera } from "./pantau-antrean";
import { kontenIdDariLink, normalHandle, urlProfilPantau, type PlatformPantau } from "./pantau-muatan";
import { TAHAP_BERJALAN } from "./tahap";
import { buatBriefDiTx } from "./writer";

/*
 * "Tempel link" di Kreatif → Performa video — KHUSUS SERVER (klien hanya
 * `import type`).
 *
 * Satu langkah untuk pemilik yang memantau sampai 10.000 KOL dan afiliasi:
 * tempel link video TikTok, pilih KOL atau Afiliasi, selesai. Per link, di
 * dalam SATU `runSerializable` (dua tempelan link yang sama serentak membuat
 * SATU konten — dibuktikan tes balapan):
 *
 *   1. video yang id-nya sudah ada di link konten mana pun → "sudah dipantau";
 *   2. akun TikTok dicari lewat handle (abai huruf besar dan "@"); tidak ada →
 *      KOL baru bernama "@handle" + akun TikTok-nya (`simpanProfilKolDiTx`);
 *   3. kolaborasi berjalan KOL itu yang jenisnya cocok — Afiliasi = kerja sama
 *      KOMISI, KOL = selain KOMISI (keputusan sementara, ingatkan pemilik:
 *      video afiliasi tidak pernah memajukan kolaborasi barter/berbayar,
 *      dan sebaliknya); tidak ada → kolaborasi baru tanpa fee dan tanpa
 *      campaign (`buatBriefDiTx`, Afiliasi = KOMISI, KOL = bawaannya);
 *   4. konten VIDEO dengan link baku dan tanggal tayang = waktu unggah dari id
 *      videonya (`simpanKontenKolDiTx` → tahap maju ke TAYANG lewat
 *      `terapkanMajuOtomatis`, seperti link yang ditempel di panel Konten);
 *   5. tugas cek pertama `KONTEN:<id>:SEGERA` supaya angka pertamanya masuk
 *      dalam hitungan menit.
 *
 * Jejak `AuditLog` ditulis oleh penulis-penulis itu sendiri, di transaksi yang
 * sama, ber-`metadata.sumber = "TEMPEL_LINK"`. Satu link yang gagal tidak
 * menggagalkan yang lain; alasannya dilaporkan per baris.
 *
 * Instagram dan YouTube (2026-10-10, D9): langkah yang sama per platform —
 * akun Instagram/YouTube dicari lewat handle, KOL baru mendapat akun platform
 * itu, konten Instagram berformat REELS (reel) atau FEED (posting), YouTube
 * VIDEO. Link yang tidak memuat nama akun dibuka server dulu
 * (`link-video-pemilik.ts`); tanggal tayang YouTube dari halaman videonya,
 * Instagram dari shortcode-nya.
 */

type Klien = Prisma.TransactionClient;

export const SUMBER_TEMPEL = "TEMPEL_LINK";

export type GagalTempel = { baris: string; alasan: AlasanGagalTempel };

export type HasilTempelLink =
  | {
      ok: true;
      /** Video baru yang mulai dipantau. */
      ditambahkan: number;
      /** Video yang sudah ada di Elorae — tidak ditambah lagi. */
      sudahAda: number;
      /** Orang (KOL/afiliasi) baru yang dibuat. */
      kolBaru: number;
      /** Link kembar di tempelan yang dibuang. */
      kembar: number;
      gagal: GagalTempel[];
      kontenIds: string[];
    }
  | { ok: false; kode: "JENIS_TIDAK_SAH" | "KOSONG" | "TERLALU_PANJANG" | "TERLALU_BANYAK" };

/**
 * Satu konten yang akan ditambahkan. `videoId` = id video TikTok / shortcode Instagram / id video
 * YouTube; `platform` tidak ada = TIKTOK; `format` tidak ada = VIDEO.
 */
export type VideoTempel = {
  baris: string;
  videoId: string;
  handle: string;
  url: string;
  platform?: PlatformPantau;
  format?: "VIDEO" | "REELS" | "FEED";
};

export type HasilSatu =
  | { status: "DITAMBAHKAN"; kontenId: string; kolaborasiId: string; kolBaru: boolean }
  | { status: "SUDAH_ADA"; kontenId: string }
  | { status: "GAGAL"; alasan: AlasanGagalTempel };

/** Akun TikTok yang handle-nya sama (tersimpan dengan/tanpa "@", huruf apa pun, atau sebagai URL profil). */
export async function akunTiktok(tx: Klien, handle: string) {
  return akunPlatform(tx, "TIKTOK", handle);
}

/** Akun platform itu yang handle-nya sama (tersimpan dengan/tanpa "@", huruf apa pun, atau sebagai URL profil). */
export async function akunPlatform(tx: Klien, platform: PlatformPantau, handle: string) {
  const calon = await tx.kolAccount.findMany({
    where: {
      platform,
      OR: [
        { handle: samaTeks(handle) },
        { handle: samaTeks(`@${handle}`) },
        { handle: cariTeks(platform === "INSTAGRAM" ? `instagram.com/${handle}` : `/@${handle}`) },
      ],
    },
    select: { id: true, handle: true, kol: { select: { id: true, blockedAt: true, createdAt: true } } },
    take: 50,
  });
  // KOL yang tidak diblokir dulu, lalu yang paling lama terdaftar.
  return calon
    .filter((a) => a.kol != null && normalHandle(a.handle) === handle)
    .sort(
      (a, b) =>
        Number(a.kol.blockedAt !== null) - Number(b.kol.blockedAt !== null) ||
        a.kol.createdAt.getTime() - b.kol.createdAt.getTime() ||
        a.kol.id.localeCompare(b.kol.id),
    );
}

/**
 * Satu video ke Elorae: KOL (dibuat bila belum ada) → kolaborasi berjalan yang cocok (dibuat bila belum
 * ada) → konten. Dipakai juga oleh "Simpan ke Elorae" di ekstensi (`sumber: "EKSTENSI"`), yang langsung
 * menyimpan angkanya sendiri sehingga tidak perlu tugas cek segera (`tanpaTugasSegera`).
 */
export async function tempelSatuDiTx(
  tx: Klien,
  v: VideoTempel & { liveAt: Date; jenis: JenisOrangVideo; olehUserId: string; sekarang: Date; sumber?: string; tanpaTugasSegera?: boolean },
): Promise<HasilSatu> {
  const sumber = v.sumber ?? SUMBER_TEMPEL;
  const platform = v.platform ?? "TIKTOK";
  // Shortcode Instagram dan id YouTube peka huruf besar/kecil; `cariTeks` tidak (MariaDB) — pencocok akhirnya di JS.
  const ada = await tx.kolContent.findMany({ where: { link: cariTeks(v.videoId) }, select: { id: true, link: true }, take: 50 });
  const sama = ada.find((k) => kontenIdDariLink(k.link, platform) === v.videoId);
  if (sama) return { status: "SUDAH_ADA", kontenId: sama.id };

  let kolId: string;
  let kolBaru = false;
  const akun = await akunPlatform(tx, platform, v.handle);
  if (akun.length) {
    if (akun[0].kol.blockedAt) return { status: "GAGAL", alasan: "KOL_DIBLOKIR" };
    kolId = akun[0].kol.id;
  } else {
    const r = await simpanProfilKolDiTx(tx, {
      isi: { name: `@${v.handle}`, akun: [{ platform, handle: v.handle, followers: 0, url: urlProfilPantau(platform, v.handle) }] },
      olehUserId: v.olehUserId,
      periksaKembar: false,
      sumber,
    });
    if (!r.ok) throw new Error(`TEMPEL_KOL_${r.alasan}`);
    kolId = r.id;
    kolBaru = true;
  }

  const berjalan = await tx.kolBrief.findMany({
    where: { kolId, tahap: { in: [...TAHAP_BERJALAN] } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, jenis: true },
  });
  let kolaborasiId = berjalan.find((b) => (v.jenis === "AFILIASI" ? b.jenis === "KOMISI" : b.jenis !== "KOMISI"))?.id;
  if (!kolaborasiId) {
    const r = await buatBriefDiTx(tx, {
      kolId,
      jenis: v.jenis === "AFILIASI" ? "KOMISI" : undefined,
      fee: 0,
      olehUserId: v.olehUserId,
      sumber,
      sekarang: v.sekarang,
    });
    if (!r.ok) {
      if (r.alasan === "KOL_DIBLOKIR") return { status: "GAGAL", alasan: "KOL_DIBLOKIR" };
      throw new Error(`TEMPEL_KOLABORASI_${r.alasan}`);
    }
    kolaborasiId = r.id;
  }

  const k = await simpanKontenKolDiTx(tx, {
    kolaborasiId,
    platform,
    format: v.format ?? "VIDEO",
    link: v.url,
    liveAt: v.liveAt,
    olehUserId: v.olehUserId,
    sumber,
  });
  if (!k.ok) throw new Error(`TEMPEL_KONTEN_${k.kode}`);
  if (v.tanpaTugasSegera) return { status: "DITAMBAHKAN", kontenId: k.id, kolaborasiId, kolBaru };

  const t = tugasSegera({ contentId: k.id, url: v.url, hariIni: hariIniWib(v.sekarang), platform });
  await tx.kolTugasPantau.create({
    data: {
      kunci: t.kunci,
      jenis: t.jenis,
      platform: t.platform,
      contentId: t.contentId,
      url: t.url,
      titikH: t.titikH,
      prioritas: t.prioritas,
      jatuhAt: v.sekarang,
      createdAt: v.sekarang,
    },
  });
  return { status: "DITAMBAHKAN", kontenId: k.id, kolaborasiId, kolBaru };
}

/**
 * Tempel link video. `sekarang` dan `bukaPendek` (fetch suntikan untuk link
 * pendek) hanya untuk tes; izin (`creative:manage`) diperiksa aksinya.
 */
export async function tempelLinkVideo(input: {
  teks: string;
  jenis: JenisOrangVideo;
  olehUserId: string;
  sekarang?: Date;
  bukaPendek?: OpsiBukaPendek;
  /** `fetch` suntikan untuk membaca pemilik link Instagram/YouTube (tes). */
  bukaPemilik?: OpsiBukaPemilik;
}): Promise<HasilTempelLink> {
  if (!(JENIS_ORANG_VIDEO as readonly string[]).includes(input.jenis)) return { ok: false, kode: "JENIS_TIDAK_SAH" };
  const teks = typeof input.teks === "string" ? input.teks : "";
  if (teks.length > MAKS_TEKS_TEMPEL) return { ok: false, kode: "TERLALU_PANJANG" };
  const baca = bacaLinkVideo(teks);
  if (baca.link.length === 0 && baca.ditolak.length === 0) return { ok: false, kode: "KOSONG" };
  if (baca.link.length > BATAS_LINK_TEMPEL) return { ok: false, kode: "TERLALU_BANYAK" };

  const gagal: GagalTempel[] = baca.ditolak.map((d) => ({ baris: d.teks, alasan: d.alasan }));
  const pendek = baca.link.flatMap((l) => (l.bentuk === "PENDEK" ? [l.url] : []));
  // Link Instagram tanpa nama akun dan semua link YouTube: pemiliknya dibaca dari halamannya.
  const cariPemilik: PermintaanPemilik[] = baca.link.flatMap((l): PermintaanPemilik[] =>
    l.bentuk === "YOUTUBE" ? [{ platform: "YOUTUBE", id: l.id }] : l.bentuk === "INSTAGRAM" && !l.handle ? [{ platform: "INSTAGRAM", id: l.id }] : [],
  );
  const [terbuka, pemilik] = await Promise.all([
    pendek.length ? bukaSemuaLinkPendek(pendek, input.bukaPendek) : Promise.resolve(new Map()),
    cariPemilik.length ? bukaSemuaPemilik(cariPemilik, input.bukaPemilik) : Promise.resolve(new Map()),
  ]);

  // Link pendek yang terbuka bisa menunjuk video yang sama dengan link lain di tempelan.
  const video: (VideoTempel & { tayangAt: Date | null })[] = [];
  const sudah = new Set<string>();
  let kembar = baca.kembar;
  for (const l of baca.link) {
    let v: VideoTempel & { tayangAt: Date | null };
    if (l.bentuk === "PANJANG") {
      v = { baris: l.teks, videoId: l.videoId, handle: l.handle, url: l.url, tayangAt: waktuTayangDariId(l.videoId) };
    } else if (l.bentuk === "PENDEK") {
      const r = terbuka.get(l.url);
      if (!r?.ok) {
        gagal.push({ baris: l.teks, alasan: "LINK_PENDEK_GAGAL" });
        continue;
      }
      v = { baris: l.teks, videoId: r.videoId, handle: r.handle, url: r.url, tayangAt: waktuTayangDariId(r.videoId) };
    } else {
      const platform = l.bentuk;
      const p = l.bentuk === "INSTAGRAM" && l.handle ? { ok: true as const, handle: l.handle, tayangAt: null } : pemilik.get(`${platform}:${l.id}`);
      const handle = p?.ok ? normalHandle(p.handle) : "";
      if (!p?.ok || !handle) {
        gagal.push({ baris: l.teks, alasan: "PEMILIK_TIDAK_TERBACA" });
        continue;
      }
      const tayangAt = p.tayangAt ?? (platform === "INSTAGRAM" ? waktuTayangInstagram(l.id) : null);
      const format = l.bentuk === "INSTAGRAM" ? (l.jenisKonten === "REEL" ? "REELS" : "FEED") : "VIDEO";
      v = { baris: l.teks, videoId: l.id, handle, url: l.url, platform, format, tayangAt };
    }
    const kunci = `${v.platform ?? "TIKTOK"}:${v.videoId}`;
    if (sudah.has(kunci)) {
      kembar += 1;
      continue;
    }
    sudah.add(kunci);
    video.push(v);
  }

  let ditambahkan = 0;
  let sudahAda = 0;
  let kolBaru = 0;
  const kontenIds: string[] = [];
  const kolaborasiDisentuh = new Set<string>();
  for (const { tayangAt, ...v } of video) {
    const sekarang = input.sekarang ?? new Date();
    const unggah = tayangAt ?? sekarang;
    // Jam TikTok/ID yang aneh tidak boleh membuat tanggal tayang di masa depan (angka ditolak sebelum hari tayang).
    const liveAt = unggah.getTime() > sekarang.getTime() ? sekarang : unggah;
    try {
      const r = await denganNomorUnik(() =>
        runSerializable((tx) => tempelSatuDiTx(tx, { ...v, liveAt, jenis: input.jenis, olehUserId: input.olehUserId, sekarang })),
      );
      if (r.status === "SUDAH_ADA") sudahAda += 1;
      else if (r.status === "GAGAL") gagal.push({ baris: v.baris, alasan: r.alasan });
      else {
        ditambahkan += 1;
        if (r.kolBaru) kolBaru += 1;
        kontenIds.push(r.kontenId);
        kolaborasiDisentuh.add(r.kolaborasiId);
      }
    } catch (err) {
      console.error("[tempelLinkVideo] gagal untuk", v.url, err);
      gagal.push({ baris: v.baris, alasan: "GAGAL" });
    }
  }

  // Sesudah commit: kolaborasi berbayar yang baru tayang mengakui fee-nya — selaraskan jurnal (best-effort).
  if (kolaborasiDisentuh.size) await sinkronJurnalKolAman([...kolaborasiDisentuh], input.olehUserId);
  return { ok: true, ditambahkan, sudahAda, kolBaru, kembar, gagal, kontenIds };
}
