import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Batas tebakan sandi di `authorize` (lib/auth.ts).
 *
 * Dulu kegagalan dicatat SESUDAH pencarian pengguna dan bcrypt, sedangkan
 * kunciannya diperiksa SEBELUM keduanya. Permintaan serentak semuanya melihat
 * nol gagal dan semuanya ikut menebak — batas lima per email tidak berlaku bagi
 * penebak yang mengirim paralel. Polanya sekarang meniru `cobaPin`
 * (app/actions/security/pin-auth.ts): satu percobaan dicatat dulu sebagai
 * gagal, baru dicocokkan.
 *
 * NextAuth, Prisma, dan bcrypt ditiru; `authorize` diambil dari konfigurasi
 * yang diserahkan ke NextAuth. Pencatat batasnya yang asli (satu per proses),
 * jadi setiap tes memakai email sendiri.
 */

const tangkap = vi.hoisted(() => ({ konfigurasi: null as null | { providers: Array<{ authorize: (c: unknown) => Promise<unknown> }> } }));

vi.mock("next-auth", () => ({
  default: (konfigurasi: typeof tangkap.konfigurasi) => {
    tangkap.konfigurasi = konfigurasi;
    return { handlers: { GET: vi.fn(), POST: vi.fn() }, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() };
  },
  CredentialsSignin: class CredentialsSignin extends Error {
    code = "credentials";
  },
}));
vi.mock("next-auth/providers/credentials", () => ({ default: (opsi: unknown) => opsi }));
vi.mock("@auth/prisma-adapter", () => ({ PrismaAdapter: () => ({}) }));

const tunda = (ms: number) => new Promise((r) => setTimeout(r, ms));

const db = vi.hoisted(() => ({ prisma: { user: { findUnique: vi.fn() } }, Role: {} }));
vi.mock("@elorae/db", () => db);

const sandi = vi.hoisted(() => ({ compare: vi.fn(), hash: vi.fn() }));
vi.mock("bcryptjs", () => ({ default: sandi }));

await import("./auth");
const { TooManyAttemptsSignin, ServerUnavailableSignin } = await import("./auth/login-errors");
const authorize = (email: string, password: string) => tangkap.konfigurasi!.providers[0].authorize({ email, password });

const BENAR = "sandi-benar-123";

function penggunaUntuk(email: string) {
  return {
    id: `u-${email}`,
    email,
    name: "Penguji",
    role: "STAFF",
    passwordHash: "hash",
    roleDefinition: { id: "peran-1", name: "Staf", isSystem: false, permissions: [{ permission: { code: "items:view" } }] },
  };
}

let nomor = 0;
const emailBaru = () => `tebak-${Date.now()}-${nomor++}@uji.local`;

beforeEach(() => {
  vi.clearAllMocks();
  // Latensi sungguhan: pencarian dan bcrypt sama-sama menunggu.
  db.prisma.user.findUnique.mockImplementation(async ({ where }: { where: { email: string } }) => {
    await tunda(5);
    return where.email.startsWith("tak-ada-") ? null : penggunaUntuk(where.email);
  });
  sandi.compare.mockImplementation(async (pw: string) => {
    await tunda(20);
    return pw === BENAR;
  });
});

describe("authorize — batas tebakan sandi", () => {
  it("delapan tebakan serentak: hanya lima yang sampai ke bcrypt, sisanya ditolak terkunci", async () => {
    const email = emailBaru();
    const hasil = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => authorize(email, `salah-${i}`)));
    expect(sandi.compare).toHaveBeenCalledTimes(5);
    expect(hasil.filter((h) => h.status === "fulfilled" && h.value === null)).toHaveLength(5);
    const ditolak = hasil.filter((h): h is PromiseRejectedResult => h.status === "rejected");
    expect(ditolak).toHaveLength(3);
    for (const h of ditolak) expect(h.reason).toBeInstanceOf(TooManyAttemptsSignin);
  });

  it("email yang tidak terdaftar juga dibatasi saat serentak (tanpa beda respons)", async () => {
    const email = `tak-ada-${emailBaru()}`;
    const hasil = await Promise.allSettled(Array.from({ length: 8 }, () => authorize(email, "apa-saja")));
    expect(hasil.filter((h) => h.status === "fulfilled" && h.value === null)).toHaveLength(5);
    expect(hasil.filter((h) => h.status === "rejected")).toHaveLength(3);
    expect(sandi.compare).not.toHaveBeenCalled();
  });

  it("berurutan: lima salah lalu sandi benar pun ditolak selama terkunci", async () => {
    const email = emailBaru();
    for (let i = 0; i < 5; i++) await expect(authorize(email, `salah-${i}`)).resolves.toBeNull();
    await expect(authorize(email, BENAR)).rejects.toBeInstanceOf(TooManyAttemptsSignin);
    expect(sandi.compare).toHaveBeenCalledTimes(5);
  });

  it("sandi benar mengembalikan pengguna dan menghapus catatan gagalnya", async () => {
    const email = emailBaru();
    for (let i = 0; i < 4; i++) await authorize(email, `salah-${i}`);
    await expect(authorize(email, BENAR)).resolves.toMatchObject({ id: `u-${email}`, permissions: ["items:view"] });
    // Catatan bersih: lima salah lagi masih boleh dicoba sebelum terkunci.
    for (let i = 0; i < 5; i++) await expect(authorize(email, `salah-lagi-${i}`)).resolves.toBeNull();
    await expect(authorize(email, "salah-keenam")).rejects.toBeInstanceOf(TooManyAttemptsSignin);
  });

  it("basis data mati tidak dihitung sebagai sandi salah", async () => {
    const email = emailBaru();
    db.prisma.user.findUnique.mockRejectedValue(new Error("pool timeout"));
    for (let i = 0; i < 6; i++) await expect(authorize(email, BENAR)).rejects.toBeInstanceOf(ServerUnavailableSignin);
    db.prisma.user.findUnique.mockImplementation(async ({ where }: { where: { email: string } }) => penggunaUntuk(where.email));
    await expect(authorize(email, BENAR)).resolves.toMatchObject({ id: `u-${email}` });
  });

  it("email beda huruf besar dihitung sebagai email yang sama", async () => {
    const email = emailBaru();
    await Promise.allSettled(Array.from({ length: 5 }, (_, i) => authorize(i % 2 ? email.toUpperCase() : email, "salah")));
    await expect(authorize(` ${email.toUpperCase()} `, BENAR)).rejects.toBeInstanceOf(TooManyAttemptsSignin);
  });
});
