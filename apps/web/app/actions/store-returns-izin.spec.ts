import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Izin setiap aksi selisih retur toko. Tanpa basis data: penulisnya ditiru.
 *
 * - Menetapkan dan mengalihkan penanggung selisih retur: `store_returns:decide_shortfall`
 *   (P22: izin "memutuskan penanggung" dipecah dua — barang hilang SPG tetap
 *   `receivables:decide_bearer`). Dulu `receivables:decide_bearer`, sebelumnya `receivables:manage`.
 * - Menandai beban gudang/perusahaan sudah diganti, menjadikan / melepas barang susulan, dan
 *   mencatat potongan dari komisi sales: `receivables:manage`.
 * - Menghitung barang susulan: `inventory_opname:count` — izin menghitung, bukan izin piutang.
 * - Melapor hasil cek selisih: pekerjaan lapangan (`pwa:access`); penulisnya yang menolak
 *   siapa pun selain pemegang toko itu.
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
vi.mock("@/lib/finance/operasional/kait", () => ({ kaitPotongSalesRetur: vi.fn(async () => {}) }));
vi.mock("@/lib/receivables/return-writer", () => {
  const penulis = (nama: string, hasil: Record<string, unknown> = {}) =>
    vi.fn(async () => {
      state.dipanggil.push(nama);
      return { ok: true, ...hasil };
    });
  const selaras = { kejadian: "TETAP", chargeId: null, sebelum: null, sesudah: null };
  return {
    putuskanBeban: penulis("putuskanBeban"),
    alihkanBeban: penulis("alihkanBeban"),
    tandaiBebanLunas: penulis("tandaiBebanLunas"),
    laporHasilCekSelisih: penulis("laporHasilCekSelisih", { notifikasi: null }),
    catatHitunganSusulan: penulis("catatHitunganSusulan", {
      id: "nri2",
      noNri: "NRI/26/11/0002",
      fisik: { nilai: 0, qty: 0 },
      sisaSelisih: 0,
      selaras,
    }),
    jadikanSusulan: penulis("jadikanSusulan", { selaras, notifikasi: null }),
    lepasSusulan: penulis("lepasSusulan", { selaras, notifikasi: null }),
    bebanTokoDiNota: vi.fn(async () => ({ tertahan: 0, sisaFaktur: 0, tampil: 0 })),
  };
});
vi.mock("@/lib/receivables/potong-beban-retur", () => ({
  tandaiBebanReturDipotong: vi.fn(async () => {
    state.dipanggil.push("tandaiBebanReturDipotong");
    return { ok: true, nilai: 10_000, ulang: false };
  }),
  tandaiKelebihanReturDikembalikan: vi.fn(async () => {
    state.dipanggil.push("tandaiKelebihanReturDikembalikan");
    return { ok: true, nilai: 10_000, ulang: false };
  }),
}));
vi.mock("@elorae/db", () => ({
  prisma: {
    returnCharge: { findUnique: vi.fn(async () => null) },
    warehouseReturn: { findUnique: vi.fn(async () => null) },
  },
}));

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
const POTONG = { salesmanId: "s1", bulan: "2026-11", jumlah: 10_000, kunci: "kunci-layar-1" };

describe("menetapkan dan mengalihkan beban selisih retur: store_returns:decide_shortfall", () => {
  it("pengelola piutang ditolak sebelum menyentuh penulis", async () => {
    masuk(["receivables:view", "receivables:manage"]);
    expect(await putuskan()).toEqual(DITOLAK);
    expect(await alihkan()).toEqual(DITOLAK);
    expect(state.dipanggil).toEqual([]);
  });

  it("pemegang izin barang hilang (receivables:decide_bearer) saja ditolak — izinnya dipecah dua", async () => {
    masuk(["receivables:decide_bearer"]);
    expect(await putuskan()).toEqual(DITOLAK);
    expect(await alihkan()).toEqual(DITOLAK);
    expect(state.dipanggil).toEqual([]);
  });

  it("pemegang izin selisih retur menetapkan dan mengalihkan", async () => {
    masuk(["store_returns:decide_shortfall"]);
    expect(await putuskan()).toEqual({ ok: true });
    expect(await alihkan()).toEqual({ ok: true });
    expect(state.dipanggil).toEqual(["putuskanBeban", "alihkanBeban"]);
  });

  it("menandai beban sudah diganti tetap milik pengelola piutang", async () => {
    masuk(["store_returns:decide_shortfall"]);
    expect(await aksi.tandaiBebanLunasAction("c1")).toEqual(DITOLAK);
    masuk(["receivables:manage"]);
    expect(await aksi.tandaiBebanLunasAction("c1")).toEqual({ ok: true });
    expect(state.dipanggil).toEqual(["tandaiBebanLunas"]);
  });
});

