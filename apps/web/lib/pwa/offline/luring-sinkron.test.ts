import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Penyinkron antrean tanpa sinyal (check-in, pekerjaan stok, check-out). Dexie
 * dan aksi server ditirukan — yang dipasak: urutan kirim, muatan (kunci yang
 * sama, waktu tangkap, kunjungan), pekerjaan yang menunggu check-in-nya,
 * pekerjaan yang berhenti karena check-in-nya ditolak, foto rusak yang
 * diunggah sekali, dan nasib setiap jawaban. Juga mutasi antar toko: ajuan dan
 * tanda dikirim ikut urutan waktu kerja, tanda dikirim menunggu ajuannya yang
 * juga di HP dan diarahkan ke id mutasi server begitu ajuan itu sampai.
 */
type Baris = Record<string, unknown> & { localId: string; syncState: string };

const h = vi.hoisted(() => {
  const tabel = () => ({ rows: [] as Baris[], update: vi.fn(), delete: vi.fn() });
  return {
    t: {
      pendingCheckins: tabel(),
      pendingCheckouts: tabel(),
      pendingStoreReceipts: tabel(),
      pendingStoreOpnames: tabel(),
      pendingSpgReturns: tabel(),
      pendingMutasiAjuan: tabel(),
      pendingMutasiKirim: tabel(),
    },
    checkIn: vi.fn(),
    checkOut: vi.fn(),
    terima: vi.fn(),
    opname: vi.fn(),
    retur: vi.fn(),
    ajukanMutasi: vi.fn(),
    kirimMutasi: vi.fn(),
    unggah: vi.fn(),
    catatTerkirim: vi.fn(),
    lupakan: vi.fn(),
    panggilan: [] as string[],
  };
});

vi.mock("./db", () => {
  const buat = (nama: keyof typeof h.t) => ({
    where: (indeks: string) => ({
      anyOf: (keadaan: string[]) => ({ toArray: async () => h.t[nama].rows.filter((r) => keadaan.includes(r.syncState)) }),
      equals: (nilai: unknown) => ({
        modify: async (ubah: Record<string, unknown>) => {
          for (const r of h.t[nama].rows.filter((x) => x[indeks] === nilai)) {
            h.t[nama].update(r.localId, ubah);
            Object.assign(r, ubah);
          }
        },
      }),
    }),
    get: async (id: string) => h.t[nama].rows.find((r) => r.localId === id),
    update: (id: string, ubah: Record<string, unknown>) => {
      h.t[nama].update(id, ubah);
      const r = h.t[nama].rows.find((x) => x.localId === id);
      if (r) Object.assign(r, ubah);
      return Promise.resolve(1);
    },
    delete: (id: string) => {
      h.t[nama].delete(id);
      h.t[nama].rows = h.t[nama].rows.filter((x) => x.localId !== id);
      return Promise.resolve();
    },
  });
  return {
    pwaDb: {
      pendingCheckins: buat("pendingCheckins"),
      pendingCheckouts: buat("pendingCheckouts"),
      pendingStoreReceipts: buat("pendingStoreReceipts"),
      pendingStoreOpnames: buat("pendingStoreOpnames"),
      pendingSpgReturns: buat("pendingSpgReturns"),
      pendingMutasiAjuan: buat("pendingMutasiAjuan"),
      pendingMutasiKirim: buat("pendingMutasiKirim"),
    },
  };
});
vi.mock("@/app/pwa/stores/actions", () => ({
  checkInLuringAction: (m: unknown) => {
    h.panggilan.push("checkin");
    return h.checkIn(m);
  },
  checkOutLuringAction: (m: unknown) => {
    h.panggilan.push("checkout");
    return h.checkOut(m);
  },
}));
vi.mock("@/app/actions/spg-stok", () => ({
  terimaKirimanAction: (m: unknown) => {
    h.panggilan.push("terima");
    return h.terima(m);
  },
  catatOpnameAction: (m: unknown) => {
    h.panggilan.push("opname");
    return h.opname(m);
  },
}));
vi.mock("@/app/actions/spg-retur", () => ({
  catatReturPembeliAction: (m: unknown) => {
    h.panggilan.push("retur");
    return h.retur(m);
  },
}));
vi.mock("@/app/actions/spg-mutasi", () => ({
  ajukanMutasiAction: (m: unknown) => {
    h.panggilan.push("ajuanMutasi");
    return h.ajukanMutasi(m);
  },
  kirimMutasiAction: (m: unknown) => {
    h.panggilan.push("kirimMutasi");
    return h.kirimMutasi(m);
  },
}));
vi.mock("@/lib/foto/unggah", () => ({ unggahFoto: h.unggah }));
vi.mock("./luring-kunjungan", async (asli) => ({
  ...(await asli<typeof import("./luring-kunjungan")>()),
  catatKunjunganTerkirim: h.catatTerkirim,
  lupakanKunjunganTerkirim: h.lupakan,
}));

