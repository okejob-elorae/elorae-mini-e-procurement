import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { blokirKol, buatCatatanKol, bukaBlokirKol, simpanKolMassal, simpanProfilKol, type IsiKol } from "./kol-writer";

/*
 * Penulis database KOL terhadap basis data sungguhan (Postgres lokal).
 *
 * Yang dibuktikan di sini: akun diubah DI TEMPAT (id tetap, riwayat pengikut
 * tidak hilang dan hanya bertambah saat angkanya berubah), kembar ditolak
 * sampai ada alasan, tambah massal tidak pernah membuat dobel dan tidak
 * menimpa data yang sudah rapi, blokir wajib beralasan, dan catatan memulai
 * ulang jam follow-up.
 */

const tag = `v1w${Math.random().toString(36).slice(2, 8)}`;
let userId = "";
let kolIds: string[] = [];
let briefIds: string[] = [];
let catatanIds: string[] = [];

beforeEach(async () => {
  userId = "";
  kolIds = [];
  briefIds = [];
  catatanIds = [];
  userId = (await prisma.user.findFirstOrThrow({ select: { id: true } })).id;
});

afterEach(async () => {
  await prisma.auditLog.deleteMany({ where: { entityId: { in: seededIds([...kolIds, ...briefIds, ...catatanIds]) } } });
  await prisma.kolNote.deleteMany({ where: { kolId: { in: seededIds(kolIds) } } });
  await prisma.kolBrief.deleteMany({ where: { id: { in: seededIds(briefIds) } } });
  await prisma.kol.deleteMany({ where: { id: { in: seededIds(kolIds) } } });
});

const h = (s: string) => `${tag}${s}`;

async function buat(isi: Partial<IsiKol> & Pick<IsiKol, "akun">, opsi: { periksaKembar?: boolean; alasanKembar?: string } = {}) {
  const r = await simpanProfilKol({ isi: { name: "", ...isi }, olehUserId: userId, periksaKembar: opsi.periksaKembar ?? false, alasanKembar: opsi.alasanKembar });
  if (r.ok) kolIds.push(r.id);
  return r;
}

const akunDari = (kolId: string) =>
  prisma.kolAccount.findMany({ where: { kolId: seededId(kolId) }, include: { snapshots: true }, orderBy: { platform: "asc" } });

