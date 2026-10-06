import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Kabar ke salesman dipasang di aksi-aksi backoffice (pengiriman, verifikasi BKM, retur, perubahan
 * toko). Yang diuji di sini hanya KAITANNYA: siapa penerimanya, kapan TIDAK dikirim, dan bahwa
 * kegagalan kabar tidak mengubah hasil aksi. Penulis dan basis data dipalsukan seluruhnya.
 */

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  kabari: vi.fn(),
  db: {
    paymentClaim: { findUnique: vi.fn() },
    storeReturn: { findUnique: vi.fn() },
    returnCharge: { findUnique: vi.fn() },
    storeChangeRequest: { findUnique: vi.fn() },
    fieldSalesDelivery: { findUnique: vi.fn() },
    fieldSalesOrder: { findUnique: vi.fn() },
  },
  putuskanKlaim: vi.fn(),
  batalkanKlaim: vi.fn(),
  catatHitunganGudang: vi.fn(),
  jodohkanRetur: vi.fn(),
  putuskanBeban: vi.fn(),
  alihkanBeban: vi.fn(),
  approveStore: vi.fn(),
  rejectStore: vi.fn(),
  recordDelivery: vi.fn(),
  closeRemainder: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@elorae/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@elorae/db")>()),
  prisma: h.db,
}));
vi.mock("@/lib/notifications/kabar-pengguna", async () => {
  const JENIS_KABAR = Object.fromEntries(
    [
      "PESANAN_DIKIRIM",
      "PESANAN_DITUTUP",
      "PELUNASAN_TERVERIFIKASI",
      "PELUNASAN_DITOLAK",
      "PELUNASAN_DIBATALKAN",
      "RETUR_DIHITUNG",
      "RETUR_DIBEBANKAN",
      "PERUBAHAN_TOKO_DISETUJUI",
      "PERUBAHAN_TOKO_DITOLAK",
    ].map((k) => [k, k]),
  );
  return { JENIS_KABAR, kabariPengguna: h.kabari };
});
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));
// Kabar "barang sedang dikirim" ke SPG punya tesnya sendiri; di sini cukup tidak menyentuh basis data.
vi.mock("@/lib/spg/pesanan-menuju-toko", () => ({ kabarkanKirimanBerangkat: vi.fn(async () => undefined) }));
vi.mock("@/app/actions/audit", () => ({ logPrint: vi.fn() }));
vi.mock("@/lib/receivables/writer", () => ({
  putuskanKlaim: h.putuskanKlaim,
  batalkanKlaim: h.batalkanKlaim,
  tautkanUlangPotongan: vi.fn(),
}));
vi.mock("@/lib/receivables/claim-writer", () => ({ buatKlaimPembayaran: vi.fn() }));
vi.mock("@/lib/receivables/return-writer", () => ({
  catatHitunganGudang: h.catatHitunganGudang,
  jodohkanRetur: h.jodohkanRetur,
  putuskanBeban: h.putuskanBeban,
  alihkanBeban: h.alihkanBeban,
  catatReturToko: vi.fn(),
  lepasPasangan: vi.fn(),
  tandaiBebanLunas: vi.fn(),
  batalkanRetur: vi.fn(),
}));
vi.mock("@/lib/store-changes/writer", () => ({
  approveStoreChangeRequest: h.approveStore,
  rejectStoreChangeRequest: h.rejectStore,
}));
vi.mock("@/lib/field-sales/delivery/writer", () => ({
  recordFieldSalesDelivery: h.recordDelivery,
  closeFieldSalesOrderRemainder: h.closeRemainder,
}));

import { batalkanKlaimAction, verifikasiKlaimAction } from "@/app/actions/receivables";
import {
  alihkanBebanAction,
  catatHitunganGudangAction,
  jodohkanReturAction,
  putuskanBebanAction,
} from "@/app/actions/store-returns";
import { approveStoreChangeRequestAction, rejectStoreChangeRequestAction } from "@/app/actions/store-changes";
import { closeRemainderAction, recordDeliveryAction } from "@/app/actions/field-sales-deliveries";

