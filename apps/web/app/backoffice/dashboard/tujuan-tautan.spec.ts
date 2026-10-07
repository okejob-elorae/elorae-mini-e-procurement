import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Tautan Beranda mendarat di daftar yang SUDAH tersaring dengan definisi yang
 * sama dengan angkanya. Tes di `lib/dashboard/antrean-kantor.test.ts` hanya
 * memastikan tautannya membawa saringan; di sini halaman tujuannya dibuka
 * dengan alamat tautan itu sendiri, dan yang diperiksa adalah baris yang
 * DIKIRIM halaman ke kliennya.
 *
 * Tanpa basis data: model Prisma ditiru, dan tiruannya menerapkan `where` yang
 * dipakai halaman — jadi membuang saringan di halaman menggagalkan tes.
 */

type Klaim = { id: string; status: string };
type Toko = { id: string; name: string; isActive: boolean; salesmanId: string | null };
type Permintaan = { id: string; status: string; tokoId: string };
type Biaya = { id: string; status: string; spentAt: Date };

const data = vi.hoisted(() => ({
  klaim: [] as Klaim[],
  koreksi: new Set<string>(),
  toko: [] as Toko[],
  perubahan: [] as { storeId: string; status: string }[],
  permintaan: [] as Permintaan[],
  biaya: [] as Biaya[],
  retur: [] as { jenis: string; id: string }[],
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "u-admin", permissions: ["*"] } })) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  },
  notFound: () => {
    throw new Error("__NOT_FOUND__");
  },
}));

const bulanWib = (d: Date) => new Date(d.getTime() + 7 * 3_600_000).toISOString().slice(0, 7);

vi.mock("@elorae/db", () => ({
  prisma: {
    paymentClaim: {
      findMany: vi.fn(async () =>
        data.klaim.map((k) => ({
          id: k.id,
          docNo: `BKM-${k.id}`,
          claimedTransferAt: new Date("2026-10-01T03:00:00Z"),
          invoiceAmount: 100,
          deductionTotal: 0,
          receivedAmount: 100,
          status: k.status,
          verifyNote: null,
          method: "TRANSFER",
          giroNo: null,
          giroIssueDate: null,
          giroEffectiveDate: null,
          giroStatus: null,
          salesmanId: "s1",
          createdById: "s1",
          store: { name: "Toko" },
          salesman: { name: "Sales" },
          deductions: [],
        })),
      ),
    },
    expenseClaim: {
      findMany: vi.fn(async (args: { where?: { status?: string } }) =>
        data.biaya.filter((b) => !args.where?.status || b.status === args.where.status).map((b) => ({ spentAt: b.spentAt })),
      ),
    },
    store: {
      findMany: vi.fn(async (args: { where?: { salesmanId?: string | null } }) =>
        data.toko
          .filter((t) => !args.where || !("salesmanId" in args.where) || t.salesmanId === args.where.salesmanId)
          .map((t) => ({ id: t.id })),
      ),
    },
    storeChangeRequest: {
      findMany: vi.fn(async (args: { where?: { status?: string } }) =>
        data.perubahan.filter((p) => !args.where?.status || p.status === args.where.status),
      ),
    },
    storeReturn: { findMany: vi.fn(async () => []) },
    user: { findMany: vi.fn(async () => []) },
  },
}));

vi.mock("@/lib/receivables/koreksi", () => ({
  koreksiTertunda: vi.fn(
    async (_jenis: string, ids: string[]) =>
      new Map(ids.filter((id) => data.koreksi.has(id)).map((id) => [id, { pada: "", alasan: "" }])),
  ),
}));

// Halaman toko.
vi.mock("@/lib/salesman/queries", () => ({ daftarSalesman: vi.fn(async () => []) }));
vi.mock("@/lib/stores/areas", () => ({ daftarArea: vi.fn(async () => []) }));
vi.mock("@/lib/stores/kelas-toko", () => ({ bacaKelas: () => null }));
vi.mock("@/lib/stores/usulan-queries", () => ({ jumlahUsulanMenunggu: vi.fn(async () => 0) }));
vi.mock("@/lib/store-changes/queries", () => ({
  listPendingStoreChangeStoreIds: vi.fn(async (ids: string[]) => new Set(ids)),
}));
vi.mock("@/lib/stores/queries", () => ({
  listStores: vi.fn(async (opts: { activeOnly?: boolean }, paging?: { page: number; pageSize: number }) => {
    const rows = data.toko.filter((t) => !opts.activeOnly || t.isActive);
    const items = paging ? rows.slice((paging.page - 1) * paging.pageSize, paging.page * paging.pageSize) : rows;
    return { items: items.map((t) => ({ ...t })), totalCount: rows.length };
  }),
}));

// Permintaan stok SPG.
vi.mock("@/lib/spg/kantor-queries", () => ({
  daftarPermintaanKiriman: vi.fn(async (opsi: { status?: string } = {}) =>
    data.permintaan
      .filter((p) => !opsi.status || p.status === opsi.status)
      .map((p) => ({
        id: p.id,
        toko: { id: p.tokoId, name: p.tokoId },
        peminta: "SPG",
        status: p.status,
        catatan: null,
        dibuat: "2026-10-01T03:00:00.000Z",
        ditangani: null,
        baris: [],
        totalQty: 1,
      })),
  ),
}));

