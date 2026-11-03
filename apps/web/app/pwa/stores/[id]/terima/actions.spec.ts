import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `terimaKirimanPemegangAction` — pintu HP salesman pemegang untuk menerima kiriman di toko yang
 * SPG-nya sudah berhenti (P45/P45a). Aksinya hanya memeriksa sesi dan bentuk isian; pemegang,
 * kunjungan, toko tanpa SPG, dan foto diperiksa penulisnya (diuji pemiliknya). Yang dijaga di sini:
 * SPG dan admin tidak lewat jalur ini, orang yang menerima diambil dari SESI (bukan dari isian),
 * dan kegagalan tak terduga tidak melempar ke layar.
 *
 * Tanpa basis data — semua tiruan.
 */

const state = {
  sesi: null as { user: { id: string; permissions: string[] } } | null,
  tokoTetap: null as string | null,
  dipanggil: [] as Record<string, unknown>[],
  hasil: { ok: true, receiptId: "rc1" } as Record<string, unknown>,
  lempar: false,
  revalidasi: [] as string[],
};

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => state.sesi) }));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => state.revalidasi.push(p) }));
vi.mock("@/lib/pwa/peran", () => ({ ambilTokoTetap: vi.fn(async () => state.tokoTetap) }));
vi.mock("@/lib/spg/stok-writer-pemegang", () => ({
  terimaKirimanPemegang: vi.fn(async (input: Record<string, unknown>) => {
    state.dipanggil.push(input);
    if (state.lempar) throw new Error("putus");
    return state.hasil;
  }),
}));

const { terimaKirimanPemegangAction } = await import("./actions");

const ISIAN = {
  storeId: "toko1",
  sourceType: "KONSI_TRANSFER",
  sourceId: "kt1",
  diterima: [{ lineId: "l1", qtyReceived: 3 }],
  picName: "Bu Rina",
  photoUrl: "https://r2.test/store-receipt-photos/toko1/KONSI_TRANSFER-kt1/k1.jpg",
  photoR2Key: "store-receipt-photos/toko1/KONSI_TRANSFER-kt1/k1.jpg",
  idempotencyKey: "k1",
};

beforeEach(() => {
  state.sesi = { user: { id: "sales1", permissions: ["pwa:access"] } };
  state.tokoTetap = null;
  state.dipanggil = [];
  state.hasil = { ok: true, receiptId: "rc1" };
  state.lempar = false;
  state.revalidasi = [];
});

describe("terimaKirimanPemegangAction", () => {
  it("tanpa sesi ditolak TANPA_AKSES dan penulisnya tidak dipanggil", async () => {
    state.sesi = null;
    expect(await terimaKirimanPemegangAction(ISIAN)).toEqual({ ok: false, alasan: "TANPA_AKSES" });
    expect(state.dipanggil).toHaveLength(0);
  });

  it("SPG ditolak — SPG menerima lewat layar Terima kirimannya sendiri", async () => {
    state.tokoTetap = "toko1";
    expect(await terimaKirimanPemegangAction(ISIAN)).toEqual({ ok: false, alasan: "TANPA_AKSES" });
    expect(state.dipanggil).toHaveLength(0);
  });

  it("akun kantor (wildcard) tidak memakai layar HP ini", async () => {
    state.sesi = { user: { id: "admin1", permissions: ["*"] } };
    expect(await terimaKirimanPemegangAction(ISIAN)).toEqual({ ok: false, alasan: "TANPA_AKSES" });
    expect(state.dipanggil).toHaveLength(0);
  });

  it("isian yang tidak sah ditolak ISIAN_TIDAK_VALID — jenis kiriman lain, jumlah pecahan, tanpa baris", async () => {
    for (const salah of [
      { ...ISIAN, sourceType: "MUTASI" },
      { ...ISIAN, diterima: [{ lineId: "l1", qtyReceived: 1.5 }] },
      { ...ISIAN, diterima: [] },
      { ...ISIAN, idempotencyKey: "" },
    ]) {
      expect(await terimaKirimanPemegangAction(salah)).toEqual({ ok: false, alasan: "ISIAN_TIDAK_VALID" });
    }
    expect(state.dipanggil).toHaveLength(0);
  });

  it("penerima diambil dari sesi, bukan dari isian; hasil penulis diteruskan dan halaman tokonya disegarkan", async () => {
    expect(await terimaKirimanPemegangAction({ ...ISIAN, userId: "orang-lain" })).toEqual({ ok: true, receiptId: "rc1" });
    expect(state.dipanggil).toHaveLength(1);
    expect(state.dipanggil[0]).toMatchObject({ userId: "sales1", storeId: "toko1", sourceId: "kt1", picName: "Bu Rina" });
    expect(state.revalidasi).toContain("/pwa/stores/toko1");
  });

  it("penolakan penulis diteruskan apa adanya, tanpa menyegarkan halaman", async () => {
    state.hasil = { ok: false, alasan: "TANPA_KUNJUNGAN" };
    expect(await terimaKirimanPemegangAction(ISIAN)).toEqual({ ok: false, alasan: "TANPA_KUNJUNGAN" });
    expect(state.revalidasi).toHaveLength(0);
  });

  it("kegagalan tak terduga menjadi GAGAL, tidak melempar ke layar", async () => {
    state.lempar = true;
    const galat = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await terimaKirimanPemegangAction(ISIAN)).toEqual({ ok: false, alasan: "GAGAL" });
    galat.mockRestore();
  });
});
