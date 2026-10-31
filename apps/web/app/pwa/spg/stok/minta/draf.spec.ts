import { describe, expect, it } from "vitest";
import { rapikanDraf, UMUR_DRAF_MS } from "./draf";

/** Draf formulir minta kiriman — isi `localStorage` yang rusak atau basi tidak boleh masuk ke formulir. */
describe("rapikanDraf", () => {
  const sekarang = Date.parse("2026-10-01T05:00:00Z");

  it("keeps valid lines, the note and the submit key", () => {
    expect(
      rapikanDraf(
        {
          baris: [
            { kunci: "i1::M", qty: "3", alasan: "LAKU_DI_SINI" },
            { kunci: "i2::", qty: "", alasan: "MANUAL" },
          ],
          catatan: "untuk promo",
          kunciKirim: "kunci-1",
          waktu: sekarang - 1000,
        },
        sekarang,
      ),
    ).toEqual({
      baris: [
        { kunci: "i1::M", qty: "3", alasan: "LAKU_DI_SINI" },
        { kunci: "i2::", qty: "", alasan: "MANUAL" },
      ],
      catatan: "untuk promo",
      kunciKirim: "kunci-1",
      waktu: sekarang - 1000,
    });
  });

  it("drops lines with an unknown reason or a non-numeric quantity", () => {
    const d = rapikanDraf(
      {
        baris: [
          { kunci: "i1::", qty: "2", alasan: "PALSU" },
          { kunci: "i2::", qty: "x", alasan: "MANUAL" },
          { kunci: 5, qty: "1", alasan: "MANUAL" },
          null,
          { kunci: "i3::", qty: "1", alasan: "BARANG_BARU" },
        ],
        waktu: sekarang,
      },
      sekarang,
    );
    expect(d?.baris).toEqual([{ kunci: "i3::", qty: "1", alasan: "BARANG_BARU" }]);
    expect(d?.kunciKirim).toBeNull();
  });

  it("discards a draft that is too old, from the future, or not a draft at all", () => {
    expect(rapikanDraf({ baris: [], waktu: sekarang - UMUR_DRAF_MS - 1 }, sekarang)).toBeNull();
    expect(rapikanDraf({ baris: [], waktu: sekarang + 3_600_000 }, sekarang)).toBeNull();
    expect(rapikanDraf("teks", sekarang)).toBeNull();
    expect(rapikanDraf({ baris: "x", waktu: sekarang }, sekarang)).toBeNull();
  });
});