/** Kabar dikirim tanpa di-await; tunggu antreannya habis sebelum memeriksa. */
const tuntas = () => new Promise((r) => setTimeout(r, 0));

const ADMIN = "admin-1";

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ user: { id: ADMIN, permissions: ["*"] } });
});

describe("kabar pelunasan", () => {
  beforeEach(() => {
    h.db.paymentClaim.findUnique.mockResolvedValue({
      docNo: "BKM-0001",
      salesmanId: "sales-1",
      receivedAmount: 1_500_000,
      store: { name: "Toko Maju" },
    });
  });

  it("terverifikasi dikabarkan ke pelapor BKM (salesmanId)", async () => {
    h.putuskanKlaim.mockResolvedValue({ ok: true, sisaBaru: [] });
    expect(await verifikasiKlaimAction("klaim-1", "TERVERIFIKASI")).toEqual({ ok: true });
    await tuntas();
    expect(h.kabari).toHaveBeenCalledTimes(1);
    const [penerima, kabar] = h.kabari.mock.calls[0];
    expect(penerima).toBe("sales-1");
    expect(kabar).toMatchObject({
      jenis: "PELUNASAN_TERVERIFIKASI",
      judul: "Pelunasan BKM-0001 terverifikasi",
      data: { claimId: "klaim-1" },
    });
    expect(kabar.isi).toContain("Toko Maju");
  });

  it("ditolak membawa catatannya", async () => {
    h.putuskanKlaim.mockResolvedValue({ ok: true, sisaBaru: [] });
    await verifikasiKlaimAction("klaim-1", "DITOLAK", "Transfer tidak ada di mutasi");
    await tuntas();
    expect(h.kabari.mock.calls[0][1]).toMatchObject({ jenis: "PELUNASAN_DITOLAK" });
    expect(h.kabari.mock.calls[0][1].isi).toContain("Transfer tidak ada di mutasi");
  });

  it("dibatalkan membawa alasannya", async () => {
    h.batalkanKlaim.mockResolvedValue({ ok: true, piutangDihitungUlang: 1 });
    await batalkanKlaimAction("klaim-1", "Salah faktur");
    await tuntas();
    expect(h.kabari.mock.calls[0][1]).toMatchObject({ jenis: "PELUNASAN_DIBATALKAN" });
    expect(h.kabari.mock.calls[0][1].isi).toContain("Salah faktur");
  });

  it("keputusan yang gagal tidak dikabarkan", async () => {
    h.putuskanKlaim.mockResolvedValue({ ok: false, alasan: "SUDAH_DIPUTUSKAN" });
    await verifikasiKlaimAction("klaim-1", "TERVERIFIKASI");
    await tuntas();
    expect(h.kabari).not.toHaveBeenCalled();
  });

  it("pembacaan kabar yang gagal tidak mengubah hasil aksi", async () => {
    h.putuskanKlaim.mockResolvedValue({ ok: true, sisaBaru: [] });
    h.db.paymentClaim.findUnique.mockRejectedValue(new Error("db down"));
    const galat = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await verifikasiKlaimAction("klaim-1", "TERVERIFIKASI")).toEqual({ ok: true });
    await tuntas();
    expect(h.kabari).not.toHaveBeenCalled();
    galat.mockRestore();
  });
});