describe("simpanProfilKol — akun diubah di tempat", () => {
  it("id akun tetap, riwayat pengikut hanya bertambah saat angkanya berubah", async () => {
    const r = await buat({
      name: "Nadia",
      city: "Solo",
      akun: [
        { platform: "INSTAGRAM", handle: `@${h("ig")}`, followers: 10_000 },
        { platform: "TIKTOK", handle: h("tt"), followers: 5_000 },
      ],
    });
    if (!r.ok) throw new Error(r.alasan);
    const awal = await akunDari(r.id);
    expect(awal.map((a) => [a.platform, a.handle, a.snapshots.length])).toEqual([
      ["INSTAGRAM", h("ig"), 1],
      ["TIKTOK", h("tt"), 1],
    ]);
    const ig = awal.find((a) => a.platform === "INSTAGRAM")!;
    const tt = awal.find((a) => a.platform === "TIKTOK")!;

    // Ubah: IG naik, TT sama, YT baru; kota tidak dikirim → tidak disentuh.
    const u = await simpanProfilKol({
      id: r.id,
      isi: {
        name: "Nadia Putri",
        akun: [
          { id: ig.id, platform: "INSTAGRAM", handle: h("ig"), followers: 12_000 },
          { id: tt.id, platform: "TIKTOK", handle: h("tt"), followers: 5_000 },
          { platform: "YOUTUBE", handle: h("yt"), followers: 300 },
        ],
      },
      olehUserId: userId,
      periksaKembar: true,
    });
    expect(u).toMatchObject({ ok: true, dibuat: false, riwayatPengikut: 2 });
    const kedua = await akunDari(r.id);
    expect(kedua.find((a) => a.platform === "INSTAGRAM")).toMatchObject({ id: ig.id, followers: 12_000 });
    expect(kedua.find((a) => a.platform === "INSTAGRAM")!.snapshots.map((s) => s.followers).sort()).toEqual([10_000, 12_000]);
    expect(kedua.find((a) => a.platform === "TIKTOK")).toMatchObject({ id: tt.id });
    expect(kedua.find((a) => a.platform === "TIKTOK")!.snapshots).toHaveLength(1);
    expect(kedua.find((a) => a.platform === "YOUTUBE")!.snapshots).toHaveLength(1);
    const kol = await prisma.kol.findUniqueOrThrow({ where: { id: r.id } });
    expect(kol.name).toBe("Nadia Putri");
    expect(kol.city).toBe("Solo");

    // Tanpa id, handle ditulis lain ("@", huruf besar) → tetap akun yang sama; tidak ada riwayat baru.
    const v = await simpanProfilKol({
      id: r.id,
      isi: {
        name: "Nadia Putri",
        akun: [
          { platform: "INSTAGRAM", handle: `@${h("IG")}`.toUpperCase(), followers: 12_000 },
          { platform: "YOUTUBE", handle: h("yt"), followers: 300 },
        ],
      },
      olehUserId: userId,
      periksaKembar: true,
    });
    expect(v).toMatchObject({ ok: true, riwayatPengikut: 0 });
    const ketiga = await akunDari(r.id);
    // TikTok dibuang dari formulir → akunnya (dan riwayatnya) dihapus; yang lain tetap id-nya.
    expect(ketiga.map((a) => a.platform)).toEqual(["INSTAGRAM", "YOUTUBE"]);
    expect(ketiga.find((a) => a.platform === "INSTAGRAM")!.id).toBe(ig.id);
    expect(ketiga.find((a) => a.platform === "INSTAGRAM")!.snapshots).toHaveLength(2);

    const jejak = await prisma.auditLog.findMany({ where: { entityId: r.id, action: "KOL_UPDATED" }, orderBy: { createdAt: "asc" } });
    expect(jejak).toHaveLength(2);
    expect((jejak[0].metadata as { pengikutBerubah: unknown[] }).pengikutBerubah).toEqual([
      { akun: `INSTAGRAM:@${h("ig")}`, dari: 10_000, ke: 12_000 },
    ]);
    expect((jejak[1].metadata as { akunDihapus: string[] }).akunDihapus).toEqual([`TIKTOK:@${h("tt")}`]);
  });

  it("menolak tanpa akun; nama kosong memakai handle; ER di luar 0–100 ditolak", async () => {
    expect(await buat({ name: "X", akun: [] })).toMatchObject({ ok: false, alasan: "AKUN_WAJIB" });
    const r = await buat({ akun: [{ platform: "TIKTOK", handle: h("tanpanama"), followers: 0 }] });
    if (!r.ok) throw new Error(r.alasan);
    expect((await prisma.kol.findUniqueOrThrow({ where: { id: r.id } })).name).toBe(h("tanpanama"));
    expect(await buat({ akun: [{ platform: "TIKTOK", handle: h("er"), followers: 0 }], engagementRate: 140 })).toMatchObject({
      ok: false,
      alasan: "TIDAK_VALID",
      detail: "engagementRate",
    });
  });

  it("menyimpan alamat, ukuran, label, dan nomor WA bentuk 62…", async () => {
    const r = await buat({
      name: "Rara",
      phone: "0812-7000-1111",
      address: "Jl. Melati 5",
      province: "Jawa Tengah",
      postalCode: "57111",
      label: "Favorit, hijab, favorit",
      ukuran: { atasan: "M", hijab: true },
      akun: [{ platform: "INSTAGRAM", handle: h("rara"), followers: 0 }],
    });
    if (!r.ok) throw new Error(r.alasan);
    const k = await prisma.kol.findUniqueOrThrow({ where: { id: r.id } });
    expect(k.waNormal).toBe("6281270001111");
    expect(k.label).toBe("Favorit, hijab");
    expect(JSON.parse(k.sizeProfile!)).toMatchObject({ atasan: "M", hijab: true, tinggiCm: null });
  });
});

