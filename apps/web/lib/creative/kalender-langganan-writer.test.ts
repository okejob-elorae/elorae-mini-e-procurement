import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId } from "@elorae/db";
import { geserHari, hariIniWib } from "@/lib/tanggal-isian";
import { bukaLanggananKalender, isiLanggananKalender, ringkasLanggananKalender } from "./kalender-langganan-queries";
import { buatLanggananKalender, cabutLanggananKalender, catatPemakaianLangganan } from "./kalender-langganan-writer";

/*
 * Tautan langganan Kalender Kreatif terhadap basis data sungguhan. Pengguna dan
 * peran fixture dibuat sendiri — memakai admin sungguhan akan mencabut tautan
 * kalender pemiliknya. Teardown lewat `seededId()`.
 */

const tag = `UJIKAL${Math.random().toString(36).slice(2, 8)}`;
let peranId = "";
let userBolehId = "";
let userTanpaId = "";

beforeEach(async () => {
  peranId = "";
  userBolehId = "";
  userTanpaId = "";
  const izin = await prisma.permission.findUniqueOrThrow({ where: { code: "creative:view" }, select: { id: true } });
  peranId = (await prisma.roleDefinition.create({ data: { name: `${tag}-peran`, isSystem: false }, select: { id: true } })).id;
  await prisma.rolePermission.create({ data: { roleId: peranId, permissionId: izin.id } });
  userBolehId = (await prisma.user.create({ data: { email: `${tag.toLowerCase()}-a@uji.local`, name: `${tag} A`, roleId: peranId }, select: { id: true } })).id;
  userTanpaId = (await prisma.user.create({ data: { email: `${tag.toLowerCase()}-b@uji.local`, name: `${tag} B` }, select: { id: true } })).id;
});

afterEach(async () => {
  await prisma.kolAgenda.deleteMany({ where: { ownerId: { in: [seededId(userBolehId), seededId(userTanpaId)] } } });
  await prisma.kolCalendarFeed.deleteMany({ where: { userId: { in: [seededId(userBolehId), seededId(userTanpaId)] } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: [seededId(userBolehId), seededId(userTanpaId)] } } });
  await prisma.user.deleteMany({ where: { id: { in: [seededId(userBolehId), seededId(userTanpaId)] } } });
  await prisma.rolePermission.deleteMany({ where: { roleId: seededId(peranId) } });
  await prisma.roleDefinition.deleteMany({ where: { id: seededId(peranId) } });
});

describe("buat dan cabut tautan", () => {
  it("token 43 tanda, hanya hash yang disimpan; tautan baru mencabut yang lama; jejak tanpa token", async () => {
    const a = await buatLanggananKalender({ userId: userBolehId });
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const baris = await prisma.kolCalendarFeed.findUniqueOrThrow({ where: { id: a.feedId } });
    expect(JSON.stringify(baris)).not.toContain(a.token);
    expect((await bukaLanggananKalender(a.token))?.userId).toBe(userBolehId);

    const b = await buatLanggananKalender({ userId: userBolehId });
    expect(b.lamaDicabut).toBe(1);
    expect(await bukaLanggananKalender(a.token)).toBeNull();
    expect((await bukaLanggananKalender(b.token))?.feedId).toBe(b.feedId);

    const jejak = await prisma.auditLog.findMany({ where: { userId: userBolehId, action: "KOL_CALENDAR_FEED_CREATED" } });
    expect(jejak).toHaveLength(2);
    expect(JSON.stringify(jejak)).not.toContain(b.token);
    expect(JSON.stringify(jejak)).not.toContain(baris.tokenHash);
  });

  it("cabut mencabut tautan aktif, menulis jejak, dan kedua kalinya menjawab TIDAK_ADA", async () => {
    const a = await buatLanggananKalender({ userId: userBolehId });
    expect(await cabutLanggananKalender({ userId: userBolehId })).toEqual({ ok: true, dicabut: 1 });
    expect(await bukaLanggananKalender(a.token)).toBeNull();
    expect(await cabutLanggananKalender({ userId: userBolehId })).toEqual({ ok: false, kode: "TIDAK_ADA" });
    expect(await prisma.auditLog.count({ where: { userId: userBolehId, action: "KOL_CALENDAR_FEED_REVOKED", entityId: a.feedId } })).toBe(1);
    expect((await ringkasLanggananKalender(userBolehId)).aktif).toBeNull();
  });

  it("dua permintaan buat serentak menyisakan tepat satu tautan aktif", async () => {
    const [x, y] = await Promise.all([buatLanggananKalender({ userId: userBolehId }), buatLanggananKalender({ userId: userBolehId })]);
    expect(await prisma.kolCalendarFeed.count({ where: { userId: userBolehId, revokedAt: null } })).toBe(1);
    const hidup = [await bukaLanggananKalender(x.token), await bukaLanggananKalender(y.token)].filter(Boolean);
    expect(hidup).toHaveLength(1);
  });
});

