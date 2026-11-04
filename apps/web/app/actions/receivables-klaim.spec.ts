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
  /** Tagihan konsinyasi: id faktur → pemegang toko sekarang. */
  konsi: new Map<string, string | null>(),
  /** Penolakan penulis BKM (null = tercatat). */
  tulisGagal: null as string | null,
  /** Hasil `putuskanKlaim` (verifikasi / giro). */
  putusan: { ok: true } as { ok: true } | { ok: false; alasan: string },
};

/** Kabar beban toko (P84) — dipalsukan; yang diuji hanya KAPAN aksi memanggilnya. */
const kabarBeban = vi.hoisted(() => ({ dariKlaim: vi.fn(async (_id: string, _pelaku: string) => {}) }));

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
vi.mock("@/lib/receivables/writer", () => ({ putuskanKlaim: vi.fn(async () => state.putusan) }));
vi.mock("@/lib/finance/lapangan/kait", () => ({ kaitKlaimBerubah: vi.fn(async () => {}), bacaTautanPotongan: vi.fn() }));
// Modul aslinya menarik penulis retur (dan `tx-retry`, yang membaca `Prisma` dari tiruan di bawah).
vi.mock("@/lib/receivables/kabar-beban-toko", () => ({ kabarBebanTokoDariKlaim: kabarBeban.dariKlaim }));
vi.mock("@/lib/receivables/claim-writer", () => ({
  buatKlaimPembayaran: vi.fn(async (input: Record<string, unknown>) => {
    state.dicatat.push(input);
    if (state.tulisGagal) return { ok: false, alasan: state.tulisGagal };
    // Kunci yang sudah tercatat: penulis mengembalikan BKM lamanya dan menandainya kiriman ulang.
    const kunci = typeof input.idempotencyKey === "string" ? input.idempotencyKey : null;
    if (kunci && state.kunci.has(kunci)) return { ok: true, id: "bkm1", docNo: "BKM/1", diulang: true };
    return { ok: true, id: "bkm1", docNo: "BKM/1" };
  }),
}));
vi.mock("@elorae/db", () => ({
  prisma: {
    receivable: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.filter((id) => state.konsi.has(id)).map((id) => ({ store: { salesmanId: state.konsi.get(id) ?? null } })),
      ),
    },
    paymentClaim: {
      findUnique: vi.fn(async ({ where }: { where: { idempotencyKey: string } }) =>
        state.kunci.get(where.idempotencyKey) ?? null,
      ),
    },
  },
}));

const { buatKlaimAction, putuskanGiroAction, verifikasiKlaimAction } = await import("./receivables");

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
  state.konsi = new Map();
  state.tulisGagal = null;
  state.putusan = { ok: true };
  kabarBeban.dariKlaim.mockClear();
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

describe("buatKlaimAction — tagihan konsinyasi hanya lewat pemegang toko (P31)", () => {
  it("accepts the store holder's report on a konsi bill, lock off", async () => {
    state.konsi.set("f1", "u1");
    expect(await buatKlaimAction(DASAR)).toEqual({ ok: true, docNo: "BKM/1" });
  });

  it("refuses a non-holder even with the own-store lock off", async () => {
    state.konsi.set("f1", "u2");
    expect(await buatKlaimAction(DASAR)).toEqual({ ok: false, kode: "TOKO_TIDAK_DIIZINKAN" });
    expect(state.dicatat).toHaveLength(0);
  });

  it("refuses a konsi bill at a store without a holder", async () => {
    state.konsi.set("f1", null);
    expect(await buatKlaimAction(DASAR)).toEqual({ ok: false, kode: "TOKO_TIDAK_DIIZINKAN" });
  });

  it("still returns the salesperson's own recorded replay first", async () => {
    state.konsi.set("f1", "u2");
    state.kunci.set("hp-9", { salesmanId: "u1" });
    expect(await buatKlaimAction({ ...DASAR, idempotencyKey: "hp-9" })).toEqual({ ok: true, docNo: "BKM/1" });
  });

  it("leaves the office path exempt", async () => {
    state.sesi = { user: { id: "kantor", permissions: ["receivables:manage"] } };
    state.konsi.set("f1", "u2");
    expect(await buatKlaimAction(DASAR)).toEqual({ ok: true, docNo: "BKM/1" });
  });
});

