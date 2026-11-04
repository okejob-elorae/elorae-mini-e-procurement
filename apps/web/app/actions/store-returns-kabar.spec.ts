import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Kabar ke salesman pemegang toko sesudah aksi selisih retur. Tanpa basis data: penulis dan
 * pembaca ditiru, kabarnya ditangkap.
 *
 * - Melepas barang susulan dari nota yang tetap tertutup oleh hitungan lainnya tidak mengubah
 *   apa pun bagi pemegang toko — tidak ada kabar "selisih tertutup" palsu.
 * - Selisih yang ditanggung TOKO dikabarkan ke pemegang toko (keputusan 1, 2026-10-29: "sales
 *   dikabari untuk menagih kekurangannya") — juga kalau toko belum memotong nota returnya di
 *   pembayaran mana pun, tanpa angka tagihan karena belum ada yang tertahan.
 * - Kabar "retur sudah dihitung" ke salesman pelapor membawa rupiahnya, juga di toko konsinyasi
 *   (P18); hanya nota yang dilaporkan SPG, di toko konsinyasi, yang tanpa rupiah (P18a).
 * - Penerimaan tanpa toko yang dijadikan susulan atau dijodohkan di bulan yang siklus
 *   konsinyasinya terkunci: aksinya meneruskan nomor siklusnya dan konfirmasinya.
 */

const state = vi.hoisted(() => ({
  kabar: [] as { penerima: string; isi: Record<string, unknown> }[],
  selaras: { kejadian: "COCOK", chargeId: null, sebelum: null, sesudah: null } as Record<string, unknown>,
  bebanToko: { tertahan: 0, sisaFaktur: 0, tampil: 0 },
  pemegang: "pemegang-1" as string | null,
  nota: {} as Record<string, unknown>,
  jadikan: { ok: true, piutangDihitungUlang: 0, selaras: { kejadian: "TETAP" }, notifikasi: null } as Record<string, unknown>,
  jadikanInput: [] as Record<string, unknown>[],
  jodohkan: { ok: true, piutangDihitungUlang: 0, selisihBaru: null } as Record<string, unknown>,
  jodohkanInput: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "kantor-1", permissions: ["*"] } })) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/pwa/peran", () => ({ ambilTokoTetap: vi.fn(async () => null) }));
vi.mock("@/lib/salesman/queries", () => ({ tokoTerkunci: vi.fn(async () => false) }));
vi.mock("@/lib/notifications/kabar-pengguna", () => ({
  JENIS_KABAR: {
    RETUR_DIHITUNG: "RETUR_DIHITUNG",
    RETUR_SELISIH_CEK: "RETUR_SELISIH_CEK",
    RETUR_DITANGGUNG_TOKO: "RETUR_DITANGGUNG_TOKO",
    RETUR_DIBEBANKAN: "RETUR_DIBEBANKAN",
  },
  kabariPengguna: vi.fn(async (penerima: string, isi: Record<string, unknown>) => {
    state.kabar.push({ penerima, isi });
  }),
}));
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));
vi.mock("@/lib/receivables/koreksi", () => ({}));
vi.mock("@/lib/receivables/potong-beban-retur", () => ({}));
vi.mock("@/lib/finance/lapangan/kait", () => ({ kaitReturBerubah: vi.fn(async () => {}) }));
vi.mock("@/lib/finance/operasional/kait", () => ({ kaitPotongSalesRetur: vi.fn(async () => {}) }));
vi.mock("@/lib/receivables/return-writer", () => ({
  lepasSusulan: vi.fn(async () => ({ ok: true, piutangDihitungUlang: 0, selaras: state.selaras, notifikasi: null })),
  putuskanBeban: vi.fn(async () => ({ ok: true, piutangDihitungUlang: 0 })),
  bebanTokoDiNota: vi.fn(async () => state.bebanToko),
  jodohkanRetur: vi.fn(async (input: Record<string, unknown>) => {
    state.jodohkanInput.push(input);
    return state.jodohkan;
  }),
  jadikanSusulan: vi.fn(async (input: Record<string, unknown>) => {
    state.jadikanInput.push(input);
    return state.jadikan;
  }),
}));
vi.mock("@elorae/db", () => ({
  prisma: {
    warehouseReturn: { findUnique: vi.fn(async () => ({ followUpOfStoreReturnId: "nrt-1" })) },
    returnCharge: { findUnique: vi.fn(async () => ({ storeReturnId: "nrt-1", bearer: "TOKO", bearerUserId: null })) },
    storeReturn: {
      findUnique: vi.fn(async () => ({
        noNrt: "NRT-9",
        storeId: "toko-1",
        store: { name: "Toko Uji", salesmanId: state.pemegang },
        items: [],
        warehouseReturn: { status: "FINAL", items: [] },
        followUps: [],
        charges: [{ id: "beban-1", amount: 200_000 }],
        ...state.nota,
      })),
    },
  },
}));

