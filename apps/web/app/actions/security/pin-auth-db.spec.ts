import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import { prisma, seededId, seededIds } from "@elorae/db";

/**
 * Aksi PIN terhadap basis data sungguhan (sesi ditiru).
 *
 * Yang dibuktikan: setiap aksi memakai pengguna SESI, bukan id yang dikirim
 * pemanggil; fallback email hanya untuk email sesi sendiri; batas tiga PIN
 * salah tidak bisa ditembus dengan permintaan serentak (termasuk lewat
 * "PIN saat ini" di formulir ganti PIN); daftar pengguna dan reset PIN orang
 * lain butuh `settings_security:manage`; admin bukan-sistem tidak bisa mereset
 * PIN akun sistem; dan tidak ada yang bisa mereset PIN-nya sendiri lewat jalur
 * admin (itu melompati syarat PIN lama).
 */

const sesi = vi.hoisted(() => ({ aktif: true, id: "", email: "" as string | null, permissions: [] as string[] }));
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => (sesi.aktif ? { user: { id: sesi.id, email: sesi.email, permissions: sesi.permissions } } : null)),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { verifyPinForAction, setupPin, getPinAttempts, getLastSensitiveAccess, getUsersForAdmin, adminForcePinReset } =
  await import("./pin-auth");

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

const tag = `PIN-${Math.random().toString(36).slice(2, 8)}`;
const PIN_A = "1234";
const PIN_B = "5678";
const PIN_S = "9999";

