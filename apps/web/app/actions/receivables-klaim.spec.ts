import { beforeEach, describe, expect, it, vi } from "vitest";
import { nasibLaporan } from "@/lib/pwa/offline/laporan-classify";

/**
 * `buatKlaimAction` menetapkan SIAPA boleh melaporkan BKM untuk faktur MANA di
 * server, bukan menurut isian HP.
 *
 * Sebelum ini cukup `pwa:access`: SPG (yang tidak menagih) bisa melaporkan
 * pelunasan, dan salesman yang terkunci ke tokonya sendiri bisa melaporkan uang
 * atas faktur toko yang dipegang orang lain — termasuk lewat kiriman ulang
 * antrean luring, yang memanggil aksi yang sama. Aturannya meniru
 * `catatReturTokoAction`, dengan satu perbedaan yang disengaja: yang boleh
 * ditagih adalah persis yang tampil di daftar tagihan HP-nya
 * (`daftarPiutang({ penagihId })` — toko yang ia pegang, faktur yang ia jual
 * selama tokonya belum punya pemegang, dan faktur di tugas tagih terbuka
 * miliknya). Menolak faktur yang ia lihat di layar membuat laporannya mustahil.
 *
 * Tanpa basis data — semua tiruan.
 */

const state = {
  sesi: { user: { id: "u1", permissions: ["pwa:access"] } } as { user: { id: string; permissions: string[] } } | null,
  tokoTetap: null as string | null,
  terkunci: false,
  /** Faktur yang ditagih u1 menurut aturan penagih. */
  tagihanSaya: new Set<string>(),
  /** BKM yang sudah tercatat, per kunci kiriman. */
  kunci: new Map<string, { salesmanId: string }>(),
  dicatat: [] as Record<string, unknown>[],
  lingkup: [] as Record<string, unknown>[],
};

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => state.sesi) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/pwa/peran", () => ({ ambilTokoTetap: vi.fn(async () => state.tokoTetap) }));
vi.mock("@/lib/salesman/queries", () => ({ tokoTerkunci: vi.fn(async () => state.terkunci) }));
vi.mock("@/lib/receivables/queries", () => ({
  daftarPiutang: vi.fn(async (opts: { penagihId?: string; receivableIds?: string[] }) => {
    state.lingkup.push(opts);
    return (opts.receivableIds ?? []).filter((id) => state.tagihanSaya.has(id)).map((id) => ({ id }));
  }),
}));
vi.mock("@/lib/notifications/kabar-pengguna", () => ({ JENIS_KABAR: {}, kabariPengguna: vi.fn() }));
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));
vi.mock("@/lib/receivables/koreksi", () => ({}));
vi.mock("@/lib/receivables/writer", () => ({}));
vi.mock("@/lib/receivables/claim-writer", () => ({
  buatKlaimPembayaran: vi.fn(async (input: Record<string, unknown>) => {
    state.dicatat.push(input);
    return { ok: true, id: "bkm1", docNo: "BKM/1" };
  }),
}));
vi.mock("@elorae/db", () => ({
  prisma: {
    paymentClaim: {
      findUnique: vi.fn(async ({ where }: { where: { idempotencyKey: string } }) =>
        state.kunci.get(where.idempotencyKey) ?? null,
      ),
    },
  },
}));

const { buatKlaimAction } = await import("./receivables");

const DASAR = {
  storeId: "s1",
  claimedTransferAt: "2026-10-01",
  method: "transfer",
  pelunasan: [{ receivableId: "f1", nilai: 100_000 }],
  transferPhotoUrl: "/api/foto/1",
};

beforeEach(() => {
  state.sesi = { user: { id: "u1", permissions: ["pwa:access"] } };
  state.tokoTetap = null;
  state.terkunci = false;
  state.tagihanSaya = new Set();
  state.kunci = new Map();
  state.dicatat = [];
  state.lingkup = [];
});

describe("buatKlaimAction — SPG tidak menagih", () => {
  it("refuses an SPG, even for their own fixed store", async () => {
    state.tokoTetap = "s1";
    expect(await buatKlaimAction(DASAR)).toEqual({ ok: false, kode: "TANPA_AKSES" });
    expect(state.dicatat).toHaveLength(0);
  });

  it("refuses an SPG's offline replay the same way", async () => {
    state.tokoTetap = "s1";
    expect(await buatKlaimAction({ ...DASAR, idempotencyKey: "hp-1" })).toEqual({ ok: false, kode: "TANPA_AKSES" });
    expect(state.dicatat).toHaveLength(0);
  });
});

