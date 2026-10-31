import { beforeEach, describe, expect, it, vi } from "vitest";

/* Gerbang halaman Keuangan → PPh dipotong: `journals:view` melihat, `journals:manage` mengubah. */

const sesi = vi.hoisted(() => ({ ada: true, permissions: [] as string[] }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => (sesi.ada ? { user: { id: "u", permissions: sesi.permissions } } : null)) }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((ke: string) => {
    throw new Error(`REDIRECT:${ke}`);
  }),
}));
const kueri = vi.hoisted(() => ({ masa: [] as string[] }));
vi.mock("@/lib/creative/termin-queries", () => ({
  daftarPphDipotong: vi.fn(async (masa: string) => {
    kueri.masa.push(masa);
    return [];
  }),
}));
vi.mock("./PphDipotongClient", () => ({ PphDipotongClient: () => null }));

const { default: Halaman } = await import("./page");
const buka = (masa?: string) => Halaman({ searchParams: Promise.resolve(masa ? { masa } : {}) });

beforeEach(() => {
  sesi.ada = true;
  kueri.masa = [];
});

describe("halaman PPh dipotong", () => {
  it("tanpa sesi → login; tanpa journals:view (mis. hanya Kreatif) → beranda, kueri tidak jalan", async () => {
    sesi.ada = false;
    await expect(buka()).rejects.toThrow("REDIRECT:/login");
    sesi.ada = true;
    sesi.permissions = ["creative:view", "creative:manage"];
    await expect(buka()).rejects.toThrow("REDIRECT:/backoffice");
    expect(kueri.masa).toHaveLength(0);
  });

  it("pembaca jurnal melihat; mengubah hanya untuk journals:manage; masa rusak jatuh ke bulan ini", async () => {
    sesi.permissions = ["journals:view"];
    const el = (await buka("2026-09")) as { props: { masa: string; bolehMengelola: boolean } };
    expect(el.props).toMatchObject({ masa: "2026-09", bolehMengelola: false });
    sesi.permissions = ["journals:view", "journals:manage"];
    const el2 = (await buka("bukan-masa")) as { props: { masa: string; bolehMengelola: boolean } };
    expect(el2.props.bolehMengelola).toBe(true);
    expect(el2.props.masa).toMatch(/^\d{4}-\d{2}$/);
  });
});
