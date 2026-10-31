import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { kunciSegera, PRIORITAS_PANTAU } from "./pantau-antrean";
import { tempelLinkVideo } from "./tempel-link-writer";

/*
 * Penulis "Tempel link" (Kreatif → Performa video) terhadap basis data
 * sungguhan. Setiap tes memakai handle acak sendiri (`ujitempel…`), waktu di
 * tahun 2000–2004, dan id video yang diturunkan dari waktu itu. Teardown
 * mencari baris lewat handle PERSIS yang dipakai tes (bukan awalan), lalu
 * menghapus lewat `seededId()`. Link pendek dibuka lewat `fetch` suntikan —
 * tes tidak pernah memanggil TikTok.
 */

const tag = `ujitempel${Math.random().toString(36).slice(2, 7)}`;

let userId = "";
let SEKARANG = new Date();
let handleDipakai: string[] = [];
let kolSeed: string[] = [];

/** Pukul 10.00 WIB pada satu hari acak 2000–2004. */
function hariAcak(): Date {
  const r = (n: number) => Math.floor(Math.random() * n);
  return new Date(Date.UTC(2000 + r(5), r(12), 1 + r(28), 3, 0, 0));
}

/** Id video TikTok yang diunggah pada `waktu` (32 bit teratas = detik unix). */
function idVideo(waktu: Date, ekor = Math.floor(Math.random() * 1_000_000)): string {
  return ((BigInt(Math.floor(waktu.getTime() / 1000)) << BigInt(32)) | BigInt(ekor)).toString();
}

const hariSebelum = (n: number) => new Date(SEKARANG.getTime() - n * 86_400_000);

function handle(akhiran: string): string {
  const h = `${tag}.${akhiran}`;
  handleDipakai.push(h);
  return h;
}

const link = (h: string, id: string) => `https://www.tiktok.com/@${h}/video/${id}`;

async function barisMilik(handles: string[]) {
  const akun = await prisma.kolAccount.findMany({
    where: { OR: handles.flatMap((h) => [{ handle: h }, { handle: `@${h}` }, { handle: `@${h.toUpperCase()}` }]) },
    select: { kolId: true },
  });
  const kolIds = [...new Set([...akun.map((a) => a.kolId), ...kolSeed])];
  const brief = await prisma.kolBrief.findMany({ where: { kolId: { in: seededIds(kolIds) } }, select: { id: true } });
  const briefIds = brief.map((b) => b.id);
  const konten = await prisma.kolContent.findMany({ where: { collabId: { in: seededIds(briefIds) } }, select: { id: true } });
  return { kolIds, briefIds, kontenIds: konten.map((k) => k.id) };
}

beforeEach(async () => {
  userId = "";
  handleDipakai = [];
  kolSeed = [];
  SEKARANG = hariAcak();
  userId = (await prisma.user.findFirstOrThrow({ select: { id: true } })).id;
});

afterEach(async () => {
  if (!handleDipakai.length && !kolSeed.length) return;
  const { kolIds, briefIds, kontenIds } = await barisMilik(handleDipakai);
  await prisma.kolTugasPantau.deleteMany({ where: { contentId: { in: seededIds(kontenIds) } } });
  await prisma.kolContentMetric.deleteMany({ where: { contentId: { in: seededIds(kontenIds) } } });
  await prisma.kolContent.deleteMany({ where: { id: { in: seededIds(kontenIds) } } });
  await prisma.auditLog.deleteMany({ where: { entityId: { in: seededIds([...kolIds, ...briefIds]) } } });
  await prisma.kolBrief.deleteMany({ where: { id: { in: seededIds(briefIds) } } });
  await prisma.kolFollowerSnapshot.deleteMany({ where: { account: { kolId: { in: seededIds(kolIds) } } } });
  await prisma.kolAccount.deleteMany({ where: { kolId: { in: seededIds(kolIds) } } });
  await prisma.kol.deleteMany({ where: { id: { in: seededIds(kolIds) } } });
});