// Biaya perjalanan: daftar kantor per bulan WIB (`rentangBulanWib`).
vi.mock("@/lib/salesman/biaya-queries", () => ({
  daftarBiayaKantor: vi.fn(async (s: { bulan: string; status: string | null }) => ({
    baris: data.biaya
      .filter((b) => bulanWib(b.spentAt) === s.bulan && (!s.status || b.status === s.status))
      .map((b) => ({ id: b.id, status: b.status, nilai: 10 })),
    perStatus: {},
    total: { jumlah: 0, nilai: 0 },
  })),
}));

// Piutang: kontrabon dan retur toko.
vi.mock("@/lib/receivables/collection-queries", () => ({
  daftarKontrabon: vi.fn(async () => []),
  piutangSiapKontrabon: vi.fn(async () => []),
}));
vi.mock("@/lib/receivables/return-queries", () => ({
  daftarKerjaRetur: vi.fn(async () => data.retur),
  katalogBarang: vi.fn(async () => []),
  notaBelumBerpasangan: vi.fn(async () => []),
  tokoUntukRetur: vi.fn(async () => []),
  ringkasKerjaRetur: vi.fn(() => ({})),
}));

// Komponen klien tidak dirender — yang diuji props yang dikirim halaman.
vi.mock("@/app/backoffice/pelunasan/PelunasanClient", () => ({ PelunasanClient: () => null }));
vi.mock("@/app/backoffice/pelunasan/[id]/putusan-klaim", () => ({ pemeriksaSamaKlaim: () => false }));
vi.mock("@/app/backoffice/stores/StoreListClient", () => ({ StoreListClient: () => null }));
vi.mock("@/app/backoffice/spg-requests/PermintaanKirimanClient", () => ({ PermintaanKirimanClient: () => null }));
vi.mock("@/app/backoffice/biaya-perjalanan/BiayaPerjalananClient", () => ({ BiayaPerjalananClient: () => null }));
vi.mock("@/app/backoffice/kontrabon/KontrabonClient", () => ({ KontrabonClient: () => null }));
vi.mock("@/app/backoffice/retur-toko/ReturTokoClient", () => ({ ReturTokoClient: () => null }));

const { ANTREAN_KANTOR } = await import("@/lib/dashboard/antrean-kantor");
const { buildActionItems } = await import("@/lib/dashboard/action-items");

type Halaman = (p: { searchParams: Promise<Record<string, string>> }) => Promise<unknown>;
const halaman = async (jalur: string) => (await import(jalur)).default as Halaman;

/** Membuka halaman dengan alamat tautan Beranda; mengembalikan props kliennya. */
async function buka(href: string, jalurModul: string): Promise<Record<string, unknown>> {
  const url = new URL(href, "http://x");
  const el = (await (await halaman(jalurModul))({
    searchParams: Promise.resolve(Object.fromEntries(url.searchParams)),
  })) as { props: Record<string, unknown> };
  return el.props;
}

const hrefBaris = (key: string) => {
  const items = buildActionItems(
    {
      fieldSalesPendingApproval: 1,
      storeChangesPending: 1,
      taxInvoicePending: 1,
      salesReturnPending: 1,
      journalPending: 1,
      overduePOs: 1,
      draftPOs: 1,
      oversoldSkus: 1,
      unshippedOrders: 1,
      claimsAwaitingVerification: { count: 1, amount: 1 },
    },
    ["*"],
  );
  const href = items.find((i) => i.key === key)?.href;
  if (!href) throw new Error(`baris ${key} tidak ada`);
  return href;
};

beforeEach(() => {
  data.klaim = [
    { id: "k1", status: "DIKIRIM" },
    { id: "k2", status: "TERVERIFIKASI" },
    { id: "k3", status: "DIKIRIM" },
    { id: "k4", status: "DITOLAK" },
    { id: "k5", status: "DIBATALKAN" },
  ];
  data.koreksi = new Set(["k2", "n2"]);
  data.toko = [
    { id: "t1", name: "Aktif tanpa pemegang", isActive: true, salesmanId: null },
    { id: "t2", name: "Aktif dipegang", isActive: true, salesmanId: "s1" },
    { id: "t3", name: "Nonaktif", isActive: false, salesmanId: null },
  ];
  data.perubahan = [
    { storeId: "t2", status: "PENDING" },
    { storeId: "t3", status: "PENDING" },
    { storeId: "t1", status: "APPROVED" },
  ];
  data.permintaan = [
    { id: "p1", status: "BARU", tokoId: "t1" },
    { id: "p2", status: "BARU", tokoId: "t2" },
    { id: "p3", status: "DIPROSES", tokoId: "t1" },
    { id: "p4", status: "BARU", tokoId: "t3" },
  ];
  data.biaya = [
    // Bulan lalu dan bulan-bulan sebelumnya: tetap menunggu, tetap harus tampil.
    { id: "b1", status: "DIAJUKAN", spentAt: new Date("2026-06-30T18:00:00Z") }, // 1 Juli WIB
    { id: "b2", status: "DIAJUKAN", spentAt: new Date("2026-10-02T03:00:00Z") },
    { id: "b3", status: "DISETUJUI", spentAt: new Date("2026-08-15T03:00:00Z") },
    { id: "b4", status: "DIBAYAR", spentAt: new Date("2026-10-03T03:00:00Z") },
  ];
  data.retur = [
    { jenis: "NRT", id: "n1" },
    { jenis: "NRT", id: "n2" },
    { jenis: "GUDANG_YATIM", id: "g1" },
  ];
});