describe("tindak lanjut selisih retur", () => {
  it("melapor hasil cek butuh pwa:access (atau pengelola piutang); tanpa itu ditolak", async () => {
    masuk(["inventory_opname:count"]);
    expect(await aksi.laporHasilCekSelisihAction("c1", "DITEMUKAN", null)).toEqual(DITOLAK);
    masuk(["pwa:access"]);
    expect(await aksi.laporHasilCekSelisihAction("c1", "DITEMUKAN", null)).toEqual({ ok: true });
    expect(state.dipanggil).toEqual(["laporHasilCekSelisih"]);
  });

  it("menghitung barang susulan butuh izin menghitung, bukan izin piutang", async () => {
    const isian = { storeReturnId: "nrt1", receivedAt: "2026-11-01", deliveryMethod: "SALES" as const, physicalAmount: 0 };
    masuk(["receivables:manage", "store_returns:decide_shortfall"]);
    expect(await aksi.catatHitunganSusulanAction(isian)).toEqual(DITOLAK);
    masuk(["inventory_opname:count"]);
    expect(await aksi.catatHitunganSusulanAction(isian)).toMatchObject({ ok: true, noNri: "NRI/26/11/0002" });
    expect(state.dipanggil).toEqual(["catatHitunganSusulan"]);
  });

  it("menolak tanggal terima di masa depan sebelum menyentuh penulis", async () => {
    masuk(["inventory_opname:count"]);
    expect(
      await aksi.catatHitunganSusulanAction({ storeReturnId: "nrt1", receivedAt: "2999-01-01", deliveryMethod: "SALES" }),
    ).toEqual({ ok: false, kode: "TANGGAL_TIDAK_VALID" });
    expect(state.dipanggil).toEqual([]);
  });

  it("menjadikan dan melepas barang susulan butuh receivables:manage", async () => {
    masuk(["inventory_opname:count", "store_returns:decide_shortfall"]);
    expect(await aksi.jadikanSusulanAction("nri1", "nrt1")).toEqual(DITOLAK);
    expect(await aksi.lepasSusulanAction("nri1")).toEqual(DITOLAK);
    masuk(["receivables:manage"]);
    expect(await aksi.jadikanSusulanAction("nri1", "nrt1")).toEqual({ ok: true });
    expect(await aksi.lepasSusulanAction("nri1")).toEqual({ ok: true });
    expect(state.dipanggil).toEqual(["jadikanSusulan", "lepasSusulan"]);
  });

  it("memotong beban dari komisi sales dan mengembalikan kelebihannya butuh receivables:manage", async () => {
    masuk(["store_returns:decide_shortfall", "field_sales_orders:approve"]);
    expect(await aksi.tandaiBebanReturDipotongAction(POTONG)).toEqual({ ok: false, code: "TANPA_AKSES" });
    expect(await aksi.tandaiKelebihanReturDikembalikanAction(POTONG)).toEqual({ ok: false, code: "TANPA_AKSES" });
    masuk(["receivables:manage"]);
    expect(await aksi.tandaiBebanReturDipotongAction(POTONG)).toEqual({ ok: true, nilai: 10_000 });
    expect(await aksi.tandaiKelebihanReturDikembalikanAction(POTONG)).toEqual({ ok: true, nilai: 10_000 });
    expect(state.dipanggil).toEqual(["tandaiBebanReturDipotong", "tandaiKelebihanReturDikembalikan"]);
  });
});