d("aksi PIN (test bed only)", () => {
  let peranBiasa = "";
  let peranSistem = "";
  let peranSistemDibuat = false;
  let a = "";
  let b = "";
  let sistem = "";
  let sistem2 = "";
  const emailA = `${tag}-a@uji.local`;
  const hash: Record<string, string> = {};

  const semua = () => seededIds([a, b, sistem, sistem2].filter(Boolean));
  const masukSebagai = (id: string, permissions: string[], email: string | null = null) => {
    sesi.aktif = true;
    sesi.id = id;
    sesi.email = email;
    sesi.permissions = permissions;
  };
  const pinHashDari = async (id: string) =>
    (await prisma.user.findUnique({ where: { id: seededId(id) }, select: { pinHash: true } }))?.pinHash ?? null;

  beforeAll(async () => {
    peranBiasa = "";
    peranSistem = "";
    a = "";
    b = "";
    sistem = "";
    sistem2 = "";
    hash.a = await bcrypt.hash(PIN_A, 4);
    hash.b = await bcrypt.hash(PIN_B, 4);
    hash.s = await bcrypt.hash(PIN_S, 4);
    peranBiasa = (await prisma.roleDefinition.create({ data: { name: `${tag}-BIASA`, isSystem: false } })).id;
    const ada = await prisma.roleDefinition.findFirst({ where: { isSystem: true }, select: { id: true } });
    if (ada) {
      peranSistem = ada.id;
    } else {
      peranSistem = (await prisma.roleDefinition.create({ data: { name: `${tag}-SISTEM`, isSystem: true } })).id;
      peranSistemDibuat = true;
    }
    a = (await prisma.user.create({ data: { email: emailA, name: `${tag} A`, roleId: peranBiasa } })).id;
    b = (await prisma.user.create({ data: { email: `${tag}-b@uji.local`, name: `${tag} B`, roleId: peranBiasa } })).id;
    sistem = (await prisma.user.create({ data: { email: `${tag}-s@uji.local`, name: `${tag} S`, roleId: peranSistem } })).id;
    sistem2 = (await prisma.user.create({ data: { email: `${tag}-s2@uji.local`, name: `${tag} S2`, roleId: peranSistem } })).id;
  });

  beforeEach(async () => {
    await prisma.pinAttempt.deleteMany({ where: { userId: { in: semua() } } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: semua() } } });
    await prisma.user.update({ where: { id: seededId(a) }, data: { pinHash: hash.a } });
    await prisma.user.update({ where: { id: seededId(b) }, data: { pinHash: hash.b, roleId: peranBiasa } });
    await prisma.user.update({ where: { id: seededId(sistem) }, data: { pinHash: hash.s } });
    await prisma.user.update({ where: { id: seededId(sistem2) }, data: { pinHash: hash.s } });
    masukSebagai(a, [], emailA);
  });

  afterAll(async () => {
    await prisma.pinAttempt.deleteMany({ where: { userId: { in: semua() } } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: semua() } } });
    await prisma.user.deleteMany({ where: { id: { in: semua() } } });
    await prisma.roleDefinition.deleteMany({ where: { id: seededId(peranBiasa) } });
    if (peranSistemDibuat) await prisma.roleDefinition.deleteMany({ where: { id: seededId(peranSistem) } });
  });

  describe("verifyPinForAction", () => {
    it("memeriksa PIN pengguna SESI, bukan id yang dikirim pemanggil", async () => {
      // Id B + PIN B dari sesi A: dulu lolos sebagai B.
      expect(await verifyPinForAction(b, PIN_B, "VIEW_BANK_ACCOUNT")).toMatchObject({ success: false, messageKey: "pinIncorrect" });
      expect(await verifyPinForAction(b, PIN_A, "VIEW_BANK_ACCOUNT")).toEqual({ success: true, messageKey: "ok", userId: a });
      expect(await prisma.pinAttempt.count({ where: { userId: seededId(b) } })).toBe(0);
      expect(await prisma.pinAttempt.count({ where: { userId: seededId(a) } })).toBe(2);
    });

    it("tanpa sesi ditolak tanpa mencatat apa pun", async () => {
      sesi.aktif = false;
      expect(await verifyPinForAction(b, PIN_B, "VIEW_BANK_ACCOUNT")).toMatchObject({ success: false });
      expect(await prisma.pinAttempt.count({ where: { userId: { in: semua() } } })).toBe(0);
    });

    it("fallback email hanya untuk email sesi sendiri, tidak pernah email kiriman pemanggil", async () => {
      // Sesi basi: id-nya tidak ada di basis data.
      masukSebagai(`${tag}-basi`, [], emailA);
      expect(await verifyPinForAction(b, PIN_B, "STOCK_ADJUSTMENT", undefined, undefined, `${tag}-b@uji.local`)).toMatchObject({
        success: false,
      });
      expect(await prisma.pinAttempt.count({ where: { userId: seededId(b) } })).toBe(0);
      expect(await verifyPinForAction(b, PIN_A, "STOCK_ADJUSTMENT", undefined, undefined, emailA.toUpperCase())).toEqual({
        success: true,
        messageKey: "ok",
        userId: a,
      });
    });

    it("batas tiga PIN salah tidak tertembus oleh permintaan serentak", async () => {
      // Beberapa gelombang serentak: jumlah tebakan yang benar-benar dicocokkan
      // dalam satu jendela tidak pernah lebih dari tiga. Gelombang yang semuanya
      // melihat lebih dari tiga baris ditolak seluruhnya tanpa satu pun dicocokkan.
      let salah = 0;
      for (let gelombang = 0; gelombang < 4 && salah < 3; gelombang++) {
        const hasil = await Promise.all(
          Array.from({ length: 8 }, (_, i) => verifyPinForAction(a, `00${gelombang}${i}`, "VIEW_BANK_ACCOUNT")),
        );
        const salahKini = hasil.filter((h) => h.messageKey === "pinIncorrect").length;
        expect(salahKini + hasil.filter((h) => h.messageKey === "tooManyAttempts").length).toBe(8);
        salah += salahKini;
        expect(salah).toBeLessThanOrEqual(3);
        // Percobaan yang ditolak karena terkunci tidak dicatat (tidak memperpanjang kuncian).
        expect(await prisma.pinAttempt.count({ where: { userId: seededId(a), success: false } })).toBe(salah);
      }
      for (let i = salah; i < 3; i++) await verifyPinForAction(a, "0000", "VIEW_BANK_ACCOUNT");
      expect(await verifyPinForAction(a, PIN_A, "VIEW_BANK_ACCOUNT")).toMatchObject({ success: false, messageKey: "tooManyAttempts" });
    });

    it("argumen kiriman klien yang tidak masuk akal ditolak tanpa mencatat dan tanpa melempar", async () => {
      // Aksi bebas akan menulis baris sampah ke riwayat; PIN bukan string membuat bcrypt melempar
      // setelah baris gagal tercatat.
      expect(await verifyPinForAction(a, PIN_A, "BUKAN_AKSI")).toMatchObject({ success: false, messageKey: "pinInvalid" });
      expect(await verifyPinForAction(a, 1234 as unknown as string, "VIEW_BANK_ACCOUNT")).toMatchObject({
        success: false,
        messageKey: "pinInvalid",
      });
      expect(await prisma.pinAttempt.count({ where: { userId: seededId(a) } })).toBe(0);
      expect(await setupPin(["4321"] as unknown as string, PIN_A)).toMatchObject({ success: false, messageKey: "pinFormatError" });
      expect(await setupPin("4321", 1234 as unknown as string)).toMatchObject({ success: false, messageKey: "enterCurrentPin" });
      expect(await pinHashDari(a)).toBe(hash.a);
      expect(await prisma.pinAttempt.count({ where: { userId: seededId(a) } })).toBe(0);
    });

    it("tiga salah berurutan mengunci, dan PIN benar tercatat berhasil", async () => {
      expect(await verifyPinForAction(a, PIN_A, "VOID_DOCUMENT")).toMatchObject({ success: true });
      expect(await prisma.pinAttempt.count({ where: { userId: seededId(a), success: true } })).toBe(1);
      for (let i = 0; i < 3; i++) {
        expect(await verifyPinForAction(a, "0000", "VOID_DOCUMENT")).toMatchObject({ messageKey: "pinIncorrect" });
      }
      expect(await verifyPinForAction(a, PIN_A, "VOID_DOCUMENT")).toMatchObject({ messageKey: "tooManyAttempts" });
    });
  });

  describe("setupPin", () => {
    it("hanya mengubah PIN pengguna sesi, dan PIN lama wajib bila sudah ada", async () => {
      expect(await setupPin("4321")).toMatchObject({ success: false, messageKey: "enterCurrentPin" });
      expect(await setupPin("4321", PIN_B)).toMatchObject({ success: false, messageKey: "currentPinIncorrect" });
      expect(await setupPin("4321", PIN_A)).toEqual({ success: true, messageKey: "pinSaved" });
      expect(await bcrypt.compare("4321", (await pinHashDari(a)) ?? "")).toBe(true);
      expect(await pinHashDari(b)).toBe(hash.b);
    });

    it("tebakan PIN lama ikut batas tiga salah", async () => {
      for (let i = 0; i < 3; i++) {
        expect(await setupPin("4321", `000${i}`)).toMatchObject({ messageKey: "currentPinIncorrect" });
      }
      expect(await setupPin("4321", PIN_A)).toMatchObject({ success: false, messageKey: "tooManyAttempts" });
      expect(await pinHashDari(a)).toBe(hash.a);
    });

    it("pengguna tanpa PIN boleh membuatnya tanpa PIN lama; tanpa sesi ditolak", async () => {
      await prisma.user.update({ where: { id: seededId(b) }, data: { pinHash: null } });
      masukSebagai(b, []);
      expect(await setupPin("2468")).toEqual({ success: true, messageKey: "pinSaved" });
      expect(await bcrypt.compare("2468", (await pinHashDari(b)) ?? "")).toBe(true);
      sesi.aktif = false;
      expect(await setupPin("1357")).toMatchObject({ success: false });
      expect(await bcrypt.compare("2468", (await pinHashDari(b)) ?? "")).toBe(true);
    });
  });

  describe("riwayat", () => {
    it("getPinAttempts dan getLastSensitiveAccess hanya milik pengguna sesi", async () => {
      masukSebagai(b, []);
      await verifyPinForAction(b, PIN_B, "DELETE_SUPPLIER");
      masukSebagai(a, []);
      await verifyPinForAction(a, PIN_A, "VIEW_BANK_ACCOUNT");
      const percobaan = await getPinAttempts();
      expect(percobaan.map((p) => p.action)).toEqual(["VIEW_BANK_ACCOUNT"]);
      expect((await getLastSensitiveAccess()).map((p) => p.action)).toEqual(["VIEW_BANK_ACCOUNT"]);
      sesi.aktif = false;
      expect(await getPinAttempts()).toEqual([]);
      expect(await getLastSensitiveAccess()).toEqual([]);
    });
  });

  describe("fungsi admin", () => {
    it("getUsersForAdmin butuh settings_security:manage", async () => {
      masukSebagai(a, ["settings_security:view"]);
      expect(await getUsersForAdmin()).toEqual([]);
      masukSebagai(a, ["settings_security:manage"]);
      expect((await getUsersForAdmin()).map((u) => u.id)).toEqual(expect.arrayContaining([a, b]));
      masukSebagai(sistem, ["*"]);
      expect((await getUsersForAdmin()).map((u) => u.id)).toContain(b);
    });

    it("adminForcePinReset tanpa izin ditolak", async () => {
      masukSebagai(a, ["settings_security:view"]);
      expect(await adminForcePinReset(b)).toMatchObject({ success: false, messageKey: "adminOnlyReset" });
      expect(await pinHashDari(b)).toBe(hash.b);
    });

    it("admin bukan-sistem tidak bisa mereset PIN akun sistem — juga bila sesinya masih membawa '*' lama", async () => {
      masukSebagai(a, ["settings_security:manage"]);
      expect(await adminForcePinReset(sistem)).toMatchObject({ success: false, messageKey: "systemAccountPinReset" });
      masukSebagai(a, ["*"]);
      expect(await adminForcePinReset(sistem)).toMatchObject({ success: false, messageKey: "systemAccountPinReset" });
      expect(await pinHashDari(sistem)).toBe(hash.s);
    });

    it("balapan: akun yang sedang diangkat menjadi admin sistem tidak bisa direset admin bukan-sistem", async () => {
      // Pengangkatan B ditahan di transaksi yang belum di-commit, sementara admin bukan-sistem
      // mereset PIN B. Pemeriksaan yang dibaca sebelum commit melihat B masih akun biasa; tanpa
      // pemeriksaan ulang di dalam transaksi serializable, PIN admin baru itu terhapus.
      masukSebagai(a, ["settings_security:manage"]);
      let reset: ReturnType<typeof adminForcePinReset> | null = null;
      await prisma.$transaction(
        async (tx) => {
          await tx.user.update({ where: { id: seededId(b) }, data: { roleId: peranSistem } });
          reset = adminForcePinReset(b);
          await new Promise((r) => setTimeout(r, 400));
        },
        { timeout: 10_000 },
      );
      expect(await reset).toMatchObject({ success: false, messageKey: "systemAccountPinReset" });
      expect(await pinHashDari(b)).toBe(hash.b);
      expect(await prisma.auditLog.count({ where: { userId: seededId(a), action: "USER_PIN_RESET" } })).toBe(0);
    });

    it("tidak ada yang mereset PIN-nya sendiri lewat jalur admin", async () => {
      masukSebagai(a, ["settings_security:manage"]);
      expect(await adminForcePinReset(a)).toMatchObject({ success: false, messageKey: "ownPinReset" });
      masukSebagai(sistem, ["*"]);
      expect(await adminForcePinReset(sistem)).toMatchObject({ success: false, messageKey: "ownPinReset" });
      expect(await pinHashDari(a)).toBe(hash.a);
      expect(await pinHashDari(sistem)).toBe(hash.s);
    });

    it("admin sah mereset PIN orang lain, dengan jejak audit; target tak dikenal ditolak", async () => {
      masukSebagai(a, ["settings_security:manage"]);
      expect(await adminForcePinReset(b)).toEqual({ success: true, messageKey: "userPinReset" });
      expect(await pinHashDari(b)).toBeNull();
      const jejak = await prisma.auditLog.findMany({ where: { userId: seededId(a), action: "USER_PIN_RESET" } });
      expect(jejak.map((j) => j.entityId)).toEqual([b]);

      masukSebagai(sistem, ["*"]);
      expect(await adminForcePinReset(sistem2)).toEqual({ success: true, messageKey: "userPinReset" });
      expect(await pinHashDari(sistem2)).toBeNull();
      expect(await adminForcePinReset(`${tag}-tidak-ada`)).toMatchObject({ success: false, messageKey: "userNotFound" });
    });
  });
});