const { jadikanSusulanAction, jodohkanReturAction, lepasSusulanAction, putuskanBebanAction } = await import("./store-returns");

/** Kabar dikirim tanpa ditunggu aksinya: beri kesempatan rantai janjinya selesai. */
const tunggu = () => new Promise((r) => setTimeout(r, 10));

beforeEach(() => {
  state.kabar = [];
  state.selaras = { kejadian: "COCOK", chargeId: null, sebelum: null, sesudah: null };
  state.bebanToko = { tertahan: 0, sisaFaktur: 0, tampil: 0 };
  state.pemegang = "pemegang-1";
  state.nota = {};
  state.jadikan = { ok: true, piutangDihitungUlang: 0, selaras: { kejadian: "TETAP" }, notifikasi: null };
  state.jadikanInput = [];
  state.jodohkan = { ok: true, piutangDihitungUlang: 0, selisihBaru: null };
  state.jodohkanInput = [];
});

describe("lepasSusulanAction — kabar ke pemegang toko", () => {
  it("nota yang tetap tertutup oleh hitungan lainnya (tanpa beban sebelum maupun sesudah): tidak ada kabar", async () => {
    expect(await lepasSusulanAction("nri-1")).toEqual({ ok: true });
    await tunggu();
    expect(state.kabar).toEqual([]);
  });

  it("selisih TERBUKA yang benar-benar tertutup tetap dikabarkan tertutup", async () => {
    state.selaras = { kejadian: "COCOK", chargeId: "beban-1", sebelum: { amount: 50_000, status: "TERBUKA" }, sesudah: null };
    expect(await lepasSusulanAction("nri-1")).toEqual({ ok: true });
    await tunggu();
    expect(state.kabar).toHaveLength(1);
    expect(state.kabar[0]).toMatchObject({ penerima: "pemegang-1", isi: { jenis: "RETUR_DIHITUNG" } });
    expect(String(state.kabar[0].isi.judul)).toContain("tertutup");
  });
});

describe("putuskanBebanAction TOKO — pemegang toko dikabari untuk menagih", () => {
  it("toko belum memotong nota returnya: tetap dikabarkan, tanpa angka tagihan", async () => {
    expect(await putuskanBebanAction("beban-1", "TOKO", "toko mengaku laku")).toEqual({ ok: true });
    await tunggu();
    expect(state.kabar).toHaveLength(1);
    expect(state.kabar[0]).toMatchObject({ penerima: "pemegang-1", isi: { jenis: "RETUR_DITANGGUNG_TOKO" } });
    const isi = String(state.kabar[0].isi.isi);
    expect(isi).toContain("belum memotong nota retur ini");
    expect(isi).toContain("tagih saat itu");
    expect(isi).not.toContain("tagih saat berkunjung");
  });

  it("toko sudah memotongnya: kabar menyebut yang masih harus ditagih", async () => {
    state.bebanToko = { tertahan: 200_000, sisaFaktur: 200_000, tampil: 200_000 };
    expect(await putuskanBebanAction("beban-1", "TOKO", "toko mengaku laku")).toEqual({ ok: true });
    await tunggu();
    expect(state.kabar).toHaveLength(1);
    expect(String(state.kabar[0].isi.isi)).toContain("tagih saat berkunjung");
  });

  it("pemegang toko yang memutuskan sendiri, atau toko tanpa pemegang: tidak ada kabar", async () => {
    state.pemegang = "kantor-1";
    await putuskanBebanAction("beban-1", "TOKO", "x");
    state.pemegang = null;
    await putuskanBebanAction("beban-1", "TOKO", "x");
    await tunggu();
    expect(state.kabar).toEqual([]);
  });
});