describe("simpanProfilKol — rate card per format", () => {
  it("tersimpan sebagai JSON berurutan, tidak terhapus oleh penulis yang tidak membawanya, dan berjejak", async () => {
    const r = await buat({ name: "Rara", rateFormat: { REELS: 750_000, FEED: 500_000 }, akun: [{ platform: "TIKTOK", handle: h("rr"), followers: 1_000 }] });
    if (!r.ok) throw new Error(r.alasan);
    const kolom = async () => (await prisma.kol.findUniqueOrThrow({ where: { id: r.id }, select: { rateFormat: true } })).rateFormat;
    expect(await kolom()).toBe('{"FEED":500000,"REELS":750000}');

    // Ubah tanpa `rateFormat` (bentuk isian ekstensi / tempel link) → tidak disentuh.
    const u = await simpanProfilKol({
      id: r.id,
      isi: { name: "Rara", city: "Solo", akun: [{ platform: "TIKTOK", handle: h("rr"), followers: 2_000 }] },
      olehUserId: userId,
      periksaKembar: false,
    });
    expect(u.ok).toBe(true);
    expect(await kolom()).toBe('{"FEED":500000,"REELS":750000}');

    // Tambah massal PERBARUI juga tidak menyentuhnya.
    const m = await simpanKolMassal({ baris: [{ handle: h("rr"), pengikut: 3_000, aksi: "PERBARUI", targetId: r.id }], platform: "TIKTOK", olehUserId: userId });
    expect(m.ok).toBe(true);
    expect(await kolom()).toBe('{"FEED":500000,"REELS":750000}');

    // Angka tidak sah ditolak per kolom, tanpa menulis.
    const salah = await simpanProfilKol({
      id: r.id,
      isi: { name: "Rara", rateFormat: { FEED: 1.5 }, akun: [{ platform: "TIKTOK", handle: h("rr"), followers: 3_000 }] },
      olehUserId: userId,
      periksaKembar: false,
    });
    expect(salah).toMatchObject({ ok: false, alasan: "TIDAK_VALID", detail: "rateFormat" });

    // Ganti isinya: jejak mencatat objek sebelum/sesudah, bukan teks JSON.
    await simpanProfilKol({
      id: r.id,
      isi: { name: "Rara", rateFormat: { FEED: 600_000 }, akun: [{ platform: "TIKTOK", handle: h("rr"), followers: 3_000 }] },
      olehUserId: userId,
      periksaKembar: false,
    });
    expect(await kolom()).toBe('{"FEED":600000}');
    const jejak = await prisma.auditLog.findMany({ where: { entityId: seededId(r.id), action: "KOL_UPDATED" }, orderBy: { createdAt: "desc" } });
    expect(jejak[0].changes).toMatchObject({
      before: { rateFormat: { FEED: 500_000, REELS: 750_000 } },
      after: { rateFormat: { FEED: 600_000 } },
    });

    // Objek kosong atau null mengosongkan kolomnya.
    await simpanProfilKol({ id: r.id, isi: { name: "Rara", rateFormat: {}, akun: [{ platform: "TIKTOK", handle: h("rr"), followers: 3_000 }] }, olehUserId: userId, periksaKembar: false });
    expect(await kolom()).toBeNull();
  });
});

describe("simpanProfilKol — kembar", () => {
  it("nomor WA sama ditolak sampai ada alasan; alasannya masuk jejak", async () => {
    const a = await buat({ name: "Asli", phone: "0812-9000-1234", akun: [{ platform: "INSTAGRAM", handle: h("asli"), followers: 0 }] });
    if (!a.ok) throw new Error(a.alasan);

    const tolak = await buat({ name: "Kembar", phone: "+62 812 9000 1234", akun: [{ platform: "TIKTOK", handle: h("lain"), followers: 0 }] }, { periksaKembar: true });
    expect(tolak).toMatchObject({ ok: false, alasan: "KEMBAR" });
    if (tolak.ok) throw new Error("harus kembar");
    expect(tolak.kembar).toEqual([{ id: a.id, nama: "Asli", sebab: ["WA"], handles: [h("asli")], diblokir: false }]);

    const jadi = await buat(
      { name: "Kembar", phone: "+62 812 9000 1234", akun: [{ platform: "TIKTOK", handle: h("lain"), followers: 0 }] },
      { periksaKembar: true, alasanKembar: "Nomor admin agensi, orangnya berbeda" },
    );
    if (!jadi.ok) throw new Error(jadi.alasan);
    const jejak = await prisma.auditLog.findFirstOrThrow({ where: { entityId: jadi.id, action: "KOL_CREATED" } });
    expect(jejak.metadata).toMatchObject({ kembarDengan: [a.id], alasanKembar: "Nomor admin agensi, orangnya berbeda" });
    expect(jejak.reason).toBe("Nomor admin agensi, orangnya berbeda");
  });

  it("handle sama di platform lain = kembar; mengubah KOL itu sendiri tidak dianggap kembar", async () => {
    const a = await buat({ name: "Asli", akun: [{ platform: "INSTAGRAM", handle: h("sama"), followers: 0 }] });
    if (!a.ok) throw new Error(a.alasan);
    const b = await buat({ name: "Lain", akun: [{ platform: "TIKTOK", handle: `@${h("Sama")}`, followers: 0 }] }, { periksaKembar: true });
    expect(b).toMatchObject({ ok: false, alasan: "KEMBAR" });
    if (!b.ok) expect(b.kembar?.[0]).toMatchObject({ id: a.id, sebab: ["HANDLE"] });

    const ubah = await simpanProfilKol({
      id: a.id,
      isi: { name: "Asli", akun: [{ platform: "INSTAGRAM", handle: h("sama"), followers: 50 }] },
      olehUserId: userId,
      periksaKembar: true,
    });
    expect(ubah.ok).toBe(true);
  });
});