const { flushCheckinTertahan, flushCheckoutTertahan, flushStokTertahan } = await import("./luring-sinkron");

const checkin = (localId: string, waktu: number, lain: Record<string, unknown> = {}): Baris => ({
  localId,
  storeId: "t1",
  storeName: "Toko Satu",
  waktu,
  lat: -7.78,
  lng: 110.37,
  akurasi: 12,
  capturedAt: waktu,
  syncState: "pending",
  attempts: 0,
  ...lain,
});
const terima = (localId: string, waktu: number, lain: Record<string, unknown> = {}): Baris => ({
  localId,
  storeId: "t1",
  sourceType: "KONSI_SHIPMENT",
  sourceId: `src-${localId}`,
  docNo: `KRM-${localId}`,
  waktu,
  visitId: "v1",
  visitClientId: null,
  diterima: [{ lineId: "L1", productName: "Kemeja", qtySent: 5, qtyReceived: 5 }],
  note: null,
  capturedAt: waktu,
  syncState: "pending",
  attempts: 0,
  ...lain,
});
const opname = (localId: string, waktu: number, lain: Record<string, unknown> = {}): Baris => ({
  localId,
  storeId: "t1",
  waktu,
  visitId: "v1",
  visitClientId: null,
  baris: [{ itemId: "i1", variantSku: "", qtyCounted: 3, productName: "Kemeja" }],
  note: null,
  capturedAt: waktu,
  syncState: "pending",
  attempts: 0,
  ...lain,
});
const retur = (localId: string, waktu: number): Baris => ({
  localId,
  storeId: "t1",
  spgSaleId: "s1",
  docNo: "SPG/1",
  waktu,
  alasan: "ukuran",
  baris: [{ saleLineId: "sl1", qty: 1, condition: "LAYAK", productName: "Kaos" }],
  capturedAt: waktu,
  syncState: "pending",
  attempts: 0,
});
const checkout = (localId: string, waktu: number, lain: Record<string, unknown> = {}): Baris => ({
  localId,
  storeId: "t1",
  storeName: "Toko Satu",
  visitId: null,
  visitClientId: "hp-1",
  waktu,
  lat: 1,
  lng: 2,
  outcome: null,
  outcomeNote: null,
  transaksiTertunda: false,
  capturedAt: waktu,
  syncState: "pending",
  attempts: 0,
  ...lain,
});

beforeEach(() => {
  for (const t of Object.values(h.t)) {
    t.rows = [];
    t.update.mockReset();
    t.delete.mockReset();
  }
  for (const f of [h.checkIn, h.checkOut, h.terima, h.opname, h.retur, h.ajukanMutasi, h.kirimMutasi, h.unggah, h.catatTerkirim, h.lupakan]) {
    f.mockReset();
  }
  h.panggilan = [];
});

