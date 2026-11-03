import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * `getAntreanKantor` hanya menjalankan kueri baris yang boleh dilihat
 * penontonnya. Tanpa basis data: setiap model ditiru dan setiap kueri dicatat.
 */

const catatan = vi.hoisted(() => ({ dipanggil: [] as string[], gagal: new Map<string, "sinkron" | "tolak">() }));

vi.mock("@elorae/db", () => {
  const model = (nama: string) =>
    new Proxy(
      {},
      {
        get: (_t, op: string) => {
          const cara = catatan.gagal.get(nama);
          if (cara === "sinkron") {
            return () => {
              throw new Error(`${nama} rusak`);
            };
          }
          return vi.fn(async () => {
            if (cara === "tolak") throw new Error(`${nama} rusak`);
            catatan.dipanggil.push(`${nama}.${op}`);
            if (op === "count") return 3;
            if (op === "groupBy") return [{ _sum: { qty: 2 } }, { _sum: { qty: 0 } }];
            return [];
          });
        },
      },
    );
  return {
    prisma: new Proxy({}, { get: (_t, nama: string) => model(nama) }),
    // Hitungan jadwal produksi dimuat lewat modul yang juga memuat `runSerializable`,
    // yang membaca tingkat isolasi saat modulnya dimuat.
    Prisma: { TransactionIsolationLevel: { Serializable: "Serializable" } },
  };
});
vi.mock("@/lib/stores/usulan-queries", () => ({
  jumlahUsulanMenunggu: vi.fn(async () => {
    catatan.dipanggil.push("usulan");
    return 4;
  }),
}));
vi.mock("@/lib/spg/shift-queries", () => ({
  jumlahTukarMenungguKantor: vi.fn(async () => {
    catatan.dipanggil.push("shift");
    return 5;
  }),
}));
// Dokumen tanpa jurnal menjalankan pencari sapuan (SQL mentah) — ditiru di tingkat modulnya.
vi.mock("@/lib/finance/integritas/queries", () => ({
  hitungDokumenTanpaJurnalDiam: vi.fn(async () => {
    catatan.dipanggil.push("tanpaJurnal");
    return 6;
  }),
}));
// Tiga hitungan keputusan pemilik 2026-11-02 — modulnya membawa SQL mentah (harga Jubelio) atau
// rantai impor yang berat (komisi, retur pembeli), jadi ditiru di tingkat modulnya.
vi.mock("@/lib/jubelio/harga/queries", () => ({
  hitungHargaMenungguKonfirmasi: vi.fn(async () => {
    catatan.dipanggil.push("hargaJubelio");
    return 7;
  }),
  hitungHargaBedaDiJubelio: vi.fn(async () => {
    catatan.dipanggil.push("hargaBeda");
    return 10;
  }),
}));
/*
 * Baris jawaban pemilik 2026-11-02 (putaran kedua). Modulnya membawa SQL mentah (Vendor Billing),
 * rantai transaksi (GRN tanpa PO), atau rantai impor yang berat (SPG, retur toko), jadi ditiru di
 * tingkat modulnya — setiap tiruan mencatat namanya sendiri.
 */
