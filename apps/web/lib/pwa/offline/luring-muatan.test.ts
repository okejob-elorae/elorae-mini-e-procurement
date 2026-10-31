import { describe, expect, it } from "vitest";
import { muatanCheckin, muatanCheckout, muatanOpname, muatanReturPembeli, muatanTerima, susunCheckin } from "./luring-muatan";
import { BATAS_STOK_LURING_MS } from "@/lib/pwa/waktu-luring";

const WAKTU = Date.parse("2026-10-03T02:15:00.000Z");

describe("susunCheckin / muatanCheckin", () => {
  it("queues the phone's id, place and time, and sends them as the offline check-in payload", () => {
    const c = susunCheckin({ clientId: "hp-1", storeId: "t1", storeName: "Toko", waktu: WAKTU, lat: -7.78, lng: 110.37, akurasi: 14.6 });
    expect(c).toEqual({ localId: "hp-1", storeId: "t1", storeName: "Toko", waktu: WAKTU, lat: -7.78, lng: 110.37, akurasi: 15 });
    expect(muatanCheckin(c!)).toEqual({
      clientId: "hp-1",
      storeId: "t1",
      lat: -7.78,
      lng: 110.37,
      accuracy: 15,
      waktu: "2026-10-03T02:15:00.000Z",
    });
  });

  it("refuses coordinates or a time that cannot be read, and drops a nonsense accuracy", () => {
    expect(susunCheckin({ clientId: "hp-1", storeId: "t1", storeName: null, waktu: WAKTU, lat: Number.NaN, lng: 1, akurasi: 5 })).toBeNull();
    expect(susunCheckin({ clientId: "hp-1", storeId: "t1", storeName: null, waktu: WAKTU, lat: 91, lng: 1, akurasi: 5 })).toBeNull();
    expect(susunCheckin({ clientId: "hp-1", storeId: "t1", storeName: null, waktu: Number.NaN, lat: 1, lng: 1, akurasi: 5 })).toBeNull();
    expect(susunCheckin({ clientId: "", storeId: "t1", storeName: null, waktu: WAKTU, lat: 1, lng: 1, akurasi: 5 })).toBeNull();
    expect(susunCheckin({ clientId: "hp-1", storeId: "t1", storeName: null, waktu: WAKTU, lat: 1, lng: 1, akurasi: -3 })?.akurasi).toBeNull();
  });
});

describe("muatanCheckout", () => {
  const dasar = { waktu: WAKTU, lat: 1, lng: 2, outcome: "TOKO_TUTUP", outcomeNote: null, transaksiTertunda: false };

  it("points at a queued check-in by its client id first, else at the server visit", () => {
    expect(muatanCheckout({ ...dasar, visitId: null, visitClientId: "hp-1" })).toEqual({
      visitClientId: "hp-1",
      waktu: "2026-10-03T02:15:00.000Z",
      lat: 1,
      lng: 2,
      outcome: "TOKO_TUTUP",
      outcomeNote: null,
      transaksiTertunda: false,
    });
    expect(muatanCheckout({ ...dasar, visitId: "v1", visitClientId: null })).toMatchObject({ visitId: "v1" });
    expect(muatanCheckout({ ...dasar, visitId: "v1", visitClientId: null })).not.toHaveProperty("visitClientId");
  });
});

describe("muatanTerima", () => {
  const terima = {
    localId: "kunci-1",
    storeId: "t1",
    sourceType: "KONSI_SHIPMENT",
    sourceId: "k1",
    docNo: "KRM-1",
    waktu: WAKTU,
    visitId: null,
    visitClientId: "hp-1",
    diterima: [
      { lineId: "L1", productName: "Kemeja", qtySent: 5, qtyReceived: 5, qtyDamaged: 2, damageNote: " sobek ", foto: { nama: "a.jpg", blob: new Blob(["x"]) } },
      { lineId: "L2", productName: "Hanger", qtySent: 3, qtyReceived: 3 },
    ],
    note: null,
  };

  it("sends the same key, the count time, and the visit — offline, with the uploaded damage photo", () => {
    const m = muatanTerima(terima, (i) => (i === 0 ? "/api/foto/f1" : null));
    expect(m).toEqual({
      sourceType: "KONSI_SHIPMENT",
      sourceId: "k1",
      diterima: [
        { lineId: "L1", qtyReceived: 5, qtyDamaged: 2, damageNote: "sobek", damagePhotoUrl: "/api/foto/f1" },
        { lineId: "L2", qtyReceived: 3 },
      ],
      idempotencyKey: "kunci-1",
      luring: true,
      waktuTangkap: "2026-10-03T02:15:00.000Z",
      visitClientId: "hp-1",
    });
  });

  it("never sends a photo blob or the display names", () => {
    const teks = JSON.stringify(muatanTerima(terima, () => null));
    expect(teks).not.toContain("blob");
    expect(teks).not.toContain("Kemeja");
  });
});