describe("kabar retur", () => {
  beforeEach(() => {
    h.db.storeReturn.findUnique.mockResolvedValue({
      noNrt: "NRT-4471",
      salesmanId: "sales-1",
      claimedAmount: 900_000,
      store: { name: "Toko Maju" },
      // Kabarnya menyebut jumlah potong yang dihitung gudang (Σ baris NRI).
      warehouseReturn: { physicalAmount: 700_000, items: [{ qty: 2 }, { qty: 1 }] },
    });
    h.db.returnCharge.findUnique.mockResolvedValue({
      amount: 200_000,
      storeReturnId: "nrt-1",
      store: { name: "Toko Maju" },
      storeReturn: { noNrt: "NRT-4471", store: { name: "Toko Maju" } },
      warehouseReturn: { noNri: "NRI/2026/0001" },
    });
  });

  it("hitungan gudang dikabarkan ke pelapor NRT, dengan selisihnya", async () => {
    h.catatHitunganGudang.mockResolvedValue({ ok: true, id: "nri-1", noNri: "NRI/1", barisStok: 0, piutangDihitungUlang: 0 });
    await catatHitunganGudangAction({ storeReturnId: "nrt-1", receivedAt: "2026-09-30", deliveryMethod: "SALES" });
    await tuntas();
    expect(h.kabari.mock.calls[0][0]).toBe("sales-1");
    expect(h.kabari.mock.calls[0][1]).toMatchObject({ jenis: "RETUR_DIHITUNG", data: { returnId: "nrt-1" } });
    expect(h.kabari.mock.calls[0][1].isi).toContain("selisih");
  });

  it("penerimaan yatim (tanpa NRT) tidak punya pelapor untuk dikabari", async () => {
    h.catatHitunganGudang.mockResolvedValue({ ok: true, id: "nri-1", noNri: "NRI/1", barisStok: 0, piutangDihitungUlang: 0 });
    await catatHitunganGudangAction({ storeId: "toko-1", receivedAt: "2026-09-30", deliveryMethod: "EKSPEDISI" });
    await tuntas();
    expect(h.kabari).not.toHaveBeenCalled();
  });

  it("menjodohkan penerimaan yatim mengabari pelapor NRT-nya", async () => {
    h.jodohkanRetur.mockResolvedValue({ ok: true, piutangDihitungUlang: 0 });
    await jodohkanReturAction("nri-1", "nrt-1");
    await tuntas();
    expect(h.kabari.mock.calls[0][1]).toMatchObject({ jenis: "RETUR_DIHITUNG" });
  });

  it("beban ke SALES dikabarkan ke orang yang ditetapkan", async () => {
    h.putuskanBeban.mockResolvedValue({ ok: true, piutangDihitungUlang: 0 });
    await putuskanBebanAction("beban-1", "SALES", "Barang rusak di mobil", "sales-2");
    await tuntas();
    expect(h.kabari.mock.calls[0][0]).toBe("sales-2");
    expect(h.kabari.mock.calls[0][1]).toMatchObject({
      jenis: "RETUR_DIBEBANKAN",
      judul: "Selisih retur NRT-4471 dibebankan ke Anda",
      data: { chargeId: "beban-1", returnId: "nrt-1" },
    });
  });

  it("beban ke toko atau perusahaan tidak mengabari siapa pun", async () => {
    h.putuskanBeban.mockResolvedValue({ ok: true, piutangDihitungUlang: 0 });
    await putuskanBebanAction("beban-1", "TOKO", "Toko setuju", "sales-2");
    await tuntas();
    expect(h.kabari).not.toHaveBeenCalled();
  });

  it("mengalihkan ke sales lain mengabari orang barunya; menyimpan ulang orang yang sama tidak", async () => {
    h.alihkanBeban.mockResolvedValue({ ok: true });
    h.db.returnCharge.findUnique.mockResolvedValueOnce({ bearer: "SALES", bearerUserId: "sales-2" });
    await alihkanBebanAction("beban-1", "SALES", "Koreksi catatan", "sales-2");
    await tuntas();
    expect(h.kabari).not.toHaveBeenCalled();

    h.db.returnCharge.findUnique.mockResolvedValueOnce({ bearer: "SALES", bearerUserId: null });
    await alihkanBebanAction("beban-1", "SALES", "Orangnya dilengkapi", "sales-3");
    await tuntas();
    expect(h.kabari).toHaveBeenCalledTimes(1);
    expect(h.kabari.mock.calls[0][0]).toBe("sales-3");
  });
});

