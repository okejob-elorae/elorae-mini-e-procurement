import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Ajuan dan tanda dikirim mutasi dari antrean HP: diikat ke kunjungan saat
 * pekerjaannya dilakukan (boleh sudah check-out, harus milik SPG ini di
 * tokonya), kunci dan waktu tangkap diteruskan ke penulis. Dari konter tetap
 * butuh check-in yang masih aktif. Tanpa basis data.
 *
 * SPG yang sudah ditandai berhenti (P66, `assignedStoreId` kosong): kiriman antrean
 * yang ditangkap paling lambat akhir hari terakhirnya (WIB) tetap dicatat dari toko yang
 * dilepasnya (`tokoSpgUntukAntrean` asli); sesudahnya, atau dari konter, NO_ASSIGNED_STORE.
 */
const state = {
  aktif: null as null | { storeId: string },
  user: { assignedStoreId: "t1" as string | null, spgEndedOn: null as string | null, spgEndedStoreId: null as string | null },
  kunjunganAntrean: "v-antre" as string | null,
  cari: [] as Record<string, unknown>[],
  ajukan: [] as Record<string, unknown>[],
  kirim: [] as Record<string, unknown>[],
};

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "spg1", permissions: ["spg_sales:record"] } })) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@elorae/db", () => ({ prisma: { user: { findUnique: vi.fn(async () => ({ ...state.user })) } } }));
vi.mock("@/lib/stores/queries", () => ({ getActiveVisit: vi.fn(async () => state.aktif) }));
vi.mock("@/lib/pwa/kunjungan-antrean", () => ({
  cariKunjunganAntrean: vi.fn(async (k: Record<string, unknown>) => {
    state.cari.push(k);
    return state.kunjunganAntrean;
  }),
}));
vi.mock("@/lib/spg/mutasi-writer", () => ({
  ajukanMutasi: vi.fn(async (i: Record<string, unknown>) => {
    state.ajukan.push(i);
    return { ok: true, id: "m1", docNo: "MTS/2026/00001", status: "DIAJUKAN", ulang: false, kurangSaldo: [] };
  }),
  kirimMutasi: vi.fn(async (i: Record<string, unknown>) => {
    state.kirim.push(i);
    return { ok: true, id: "m1", docNo: "MTS/2026/00001", status: "DIKIRIM", ulang: false };
  }),
  alihkanTujuanMutasi: vi.fn(),
  batalkanMutasi: vi.fn(),
  putuskanSelisihMutasi: vi.fn(),
  setujuiMutasi: vi.fn(),
  terimaMutasiKantor: vi.fn(),
  tolakMutasi: vi.fn(),
}));

const { ajukanMutasiAction, kirimMutasiAction } = await import("./spg-mutasi");

const AJUAN = { toStoreId: "t2", alasan: "stok habis", baris: [{ itemId: "i1", variantSku: null, qty: 2 }], idempotencyKey: "kunci-a" };
const WAKTU = "2026-10-03T02:00:00.000Z";

beforeEach(() => {
  state.aktif = null;
  state.user = { assignedStoreId: "t1", spgEndedOn: null, spgEndedStoreId: null };
  state.kunjunganAntrean = "v-antre";
  state.cari = [];
  state.ajukan = [];
  state.kirim = [];
});

describe("ajukanMutasiAction dari antrean HP", () => {
  it("binds to the visit of the moment by the phone's id, even with no visit open now, and passes key and time", async () => {
    const r = await ajukanMutasiAction({ ...AJUAN, luring: true, waktuTangkap: WAKTU, visitClientId: "hp-1" });
    expect(r).toEqual({ ok: true, id: "m1", docNo: "MTS/2026/00001", status: "DIAJUKAN" });
    expect(state.cari[0]).toEqual({ userId: "spg1", storeId: "t1", visitId: null, visitClientId: "hp-1" });
    expect(state.ajukan[0]).toMatchObject({
      userId: "spg1",
      fromStoreId: "t1",
      idempotencyKey: "kunci-a",
      kunjunganId: "v-antre",
      waktuTangkap: new Date(WAKTU),
      baris: [{ itemId: "i1", variantSku: "", qty: 2 }],
    });
  });

  it("refuses a visit that is not this SPG's at their store", async () => {
    state.kunjunganAntrean = null;
    expect(await ajukanMutasiAction({ ...AJUAN, luring: true, waktuTangkap: WAKTU, visitId: "v-orang-lain" })).toEqual({
      ok: false,
      code: "KUNJUNGAN_TIDAK_SAH",
    });
    expect(state.ajukan).toHaveLength(0);
  });

  it("from the counter still needs a check-in open now — the capture time is ignored without `luring`", async () => {
    expect(await ajukanMutasiAction({ ...AJUAN, waktuTangkap: WAKTU })).toEqual({ ok: false, code: "NO_ACTIVE_VISIT" });
    state.aktif = { storeId: "t1" };
    expect((await ajukanMutasiAction({ ...AJUAN, waktuTangkap: WAKTU })).ok).toBe(true);
    expect(state.ajukan[0]).toMatchObject({ kunjunganId: null, waktuTangkap: null });
    expect(state.cari).toHaveLength(0);
  });
});

