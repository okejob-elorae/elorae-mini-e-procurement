import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Pagar aksi BACA GRN (`getGRNs`, `getGRNById`, `getGrnJournalState`). Setiap
 * ekspor `"use server"` bisa dipanggil siapa pun yang sudah masuk. `getGRNs`
 * dan `getGRNById` juga dipakai formulir retur pemasok, yang izinnya
 * `vendor_returns:*` — jadi keduanya menerima `inventory:view` ATAU
 * `vendor_returns:view`. Status jurnal hanya untuk halaman inventori.
 * Tanpa basis data: prisma ditiru, dan yang dihitung adalah apakah kueri
 * sempat berjalan.
 */

const state = vi.hoisted(() => ({
  sesi: null as { user: { id: string; permissions: string[] } } | null,
  dibaca: 0,
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => state.sesi) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/notifications/actor-name", () => ({ getActorName: vi.fn(async () => "Uji") }));
vi.mock("@/lib/notifications/events", () => ({
  notifyGRNCreated: vi.fn(async () => {}),
  notifyMaterialArrivedForPo: vi.fn(async () => {}),
}));
vi.mock("@/lib/inventory/grn-journal", () => ({
  postGrnJournal: vi.fn(),
  postGrnReversalJournal: vi.fn(),
}));
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));
vi.mock("@elorae/db", async (importOriginal) => {
  const asli = await importOriginal<typeof import("@elorae/db")>();
  const metode = (nama: string) =>
    vi.fn(async () => {
      state.dibaca += 1;
      return nama === "count" ? 0 : nama === "findMany" ? [] : null;
    });
  const model = new Proxy({}, { get: (_t, nama) => metode(String(nama)) });
  return { ...asli, prisma: new Proxy({}, { get: () => model }) };
});

const grn = await import("./grn");

type Kasus = [nama: string, izinSah: string[], panggil: () => Promise<unknown>];

const KASUS: Kasus[] = [
  ["getGRNs", ["inventory:view", "vendor_returns:view"], () => grn.getGRNs()],
  [
    "getGRNs (berhalaman)",
    ["inventory:view", "vendor_returns:view"],
    () => grn.getGRNs(undefined, { page: 1, pageSize: 10 }),
  ],
  ["getGRNById", ["inventory:view", "vendor_returns:view"], () => grn.getGRNById("grn-1")],
  ["getGrnJournalState", ["inventory:view"], () => grn.getGrnJournalState("grn-1")],
];

const LUAR: Array<[string, string[]]> = [
  ["salesman", ["pwa:access"]],
  ["SPG", ["pwa:access", "spg_sales:record"]],
  ["pemegang beranda saja", ["dashboard:view"]],
  ["tanpa izin", []],
];

beforeEach(() => {
  state.sesi = null;
  state.dibaca = 0;
});

describe("aksi baca GRN — pagar izin", () => {
  it.each(KASUS)("%s menolak tanpa sesi sebelum membaca data", async (_n, _izin, panggil) => {
    await expect(panggil()).rejects.toThrow(/Unauthorized/);
    expect(state.dibaca).toBe(0);
  });

  for (const [peran, izin] of LUAR) {
    it.each(KASUS)(`%s menolak ${peran} sebelum membaca data`, async (_n, _izin, panggil) => {
      state.sesi = { user: { id: "u1", permissions: izin } };
      await expect(panggil()).rejects.toThrow(/Forbidden/);
      expect(state.dibaca).toBe(0);
    });
  }

  it("status jurnal GRN tidak terbuka bagi pemegang vendor_returns:view saja", async () => {
    state.sesi = { user: { id: "u1", permissions: ["vendor_returns:view"] } };
    await expect(grn.getGrnJournalState("grn-1")).rejects.toThrow(/Forbidden/);
    expect(state.dibaca).toBe(0);
  });

  for (const [nama, izinSah, panggil] of KASUS) {
    for (const izin of [...izinSah, "*"]) {
      it(`${nama} tetap boleh untuk ${izin}`, async () => {
        state.sesi = { user: { id: "u1", permissions: [izin] } };
        await panggil();
        expect(state.dibaca).toBeGreaterThan(0);
      });
    }
  }
});
