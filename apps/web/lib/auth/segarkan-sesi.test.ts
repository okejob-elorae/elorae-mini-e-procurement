import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Callback `jwt` di lib/auth.ts — isi sesi dibaca ulang dari basis data.
 *
 * Dulu peran dan izin hanya dibaca saat masuk: mencabut izin seseorang (atau
 * menghapus akunnya) baru berlaku saat JWT-nya kedaluwarsa, hingga 8 jam.
 * Sekarang token yang lebih tua dari `UMUR_SEGAR_SESI_MS` dibaca ulang pada
 * pemakaian berikutnya; pengguna yang sudah tidak ada → sesi tidak sah.
 *
 * NextAuth dan Prisma ditiru; callback diambil dari konfigurasi yang
 * diserahkan ke NextAuth (pola lib/auth.test.ts).
 */

type Token = Record<string, unknown>;
type Konfigurasi = {
  callbacks: {
    jwt: (a: { token: Token; user?: unknown; trigger?: string }) => Promise<Token | null>;
    session: (a: { session: { user: Record<string, unknown> }; token: Token }) => Promise<{ user: Record<string, unknown> }>;
  };
};

const tangkap = vi.hoisted(() => ({ konfigurasi: null as null | Konfigurasi }));

vi.mock("next-auth", () => ({
  default: (konfigurasi: Konfigurasi) => {
    tangkap.konfigurasi = konfigurasi;
    return { handlers: { GET: vi.fn(), POST: vi.fn() }, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() };
  },
  CredentialsSignin: class CredentialsSignin extends Error {
    code = "credentials";
  },
}));
vi.mock("next-auth/providers/credentials", () => ({ default: (opsi: unknown) => opsi }));
vi.mock("@auth/prisma-adapter", () => ({ PrismaAdapter: () => ({}) }));

const db = vi.hoisted(() => ({ prisma: { user: { findUnique: vi.fn() } }, Role: {} }));
vi.mock("@elorae/db", () => db);
vi.mock("bcryptjs", () => ({ default: { compare: vi.fn(), hash: vi.fn() } }));

await import("../auth");
const { UMUR_SEGAR_SESI_MS, lupakanSinggahanSesi } = await import("./segarkan-sesi");
const jwt = (a: { token: Token; user?: unknown; trigger?: string }) => tangkap.konfigurasi!.callbacks.jwt(a);
const session = (token: Token) => tangkap.konfigurasi!.callbacks.session({ session: { user: {} }, token });

const T0 = new Date("2026-10-06T03:00:00Z").getTime();

function penggunaDb(o: { izin?: string[]; sistem?: boolean; toko?: string | null; versi?: number; namaPeran?: string; peran?: string } = {}) {
  return {
    id: "u1",
    role: o.peran ?? "USER",
    assignedStoreId: o.toko ?? null,
    roleDefinition: {
      id: "peran-1",
      name: o.namaPeran ?? "Salesman",
      isSystem: o.sistem ?? false,
      permissionsVersion: o.versi ?? 1,
      permissions: (o.izin ?? ["pwa:access", "stores:view"]).map((code) => ({ permission: { code } })),
    },
  };
}