describe("tujuan tautan Beranda — halaman menerapkan saringan yang sama dengan angkanya", () => {
  it("BKM menunggu verifikasi → hanya BKM DIKIRIM", async () => {
    const p = await buka(hrefBaris("claimsAwaitingVerification"), "@/app/backoffice/pelunasan/page");
    expect((p.baris as Klaim[]).map((b) => b.id)).toEqual(["k1", "k3"]);
    // Halaman kini juga meneruskan `cari`; yang diperiksa saringan tautannya.
    expect(p.saring).toMatchObject({ status: "DIKIRIM", koreksi: false });
    // Chip saringan menghitung SEMUA BKM, bukan hanya yang sedang tampil.
    expect(p.jumlah).toMatchObject({ semua: 5, DIKIRIM: 2, TERVERIFIKASI: 1, DITOLAK: 1, koreksi: 1 });
  });

  it("Permintaan koreksi BKM → hanya BKM yang koreksinya tertunda, apa pun statusnya", async () => {
    const p = await buka(ANTREAN_KANTOR.claimCorrectionsPending.href, "@/app/backoffice/pelunasan/page");
    expect((p.baris as Klaim[]).map((b) => b.id)).toEqual(["k2"]);
  });

  it("Pelunasan tanpa saringan tetap memuat semua BKM", async () => {
    const p = await buka("/backoffice/pelunasan", "@/app/backoffice/pelunasan/page");
    expect((p.baris as Klaim[]).map((b) => b.id)).toEqual(["k1", "k2", "k3", "k4", "k5"]);
  });

  it("Permintaan koreksi nota retur → saringan awal koreksi dan id notanya", async () => {
    const p = await buka(ANTREAN_KANTOR.returnCorrectionsPending.href, "@/app/backoffice/retur-toko/page");
    // Saringan kini diterapkan di server (`saring`, dulu `saringAwal` di klien).
    expect(p.saring).toBe("koreksi");
    expect(p.koreksiIds).toEqual(["n2"]);
  });

  it("Janji bayar lapangan → kontrabon terbuka dengan saringan belum dikonfirmasi", async () => {
    const p = await buka(ANTREAN_KANTOR.fieldPromisesUnconfirmed.href, "@/app/backoffice/kontrabon/page");
    expect(p.saring).toBe("belum");
    // Tanpa saringan: bawaan halamannya (yang masih berjalan), bukan "belum dikonfirmasi".
    expect((await buka("/backoffice/kontrabon", "@/app/backoffice/kontrabon/page")).saring).toBe("berjalan");
  });

  it("Biaya menunggu persetujuan → semua bulan, bukan hanya bulan ini", async () => {
    const p = await buka(ANTREAN_KANTOR.expensesPendingApproval.href, "@/app/backoffice/biaya-perjalanan/page");
    const ids = ((p.data as { baris: { id: string }[] }).baris).map((b) => b.id);
    expect(ids.sort()).toEqual(["b1", "b2"]);
    expect(p.bulan).toBe("semua");
  });

  it("Biaya disetujui belum dibayar → semua bulan", async () => {
    const p = await buka(ANTREAN_KANTOR.expensesPendingPayment.href, "@/app/backoffice/biaya-perjalanan/page");
    expect(((p.data as { baris: { id: string }[] }).baris).map((b) => b.id)).toEqual(["b3"]);
  });

  it("Permintaan stok SPG di toko tanpa pemegang → hanya BARU di toko tanpa pemegang (aktif maupun nonaktif)", async () => {
    const p = await buka(ANTREAN_KANTOR.stockRequestsUnheld.href, "@/app/backoffice/spg-requests/page");
    expect((p.baris as { id: string }[]).map((b) => b.id).sort()).toEqual(["p1", "p4"]);
    expect(p.tanpaPemegang).toBe(true);
  });

  it("Perubahan data toko → hanya toko yang perubahannya menunggu, termasuk yang nonaktif", async () => {
    const p = await buka(hrefBaris("storeChangesPending"), "@/app/backoffice/stores/page");
    expect((p.stores as Toko[]).map((t) => t.id).sort()).toEqual(["t2", "t3"]);
    expect(p.totalCount).toBe(2);
    expect(p.jumlahPerubahan).toBe(2);
  });

  it("Daftar toko tanpa saringan perubahan tetap hanya toko aktif", async () => {
    const p = await buka("/backoffice/stores", "@/app/backoffice/stores/page");
    expect((p.stores as Toko[]).map((t) => t.id).sort()).toEqual(["t1", "t2"]);
  });
});
