import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Menetapkan dan mengalihkan siapa menanggung selisih retur toko:
 * `receivables:decide_bearer` (keputusan pemilik 2026-11-01), dulu
 * `receivables:manage`. Menandai beban sudah diganti tetap milik pengelola
 * piutang. Tanpa basis data: penulisnya ditiru.
 */

const state = vi.hoisted(() => ({
  sesi: null as { user: { id: string; permissions: string[] } } | null,
  dipanggil: [] as string[],
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => state.sesi) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/pwa/peran", () => ({ ambilTokoTetap: vi.fn(async () => null) }));
vi.mock("@/lib/salesman/queries", () => ({ tokoTerkunci: vi.fn(async () => false) }));
vi.mock("@/lib/notifications/kabar-pengguna", () => ({ JENIS_KABAR: {}, kabariPengguna: vi.fn() }));
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));
vi.mock("@/lib/receivables/koreksi", () => ({}));
vi.mock("@/lib/finance/lapangan/kait", () => ({ kaitReturBerubah: vi.fn(async () => {}) }));
vi.mock("@/lib/receivables/return-writer", () => {
  const penulis = (nama: string) =>
    vi.fn(async () => {
      state.dipanggil.push(nama);
      return { ok: true };
    });
  return {
    putuskanBeban: penulis("putuskanBeban"),
    alihkanBeban: penulis("alihkanBeban"),
    tandaiBebanLunas: penulis("tandaiBebanLunas"),
  };
});
vi.mock("@elorae/db", () => ({ prisma: { returnCharge: { findUnique: vi.fn(async () => null) } } }));

const aksi = await import("./store-returns");

const masuk = (permissions: string[]) => {
  state.sesi = { user: { id: "u1", permissions } };
};

beforeEach(() => {
  state.sesi = null;
  state.dipanggil = [];
});

const DITOLAK = { ok: false, kode: "TANPA_AKSES" };
const putuskan = () => aksi.putuskanBebanAction("c1", "TOKO", "toko mengaku kurang hitung");
const alihkan = () => aksi.alihkanBebanAction("c1", "PERUSAHAAN", "kesalahan gudang");

describe("menetapkan dan mengalihkan beban selisih retur: receivables:decide_bearer", () => {
  it("pengelola piutang ditolak sebelum menyentuh penulis", async () => {
    masuk(["receivables:view", "receivables:manage"]);
    expect(await putuskan()).toEqual(DITOLAK);
    expect(await alihkan()).toEqual(DITOLAK);
    expect(state.dipanggil).toEqual([]);
  });

  it("pemegang izin keputusan menetapkan dan mengalihkan", async () => {
    masuk(["receivables:decide_bearer"]);
    expect(await putuskan()).toEqual({ ok: true });
    expect(await alihkan()).toEqual({ ok: true });
    expect(state.dipanggil).toEqual(["putuskanBeban", "alihkanBeban"]);
  });

  it("menandai beban sudah diganti tetap milik pengelola piutang", async () => {
    masuk(["receivables:decide_bearer"]);
    expect(await aksi.tandaiBebanLunasAction("c1")).toEqual(DITOLAK);
    masuk(["receivables:manage"]);
    expect(await aksi.tandaiBebanLunasAction("c1")).toEqual({ ok: true });
    expect(state.dipanggil).toEqual(["tandaiBebanLunas"]);
  });
});