describe("kabar perubahan data toko", () => {
  it("disetujui dikabarkan ke pengusul, dengan storeId", async () => {
    h.approveStore.mockResolvedValue({ ok: true });
    h.db.storeChangeRequest.findUnique.mockResolvedValue({ storeId: "toko-1", requestedById: "sales-1", store: { name: "Toko Baru" } });
    await approveStoreChangeRequestAction("usulan-1", "toko-1");
    await tuntas();
    expect(h.kabari.mock.calls[0][0]).toBe("sales-1");
    expect(h.kabari.mock.calls[0][1]).toMatchObject({ jenis: "PERUBAHAN_TOKO_DISETUJUI", data: { storeId: "toko-1" } });
  });

  it("ditolak membawa alasannya", async () => {
    h.rejectStore.mockResolvedValue({ ok: true });
    h.db.storeChangeRequest.findUnique.mockResolvedValue({ storeId: "toko-1", requestedById: "sales-1", store: { name: "Toko Maju" } });
    await rejectStoreChangeRequestAction("usulan-1", "toko-1", "  Alamat tidak sesuai  ");
    await tuntas();
    expect(h.kabari.mock.calls[0][1]).toMatchObject({ jenis: "PERUBAHAN_TOKO_DITOLAK", isi: "Alasan: Alamat tidak sesuai" });
  });

  it("peninjau yang kebetulan pengusulnya sendiri tidak dikabari", async () => {
    h.approveStore.mockResolvedValue({ ok: true });
    h.db.storeChangeRequest.findUnique.mockResolvedValue({ storeId: "toko-1", requestedById: ADMIN, store: { name: "Toko Maju" } });
    await approveStoreChangeRequestAction("usulan-1", "toko-1");
    await tuntas();
    expect(h.kabari).not.toHaveBeenCalled();
  });
});

describe("kabar pengiriman pesanan", () => {
  const input = {
    orderId: "order-1",
    lines: [{ orderLineId: "line-1", qty: 2 }],
    invoiceDate: "2026-09-30",
    dueDate: "2026-10-30",
    idempotencyKey: "kunci-1",
  };

  beforeEach(() => {
    h.recordDelivery.mockResolvedValue({ deliveryId: "dlv-1", docNo: "DLV/2026/0001" });
    h.db.fieldSalesDelivery.findUnique.mockImplementation(async (args: { where: { idempotencyKey?: string; id?: string } }) =>
      args.where.idempotencyKey
        ? null
        : {
            docNo: "DLV/2026/0001",
            total: 250_000,
            order: {
              id: "order-1",
              orderNo: "PUT/2026/0012",
              salesmanId: "sales-1",
              deliveryStatus: "PARTIAL",
              store: { name: "Toko Maju" },
            },
          },
    );
  });

  it("pengiriman baru dikabarkan ke salesman pesanan", async () => {
    expect(await recordDeliveryAction(input)).toEqual({ ok: true });
    await tuntas();
    expect(h.kabari.mock.calls[0][0]).toBe("sales-1");
    expect(h.kabari.mock.calls[0][1]).toMatchObject({
      jenis: "PESANAN_DIKIRIM",
      judul: "Pesanan PUT/2026/0012 dikirim sebagian",
      data: { orderId: "order-1", deliveryId: "dlv-1" },
    });
  });

  it("kiriman ulang dengan kunci yang sama tidak dikabarkan dua kali", async () => {
    h.db.fieldSalesDelivery.findUnique.mockResolvedValueOnce({ id: "dlv-1" });
    expect(await recordDeliveryAction(input)).toEqual({ ok: true });
    await tuntas();
    expect(h.kabari).not.toHaveBeenCalled();
  });

  it("menutup sisa pesanan dikabarkan dengan alasannya", async () => {
    h.closeRemainder.mockResolvedValue({ ok: true });
    h.db.fieldSalesOrder.findUnique.mockResolvedValue({ orderNo: "PUT/2026/0012", salesmanId: "sales-1", store: { name: "Toko Maju" } });
    await closeRemainderAction("order-1", " Stok habis ");
    await tuntas();
    expect(h.kabari.mock.calls[0][1]).toMatchObject({ jenis: "PESANAN_DITUTUP", data: { orderId: "order-1" } });
    expect(h.kabari.mock.calls[0][1].isi).toContain("Alasan: Stok habis");
  });
});
