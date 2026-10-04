import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import { prisma, seededId, seededIds } from "@elorae/db";

/**
 * Ganti kata sandi terhadap basis data sungguhan (sesi ditiru).
 *
 * Yang dibuktikan: sandi yang diganti SELALU milik pengguna sesi (id kiriman
 * pemanggil tidak ada lagi), tanpa sesi tidak ada yang berubah, dan tebakan
 * "sandi saat ini" dibatasi — lima salah mengunci 15 menit, juga bila
 * tebakannya dikirim serentak.
 *
 * Penghitung tebakan hidup di memori modul, jadi setiap tes memakai pengguna
 * baru supaya kuncian satu tes tidak bocor ke tes berikutnya.
 */

const sesi = vi.hoisted(() => ({ aktif: true, id: "" }));
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => (sesi.aktif ? { user: { id: sesi.id, permissions: [] } } : null)),
}));

const { changePassword } = await import("./change-password");

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const tag = `SANDI-${Math.random().toString(36).slice(2, 8)}`;
const LAMA = "sandi-lama-1";
const BARU = "sandi-baru-12";

d("changePassword (test bed only)", () => {
  const dibuat: string[] = [];
  let u = "";
  let lain = "";
  let hashLain = "";
  let n = 0;

  const hashDari = async (id: string) =>
    (await prisma.user.findUnique({ where: { id: seededId(id) }, select: { passwordHash: true } }))?.passwordHash ?? "";

  beforeEach(async () => {
    u = "";
    lain = "";
    n += 1;
    const hashLama = await bcrypt.hash(LAMA, 4);
    hashLain = await bcrypt.hash("sandi-orang-lain", 4);
    u = (await prisma.user.create({ data: { email: `${tag}-${n}-u@uji.local`, name: `${tag} U`, passwordHash: hashLama } })).id;
    dibuat.push(u);
    lain = (await prisma.user.create({ data: { email: `${tag}-${n}-l@uji.local`, name: `${tag} L`, passwordHash: hashLain } })).id;
    dibuat.push(lain);
    sesi.aktif = true;
    sesi.id = u;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: seededIds(dibuat) } } });
  });

  it("mengganti sandi pengguna sesi saja", async () => {
    expect(await changePassword(LAMA, BARU)).toEqual({ success: true });
    expect(await bcrypt.compare(BARU, await hashDari(u))).toBe(true);
    expect(await hashDari(lain)).toBe(hashLain);
  });

  it("tanpa sesi ditolak dan tidak ada yang berubah", async () => {
    sesi.aktif = false;
    expect(await changePassword(LAMA, BARU)).toMatchObject({ success: false });
    expect(await bcrypt.compare(LAMA, await hashDari(u))).toBe(true);
  });

  it("sandi saat ini salah ditolak", async () => {
    expect(await changePassword("bukan-sandinya", BARU)).toEqual({ success: false, messageKey: "currentPasswordIncorrect" });
    expect(await bcrypt.compare(LAMA, await hashDari(u))).toBe(true);
  });

  it("tebakan serentak tidak menembus batas lima, lalu sandi benar pun ditolak selama terkunci", async () => {
    const hasil = await Promise.all(Array.from({ length: 8 }, (_, i) => changePassword(`tebakan-${i}`, BARU)));
    const salah = hasil.filter((h) => !h.success && h.messageKey === "currentPasswordIncorrect").length;
    const terkunci = hasil.filter((h) => !h.success && h.messageKey === "tooManyAttempts").length;
    expect(salah).toBeLessThanOrEqual(5);
    expect(salah + terkunci).toBe(8);
    expect(await changePassword(LAMA, BARU)).toEqual({ success: false, messageKey: "tooManyAttempts" });
    expect(await bcrypt.compare(LAMA, await hashDari(u))).toBe(true);
  });

  it("kuncian lepas setelah 15 menit dan hanya mengunci pengguna itu", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-04T03:00:00Z"));
    for (let i = 0; i < 5; i++) await changePassword(`tebakan-${i}`, BARU);
    expect(await changePassword(LAMA, BARU)).toEqual({ success: false, messageKey: "tooManyAttempts" });

    sesi.id = lain;
    expect(await changePassword("sandi-orang-lain", BARU)).toEqual({ success: true });

    sesi.id = u;
    vi.setSystemTime(new Date("2026-10-04T03:15:01Z"));
    expect(await changePassword(LAMA, BARU)).toEqual({ success: true });
    expect(await bcrypt.compare(BARU, await hashDari(u))).toBe(true);
  });
});