describe("flushCheckinTertahan", () => {
  it("sends check-ins in the order they happened, with the phone's id and time, and remembers the visit the server gave", async () => {
    h.t.pendingCheckins.rows = [checkin("b", 2_000), checkin("a", 1_000)];
    h.checkIn.mockImplementation(async (m: { clientId: string }) => ({ ok: true, visitId: `v-${m.clientId}`, storeId: "t1" }));
    const hasil = await flushCheckinTertahan();
    expect(h.checkIn.mock.calls.map((c) => c[0].clientId)).toEqual(["a", "b"]);
    expect(h.checkIn.mock.calls[0][0]).toMatchObject({ storeId: "t1", lat: -7.78, lng: 110.37, accuracy: 12, waktu: new Date(1_000).toISOString() });
    expect(h.t.pendingCheckins.delete.mock.calls.map((c) => c[0])).toEqual(["a", "b"]);
    expect(h.catatTerkirim).toHaveBeenCalledWith({ clientId: "a", storeId: "t1", storeName: "Toko Satu", waktu: 1_000, visitId: "v-a" });
    expect(hasil).toEqual({ terkirim: 2, gagal: 0, sibuk: false });
  });

  it("stops a check-in the server refuses, keeping the radius numbers for the reason", async () => {
    h.t.pendingCheckins.rows = [checkin("a", 1_000, { attempts: 1 })];
    h.checkIn.mockResolvedValue({ ok: false, code: "DI_LUAR_RADIUS", jarakMeter: 900, radiusMeter: 100, akurasiMeter: 20 });
    const hasil = await flushCheckinTertahan();
    expect(h.t.pendingCheckins.update).toHaveBeenLastCalledWith("a", {
      syncState: "failed",
      error: "DI_LUAR_RADIUS",
      attempts: 2,
      galatRinci: { jarakMeter: 900, radiusMeter: 100 },
    });
    expect(hasil.gagal).toBe(1);
  });

  it("puts a check-in whose send threw back in line", async () => {
    h.t.pendingCheckins.rows = [checkin("a", 1_000)];
    h.checkIn.mockRejectedValue(new TypeError("Failed to fetch"));
    await flushCheckinTertahan();
    expect(h.t.pendingCheckins.update).toHaveBeenLastCalledWith("a", { syncState: "pending", error: undefined, attempts: 1 });
    expect(h.t.pendingCheckins.delete).not.toHaveBeenCalled();
  });
});