// `vi.hoisted`: pabrik `vi.mock` diangkat ke atas berkas, jadi pembantunya harus ikut diangkat.
const tiruHitung = vi.hoisted(
  () => (nama: string, nilai: number) =>
    vi.fn(async () => {
      catatan.dipanggil.push(nama);
      return nilai;
    }),
);
vi.mock("@/lib/spg/hilang-queries", () => ({
  jumlahKlaimEkspedisi: vi.fn(async () => {
    catatan.dipanggil.push("klaimEkspedisi");
    return { diajukan: 11, menungguCek: 12, ditolak: 13 };
  }),
}));
vi.mock("@/lib/spg/beban-spg-queries", () => ({ jumlahBebanPerluKeputusanBarang: tiruHitung("barangReturPembeli", 14) }));
vi.mock("@/lib/spg/jadwal-bulan-queries", () => ({ jumlahJadwalBulanMenunggu: tiruHitung("jadwalBulan", 15) }));
vi.mock("@/lib/spg/absen-catatan-hadir-queries", () => ({
  jumlahCatatanHadirPerluDimasukkan: tiruHitung("catatanMasukkan", 16),
  jumlahCatatanHadirMenungguPeriksa: tiruHitung("catatanPeriksa", 17),
}));
vi.mock("@/lib/spg/utang-queries", () => ({
  jumlahUtangSpgTerbuka: tiruHitung("utangSpg", 18),
  jumlahBayarUtangSpgMenungguCek: tiruHitung("bayarUtangSpg", 19),
}));
vi.mock("@/lib/vendor-billing/belum-ditagih-queries", () => ({ hitungPenerimaanBelumDiminta: tiruHitung("belumDiminta", 20) }));
vi.mock("@/lib/vendor-billing/permintaan-invoice-queries", () => ({ hitungPermintaanInvoiceTerlambat: tiruHitung("permintaanTerlambat", 21) }));
vi.mock("@/lib/vendor-billing/koreksi-utang-queries", () => ({ hitungSelisihHargaMenunggu: tiruHitung("selisihHarga", 22) }));
vi.mock("@/lib/grn/grn-tanpa-po-writer", () => ({ hitungGrnTanpaPoMenunggu: tiruHitung("grnTanpaPo", 23) }));
// Selisih retur dihitung dari daftar kerja Retur & pencocokan itu sendiri (langkah "keputusan").
vi.mock("@/lib/receivables/return-queries", () => ({
  daftarKerjaRetur: vi.fn(async (lingkup?: { tanpaYatim?: boolean }) => {
    catatan.dipanggil.push(`daftarKerjaRetur:${lingkup?.tanpaYatim ? "tanpaYatim" : "semua"}`);
    return [
      { jenis: "NRT", langkah: "keputusan" },
      { jenis: "NRT", langkah: "keputusan" },
      { jenis: "NRT", langkah: "cek" },
      { jenis: "NRT", langkah: "beres" },
    ];
  }),
}));
vi.mock("@/lib/spg/koreksi-queries", () => ({
  jumlahKomisiSpgTertunggak: vi.fn(async () => {
    catatan.dipanggil.push("komisiTertunggak");
    return 8;
  }),
}));
vi.mock("@/lib/spg/retur-pembeli-queries", () => ({
  jumlahReturPembeliMenunggu: vi.fn(async () => {
    catatan.dipanggil.push("returPembeli");
    return 9;
  }),
}));
vi.mock("@/lib/receivables/koreksi", () => ({
  koreksiTertunda: vi.fn(async () => {
    catatan.dipanggil.push("koreksi");
    return new Map([["k1", { pada: "", alasan: "" }]]);
  }),
}));

const { getAntreanKantor, KUNCI_ANTREAN } = await import("./antrean-kantor");

beforeEach(() => {
  catatan.dipanggil = [];
  catatan.gagal.clear();
  vi.restoreAllMocks();
});