/** Token persis seperti sesudah masuk pada T0. */
async function tokenMasuk(): Promise<Token> {
  vi.setSystemTime(T0);
  const t = await jwt({
    token: { sub: "u1" },
    trigger: "signIn",
    user: {
      id: "u1",
      email: "s@uji.local",
      name: "Sales",
      role: "USER",
      roleId: "peran-1",
      roleName: "Salesman",
      permissions: ["pwa:access", "stores:view"],
      permissionsVersion: 1,
      assignedStoreId: null,
    },
  });
  return t!;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  db.prisma.user.findUnique.mockReset();
  lupakanSinggahanSesi();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("jwt — isi sesi dibaca ulang dari basis data", () => {
  it("masuk: token membawa peran, izin, toko tetap, dan cap waktu — tanpa kueri tambahan", async () => {
    const t = await tokenMasuk();
    expect(t).toMatchObject({ id: "u1", roleName: "Salesman", permissions: ["pwa:access", "stores:view"], assignedStoreId: null, disegarkanPada: T0 });
    expect(db.prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("dalam 60 detik: tidak ada kueri, token dipakai apa adanya", async () => {
    const t = await tokenMasuk();
    vi.setSystemTime(T0 + UMUR_SEGAR_SESI_MS - 1);
    const lagi = await jwt({ token: { ...t } });
    expect(lagi).toMatchObject({ permissions: ["pwa:access", "stores:view"], disegarkanPada: T0 });
    expect(db.prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("izin dicabut: token berikutnya sesudah 60 detik tidak membawanya lagi", async () => {
    const t = await tokenMasuk();
    db.prisma.user.findUnique.mockResolvedValue(penggunaDb({ izin: ["pwa:access"], versi: 2 }));
    vi.setSystemTime(T0 + UMUR_SEGAR_SESI_MS + 1);
    const lagi = await jwt({ token: { ...t } });
    expect(lagi!.permissions).toEqual(["pwa:access"]);
    expect(lagi).toMatchObject({ permissionsVersion: 2, disegarkanPada: T0 + UMUR_SEGAR_SESI_MS + 1 });
    expect(db.prisma.user.findUnique).toHaveBeenCalledTimes(1);
    expect(db.prisma.user.findUnique.mock.calls[0][0]).toMatchObject({ where: { id: "u1" } });
    // Dan sesi yang dilihat aplikasi ikut berubah.
    expect((await session(lagi!)).user.permissions).toEqual(["pwa:access"]);
  });

  it("peran, nama peran, dan toko tetap ikut disegarkan", async () => {
    const t = await tokenMasuk();
    db.prisma.user.findUnique.mockResolvedValue(penggunaDb({ izin: ["pwa:access", "spg_sales:record"], namaPeran: "SPG", toko: "toko-9", peran: "STAFF" }));
    vi.setSystemTime(T0 + 2 * UMUR_SEGAR_SESI_MS);
    const lagi = await jwt({ token: { ...t } });
    expect(lagi).toMatchObject({ role: "STAFF", roleId: "peran-1", roleName: "SPG", assignedStoreId: "toko-9" });
    expect((await session(lagi!)).user).toMatchObject({ roleName: "SPG", assignedStoreId: "toko-9" });
  });

  it("peran sistem mendapat wildcard; tanpa peran mendapat nol izin", async () => {
    const t = await tokenMasuk();
    db.prisma.user.findUnique.mockResolvedValue(penggunaDb({ sistem: true, namaPeran: "ADMIN" }));
    vi.setSystemTime(T0 + 2 * UMUR_SEGAR_SESI_MS);
    expect((await jwt({ token: { ...t } }))!.permissions).toEqual(["*"]);

    lupakanSinggahanSesi();
    db.prisma.user.findUnique.mockResolvedValue({ ...penggunaDb(), roleDefinition: null, role: "USER" });
    vi.setSystemTime(T0 + 4 * UMUR_SEGAR_SESI_MS);
    const tanpaPeran = await jwt({ token: { ...t } });
    expect(tanpaPeran).toMatchObject({ permissions: [], roleId: null, roleName: "USER" });
  });

  it("akun yang sudah dihapus: sesi tidak sah (callback mengembalikan null)", async () => {
    const t = await tokenMasuk();
    db.prisma.user.findUnique.mockResolvedValue(null);
    vi.setSystemTime(T0 + UMUR_SEGAR_SESI_MS + 1);
    expect(await jwt({ token: { ...t } })).toBeNull();
  });

  it("basis data mati: token lama tetap berlaku (tidak mengeluarkan semua orang), dicoba lagi berikutnya", async () => {
    const t = await tokenMasuk();
    const galat = vi.spyOn(console, "error").mockImplementation(() => {});
    db.prisma.user.findUnique.mockRejectedValueOnce(new Error("pool timeout"));
    vi.setSystemTime(T0 + UMUR_SEGAR_SESI_MS + 1);
    const lagi = await jwt({ token: { ...t } });
    expect(lagi).toMatchObject({ permissions: ["pwa:access", "stores:view"], disegarkanPada: T0 });
    db.prisma.user.findUnique.mockResolvedValue(penggunaDb({ izin: [] }));
    expect((await jwt({ token: { ...lagi! } }))!.permissions).toEqual([]);
    galat.mockRestore();
  });

  it("token lama dari sebelum pembaruan ini (tanpa cap waktu) langsung dibaca ulang", async () => {
    db.prisma.user.findUnique.mockResolvedValue(penggunaDb({ izin: ["pwa:access"] }));
    const lagi = await jwt({ token: { id: "u1", role: "USER", roleId: "peran-1", roleName: "Salesman", permissions: ["*"] } });
    expect(lagi!.permissions).toEqual(["pwa:access"]);
    expect(db.prisma.user.findUnique).toHaveBeenCalledTimes(1);
  });

  it("satu orang, banyak token basi dalam satu menit (RSC tidak menulis ulang cookie): satu kueri per menit per proses", async () => {
    const t = await tokenMasuk();
    db.prisma.user.findUnique.mockResolvedValue(penggunaDb({ izin: ["pwa:access"] }));
    vi.setSystemTime(T0 + UMUR_SEGAR_SESI_MS + 1);
    await jwt({ token: { ...t } });
    vi.setSystemTime(T0 + UMUR_SEGAR_SESI_MS + 30_000);
    const kedua = await jwt({ token: { ...t } });
    expect(kedua!.permissions).toEqual(["pwa:access"]);
    expect(db.prisma.user.findUnique).toHaveBeenCalledTimes(1);
    vi.setSystemTime(T0 + 2 * UMUR_SEGAR_SESI_MS + 2);
    await jwt({ token: { ...t } });
    expect(db.prisma.user.findUnique).toHaveBeenCalledTimes(2);
  });

  it("trigger update (halaman peran): selalu dibaca ulang, walau token masih segar", async () => {
    const t = await tokenMasuk();
    db.prisma.user.findUnique.mockResolvedValue(penggunaDb({ izin: ["pwa:access", "stores:manage"], versi: 3 }));
    vi.setSystemTime(T0 + 1000);
    const lagi = await jwt({ token: { ...t }, trigger: "update" });
    expect(lagi).toMatchObject({ permissions: ["pwa:access", "stores:manage"], permissionsVersion: 3 });
    expect(db.prisma.user.findUnique).toHaveBeenCalledTimes(1);
  });
});