describe("simpanKolMassal", () => {
  it("BARU dibuat, PERBARUI hanya mengganti pengikut dan mengisi yang kosong, LEWATI dan kembar baru dilewati", async () => {
    const x = await buat({ name: h("x"), city: "Solo", akun: [{ platform: "TIKTOK", handle: h("x"), followers: 1_000 }] });
    const y = await buat({ name: "Yuni", akun: [{ platform: "INSTAGRAM", handle: h("y"), followers: 100 }] });
    if (!x.ok || !y.ok) throw new Error("seed");

    const r = await simpanKolMassal({
      platform: "TIKTOK",
      olehUserId: userId,
      baris: [
        { handle: h("x"), nama: "Xena", pengikut: 2_000, wa: "0813-1111-2222", kota: "Bandung", aksi: "PERBARUI", targetId: x.id },
        { handle: `@${h("baru")}`, nama: "Baru", pengikut: 500, aksi: "BARU" },
        { handle: h("lewat"), aksi: "LEWATI" },
        // Muncul sesudah pratinjau: handle ini sudah ada (di platform lain) → dilewati, bukan dobel.
        { handle: h("y"), aksi: "BARU" },
        // Handle sama dua kali di tempelan → yang kedua dilewati.
        { handle: h("baru"), aksi: "BARU" },
      ],
    });
    if (!r.ok) throw new Error(r.alasan);
    kolIds.push(...r.kolIds.filter((id) => !kolIds.includes(id)));
    expect(r).toMatchObject({ baru: 1, diperbarui: 1, dilewati: 3, kembarBaru: [h("y")] });

    const kx = await prisma.kol.findUniqueOrThrow({ where: { id: x.id }, include: { accounts: { include: { snapshots: true } } } });
    expect(kx.name).toBe("Xena");
    expect(kx.city).toBe("Solo");
    expect(kx.waNormal).toBe("6281311112222");
    expect(kx.accounts[0].followers).toBe(2_000);
    expect(kx.accounts[0].snapshots.map((s) => s.followers).sort()).toEqual([1_000, 2_000]);

    const baru = await prisma.kol.findMany({ where: { id: { in: seededIds(r.kolIds) }, accounts: { some: { handle: h("baru") } } }, include: { accounts: true } });
    expect(baru).toHaveLength(1);
    expect(baru[0].accounts[0]).toMatchObject({ platform: "TIKTOK", followers: 500 });
    expect(await prisma.kolAccount.count({ where: { handle: h("lewat") } })).toBe(0);
    expect(await prisma.kol.count({ where: { accounts: { some: { handle: h("y") } } } })).toBe(1);
  });

  it("menolak tempelan kosong dan yang melebihi batas", async () => {
    expect(await simpanKolMassal({ platform: "TIKTOK", olehUserId: userId, baris: [] })).toMatchObject({ ok: false, alasan: "TIDAK_VALID" });
    const banyak = Array.from({ length: 501 }, (_, i) => ({ handle: h(`m${i}`), aksi: "LEWATI" as const }));
    expect(await simpanKolMassal({ platform: "TIKTOK", olehUserId: userId, baris: banyak })).toMatchObject({ ok: false, alasan: "TERLALU_BANYAK" });
  });
});

