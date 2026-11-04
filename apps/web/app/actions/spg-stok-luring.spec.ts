import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Terima kiriman dan opname dari antrean HP: diikat ke kunjungan saat
 * pekerjaannya dilakukan (boleh sudah check-out, harus milik SPG ini di
 * tokonya), kunci dan waktu tangkap diteruskan ke penulis. Kiriman di konter
 * tetap butuh check-in yang masih aktif. Tanpa basis data.
 *
 * SPG yang sudah ditandai berhenti (P66, `assignedStoreId` kosong): kiriman antrean
 * yang ditangkap paling lambat akhir hari terakhirnya (WIB) tetap dicatat ke toko yang
 * dilepasnya (`tokoSpgUntukAntrean` asli); sesudahnya, atau dari konter, NO_ASSIGNED_STORE.
 */
const state = {
  aktif: null as null | { storeId: string },
  user: { assignedStoreId: "t1" as string | null, spgEndedOn: null as string | null, spgEndedStoreId: null as string | null },
  kunjunganAntrean: "v-antre" as string | null,
  cari: [] as Record<string, unknown>[],
  terima: [] as Record<string, unknown>[],
  opname: [] as Record<string, unknown>[],
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
vi.mock("@/lib/spg/stok-writer", () => ({
  terimaKiriman: vi.fn(async (i: Record<string, unknown>) => {
    state.terima.push(i);
    return { ok: true, receiptId: "r1" };
  }),
  catatOpname: vi.fn(async (i: Record<string, unknown>) => {
    state.opname.push(i);
    return { ok: true, opnameId: "o1", selisih: 1 };
  }),
  mintaKiriman: vi.fn(),
  catatBarangDicari: vi.fn(),
  ubahStatusPermintaan: vi.fn(),
}));

const { terimaKirimanAction, catatOpnameAction } = await import("./spg-stok");

const TERIMA = { sourceType: "KONSI_SHIPMENT", sourceId: "k1", diterima: [{ lineId: "L1", qtyReceived: 3 }] };
const WAKTU = "2026-10-03T02:00:00.000Z";

beforeEach(() => {
  state.aktif = null;
  state.user = { assignedStoreId: "t1", spgEndedOn: null, spgEndedStoreId: null };
  state.kunjunganAntrean = "v-antre";
  state.cari = [];
  state.terima = [];
  state.opname = [];
});

describe("terimaKirimanAction dari antrean HP", () => {
  it("binds to the visit of the moment by the phone's id, even with no visit open now, and passes key and time", async () => {
    const r = await terimaKirimanAction({ ...TERIMA, idempotencyKey: "kunci-1", luring: true, waktuTangkap: WAKTU, visitClientId: "hp-1" });
    expect(r).toEqual({ ok: true, receiptId: "r1" });
    expect(state.cari[0]).toEqual({ userId: "spg1", storeId: "t1", visitId: null, visitClientId: "hp-1" });
    expect(state.terima[0]).toMatchObject({ storeId: "t1", idempotencyKey: "kunci-1", waktuTangkap: new Date(WAKTU) });
  });

  it("refuses a visit that is not this SPG's at their store", async () => {
    state.kunjunganAntrean = null;
    expect(await terimaKirimanAction({ ...TERIMA, luring: true, waktuTangkap: WAKTU, visitId: "v-orang-lain" })).toEqual({
      ok: false,
      code: "KUNJUNGAN_TIDAK_SAH",
    });
    expect(state.terima).toHaveLength(0);
  });

  it("at the counter still needs a check-in open now — the capture time is ignored without `luring`", async () => {
    expect(await terimaKirimanAction({ ...TERIMA, idempotencyKey: "kunci-2", waktuTangkap: WAKTU })).toEqual({ ok: false, code: "NO_ACTIVE_VISIT" });
    state.aktif = { storeId: "t1" };
    expect(await terimaKirimanAction({ ...TERIMA, idempotencyKey: "kunci-2", waktuTangkap: WAKTU })).toEqual({ ok: true, receiptId: "r1" });
    expect(state.terima[0]).toMatchObject({ idempotencyKey: "kunci-2", waktuTangkap: null });
    expect(state.cari).toHaveLength(0);
  });
});

describe("terimaKirimanAction — barang ditolak di pintu (P40)", () => {
  const PUTUS = { sourceType: "PUTUS_DELIVERY", sourceId: "d1", diterima: [{ lineId: "L1", qtyReceived: 3, qtyRefused: 2 }] };

  it("passes each line's refused pieces to the writer as typed", async () => {
    state.aktif = { storeId: "t1" };
    expect(await terimaKirimanAction(PUTUS)).toEqual({ ok: true, receiptId: "r1" });
    expect(state.terima[0]).toMatchObject({ storeId: "t1", userId: "spg1", diterima: [{ lineId: "L1", qtyReceived: 3, qtyRefused: 2 }] });
  });

  it("refuses a refused count that is not a whole number of pieces before the writer runs", async () => {
    state.aktif = { storeId: "t1" };
    for (const qtyRefused of [-1, 1.5, "2"]) {
      expect(await terimaKirimanAction({ ...PUTUS, diterima: [{ lineId: "L1", qtyReceived: 3, qtyRefused }] })).toEqual({
        ok: false,
        code: "VALIDATION",
      });
    }
    expect(state.terima).toHaveLength(0);
  });

  it("passes the writer's refusal of a cancelled or not-yet-departed shipment through unchanged", async () => {
    const { terimaKiriman } = await import("@/lib/spg/stok-writer");
    state.aktif = { storeId: "t1" };
    for (const alasan of ["KIRIMAN_DIBATALKAN", "BELUM_BERANGKAT"]) {
      vi.mocked(terimaKiriman).mockResolvedValueOnce({ ok: false, alasan } as never);
      expect(await terimaKirimanAction(PUTUS)).toEqual({ ok: false, code: alasan });
    }
  });
});

describe("catatOpnameAction dari antrean HP", () => {
  it("passes key, count time and the queued visit to the writer", async () => {
    const r = await catatOpnameAction({
      baris: [{ itemId: "i1", variantSku: null, qtyCounted: 4 }],
      idempotencyKey: "op-1",
      luring: true,
      waktuTangkap: WAKTU,
      visitId: "v1",
    });
    expect(r).toEqual({ ok: true, opnameId: "o1", selisih: 1 });
    expect(state.cari[0]).toMatchObject({ visitId: "v1" });
    expect(state.opname[0]).toMatchObject({ idempotencyKey: "op-1", waktuTangkap: new Date(WAKTU) });
  });
});

describe("terimaKirimanAction — SPG yang sudah berhenti (P66)", () => {
  /* Ditandai berhenti dengan hari terakhir 31 Okt 2026 (WIB), melepas toko "toko-1". */
  const berhenti = () => {
    state.user = { assignedStoreId: null, spgEndedOn: "2026-10-31", spgEndedStoreId: "toko-1" };
  };

  it("a queued receipt captured on her last day (22:00 WIB) is recorded at the store she left", async () => {
    berhenti();
    const r = await terimaKirimanAction({ ...TERIMA, idempotencyKey: "kunci-b", luring: true, waktuTangkap: "2026-10-31T15:00:00.000Z", visitClientId: "hp-1" });
    expect(r).toEqual({ ok: true, receiptId: "r1" });
    expect(state.cari[0]).toEqual({ userId: "spg1", storeId: "toko-1", visitId: null, visitClientId: "hp-1" });
    expect(state.terima[0]).toMatchObject({ storeId: "toko-1", waktuTangkap: new Date("2026-10-31T15:00:00.000Z") });
  });

  it("a queued receipt captured after her last day (00:30 WIB the next day) is refused with NO_ASSIGNED_STORE", async () => {
    berhenti();
    expect(
      await terimaKirimanAction({ ...TERIMA, luring: true, waktuTangkap: "2026-10-31T17:30:00.000Z", visitClientId: "hp-1" }),
    ).toEqual({ ok: false, code: "NO_ASSIGNED_STORE" });
    expect(state.cari).toHaveLength(0);
    expect(state.terima).toHaveLength(0);
  });

  it("a receipt at the counter (not from the queue) from an ended SPG is refused with NO_ASSIGNED_STORE, even with a visit open", async () => {
    berhenti();
    state.aktif = { storeId: "toko-1" };
    expect(await terimaKirimanAction({ ...TERIMA, waktuTangkap: "2026-10-31T15:00:00.000Z" })).toEqual({ ok: false, code: "NO_ASSIGNED_STORE" });
    expect(state.terima).toHaveLength(0);
  });

  it("a queued stock count captured on her last day is recorded at the store she left too", async () => {
    berhenti();
    const r = await catatOpnameAction({
      baris: [{ itemId: "i1", variantSku: null, qtyCounted: 4 }],
      idempotencyKey: "op-b",
      luring: true,
      waktuTangkap: "2026-10-31T15:00:00.000Z",
      visitId: "v1",
    });
    expect(r).toEqual({ ok: true, opnameId: "o1", selisih: 1 });
    expect(state.opname[0]).toMatchObject({ storeId: "toko-1" });
  });
});