describe("buatKlaimAction — kunci hanya toko sendiri", () => {
  it("refuses an invoice the salesperson does not collect while the lock is on", async () => {
    state.terkunci = true;
    expect(await buatKlaimAction(DASAR)).toEqual({ ok: false, kode: "TOKO_TIDAK_DIIZINKAN" });
    expect(state.dicatat).toHaveLength(0);
  });

  it("refuses the whole report when only one of its invoices is someone else's", async () => {
    state.terkunci = true;
    state.tagihanSaya = new Set(["f1"]);
    const hasil = await buatKlaimAction({
      ...DASAR,
      pelunasan: [
        { receivableId: "f1", nilai: 100_000 },
        { receivableId: "f2", nilai: 50_000 },
      ],
    });
    expect(hasil).toEqual({ ok: false, kode: "TOKO_TIDAK_DIIZINKAN" });
    expect(state.dicatat).toHaveLength(0);
  });

  it("refuses an offline replay for another salesperson's invoice the same way", async () => {
    state.terkunci = true;
    expect(await buatKlaimAction({ ...DASAR, idempotencyKey: "hp-2" })).toEqual({
      ok: false,
      kode: "TOKO_TIDAK_DIIZINKAN",
    });
    expect(state.dicatat).toHaveLength(0);
  });

  it("accepts invoices the salesperson collects, asking with the collector rule of the bills list", async () => {
    state.terkunci = true;
    state.tagihanSaya = new Set(["f1"]);
    expect(await buatKlaimAction(DASAR)).toEqual({ ok: true, docNo: "BKM/1" });
    expect(state.lingkup).toEqual([{ penagihId: "u1", receivableIds: ["f1"] }]);
    expect(state.dicatat[0]).toMatchObject({ storeId: "s1", salesmanId: "u1" });
  });

  it("checks only the lines that settle something, like the writer does", async () => {
    state.terkunci = true;
    state.tagihanSaya = new Set(["f1"]);
    const hasil = await buatKlaimAction({
      ...DASAR,
      pelunasan: [
        { receivableId: "f1", nilai: 100_000 },
        { receivableId: "f9", nilai: 0 },
      ],
    });
    expect(hasil).toEqual({ ok: true, docNo: "BKM/1" });
    expect(state.lingkup).toEqual([{ penagihId: "u1", receivableIds: ["f1"] }]);
  });

  it("lets a resend of the salesperson's own recorded report through, so the writer can return it", async () => {
    /*
     * Jawaban kiriman pertama hilang di jalan, lalu kuncinya dinyalakan (atau
     * tokonya dipindah) sebelum HP mengirim ulang. Laporannya SUDAH tercatat;
     * menolaknya sekarang membuat HP menandainya gagal padahal ada di kantor.
     */
    state.terkunci = true;
    state.kunci.set("hp-3", { salesmanId: "u1" });
    expect(await buatKlaimAction({ ...DASAR, idempotencyKey: "hp-3" })).toEqual({ ok: true, docNo: "BKM/1" });
    expect(state.dicatat).toHaveLength(1);
  });

  it("does not let someone else's key open the door", async () => {
    state.terkunci = true;
    state.kunci.set("hp-4", { salesmanId: "u2" });
    expect(await buatKlaimAction({ ...DASAR, idempotencyKey: "hp-4" })).toEqual({
      ok: false,
      kode: "TOKO_TIDAK_DIIZINKAN",
    });
    expect(state.dicatat).toHaveLength(0);
  });

  it("leaves the salesman flow unchanged while the lock is off", async () => {
    expect(await buatKlaimAction(DASAR)).toEqual({ ok: true, docNo: "BKM/1" });
    expect(state.lingkup).toHaveLength(0);
  });

  it("lets the office (receivables:manage) report for any invoice, lock or fixed store notwithstanding", async () => {
    state.sesi = { user: { id: "u1", permissions: ["receivables:manage"] } };
    state.tokoTetap = "s9";
    state.terkunci = true;
    expect(await buatKlaimAction(DASAR)).toEqual({ ok: true, docNo: "BKM/1" });
    expect(state.dicatat[0]).toMatchObject({ lintasPelapor: true });
  });

  it("treats the admin wildcard as the office: no lock check, cross-reporter allowed", async () => {
    state.sesi = { user: { id: "u1", permissions: ["*"] } };
    state.tokoTetap = "s9";
    state.terkunci = true;
    expect(await buatKlaimAction(DASAR)).toEqual({ ok: true, docNo: "BKM/1" });
    expect(state.lingkup).toHaveLength(0);
    expect(state.dicatat[0]).toMatchObject({ lintasPelapor: true });
  });

  it("still refuses someone with neither pwa:access nor receivables:manage", async () => {
    state.sesi = { user: { id: "u1", permissions: ["dashboard:view"] } };
    expect(await buatKlaimAction(DASAR)).toEqual({ ok: false, kode: "TANPA_AKSES" });
  });
});

describe("antrean luring HP", () => {
  it("treats both refusals as final, not as something to resend forever", () => {
    expect(nasibLaporan({ ok: false, kode: "TANPA_AKSES" })).toBe("terminal");
    expect(nasibLaporan({ ok: false, kode: "TOKO_TIDAK_DIIZINKAN" })).toBe("terminal");
  });
});