describe("flushStokTertahan", () => {
  it("sends stock work in the order it was done on the phone, across kinds", async () => {
    h.t.pendingStoreOpnames.rows = [opname("o", 2_000)];
    h.t.pendingStoreReceipts.rows = [terima("r", 1_000)];
    h.t.pendingSpgReturns.rows = [retur("p", 3_000)];
    h.terima.mockResolvedValue({ ok: true, receiptId: "rc" });
    h.opname.mockResolvedValue({ ok: true, opnameId: "op", selisih: 1 });
    h.retur.mockResolvedValue({ ok: true, returnId: "ret" });
    const hasil = await flushStokTertahan();
    expect(h.panggilan).toEqual(["terima", "opname", "retur"]);
    expect(h.terima.mock.calls[0][0]).toMatchObject({ idempotencyKey: "r", luring: true, waktuTangkap: new Date(1_000).toISOString(), visitId: "v1" });
    expect(h.opname.mock.calls[0][0]).toMatchObject({ idempotencyKey: "o", luring: true, visitId: "v1" });
    expect(h.retur.mock.calls[0][0]).toMatchObject({ idempotencyKey: "p", spgSaleId: "s1" });
    expect(hasil).toEqual({ terkirim: 3, gagal: 0, sibuk: false });
  });

  it("holds work tied to a check-in still on the phone, without counting it as an attempt", async () => {
    h.t.pendingCheckins.rows = [checkin("hp-1", 500)];
    h.t.pendingStoreReceipts.rows = [terima("r", 1_000, { visitId: null, visitClientId: "hp-1" })];
    await flushStokTertahan();
    expect(h.terima).not.toHaveBeenCalled();
    expect(h.t.pendingStoreReceipts.update).toHaveBeenLastCalledWith("r", { syncState: "pending" });
  });

  it("stops work tied to a check-in the server refused, with the same clear reason, without sending it", async () => {
    h.t.pendingCheckins.rows = [checkin("hp-1", 500, { syncState: "failed", error: "DI_LUAR_RADIUS" })];
    h.t.pendingStoreOpnames.rows = [opname("o", 1_000, { visitId: null, visitClientId: "hp-1" })];
    const hasil = await flushStokTertahan();
    expect(h.opname).not.toHaveBeenCalled();
    expect(h.t.pendingStoreOpnames.update).toHaveBeenLastCalledWith("o", { syncState: "failed", error: "KUNJUNGAN_DITOLAK", attempts: 1 });
    expect(hasil.gagal).toBe(1);
  });

  it("sends work tied to a check-in that already went (its row is gone) by the phone's id", async () => {
    h.t.pendingStoreOpnames.rows = [opname("o", 1_000, { visitId: null, visitClientId: "hp-1" })];
    h.opname.mockResolvedValue({ ok: true, opnameId: "op", selisih: 0 });
    await flushStokTertahan();
    expect(h.opname.mock.calls[0][0]).toMatchObject({ visitClientId: "hp-1" });
    expect(h.opname.mock.calls[0][0]).not.toHaveProperty("visitId");
  });

  it("uploads a damage photo once, keeps its URL on the queued row, and sends the URL", async () => {
    const blob = new Blob(["foto"], { type: "image/jpeg" });
    h.t.pendingStoreReceipts.rows = [
      terima("r", 1_000, {
        diterima: [{ lineId: "L1", productName: "Kemeja", qtySent: 5, qtyReceived: 5, qtyDamaged: 2, damageNote: "sobek", foto: { nama: "a.jpg", blob } }],
      }),
    ];
    h.unggah.mockResolvedValue("/api/foto/f1");
    h.terima.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce({ ok: true, receiptId: "rc" });

    await flushStokTertahan();
    expect(h.unggah).toHaveBeenCalledTimes(1);
    const disimpan = h.t.pendingStoreReceipts.update.mock.calls.find((c) => "diterima" in c[1])?.[1] as { diterima: { foto: unknown }[] };
    expect(disimpan.diterima[0].foto).toEqual({ nama: "a.jpg", url: "/api/foto/f1" });
    expect(h.t.pendingStoreReceipts.rows[0].syncState).toBe("pending");

    await flushStokTertahan();
    expect(h.unggah).toHaveBeenCalledTimes(1);
    expect(h.terima.mock.calls[1][0].diterima[0]).toEqual({ lineId: "L1", qtyReceived: 5, qtyDamaged: 2, damageNote: "sobek", damagePhotoUrl: "/api/foto/f1" });
    expect(h.t.pendingStoreReceipts.delete).toHaveBeenCalledWith("r");
  });

  it("stops on a photo the server refuses, retries a photo upload that lost signal", async () => {
    const blob = new Blob(["foto"]);
    const rusak = { diterima: [{ lineId: "L1", productName: "Kemeja", qtySent: 5, qtyReceived: 5, qtyDamaged: 1, damageNote: "x", foto: { nama: "a.jpg", blob } }] };
    h.t.pendingStoreReceipts.rows = [terima("r", 1_000, rusak)];
    h.unggah.mockRejectedValueOnce(new Error("TERLALU_BESAR"));
    await flushStokTertahan();
    expect(h.t.pendingStoreReceipts.update).toHaveBeenLastCalledWith("r", { syncState: "failed", error: "FOTO_TERLALU_BESAR", attempts: 1 });

    h.t.pendingStoreReceipts.rows = [terima("r2", 1_000, rusak)];
    h.unggah.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await flushStokTertahan();
    expect(h.t.pendingStoreReceipts.update).toHaveBeenLastCalledWith("r2", { syncState: "pending", error: undefined, attempts: 1 });
    expect(h.terima).not.toHaveBeenCalled();
  });

  it("keeps the locked consignment cycle numbers on a refused receipt", async () => {
    h.t.pendingStoreReceipts.rows = [terima("r", 1_000)];
    h.terima.mockResolvedValue({ ok: false, code: "SIKLUS_TERKUNCI", noKonsi: ["KNS/9"] });
    await flushStokTertahan();
    expect(h.t.pendingStoreReceipts.update).toHaveBeenLastCalledWith("r", { syncState: "failed", error: "SIKLUS_TERKUNCI", attempts: 1, noKonsi: ["KNS/9"] });
  });

  it("retries a shopper return the server failed to save (GAGAL), stops one it refused", async () => {
    h.t.pendingSpgReturns.rows = [retur("p", 1_000), retur("q", 2_000)];
    h.retur.mockResolvedValueOnce({ ok: false, kode: "GAGAL" }).mockResolvedValueOnce({ ok: false, kode: "MELEBIHI_SISA" });
    await flushStokTertahan();
    expect(h.t.pendingSpgReturns.update).toHaveBeenCalledWith("p", { syncState: "pending", error: "GAGAL", attempts: 1 });
    expect(h.t.pendingSpgReturns.update).toHaveBeenCalledWith("q", { syncState: "failed", error: "MELEBIHI_SISA", attempts: 1 });
  });
});

