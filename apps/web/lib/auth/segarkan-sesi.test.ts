import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

/*
 * Callback `jwt` di lib/auth.ts — isi sesi dibaca ulang dari basis data.
 *
 * Dulu peran dan izin hanya dibaca saat masuk: mencabut izin seseorang (atau
 * menghapus akunnya) baru berlaku saat JWT-nya kedaluwarsa, hingga 8 jam.
 * Sekarang dua lapis:
 *  - setiap pemakaian token menjalankan satu kueri ringan (peran, versi izin
 *    peran, sidik sandi, toko tetap). Akun hilang atau sandi diganti → penanda
 *    `sessionInvalid`; peran, versi izin, atau toko berubah → isi sesi dibaca
 *    ulang saat itu juga;
 *  - di luar itu isi sesi dibaca ulang paling lambat tiap `UMUR_SEGAR_SESI_MS`
 *    (lib/auth/segarkan-sesi.ts), paling banyak sekali per orang per proses.
 *
 * NextAuth dan Prisma ditiru; callback diambil dari konfigurasi yang
 * diserahkan ke NextAuth (pola lib/auth.test.ts). Kedua kueri memakai
 * `prisma.user.findUnique`; pemeriksaan ringan dikenali dari `select.passwordHash`.
 */

type Token = Record<string, unknown>;
type Konfigurasi = {
  callbacks: {
    jwt: (a: { token: Token; user?: unknown; trigger?: string }) => Promise<Token | null>;
    session: (a: { session: { user: Record<string, unknown> }; token: Token }) => Promise<{ user?: Record<string, unknown> }>;
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
const HASH = "hash-sandi-1";
const sidik = (hash: string) => createHash("sha256").update(hash).digest("hex");
const TIDAK_SAH = { sessionInvalid: true };

type Opsi = {
  izin?: string[];
  sistem?: boolean;
  toko?: string | null;
  versi?: number;
  namaPeran?: string;
  peran?: string;
  hash?: string;
};

/** Satu baris pengguna yang cukup untuk kedua kueri (Prisma hanya mengembalikan kolom yang dipilih; tiruan ini semuanya). */
function penggunaDb(o: Opsi = {}) {
  return {
    id: "u1",
    role: o.peran ?? "USER",
    roleId: "peran-1",
    passwordHash: o.hash ?? HASH,
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

/** Urutan kueri yang terjadi: "periksa" (kueri ringan per pemakaian) atau "isi" (baca ulang isi sesi). */
function kueri(): string[] {
  return db.prisma.user.findUnique.mock.calls.map(([a]) =>
    (a as { select?: Record<string, unknown> }).select?.passwordHash ? "periksa" : "isi",
  );
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
      passwordFingerprint: sidik(HASH),
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

  it("dalam 60 detik tanpa perubahan: hanya kueri ringan, isi sesi tidak dibaca ulang", async () => {
    const t = await tokenMasuk();
    db.prisma.user.findUnique.mockResolvedValue(penggunaDb());
    vi.setSystemTime(T0 + UMUR_SEGAR_SESI_MS - 1);
    const lagi = await jwt({ token: { ...t } });
    expect(lagi).toMatchObject({ permissions: ["pwa:access", "stores:view"], disegarkanPada: T0 });
    expect(kueri()).toEqual(["periksa"]);
    expect(db.prisma.user.findUnique.mock.calls[0][0]).toMatchObject({ where: { id: "u1" } });
  });

  it("izin peran diubah (versinya naik): berlaku saat itu juga, tanpa menunggu 60 detik", async () => {
    const t = await tokenMasuk();
    db.prisma.user.findUnique.mockResolvedValue(penggunaDb({ izin: ["pwa:access"], versi: 2 }));
    vi.setSystemTime(T0 + 1000);
    const lagi = await jwt({ token: { ...t } });
    expect(lagi!.permissions).toEqual(["pwa:access"]);
    expect(lagi).toMatchObject({ permissionsVersion: 2, disegarkanPada: T0 + 1000 });
    expect(kueri()).toEqual(["periksa", "isi"]);
    // Dan sesi yang dilihat aplikasi ikut berubah.
    expect((await session(lagi!)).user!.permissions).toEqual(["pwa:access"]);
  });

  it("izin berubah tanpa versi naik: terbaca paling lambat sesudah 60 detik", async () => {
    const t = await tokenMasuk();
    db.prisma.user.findUnique.mockResolvedValue(penggunaDb({ izin: ["pwa:access"] }));
    vi.setSystemTime(T0 + 1000);
    expect((await jwt({ token: { ...t } }))!.permissions).toEqual(["pwa:access", "stores:view"]);
    vi.setSystemTime(T0 + UMUR_SEGAR_SESI_MS + 1);
    const lagi = await jwt({ token: { ...t } });
    expect(lagi!.permissions).toEqual(["pwa:access"]);
    expect(lagi).toMatchObject({ disegarkanPada: T0 + UMUR_SEGAR_SESI_MS + 1 });
    expect(kueri()).toEqual(["periksa", "periksa", "isi"]);
  });

  it("peran, nama peran, dan toko tetap ikut disegarkan saat itu juga", async () => {
    const t = await tokenMasuk();
    db.prisma.user.findUnique.mockResolvedValue(penggunaDb({ izin: ["pwa:access", "spg_sales:record"], namaPeran: "SPG", toko: "toko-9", peran: "STAFF" }));
    vi.setSystemTime(T0 + 1000);
    const lagi = await jwt({ token: { ...t } });
    expect(lagi).toMatchObject({ role: "STAFF", roleId: "peran-1", roleName: "SPG", assignedStoreId: "toko-9" });
    expect((await session(lagi!)).user).toMatchObject({ roleName: "SPG", assignedStoreId: "toko-9" });
    expect(kueri()).toEqual(["periksa", "isi"]);
  });

  it("peran sistem mendapat wildcard; tanpa peran mendapat nol izin", async () => {
    const t = await tokenMasuk();
    db.prisma.user.findUnique.mockResolvedValue(penggunaDb({ sistem: true, namaPeran: "ADMIN" }));
    vi.setSystemTime(T0 + 2 * UMUR_SEGAR_SESI_MS);
    expect((await jwt({ token: { ...t } }))!.permissions).toEqual(["*"]);

    lupakanSinggahanSesi();
    db.prisma.user.findUnique.mockResolvedValue({ ...penggunaDb(), roleId: null, roleDefinition: null, role: "USER" });
    vi.setSystemTime(T0 + 4 * UMUR_SEGAR_SESI_MS);
    const tanpaPeran = await jwt({ token: { ...t } });
    expect(tanpaPeran).toMatchObject({ permissions: [], roleId: null, roleName: "USER" });
  });

  it("akun yang sudah dihapus: penanda sessionInvalid, sesi tanpa pengguna, dan tidak ada kueri lagi sesudahnya", async () => {
    const t = await tokenMasuk();
    db.prisma.user.findUnique.mockResolvedValue(null);
    vi.setSystemTime(T0 + 1000);
    const hasil = await jwt({ token: { ...t } });
    expect(hasil).toEqual(TIDAK_SAH);
    expect((await session(hasil!)).user).toBeUndefined();
    expect(await jwt({ token: { ...hasil! } })).toEqual(TIDAK_SAH);
    expect(kueri()).toEqual(["periksa"]);
  });

  it("akun hilang di antara kueri ringan dan pembacaan ulang: tetap tidak sah", async () => {
    const t = await tokenMasuk();
    db.prisma.user.findUnique.mockResolvedValueOnce(penggunaDb({ versi: 2 })).mockResolvedValueOnce(null);
    vi.setSystemTime(T0 + 1000);
    expect(await jwt({ token: { ...t } })).toEqual(TIDAK_SAH);
    expect(kueri()).toEqual(["periksa", "isi"]);
  });

  it("sandi diganti di tempat lain: sesi tidak sah", async () => {
    const t = await tokenMasuk();
    db.prisma.user.findUnique.mockResolvedValue(penggunaDb({ hash: "hash-sandi-baru" }));
    vi.setSystemTime(T0 + 1000);
    expect(await jwt({ token: { ...t } })).toEqual(TIDAK_SAH);
  });

  it("basis data mati: token lama tetap berlaku (tidak mengeluarkan semua orang), dicoba lagi berikutnya", async () => {
    const t = await tokenMasuk();
    const galat = vi.spyOn(console, "error").mockImplementation(() => {});
    db.prisma.user.findUnique.mockRejectedValueOnce(new Error("pool timeout"));
    vi.setSystemTime(T0 + UMUR_SEGAR_SESI_MS + 1);
    const lagi = await jwt({ token: { ...t } });
    expect(lagi).toMatchObject({ permissions: ["pwa:access", "stores:view"], disegarkanPada: T0 });

    // Kueri ringan berhasil, pembacaan ulang gagal: sama, token lama dipakai tanpa memajukan cap waktu.
    db.prisma.user.findUnique.mockResolvedValueOnce(penggunaDb()).mockRejectedValueOnce(new Error("pool timeout"));
    const kedua = await jwt({ token: { ...lagi! } });
    expect(kedua).toMatchObject({ permissions: ["pwa:access", "stores:view"], disegarkanPada: T0 });

    db.prisma.user.findUnique.mockResolvedValue(penggunaDb({ izin: [] }));
    expect((await jwt({ token: { ...kedua! } }))!.permissions).toEqual([]);
    galat.mockRestore();
  });

  it("token lama dari sebelum pembaruan ini (tanpa cap waktu, versi, dan sidik sandi) langsung dibaca ulang", async () => {
    db.prisma.user.findUnique.mockResolvedValue(penggunaDb({ izin: ["pwa:access"] }));
    const lagi = await jwt({ token: { id: "u1", role: "USER", roleId: "peran-1", roleName: "Salesman", permissions: ["*"] } });
    expect(lagi!.permissions).toEqual(["pwa:access"]);
    expect(lagi).toMatchObject({ passwordFingerprint: sidik(HASH) });
    expect(kueri()).toEqual(["periksa", "isi"]);
  });

  it("satu orang, banyak token basi dalam satu menit (RSC tidak menulis ulang cookie): isi dibaca ulang sekali per menit per proses", async () => {
    const t = await tokenMasuk();
    db.prisma.user.findUnique.mockResolvedValue(penggunaDb({ izin: ["pwa:access"] }));
    vi.setSystemTime(T0 + UMUR_SEGAR_SESI_MS + 1);
    await jwt({ token: { ...t } });
    vi.setSystemTime(T0 + UMUR_SEGAR_SESI_MS + 30_000);
    const kedua = await jwt({ token: { ...t } });
    expect(kedua!.permissions).toEqual(["pwa:access"]);
    expect(kueri()).toEqual(["periksa", "isi", "periksa"]);
    vi.setSystemTime(T0 + 2 * UMUR_SEGAR_SESI_MS + 2);
    await jwt({ token: { ...t } });
    expect(kueri().filter((k) => k === "isi")).toHaveLength(2);
  });

  it("trigger update (halaman peran): selalu dibaca ulang, walau token masih segar dan tidak ada yang berubah", async () => {
    const t = await tokenMasuk();
    db.prisma.user.findUnique.mockResolvedValue(penggunaDb({ izin: ["pwa:access", "stores:manage"] }));
    vi.setSystemTime(T0 + 1000);
    const lagi = await jwt({ token: { ...t }, trigger: "update" });
    expect(lagi).toMatchObject({ permissions: ["pwa:access", "stores:manage"], permissionsVersion: 1 });
    expect(kueri()).toEqual(["periksa", "isi"]);
  });
});