async function kolDenganAkun(h: string, simpan: string, isi: { blockedAt?: Date } = {}) {
  const k = await prisma.kol.create({
    data: { name: `${tag} lama`, blockedAt: isi.blockedAt ?? null, accounts: { create: [{ platform: "TIKTOK", handle: simpan, followers: 5000 }] } },
    select: { id: true },
  });
  kolSeed.push(k.id);
  return k.id;
}

describe("tempelLinkVideo — link baru", () => {
  it("afiliasi baru: KOL '@handle' + akun TikTok, kolaborasi KOMISI tanpa fee, konten VIDEO tayang = waktu unggah, tugas cek SEGERA, tahap TAYANG", async () => {
    const h = handle("satu");
    const unggah = hariSebelum(3);
    const id = idVideo(unggah);
    const r = await tempelLinkVideo({
      teks: `Kak ini videonya 🙏\ntiktok.com/@${h.toUpperCase()}/video/${id}?is_from_webapp=1`,
      jenis: "AFILIASI",
      olehUserId: userId,
      sekarang: SEKARANG,
    });
    expect(r).toMatchObject({ ok: true, ditambahkan: 1, sudahAda: 0, kolBaru: 1, gagal: [] });

    const akun = await prisma.kolAccount.findFirstOrThrow({
      where: { handle: h },
      select: { platform: true, url: true, followers: true, kol: { select: { id: true, name: true } } },
    });
    expect(akun).toMatchObject({ platform: "TIKTOK", url: `https://www.tiktok.com/@${h}`, followers: 0 });
    expect(akun.kol.name).toBe(`@${h}`);

    const brief = await prisma.kolBrief.findFirstOrThrow({ where: { kolId: akun.kol.id }, select: { id: true, jenis: true, fee: true, tahap: true, campaignId: true, docNo: true } });
    expect(brief).toMatchObject({ jenis: "KOMISI", tahap: "TAYANG", campaignId: null });
    expect(Number(brief.fee)).toBe(0);
    expect(brief.docNo.startsWith(`BRIEF/${SEKARANG.getUTCFullYear()}/`)).toBe(true);

    const konten = await prisma.kolContent.findFirstOrThrow({ where: { collabId: brief.id }, select: { id: true, platform: true, format: true, link: true, liveAt: true } });
    expect(konten).toMatchObject({ platform: "TIKTOK", format: "VIDEO", link: link(h, id) });
    expect(konten.liveAt?.getTime()).toBe(Math.floor(unggah.getTime() / 1000) * 1000);

    const tugas = await prisma.kolTugasPantau.findMany({ where: { contentId: konten.id } });
    expect(tugas).toHaveLength(1);
    expect(tugas[0]).toMatchObject({
      kunci: kunciSegera(konten.id),
      jenis: "KONTEN",
      status: "ANTRE",
      url: link(h, id),
      prioritas: PRIORITAS_PANTAU.KONTEN_SEGERA,
      titikH: null,
    });
    expect(tugas[0].jatuhAt.getTime()).toBe(SEKARANG.getTime());

    const jejak = await prisma.auditLog.findMany({ where: { entityId: { in: [akun.kol.id, brief.id] } }, select: { action: true, metadata: true } });
    for (const aksi of ["KOL_CREATED", "KOL_BRIEF_CREATED", "KOL_CONTENT_RECORDED"]) {
      const j = jejak.find((x) => x.action === aksi);
      expect(j, aksi).toBeDefined();
      expect((j!.metadata as Record<string, unknown>).sumber, aksi).toBe("TEMPEL_LINK");
    }
  });

  it("KOL baru → kolaborasi berjenis bawaan (barter), bukan KOMISI", async () => {
    const h = handle("dua");
    const r = await tempelLinkVideo({ teks: link(h, idVideo(hariSebelum(1))), jenis: "KOL", olehUserId: userId, sekarang: SEKARANG });
    expect(r).toMatchObject({ ok: true, ditambahkan: 1, kolBaru: 1 });
    const brief = await prisma.kolBrief.findFirstOrThrow({ where: { kol: { accounts: { some: { handle: h } } } }, select: { jenis: true } });
    expect(brief.jenis).toBe("BARTER");
  });

  it("waktu unggah di masa depan (jam/ID aneh) dipangkas ke sekarang", async () => {
    const h = handle("depan");
    await tempelLinkVideo({ teks: link(h, idVideo(new Date(SEKARANG.getTime() + 5 * 86_400_000))), jenis: "KOL", olehUserId: userId, sekarang: SEKARANG });
    const k = await prisma.kolContent.findFirstOrThrow({ where: { collab: { kol: { accounts: { some: { handle: h } } } } }, select: { liveAt: true } });
    expect(k.liveAt?.getTime()).toBe(SEKARANG.getTime());
  });
});