describe("flushCheckoutTertahan", () => {
  it("waits for its check-in, then sends with the phone's time and forgets the visit on the phone", async () => {
    h.t.pendingCheckins.rows = [checkin("hp-1", 500)];
    h.t.pendingCheckouts.rows = [checkout("k", 9_000, { outcome: "TOKO_TUTUP" })];
    await flushCheckoutTertahan();
    expect(h.checkOut).not.toHaveBeenCalled();

    h.t.pendingCheckins.rows = [];
    h.checkOut.mockResolvedValue({ ok: true, storeId: "t1", sudahTertutup: false });
    const hasil = await flushCheckoutTertahan();
    expect(h.checkOut.mock.calls[0][0]).toEqual({
      visitClientId: "hp-1",
      waktu: new Date(9_000).toISOString(),
      lat: 1,
      lng: 2,
      outcome: "TOKO_TUTUP",
      outcomeNote: null,
      transaksiTertunda: false,
    });
    expect(h.t.pendingCheckouts.delete).toHaveBeenCalledWith("k");
    expect(hasil.terkirim).toBe(1);
  });

  it("stops on a refusal with the server's reason", async () => {
    h.t.pendingCheckouts.rows = [checkout("k", 9_000, { visitClientId: null, visitId: "v1" })];
    h.checkOut.mockResolvedValue({ ok: false, code: "HASIL_WAJIB" });
    await flushCheckoutTertahan();
    expect(h.t.pendingCheckouts.update).toHaveBeenLastCalledWith("k", { syncState: "failed", error: "HASIL_WAJIB", attempts: 1 });
  });
});

const ajuanMutasi = (localId: string, waktu: number, lain: Record<string, unknown> = {}): Baris => ({
  localId,
  storeId: "t1",
  toStoreId: "t2",
  tujuanNama: "Toko Dua",
  langsung: true,
  alasan: "stok habis di sana",
  baris: [{ itemId: "i1", variantSku: null, qty: 2, productName: "Kemeja" }],
  waktu,
  visitId: "v1",
  visitClientId: null,
  capturedAt: waktu,
  syncState: "pending",
  attempts: 0,
  ...lain,
});
const kirimMutasi = (localId: string, waktu: number, lain: Record<string, unknown> = {}): Baris => ({
  localId,
  storeId: "t1",
  transferId: "m1",
  ajuanLocalId: null,
  docNo: "MTS/2026/00001",
  tujuanNama: "Toko Dua",
  pcs: 2,
  waktu,
  visitId: "v1",
  visitClientId: null,
  capturedAt: waktu,
  syncState: "pending",
  attempts: 0,
  ...lain,
});