describe("kabar selisih retur yang ditanggung TOKO ke pemegang toko (P84, keputusan 1)", () => {
  /*
   * Saat selisih diputuskan ditanggung toko, pemegang dikabari "kalau nanti dipotong … tagih saat
   * itu". BKM yang memotong nota retur itu — dicatat, diverifikasi, atau giro yang cair — adalah
   * "saat itu". Isi kabarnya (nota mana, berapa, dilewati bila pemegangnya sendiri yang bertindak)
   * diuji di `lib/receivables/kabar-beban-toko.test.ts`.
   */
  it("BKM baru yang tercatat memanggilnya, dengan pelapornya sebagai pelaku", async () => {
    expect(await buatKlaimAction(DASAR)).toEqual({ ok: true, docNo: "BKM/1" });
    expect(kabarBeban.dariKlaim).toHaveBeenCalledTimes(1);
    expect(kabarBeban.dariKlaim).toHaveBeenCalledWith("bkm1", "u1");
  });

  it("kiriman ulang antrean HP yang sudah tercatat tidak mengabari lagi", async () => {
    state.kunci.set("hp-5", { salesmanId: "u1" });
    expect(await buatKlaimAction({ ...DASAR, idempotencyKey: "hp-5" })).toEqual({ ok: true, docNo: "BKM/1" });
    expect(kabarBeban.dariKlaim).not.toHaveBeenCalled();
  });

  it("BKM yang ditolak, oleh aksi atau oleh penulisnya, tidak mengabari", async () => {
    state.tokoTetap = "s1";
    expect(await buatKlaimAction(DASAR)).toEqual({ ok: false, kode: "TANPA_AKSES" });
    state.tokoTetap = null;
    state.tulisGagal = "SUDAH_LUNAS";
    expect(await buatKlaimAction(DASAR)).toEqual({ ok: false, kode: "SUDAH_LUNAS" });
    expect(kabarBeban.dariKlaim).not.toHaveBeenCalled();
  });

  it("verifikasi TERVERIFIKASI mengabari; DITOLAK dan penolakan penulis tidak", async () => {
    state.sesi = { user: { id: "keu", permissions: ["payments:verify"] } };
    expect(await verifikasiKlaimAction("bkm7", "TERVERIFIKASI")).toEqual({ ok: true });
    expect(kabarBeban.dariKlaim).toHaveBeenCalledWith("bkm7", "keu");
    kabarBeban.dariKlaim.mockClear();

    expect(await verifikasiKlaimAction("bkm7", "DITOLAK", "tidak ada di mutasi")).toEqual({ ok: true });
    state.putusan = { ok: false, alasan: "SUDAH_DIPUTUSKAN" };
    expect(await verifikasiKlaimAction("bkm7", "TERVERIFIKASI")).toEqual({ ok: false, kode: "SUDAH_DIPUTUSKAN" });
    expect(kabarBeban.dariKlaim).not.toHaveBeenCalled();
  });

  it("giro CAIR (verifikasi lewat pintu yang sama) mengabari; giro DITOLAK tidak", async () => {
    state.sesi = { user: { id: "keu", permissions: ["payments:verify"] } };
    expect(await putuskanGiroAction("bkm8", "CAIR")).toEqual({ ok: true });
    expect(kabarBeban.dariKlaim).toHaveBeenCalledWith("bkm8", "keu");
    kabarBeban.dariKlaim.mockClear();

    expect(await putuskanGiroAction("bkm8", "DITOLAK", "dana tidak cukup")).toEqual({ ok: true });
    expect(kabarBeban.dariKlaim).not.toHaveBeenCalled();
  });
});

describe("antrean luring HP", () => {
  it("treats both refusals as final, not as something to resend forever", () => {
    expect(nasibLaporan({ ok: false, kode: "TANPA_AKSES" })).toBe("terminal");
    expect(nasibLaporan({ ok: false, kode: "TOKO_TIDAK_DIIZINKAN" })).toBe("terminal");
  });
});