describe("buka tautan", () => {
  it("bentuk salah dan tidak dikenal → null", async () => {
    expect(await bukaLanggananKalender("pendek")).toBeNull();
    expect(await bukaLanggananKalender("Z".repeat(43))).toBeNull();
    expect(await bukaLanggananKalender(42)).toBeNull();
  });

  it("izin dibaca ulang: pemilik tanpa creative:view → null; diberi peran sistem → terbuka", async () => {
    const t = await buatLanggananKalender({ userId: userTanpaId });
    expect(await bukaLanggananKalender(t.token)).toBeNull();
    const admin = await prisma.roleDefinition.findFirstOrThrow({ where: { isSystem: true }, select: { id: true } });
    await prisma.user.update({ where: { id: userTanpaId }, data: { roleId: admin.id } });
    expect((await bukaLanggananKalender(t.token))?.userId).toBe(userTanpaId);
  });

  it("izin dicabut dari perannya → tautan berhenti terbuka", async () => {
    const t = await buatLanggananKalender({ userId: userBolehId });
    expect(await bukaLanggananKalender(t.token)).not.toBeNull();
    await prisma.rolePermission.deleteMany({ where: { roleId: seededId(peranId) } });
    expect(await bukaLanggananKalender(t.token)).toBeNull();
  });

  it("akun dihapus → null", async () => {
    const t = await buatLanggananKalender({ userId: userBolehId });
    await prisma.auditLog.deleteMany({ where: { userId: seededId(userBolehId) } });
    await prisma.user.delete({ where: { id: userBolehId } });
    expect(await bukaLanggananKalender(t.token)).toBeNull();
  });
});

describe("pemakaian", () => {
  it("lastUsedAt paling sering sekali per 10 menit; ringkasan menyebut sejak dan terakhir dibaca", async () => {
    const t = await buatLanggananKalender({ userId: userBolehId, sekarang: new Date("2026-10-10T01:00:00Z") });
    const pukul = (iso: string) => new Date(iso);
    expect(await catatPemakaianLangganan(t.feedId, null, pukul("2026-10-10T02:00:00Z"))).toBe(true);
    // Pemanggil yang membaca nilai lama (null) tetap ditolak oleh basis data selama < 10 menit.
    expect(await catatPemakaianLangganan(t.feedId, null, pukul("2026-10-10T02:05:00Z"))).toBe(false);
    expect(await catatPemakaianLangganan(t.feedId, pukul("2026-10-10T02:00:00Z"), pukul("2026-10-10T02:09:59Z"))).toBe(false);
    expect(await catatPemakaianLangganan(t.feedId, pukul("2026-10-10T02:00:00Z"), pukul("2026-10-10T02:10:01Z"))).toBe(true);
    const r = await ringkasLanggananKalender(userBolehId);
    expect(r.aktif?.sejak.toISOString()).toBe("2026-10-10T01:00:00.000Z");
    expect(r.aktif?.terakhirDibaca?.toISOString()).toBe("2026-10-10T02:10:01.000Z");
  });

  it("tautan dicabut tidak dicatat dipakai", async () => {
    const t = await buatLanggananKalender({ userId: userBolehId });
    await cabutLanggananKalender({ userId: userBolehId });
    expect(await catatPemakaianLangganan(t.feedId, null)).toBe(false);
  });
});

describe("isi kalender", () => {
  it("agenda milik orang itu masuk sebagai acara berjam UTC; agenda orang lain tidak", async () => {
    const hariIni = hariIniWib();
    const lusa = geserHari(hariIni, 2);
    const milik = await prisma.kolAgenda.create({
      data: { title: `${tag} rapat`, date: new Date(`${lusa}T00:00:00.000+07:00`), time: "09:15", kind: "MEETING", ownerId: userBolehId },
      select: { id: true },
    });
    const orangLain = await prisma.kolAgenda.create({
      data: { title: `${tag} rahasia`, date: new Date(`${lusa}T00:00:00.000+07:00`), ownerId: userTanpaId },
      select: { id: true },
    });
    const ics = await isiLanggananKalender({ userId: userBolehId, asal: "https://elorae.cloud" });
    const dibuka = ics.replace(/\r\n /g, "");
    expect(dibuka).toContain(`UID:agenda-${milik.id}@elorae-kreatif`);
    expect(dibuka).toContain(`DTSTART:${lusa.replace(/-/g, "")}T021500Z`);
    expect(dibuka).toContain(`SUMMARY:${tag} rapat`);
    expect(dibuka).toContain(`https://elorae.cloud/backoffice/kreatif/kalender?bulan=${lusa.slice(0, 7)}&tanggal=${lusa}&agenda=${milik.id}`);
    expect(dibuka).not.toContain(orangLain.id);
    expect(dibuka).not.toContain(`${tag} rahasia`);
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
  });
});