describe("blokir", () => {
  it("blokir dan buka blokir wajib beralasan dan berjejak", async () => {
    const k = await buat({ name: "B", akun: [{ platform: "TIKTOK", handle: h("blok"), followers: 0 }] });
    if (!k.ok) throw new Error(k.alasan);

    expect(await blokirKol({ kolId: k.id, alasan: "  ", olehUserId: userId })).toMatchObject({ ok: false, alasan: "ALASAN_WAJIB" });
    expect(await blokirKol({ kolId: k.id, alasan: "Ghosting dua kali", olehUserId: userId })).toEqual({ ok: true });
    const terblokir = await prisma.kol.findUniqueOrThrow({ where: { id: k.id } });
    expect(terblokir.blockedAt).not.toBeNull();
    expect(terblokir.blockReason).toBe("Ghosting dua kali");
    expect(await blokirKol({ kolId: k.id, alasan: "lagi", olehUserId: userId })).toMatchObject({ ok: false, alasan: "SUDAH_DIBLOKIR" });

    expect(await bukaBlokirKol({ kolId: k.id, alasan: "", olehUserId: userId })).toMatchObject({ ok: false, alasan: "ALASAN_WAJIB" });
    expect(await bukaBlokirKol({ kolId: k.id, alasan: "Sudah minta maaf", olehUserId: userId })).toEqual({ ok: true });
    expect((await prisma.kol.findUniqueOrThrow({ where: { id: k.id } })).blockedAt).toBeNull();
    expect(await bukaBlokirKol({ kolId: k.id, alasan: "x", olehUserId: userId })).toMatchObject({ ok: false, alasan: "BELUM_DIBLOKIR" });

    const jejak = await prisma.auditLog.findMany({ where: { entityId: k.id, action: { in: ["KOL_BLOCKED", "KOL_UNBLOCKED"] } }, orderBy: { createdAt: "asc" } });
    expect(jejak.map((j) => [j.action, j.reason])).toEqual([
      ["KOL_BLOCKED", "Ghosting dua kali"],
      ["KOL_UNBLOCKED", "Sudah minta maaf"],
    ]);
  });
});

describe("buatCatatanKol", () => {
  it("catatan KOL dan catatan kolaborasi memulai ulang kontak terakhir", async () => {
    const k = await buat({ name: "C", akun: [{ platform: "TIKTOK", handle: h("cat"), followers: 0 }] });
    if (!k.ok) throw new Error(k.alasan);
    const lain = await buat({ name: "D", akun: [{ platform: "TIKTOK", handle: h("cat2"), followers: 0 }] });
    if (!lain.ok) throw new Error(lain.alasan);
    const brief = await prisma.kolBrief.create({ data: { docNo: `TEST/${tag}/1`, kolId: k.id }, select: { id: true } });
    briefIds.push(brief.id);

    expect(await buatCatatanKol({ kolId: k.id, isi: "   ", olehUserId: userId })).toMatchObject({ ok: false, alasan: "ISI_WAJIB" });
    expect(await buatCatatanKol({ isi: "x", olehUserId: userId })).toMatchObject({ ok: false, alasan: "TIDAK_VALID" });
    expect(await buatCatatanKol({ kolId: lain.id, kolaborasiId: brief.id, isi: "x", olehUserId: userId })).toMatchObject({
      ok: false,
      alasan: "TIDAK_VALID",
    });

    const a = await buatCatatanKol({ kolId: k.id, isi: "Minta rate card terbaru", olehUserId: userId });
    if (!a.ok) throw new Error(a.alasan);
    catatanIds.push(a.id);
    expect((await prisma.kol.findUniqueOrThrow({ where: { id: k.id } })).lastContactAt).not.toBeNull();

    const b = await buatCatatanKol({ kolaborasiId: brief.id, isi: "Sudah setuju barter", olehUserId: userId });
    if (!b.ok) throw new Error(b.alasan);
    catatanIds.push(b.id);
    const nb = await prisma.kolNote.findUniqueOrThrow({ where: { id: b.id } });
    expect(nb).toMatchObject({ kolId: k.id, collabId: brief.id, body: "Sudah setuju barter" });
    expect((await prisma.kolBrief.findUniqueOrThrow({ where: { id: brief.id } })).lastContactAt).not.toBeNull();

    const jejak = await prisma.auditLog.findFirstOrThrow({ where: { entityId: b.id } });
    expect(jejak).toMatchObject({ action: "KOL_NOTE_CREATED", entityType: "KolNote" });
    expect(jejak.metadata).toMatchObject({ kolId: k.id, kolaborasiId: brief.id, docNo: `TEST/${tag}/1` });
  });
});