describe("tempelLinkVideo — yang sudah ada", () => {
  it("video yang sama ditempel lagi (bentuk lain) → sudah dipantau, tanpa baris baru; dua video satu orang → satu KOL", async () => {
    const h = handle("ulang");
    const id = idVideo(hariSebelum(2));
    const id2 = idVideo(hariSebelum(1));
    expect(await tempelLinkVideo({ teks: link(h, id), jenis: "AFILIASI", olehUserId: userId, sekarang: SEKARANG })).toMatchObject({ ditambahkan: 1, kolBaru: 1 });
    const r = await tempelLinkVideo({
      teks: `www.tiktok.com/@${h}/video/${id}?lang=id\n${link(h, id2)}`,
      jenis: "AFILIASI",
      olehUserId: userId,
      sekarang: SEKARANG,
    });
    expect(r).toMatchObject({ ok: true, ditambahkan: 1, sudahAda: 1, kolBaru: 0, gagal: [] });
    const { kolIds, briefIds, kontenIds } = await barisMilik([h]);
    expect(kolIds).toHaveLength(1);
    expect(briefIds).toHaveLength(1);
    expect(kontenIds).toHaveLength(2);
    expect(await prisma.kolTugasPantau.count({ where: { contentId: { in: kontenIds } } })).toBe(2);
  });

  it("akun yang tersimpan '@Handle' dipakai; KOL memakai kolaborasi berjalan non-KOMISI, AFILIASI membuat kolaborasi KOMISI baru", async () => {
    const h = handle("lama");
    const kolId = await kolDenganAkun(h, `@${h.toUpperCase()}`);
    const barter = await prisma.kolBrief.create({ data: { docNo: `${tag}/B1`, kolId, tahap: "DEAL", jenis: "BARTER" }, select: { id: true } });

    const r1 = await tempelLinkVideo({ teks: link(h, idVideo(hariSebelum(2))), jenis: "KOL", olehUserId: userId, sekarang: SEKARANG });
    expect(r1).toMatchObject({ ok: true, ditambahkan: 1, kolBaru: 0 });
    expect((await prisma.kolBrief.findUniqueOrThrow({ where: { id: barter.id } })).tahap).toBe("TAYANG");
    expect(await prisma.kolContent.count({ where: { collabId: barter.id } })).toBe(1);

    const r2 = await tempelLinkVideo({ teks: link(h, idVideo(hariSebelum(1))), jenis: "AFILIASI", olehUserId: userId, sekarang: SEKARANG });
    expect(r2).toMatchObject({ ok: true, ditambahkan: 1, kolBaru: 0 });
    const semua = await prisma.kolBrief.findMany({ where: { kolId }, select: { jenis: true } });
    expect(semua.map((b) => b.jenis).sort()).toEqual(["BARTER", "KOMISI"]);
    expect(await prisma.kol.count({ where: { accounts: { some: { handle: h } } } })).toBe(0);
  });

  it("KOL diblokir → gagal dengan alasannya, tidak ada yang ditulis", async () => {
    const h = handle("blokir");
    const kolId = await kolDenganAkun(h, h, { blockedAt: SEKARANG });
    const l = link(h, idVideo(hariSebelum(1)));
    const r = await tempelLinkVideo({ teks: l, jenis: "AFILIASI", olehUserId: userId, sekarang: SEKARANG });
    expect(r).toEqual({ ok: true, ditambahkan: 0, sudahAda: 0, kolBaru: 0, kembar: 0, gagal: [{ baris: l, alasan: "KOL_DIBLOKIR" }], kontenIds: [] });
    expect(await prisma.kolBrief.count({ where: { kolId } })).toBe(0);
  });
});