describe("kirimMutasiAction dari antrean HP", () => {
  it("passes the tap's key, the capture time and the visit of the moment", async () => {
    const r = await kirimMutasiAction({ transferId: "m1", idempotencyKey: "kunci-k", luring: true, waktuTangkap: WAKTU, visitId: "v-lama" });
    expect(r).toMatchObject({ ok: true, status: "DIKIRIM" });
    expect(state.cari[0]).toEqual({ userId: "spg1", storeId: "t1", visitId: "v-lama", visitClientId: null });
    expect(state.kirim[0]).toEqual({
      transferId: "m1",
      userId: "spg1",
      storeId: "t1",
      idempotencyKey: "kunci-k",
      kunjunganId: "v-antre",
      waktuTangkap: new Date(WAKTU),
    });
  });

  it("from the counter passes the key too, so a queued resend of the same tap is recognised", async () => {
    state.aktif = { storeId: "t1" };
    expect((await kirimMutasiAction({ transferId: "m1", idempotencyKey: "kunci-k" })).ok).toBe(true);
    expect(state.kirim[0]).toMatchObject({ idempotencyKey: "kunci-k", kunjunganId: null, waktuTangkap: null });
  });

  it("refuses a malformed payload without calling the writer", async () => {
    expect(await kirimMutasiAction({ transferId: "", luring: true })).toEqual({ ok: false, code: "VALIDATION" });
    expect(await kirimMutasiAction({ transferId: "m1", waktuTangkap: "kemarin" })).toEqual({ ok: false, code: "VALIDATION" });
    expect(state.kirim).toHaveLength(0);
  });
});

describe("ajukanMutasiAction — SPG yang sudah berhenti (P66)", () => {
  /* Ditandai berhenti dengan hari terakhir 31 Okt 2026 (WIB), melepas toko "toko-1". */
  const berhenti = () => {
    state.user = { assignedStoreId: null, spgEndedOn: "2026-10-31", spgEndedStoreId: "toko-1" };
  };

  it("a queued request captured on her last day (22:00 WIB) is filed from the store she left", async () => {
    berhenti();
    const r = await ajukanMutasiAction({ ...AJUAN, luring: true, waktuTangkap: "2026-10-31T15:00:00.000Z", visitClientId: "hp-1" });
    expect(r).toEqual({ ok: true, id: "m1", docNo: "MTS/2026/00001", status: "DIAJUKAN" });
    expect(state.cari[0]).toEqual({ userId: "spg1", storeId: "toko-1", visitId: null, visitClientId: "hp-1" });
    expect(state.ajukan[0]).toMatchObject({ fromStoreId: "toko-1", waktuTangkap: new Date("2026-10-31T15:00:00.000Z") });
  });

  it("a queued request captured after her last day (00:30 WIB the next day) is refused with NO_ASSIGNED_STORE", async () => {
    berhenti();
    expect(await ajukanMutasiAction({ ...AJUAN, luring: true, waktuTangkap: "2026-10-31T17:30:00.000Z", visitClientId: "hp-1" })).toEqual({
      ok: false,
      code: "NO_ASSIGNED_STORE",
    });
    expect(state.cari).toHaveLength(0);
    expect(state.ajukan).toHaveLength(0);
  });

  it("a request from the counter (not from the queue) from an ended SPG is refused with NO_ASSIGNED_STORE, even with a visit open", async () => {
    berhenti();
    state.aktif = { storeId: "toko-1" };
    expect(await ajukanMutasiAction({ ...AJUAN, waktuTangkap: "2026-10-31T15:00:00.000Z" })).toEqual({ ok: false, code: "NO_ASSIGNED_STORE" });
    expect(state.ajukan).toHaveLength(0);
  });

  it("a queued shipment tap captured on her last day leaves from the store she left", async () => {
    berhenti();
    const r = await kirimMutasiAction({ transferId: "m1", idempotencyKey: "kunci-k2", luring: true, waktuTangkap: "2026-10-31T15:00:00.000Z", visitId: "v-lama" });
    expect(r).toMatchObject({ ok: true, status: "DIKIRIM" });
    expect(state.kirim[0]).toMatchObject({ storeId: "toko-1" });
  });
});
