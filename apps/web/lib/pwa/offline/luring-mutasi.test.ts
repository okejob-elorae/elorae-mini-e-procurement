import { describe, expect, it, vi } from "vitest";

/*
 * Mutasi antar toko di antrean HP — bagian murni: muatan kirim (kunci yang
 * sama dengan kiriman langsungnya, waktu tangkap, ikatan kunjungan), tanda
 * dikirim yang belum punya id mutasi server, keadaan ikatan ke ajuannya, dan
 * nasib jawaban server.
 */

vi.mock("./db", () => ({ pwaDb: {} }));

const { muatanAjuanMutasi, muatanKirimMutasi } = await import("./luring-muatan");
const { nasibIkatanAjuan } = await import("./luring-tergantung");
const { nasibKode, AJUAN_MUTASI_DITOLAK, AJUAN_MUTASI_HILANG } = await import("./luring-klasifikasi");

const ajuan = {
  localId: "a1",
  storeId: "t1",
  toStoreId: "t2",
  tujuanNama: "Toko Dua",
  langsung: false,
  alasan: "stok habis",
  baris: [
    { itemId: "i1", variantSku: "i1-M", qty: 2, productName: "Kaos — M" },
    { itemId: "i2", variantSku: null, qty: 1, productName: "Kemeja" },
  ],
  waktu: Date.UTC(2026, 9, 3, 2, 0, 0),
  visitId: "v1",
  visitClientId: null,
};

const kirim = {
  localId: "k1",
  storeId: "t1",
  transferId: "m1",
  ajuanLocalId: null,
  docNo: "MTS/2026/00001",
  tujuanNama: "Toko Dua",
  pcs: 3,
  waktu: Date.UTC(2026, 9, 3, 3, 0, 0),
  visitId: "v1",
  visitClientId: null,
};

describe("muatanAjuanMutasi", () => {
  it("sends the form's key, the phone's time and the visit, without display-only names", () => {
    expect(muatanAjuanMutasi(ajuan)).toEqual({
      toStoreId: "t2",
      alasan: "stok habis",
      baris: [
        { itemId: "i1", variantSku: "i1-M", qty: 2 },
        { itemId: "i2", variantSku: null, qty: 1 },
      ],
      idempotencyKey: "a1",
      luring: true,
      waktuTangkap: "2026-10-03T02:00:00.000Z",
      visitId: "v1",
    });
  });

  it("binds a check-in that is still on the phone by its phone id only", () => {
    const m = muatanAjuanMutasi({ ...ajuan, visitId: null, visitClientId: "hp-1" });
    expect(m).toMatchObject({ visitClientId: "hp-1" });
    expect(m).not.toHaveProperty("visitId");
  });
});

describe("muatanKirimMutasi", () => {
  it("sends the transfer id, the tap's key and time", () => {
    expect(muatanKirimMutasi(kirim)).toEqual({
      transferId: "m1",
      idempotencyKey: "k1",
      luring: true,
      waktuTangkap: "2026-10-03T03:00:00.000Z",
      visitId: "v1",
    });
  });

  it("has nothing to send while the transfer itself is still a request on the phone", () => {
    expect(muatanKirimMutasi({ ...kirim, transferId: null, ajuanLocalId: "a1", docNo: null })).toBeNull();
  });
});

describe("nasibIkatanAjuan", () => {
  it("sends a mark that already has a server transfer id", () => {
    expect(nasibIkatanAjuan({ transferId: "m1", ajuanLocalId: null }, null)).toBe("kirim");
    // Diarahkan ke id server: baris ajuan yang tersisa tidak lagi menahan.
    expect(nasibIkatanAjuan({ transferId: "m1", ajuanLocalId: "a1" }, { syncState: "pending" })).toBe("kirim");
  });

  it("waits for a request still in line, stops on one the server refused, and on one that is gone", () => {
    expect(nasibIkatanAjuan({ transferId: null, ajuanLocalId: "a1" }, { syncState: "pending" })).toBe("tunggu");
    expect(nasibIkatanAjuan({ transferId: null, ajuanLocalId: "a1" }, { syncState: "syncing" })).toBe("tunggu");
    expect(nasibIkatanAjuan({ transferId: null, ajuanLocalId: "a1" }, { syncState: "failed" })).toBe("ditolak");
    expect(nasibIkatanAjuan({ transferId: null, ajuanLocalId: "a1" }, undefined)).toBe("hilang");
    expect(nasibIkatanAjuan({ transferId: null, ajuanLocalId: null }, null)).toBe("hilang");
  });
});

describe("nasib jawaban mutasi", () => {
  it("evicts what was recorded (also a resend), stops every refusal, retries what threw", () => {
    expect(nasibKode({ ok: true })).toBe("evict");
    for (const code of ["MUTASI_DITOLAK", "MUTASI_DIBATALKAN", "SUDAH_DIKIRIM", "SIKLUS_TERKUNCI", "WAKTU_TIDAK_VALID", "KUNJUNGAN_TIDAK_SAH", "SALDO_KURANG"]) {
      expect(nasibKode({ ok: false, code })).toBe("terminal");
    }
    expect(nasibKode({ thrown: true })).toBe("retry");
  });

  it("uses local codes that never collide with a server code", () => {
    expect(AJUAN_MUTASI_DITOLAK).toBe("AJUAN_DITOLAK");
    expect(AJUAN_MUTASI_HILANG).toBe("AJUAN_TIDAK_ADA");
  });
});