describe("getAntreanKantor", () => {
  it("tanpa izin apa pun: tidak satu kueri pun berjalan", async () => {
    expect(await getAntreanKantor(["dashboard:view"])).toEqual({});
    expect(catatan.dipanggil).toEqual([]);
  });

  it("gudang: hanya kueri antrean gudang yang berjalan", async () => {
    const hasil = await getAntreanKantor(["dashboard:view", "inventory:view", "inventory:manage"]);
    expect(Object.keys(hasil).sort()).toEqual([
      "damagedDeliveriesOpen",
      "damagedWarehouseOpen",
      "exchangesPendingCompletion",
    ]);
    expect(catatan.dipanggil.sort()).toEqual([
      "damagedStockMovement.groupBy",
      "storeExchange.count",
      "storeReceiptLine.count",
    ]);
    // Saldo nol tidak menunggu keputusan apa pun.
    expect(hasil.damagedWarehouseOpen).toBe(1);
  });

  it("keuangan: koreksi BKM dan biaya yang menunggu dibayar", async () => {
    const hasil = await getAntreanKantor(["dashboard:view", "journals:manage", "payments:verify"]);
    // payments:verify membuka kartu #utang Komisi SPG (keputusan 11), tetapi tidak halaman barang
    // hilang (P28) — klaim ekspedisi yang menunggu cek tidak dihitung untuknya.
    expect(Object.keys(hasil).sort()).toEqual(["claimCorrectionsPending", "expensesPendingPayment", "spgDebtPaymentsToCheck"]);
    expect(catatan.dipanggil).not.toContain("klaimEkspedisi");
    expect(hasil.claimCorrectionsPending).toBe(1);
    expect(catatan.dipanggil).not.toContain("usulan");
    expect(catatan.dipanggil).not.toContain("shift");
  });

  it("journals:manage tanpa payments:verify: koreksi BKM tidak dihitung — memeriksa pembayaran izinnya sendiri", async () => {
    const hasil = await getAntreanKantor(["dashboard:view", "journals:manage"]);
    expect(Object.keys(hasil)).toEqual(["expensesPendingPayment"]);
    expect(catatan.dipanggil).not.toContain("koreksi");
  });

  it("produksi: hanya dua hitungan langkah jadwal produksi (terlambat, hari ini)", async () => {
    const hasil = await getAntreanKantor(["dashboard:view", "production_planning:view"]);
    expect(hasil).toEqual({ productionStepsOverdue: 3, productionStepsDueToday: 3 });
    expect(catatan.dipanggil.sort()).toEqual(["planStageStep.count", "planStageStep.count"]);
  });

  it("admin: setiap antrean dihitung", async () => {
    const hasil = await getAntreanKantor(["*"]);
    expect(Object.keys(hasil).sort()).toEqual([...KUNCI_ANTREAN].sort());
    expect(hasil.storeProposalsPending).toBe(4);
    expect(hasil.shiftSwapsPending).toBe(5);
    expect(hasil.jubelioPricesPending).toBe(7);
    expect(hasil.spgCommissionsUnpaidPast).toBe(8);
    expect(hasil.spgReturnsPending).toBe(9);
    expect(hasil.jubelioPricesDiffer).toBe(10);
    expect(hasil.klaimEkspedisiMenunggu).toBe(11);
    expect(hasil.klaimEkspedisiCek).toBe(12);
    expect(hasil.klaimEkspedisiDitolak).toBe(13);
    expect(hasil.spgReturnGoodsPending).toBe(14);
    expect(hasil.spgSchedulesPending).toBe(15);
    expect(hasil.spgAttendanceToEnter).toBe(16);
    expect(hasil.spgAttendanceToCheck).toBe(17);
    expect(hasil.spgDebtsOpen).toBe(18);
    expect(hasil.spgDebtPaymentsToCheck).toBe(19);
    expect(hasil.receiptsWithoutInvoice).toBe(20);
    expect(hasil.invoiceRequestsOverdue).toBe(21);
    expect(hasil.vendorBillPriceDifferences).toBe(22);
    expect(hasil.grnNoPoPending).toBe(23);
    // Hanya nota di langkah "keputusan", dan penerimaan yatim tidak dimuat.
    expect(hasil.returnShortfallsUndecided).toBe(2);
    expect(catatan.dipanggil).toContain("daftarKerjaRetur:tanpaYatim");
  });

  it("pengawas SPG tanpa izin memutuskan: retur pembeli dan komisi tertunggak tidak dihitung", async () => {
    const hasil = await getAntreanKantor(["dashboard:view", "spg_sales:view"]);
    expect(hasil).toEqual({});
    expect(catatan.dipanggil).not.toContain("returPembeli");
    expect(catatan.dipanggil).not.toContain("komisiTertunggak");
  });

  it("pemegang konfirmasi harga Jubelio saja: hanya hitungan harga yang berjalan", async () => {
    const hasil = await getAntreanKantor(["dashboard:view", "jubelio_prices:confirm"]);
    expect(hasil).toEqual({ jubelioPricesPending: 7, jubelioPricesDiffer: 10 });
    expect(catatan.dipanggil.sort()).toEqual(["hargaBeda", "hargaJubelio"]);
  });

  it("pemutus selisih retur saja: hanya daftar kerja retur yang dimuat, bukan hitungan barang hilang", async () => {
    const hasil = await getAntreanKantor(["dashboard:view", "receivables:view", "store_returns:decide_shortfall"]);
    expect(hasil).toEqual({ returnShortfallsUndecided: 2 });
    expect(catatan.dipanggil).toEqual(["daftarKerjaRetur:tanpaYatim"]);
  });

  it("pembelian: Vendor Billing tanpa izin memutuskan harga tidak menghitung selisih harga", async () => {
    const hasil = await getAntreanKantor(["dashboard:view", "vendor_bills:view", "vendor_bills:manage"]);
    expect(hasil).toEqual({ receiptsWithoutInvoice: 20, invoiceRequestsOverdue: 21 });
    expect(catatan.dipanggil).not.toContain("selisihHarga");
  });

  it("satu hitungan gagal (ditolak atau galat sinkron) tidak menjatuhkan Beranda: barisnya saja yang hilang", async () => {
    const galat = vi.spyOn(console, "error").mockImplementation(() => {});
    catatan.gagal.set("leaveRequest", "tolak");
    catatan.gagal.set("stockLoss", "sinkron");
    const hasil = await getAntreanKantor(["*"]);
    expect(Object.keys(hasil).sort()).toEqual(
      [...KUNCI_ANTREAN].filter((k) => k !== "leavePending" && k !== "stockLossOpen").sort(),
    );
    expect(hasil.storeProposalsPending).toBe(4);
    expect(galat).toHaveBeenCalledTimes(2);
  });
});