describe("flushStokTertahan — mutasi antar toko", () => {
  it("sends a queued shipment mark before an opname done after it, with the phone's key, time and visit", async () => {
    h.t.pendingStoreOpnames.rows = [opname("o", 3_000)];
    h.t.pendingMutasiKirim.rows = [kirimMutasi("k", 2_000)];
    h.t.pendingStoreReceipts.rows = [terima("r", 1_000)];
    h.terima.mockResolvedValue({ ok: true, receiptId: "rc" });
    h.opname.mockResolvedValue({ ok: true, opnameId: "op", selisih: 0 });
    h.kirimMutasi.mockResolvedValue({ ok: true, id: "m1", docNo: "MTS/2026/00001", status: "DIKIRIM" });
    const hasil = await flushStokTertahan();
    expect(h.panggilan).toEqual(["terima", "kirimMutasi", "opname"]);
    expect(h.kirimMutasi.mock.calls[0][0]).toEqual({
      transferId: "m1",
      idempotencyKey: "k",
      luring: true,
      waktuTangkap: new Date(2_000).toISOString(),
      visitId: "v1",
    });
    expect(h.t.pendingMutasiKirim.delete).toHaveBeenCalledWith("k");
    expect(hasil).toEqual({ terkirim: 3, gagal: 0, sibuk: false });
  });

  it("sends a queued request first, points its queued shipment mark at the new transfer, and sends that mark in the same run", async () => {
    h.t.pendingMutasiAjuan.rows = [ajuanMutasi("a", 1_000)];
    h.t.pendingMutasiKirim.rows = [kirimMutasi("k", 2_000, { transferId: null, ajuanLocalId: "a", docNo: null })];
    h.ajukanMutasi.mockResolvedValue({ ok: true, id: "m9", docNo: "MTS/2026/00009", status: "DISETUJUI" });
    h.kirimMutasi.mockResolvedValue({ ok: true, id: "m9", docNo: "MTS/2026/00009", status: "DIKIRIM" });
    await flushStokTertahan();
    expect(h.panggilan).toEqual(["ajuanMutasi", "kirimMutasi"]);
    expect(h.ajukanMutasi.mock.calls[0][0]).toEqual({
      toStoreId: "t2",
      alasan: "stok habis di sana",
      baris: [{ itemId: "i1", variantSku: null, qty: 2 }],
      idempotencyKey: "a",
      luring: true,
      waktuTangkap: new Date(1_000).toISOString(),
      visitId: "v1",
    });
    // Diarahkan SEBELUM ajuannya dihapus — HP yang mati di antaranya mengulang ajuan dengan kunci yang sama.
    expect(h.t.pendingMutasiKirim.update.mock.calls[0]).toEqual(["k", { transferId: "m9", docNo: "MTS/2026/00009", ajuanLocalId: null }]);
    expect(h.t.pendingMutasiKirim.update.mock.invocationCallOrder[0]).toBeLessThan(h.t.pendingMutasiAjuan.delete.mock.invocationCallOrder[0]);
    expect(h.kirimMutasi.mock.calls[0][0]).toMatchObject({ transferId: "m9", idempotencyKey: "k" });
    expect(h.t.pendingMutasiAjuan.delete).toHaveBeenCalledWith("a");
    expect(h.t.pendingMutasiKirim.delete).toHaveBeenCalledWith("k");
  });

  it("holds a shipment mark while its request is still waiting, without counting an attempt", async () => {
    h.t.pendingMutasiAjuan.rows = [ajuanMutasi("a", 1_000)];
    h.t.pendingMutasiKirim.rows = [kirimMutasi("k", 2_000, { transferId: null, ajuanLocalId: "a", docNo: null })];
    h.ajukanMutasi.mockRejectedValue(new TypeError("Failed to fetch"));
    await flushStokTertahan();
    expect(h.kirimMutasi).not.toHaveBeenCalled();
    expect(h.t.pendingMutasiAjuan.update).toHaveBeenLastCalledWith("a", { syncState: "pending", error: undefined, attempts: 1 });
    expect(h.t.pendingMutasiKirim.update).toHaveBeenLastCalledWith("k", { syncState: "pending" });
    expect(h.t.pendingMutasiKirim.rows[0].attempts).toBe(0);
  });

  it("stops a shipment mark whose request the server refused, keeping the refusal details on the request", async () => {
    h.t.pendingMutasiAjuan.rows = [ajuanMutasi("a", 1_000)];
    h.t.pendingMutasiKirim.rows = [kirimMutasi("k", 2_000, { transferId: null, ajuanLocalId: "a", docNo: null })];
    const kurang = [{ itemId: "i1", variantSku: "", qty: 2, tersedia: 1, productName: "Kemeja" }];
    h.ajukanMutasi.mockResolvedValue({ ok: false, code: "SALDO_KURANG", kurang });
    const hasil = await flushStokTertahan();
    expect(h.kirimMutasi).not.toHaveBeenCalled();
    expect(h.t.pendingMutasiAjuan.update).toHaveBeenLastCalledWith("a", { syncState: "failed", error: "SALDO_KURANG", attempts: 1, kurang });
    expect(h.t.pendingMutasiKirim.update).toHaveBeenLastCalledWith("k", { syncState: "failed", error: "AJUAN_DITOLAK", attempts: 1 });
    expect(hasil.gagal).toBe(2);
  });

  it("stops a shipment mark whose request is gone from the phone, without sending it", async () => {
    h.t.pendingMutasiKirim.rows = [kirimMutasi("k", 2_000, { transferId: null, ajuanLocalId: "hilang", docNo: null })];
    await flushStokTertahan();
    expect(h.kirimMutasi).not.toHaveBeenCalled();
    expect(h.t.pendingMutasiKirim.update).toHaveBeenLastCalledWith("k", { syncState: "failed", error: "AJUAN_TIDAK_ADA", attempts: 1 });
  });

  it("stops a shipment mark the server refuses (with the locked cycle), and retries one whose send threw", async () => {
    h.t.pendingMutasiKirim.rows = [kirimMutasi("k", 1_000), kirimMutasi("l", 2_000, { transferId: "m2" })];
    h.kirimMutasi.mockResolvedValueOnce({ ok: false, code: "SIKLUS_TERKUNCI", noKonsi: ["KNS/7"] }).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const hasil = await flushStokTertahan();
    expect(h.t.pendingMutasiKirim.update).toHaveBeenCalledWith("k", { syncState: "failed", error: "SIKLUS_TERKUNCI", attempts: 1, noKonsi: ["KNS/7"] });
    expect(h.t.pendingMutasiKirim.update).toHaveBeenCalledWith("l", { syncState: "pending", error: undefined, attempts: 1 });
    expect(hasil).toEqual({ terkirim: 0, gagal: 1, sibuk: false });
  });

  it("holds request and shipment mark tied to a check-in still on the phone", async () => {
    h.t.pendingCheckins.rows = [checkin("hp-1", 500)];
    h.t.pendingMutasiAjuan.rows = [ajuanMutasi("a", 1_000, { visitId: null, visitClientId: "hp-1" })];
    await flushStokTertahan();
    expect(h.ajukanMutasi).not.toHaveBeenCalled();
    expect(h.t.pendingMutasiAjuan.update).toHaveBeenLastCalledWith("a", { syncState: "pending" });

    h.t.pendingCheckins.rows = [];
    h.ajukanMutasi.mockResolvedValue({ ok: true, id: "m1", docNo: "MTS/2026/00001", status: "DIAJUKAN" });
    await flushStokTertahan();
    expect(h.ajukanMutasi.mock.calls[0][0]).toMatchObject({ visitClientId: "hp-1" });
    expect(h.ajukanMutasi.mock.calls[0][0]).not.toHaveProperty("visitId");
  });
});