describe("kabar 'retur sudah dihitung' ke pelapor nota", () => {
  const konsi = (reportedBySpg: boolean) => ({
    salesmanId: "pelapor-1",
    reportedBySpg,
    claimedAmount: 300_000,
    store: { name: "Toko Uji", salesmanId: state.pemegang, termsType: "KONSI" },
    warehouseReturn: { status: "FINAL", physicalAmount: 100_000, items: [{ qty: 1 }, { qty: 2 }] },
  });

  it("dilaporkan salesman di toko konsinyasi: klaim, fisik, dan selisih ikut dalam rupiah (P18)", async () => {
    state.nota = konsi(false);
    expect(await jodohkanReturAction("nri-1", "nrt-1")).toEqual({ ok: true });
    await tunggu();
    expect(state.kabar).toHaveLength(1);
    expect(state.kabar[0]).toMatchObject({ penerima: "pelapor-1", isi: { jenis: "RETUR_DIHITUNG" } });
    const isi = String(state.kabar[0].isi.isi);
    expect(isi).toContain("klaim Rp");
    expect(isi).toContain("fisik Rp");
    expect(isi).toContain("selisih Rp");
  });

  it("dilaporkan SPG di toko konsinyasi: tanpa rupiah, cukup jumlah potong (P18a)", async () => {
    state.nota = konsi(true);
    expect(await jodohkanReturAction("nri-1", "nrt-1")).toEqual({ ok: true });
    await tunggu();
    expect(state.kabar).toHaveLength(1);
    const isi = String(state.kabar[0].isi.isi);
    expect(isi).toBe("Toko Uji · 3 potong diterima");
    expect(isi).not.toContain("Rp");
  });
});

describe("jadikanSusulanAction — bulan yang siklus konsinyasinya terkunci", () => {
  it("meneruskan nomor siklusnya, lalu konfirmasinya ke penulis", async () => {
    state.jadikan = { ok: false, alasan: "SIKLUS_TERKUNCI", noKonsi: ["KONSI/26/10/0001"] };
    expect(await jadikanSusulanAction("nri-1", "nrt-1")).toEqual({
      ok: false,
      kode: "SIKLUS_TERKUNCI",
      noKonsi: ["KONSI/26/10/0001"],
    });
    expect(state.jadikanInput[0]).toMatchObject({ setujuSiklusTerkunci: false });

    state.jadikan = { ok: true, piutangDihitungUlang: 0, selaras: { kejadian: "TETAP" }, notifikasi: null };
    expect(await jadikanSusulanAction("nri-1", "nrt-1", true)).toEqual({ ok: true });
    expect(state.jadikanInput[1]).toMatchObject({ setujuSiklusTerkunci: true });
  });
});

describe("jodohkanReturAction — bulan yang siklus konsinyasinya terkunci", () => {
  it("meneruskan nomor siklusnya, lalu konfirmasinya ke penulis", async () => {
    state.jodohkan = { ok: false, alasan: "SIKLUS_TERKUNCI", noKonsi: ["KONSI/26/10/0001"] };
    expect(await jodohkanReturAction("nri-1", "nrt-1")).toEqual({
      ok: false,
      kode: "SIKLUS_TERKUNCI",
      noKonsi: ["KONSI/26/10/0001"],
    });
    expect(state.jodohkanInput[0]).toMatchObject({ setujuSiklusTerkunci: false });
    await tunggu();
    expect(state.kabar).toEqual([]);

    state.jodohkan = { ok: true, piutangDihitungUlang: 0, selisihBaru: null };
    expect(await jodohkanReturAction("nri-1", "nrt-1", true)).toEqual({ ok: true });
    expect(state.jodohkanInput[1]).toMatchObject({ setujuSiklusTerkunci: true });
  });
});