describe("muatanOpname / muatanReturPembeli", () => {
  it("sends the count without any system balance from the phone", () => {
    const m = muatanOpname({
      localId: "op-1",
      storeId: "t1",
      waktu: WAKTU,
      visitId: "v1",
      visitClientId: null,
      baris: [{ itemId: "i1", variantSku: "i1-M", qtyCounted: 4, productName: "Kaos — M" }],
      note: "rak depan",
    });
    expect(m).toEqual({
      baris: [{ itemId: "i1", variantSku: "i1-M", qtyCounted: 4 }],
      note: "rak depan",
      idempotencyKey: "op-1",
      luring: true,
      waktuTangkap: "2026-10-03T02:15:00.000Z",
      visitId: "v1",
    });
  });

  it("carries each line's count age, so the server judges it against the balance when that shelf was counted", () => {
    // Kemeja dihitung 40 menit sebelum opname masuk antrean, celana belum punya umur (klien lama).
    const m = muatanOpname({
      localId: "op-2",
      storeId: "t1",
      waktu: WAKTU,
      visitId: null,
      visitClientId: "vc-1",
      baris: [
        { itemId: "i1", variantSku: null, qtyCounted: 10, productName: "Kemeja", umurHitungMs: 40 * 60_000 },
        { itemId: "i2", variantSku: "i2-L", qtyCounted: 3, productName: "Celana — L" },
      ],
      note: null,
    });
    expect(m.baris).toEqual([
      { itemId: "i1", variantSku: null, qtyCounted: 10, umurHitungMs: 2_400_000 },
      { itemId: "i2", variantSku: "i2-L", qtyCounted: 3 },
    ]);
    // Umur dihitung dari saat tangkap, jadi waktu tangkap tetap ikut — server memakai keduanya.
    expect(m).toMatchObject({ waktuTangkap: "2026-10-03T02:15:00.000Z", visitClientId: "vc-1", luring: true });
    expect(JSON.stringify(m)).not.toContain("Kemeja");
  });

  it("drops a count age the phone could not have produced instead of sending it", () => {
    const m = muatanOpname({
      localId: "op-3",
      storeId: "t1",
      waktu: WAKTU,
      visitId: "v1",
      visitClientId: null,
      baris: [
        { itemId: "i1", variantSku: null, qtyCounted: 1, productName: "A", umurHitungMs: Number.NaN },
        { itemId: "i2", variantSku: null, qtyCounted: 1, productName: "B", umurHitungMs: -5 },
        { itemId: "i3", variantSku: null, qtyCounted: 1, productName: "C", umurHitungMs: 1500.6 },
      ],
      note: null,
    });
    // Server menolak seluruh opname bila satu umur tidak sah — antrean tidak boleh macet karenanya.
    expect(m.baris).toEqual([
      { itemId: "i1", variantSku: null, qtyCounted: 1 },
      { itemId: "i2", variantSku: null, qtyCounted: 1 },
      { itemId: "i3", variantSku: null, qtyCounted: 1, umurHitungMs: 1501 },
    ]);
  });

  it("caps a count age at the server's own limit instead of sending a number the action schema rejects", () => {
    // Draf rusak / jam HP melompat: umur 1e300 ms. Skema aksi (`z.number().int()`)
    // menolak bilangan di atas bilangan bulat aman — seluruh opname akan ditolak.
    const m = muatanOpname({
      localId: "op-4",
      storeId: "t1",
      waktu: WAKTU,
      visitId: "v1",
      visitClientId: null,
      baris: [
        { itemId: "i1", variantSku: null, qtyCounted: 1, productName: "A", umurHitungMs: 1e300 },
        { itemId: "i2", variantSku: null, qtyCounted: 1, productName: "B", umurHitungMs: BATAS_STOK_LURING_MS + 1 },
      ],
      note: null,
    });
    expect(m.baris.map((b) => b.umurHitungMs)).toEqual([BATAS_STOK_LURING_MS, BATAS_STOK_LURING_MS]);
    expect(m.baris.every((b) => Number.isSafeInteger(b.umurHitungMs))).toBe(true);
  });

  it("sends a shopper return exactly like the counter does, with the same key", () => {
    expect(
      muatanReturPembeli({
        localId: "rp-1",
        storeId: "t1",
        spgSaleId: "s1",
        docNo: "SPG/1",
        waktu: WAKTU,
        alasan: "ukuran",
        baris: [{ saleLineId: "sl1", qty: 1, condition: "RUSAK", productName: "Kaos" }],
      }),
    ).toEqual({
      spgSaleId: "s1",
      alasan: "ukuran",
      idempotencyKey: "rp-1",
      baris: [{ saleLineId: "sl1", qty: 1, condition: "RUSAK" }],
      luring: true,
      waktuTangkap: "2026-10-03T02:15:00.000Z",
    });
  });
});