describe("tempelLinkVideo — laporan per baris", () => {
  it("link pendek dibuka lewat fetch; yang gagal, Instagram tanpa akun yang tak terbaca, dan foto disebut alasannya", async () => {
    const h = handle("pendek");
    const id = idVideo(hariSebelum(2));
    const ambil = vi.fn(async (url: string | URL | Request) =>
      String(url).includes("ZSbisa")
        ? new Response(null, { status: 301, headers: { location: `https://www.tiktok.com/@${h}/video/${id}?_r=1` } })
        : new Response("tidak ada", { status: 404 }),
    ) as unknown as typeof fetch;
    const r = await tempelLinkVideo({
      teks: [
        "https://vt.tiktok.com/ZSbisa/",
        "https://vt.tiktok.com/ZSgagal/",
        "https://www.instagram.com/reel/C9abc/",
        `https://www.tiktok.com/@${h}/photo/${id}`,
        "halo kak",
      ].join("\n"),
      jenis: "AFILIASI",
      olehUserId: userId,
      sekarang: SEKARANG,
      bukaPendek: { fetch: ambil },
      // Halaman Instagram tanpa masuk: tidak menyebut akun pemiliknya.
      bukaPemilik: { fetch: (async () => new Response("<title>Login • Instagram</title>", { status: 200 })) as unknown as typeof fetch },
    });
    expect(r).toMatchObject({ ok: true, ditambahkan: 1, sudahAda: 0, kolBaru: 1 });
    if (!r.ok) return;
    expect(r.gagal).toEqual([
      { baris: `https://www.tiktok.com/@${h}/photo/${id}`, alasan: "LINK_FOTO" },
      { baris: "https://vt.tiktok.com/ZSgagal/", alasan: "LINK_PENDEK_GAGAL" },
      { baris: "https://www.instagram.com/reel/C9abc/", alasan: "PEMILIK_TIDAK_TERBACA" },
    ]);
    const k = await prisma.kolContent.findFirstOrThrow({ where: { collab: { kol: { accounts: { some: { handle: h } } } } }, select: { link: true } });
    expect(k.link).toBe(link(h, id));
  });

  it("masukan yang salah ditolak sebelum menulis apa pun", async () => {
    expect(await tempelLinkVideo({ teks: "x", jenis: "SALAH" as never, olehUserId: userId })).toEqual({ ok: false, kode: "JENIS_TIDAK_SAH" });
    expect(await tempelLinkVideo({ teks: "halo kak\nterima kasih", jenis: "KOL", olehUserId: userId })).toEqual({ ok: false, kode: "KOSONG" });
    expect(await tempelLinkVideo({ teks: "a".repeat(200_001), jenis: "KOL", olehUserId: userId })).toEqual({ ok: false, kode: "TERLALU_PANJANG" });
    const banyak = Array.from({ length: 501 }, (_, i) => link(`${tag}.n${i}`, idVideo(hariSebelum(1), i))).join("\n");
    expect(await tempelLinkVideo({ teks: banyak, jenis: "KOL", olehUserId: userId })).toEqual({ ok: false, kode: "TERLALU_BANYAK" });
  });
});

