import { describe, it, expect, vi, beforeEach } from "vitest";

/*
 * /login/redirect untuk sesi yang sudah tidak sah.
 *
 * Callback `jwt` (lib/auth/segarkan-sesi.ts) membuat sesi akun yang dihapus
 * menjadi null, tetapi `auth()` di rute ini TIDAK menghapus cookie-nya. proxy.ts
 * membaca cookie itu langsung (getToken) dan mengirim /login → /login/redirect,
 * yang dulu mengirim balik ke /login: putaran alihan tanpa akhir. Rute ini
 * karena itu menghapus cookie sesi sebelum mengirim ke /login.
 */
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { auth } from "@/lib/auth";
import { GET } from "./route";

const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;
const minta = (cookie?: string, q = "") =>
  new Request(`http://localhost/login/redirect${q}`, { headers: cookie ? { cookie } : {} });

beforeEach(() => {
  mockAuth.mockReset();
});

describe("GET /login/redirect", () => {
  it("sesi sah: diarahkan ke area pengguna, cookie tidak disentuh", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["pwa:access"] } });
    const r = await GET(minta("authjs.session-token=abc"));
    expect(r.status).toBe(307);
    expect(r.headers.get("location")).toBe("/pwa");
    expect(r.headers.getSetCookie()).toEqual([]);
  });

  it("sesi tidak sah (akun dihapus) tetapi cookie masih ada: cookie dihapus, lalu ke /login — tidak berputar", async () => {
    mockAuth.mockResolvedValue(null);
    const r = await GET(minta("authjs.session-token=abc; tema=gelap; __Secure-authjs.session-token.0=x; __Secure-authjs.session-token.1=y"));
    expect(r.status).toBe(307);
    expect(r.headers.get("location")).toBe("/login");
    const hapus = r.headers.getSetCookie();
    expect(hapus.map((c) => c.split("=")[0]).sort()).toEqual([
      "__Secure-authjs.session-token.0",
      "__Secure-authjs.session-token.1",
      "authjs.session-token",
    ]);
    for (const c of hapus) {
      expect(c).toMatch(/Max-Age=0/);
      expect(c).toMatch(/Path=\//);
    }
    // Cookie berawalan __Secure- hanya diterima peramban bila ditulis dengan Secure.
    for (const c of hapus.filter((x) => x.startsWith("__Secure-"))) expect(c).toMatch(/; Secure/);
    // Cookie lain milik aplikasi tidak ikut dihapus.
    expect(hapus.some((c) => c.startsWith("tema="))).toBe(false);
  });

  it("tanpa sesi dan tanpa cookie: langsung ke /login tanpa Set-Cookie", async () => {
    mockAuth.mockResolvedValue(null);
    const r = await GET(minta());
    expect(r.headers.get("location")).toBe("/login");
    expect(r.headers.getSetCookie()).toEqual([]);
  });
});