describe("tempelLinkVideo — Instagram dan YouTube", () => {
  it("reel Instagram ber-akun dan video YouTube: KOL dengan akun platformnya, konten REELS/VIDEO, tugas segera ber-platform", async () => {
    const hIg = handle("ig");
    const hYt = handle("yt");
    const kode = `C${Math.random().toString(36).slice(2, 12)}`;
    const ytId = `Yt${Math.random().toString(36).slice(2, 11)}`.slice(0, 11).padEnd(11, "x");
    const terbit = hariSebelum(3);
    const ambil = vi.fn(async (url: string | URL | Request) =>
      String(url) === `https://www.youtube.com/watch?v=${ytId}`
        ? new Response(
            `<script>var ytInitialPlayerResponse = {"videoDetails":{"videoId":"${ytId}"},"microformat":{"playerMicroformatRenderer":` +
              `{"ownerProfileUrl":"http://www.youtube.com/@${hYt}","publishDate":"${terbit.toISOString()}"}}};</script>`,
            { status: 200 },
          )
        : new Response("tidak ada", { status: 404 }),
    ) as unknown as typeof fetch;
    const r = await tempelLinkVideo({
      teks: [`https://www.instagram.com/${hIg}/reel/${kode}/?igsh=x`, `https://youtu.be/${ytId}`].join("\n"),
      jenis: "KOL",
      olehUserId: userId,
      sekarang: SEKARANG,
      bukaPemilik: { fetch: ambil },
    });
    expect(r).toMatchObject({ ok: true, ditambahkan: 2, kolBaru: 2, gagal: [] });
    if (!r.ok) return;
    // Link Instagram yang memuat nama akun tidak perlu dibuka; YouTube dibuka sekali.
    expect(ambil).toHaveBeenCalledTimes(1);

    const ig = await prisma.kolContent.findFirstOrThrow({
      where: { collab: { kol: { accounts: { some: { handle: hIg } } } } },
      select: { id: true, platform: true, format: true, link: true, collab: { select: { kol: { select: { accounts: { select: { platform: true, url: true } } } } } } },
    });
    expect(ig).toMatchObject({ platform: "INSTAGRAM", format: "REELS", link: `https://www.instagram.com/reel/${kode}/` });
    expect(ig.collab.kol.accounts).toEqual([{ platform: "INSTAGRAM", url: `https://www.instagram.com/${hIg}/` }]);
    expect(await prisma.kolTugasPantau.findFirstOrThrow({ where: { contentId: ig.id }, select: { platform: true, url: true } })).toEqual({
      platform: "INSTAGRAM",
      url: `https://www.instagram.com/reel/${kode}/`,
    });

    const yt = await prisma.kolContent.findFirstOrThrow({
      where: { collab: { kol: { accounts: { some: { handle: hYt } } } } },
      select: { id: true, platform: true, format: true, link: true, liveAt: true },
    });
    expect(yt).toMatchObject({ platform: "YOUTUBE", format: "VIDEO", link: `https://www.youtube.com/watch?v=${ytId}`, liveAt: terbit });

    // Tempel ulang dengan bentuk link lain → sudah dipantau, tidak dibuka lagi bila memuat akun.
    const ulang = await tempelLinkVideo({ teks: `https://www.instagram.com/${hIg}/p/${kode}`, jenis: "KOL", olehUserId: userId, sekarang: SEKARANG, bukaPemilik: { fetch: ambil } });
    expect(ulang).toMatchObject({ ok: true, ditambahkan: 0, sudahAda: 1 });
  });
});

describe("tempelLinkVideo — balapan", () => {
  it("BALAPAN: dua tempelan serentak dengan link yang sama → satu KOL, satu kolaborasi, satu konten, satu tugas", async () => {
    const h = handle("balap");
    const teks = link(h, idVideo(hariSebelum(2)));
    const [a, b] = await Promise.all([
      tempelLinkVideo({ teks, jenis: "AFILIASI", olehUserId: userId, sekarang: SEKARANG }),
      tempelLinkVideo({ teks, jenis: "AFILIASI", olehUserId: userId, sekarang: SEKARANG }),
    ]);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.ditambahkan + b.ditambahkan).toBe(1);
    expect(a.sudahAda + b.sudahAda).toBe(1);
    expect(a.kolBaru + b.kolBaru).toBe(1);
    const { kolIds, briefIds, kontenIds } = await barisMilik([h]);
    expect(kolIds).toHaveLength(1);
    expect(briefIds).toHaveLength(1);
    expect(kontenIds).toHaveLength(1);
    expect(await prisma.kolTugasPantau.count({ where: { contentId: seededId(kontenIds[0]) } })).toBe(1);
  });
});
