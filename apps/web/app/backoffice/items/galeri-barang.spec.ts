import { describe, expect, it } from "vitest";
import {
  kunciGalatSimpanGambar,
  kunciGalatUnggah,
  perubahanGaleri,
  type ButirGaleri,
} from "./galeri-barang";

const tersimpan: ButirGaleri[] = [
  { id: "g1", url: "https://r2/a.jpg", variantSku: null, sortOrder: 0 },
  { id: "g2", url: "https://r2/b.jpg", variantSku: null, sortOrder: 1 },
  { id: "g3", url: "https://r2/c.jpg", variantSku: "KAOS-M", sortOrder: 0 },
];

describe("perubahanGaleri", () => {
  it("reports no change when nothing moved", () => {
    expect(perubahanGaleri(tersimpan, [...tersimpan])).toEqual({ baru: 0, dihapus: 0, digeser: 0, adaPerubahan: false });
  });

  it("counts uploaded images that are not saved yet", () => {
    const h = perubahanGaleri(tersimpan, [
      ...tersimpan,
      { url: "https://r2/d.jpg", variantSku: null, sortOrder: 2 },
      { url: "https://r2/e.jpg", variantSku: "KAOS-M", sortOrder: 1 },
    ]);
    expect(h).toEqual({ baru: 2, dihapus: 0, digeser: 0, adaPerubahan: true });
  });

  it("counts removed and reordered images", () => {
    const h = perubahanGaleri(tersimpan, [
      { id: "g2", url: "https://r2/b.jpg", variantSku: null, sortOrder: 0 },
      { id: "g3", url: "https://r2/c.jpg", variantSku: "KAOS-M", sortOrder: 0 },
    ]);
    expect(h).toEqual({ baru: 0, dihapus: 1, digeser: 1, adaPerubahan: true });
  });

  it("treats a just-saved upload (still without id) as saved once the snapshot holds it", () => {
    const sekarang: ButirGaleri[] = [...tersimpan, { url: "https://r2/d.jpg", variantSku: null, sortOrder: 2 }];
    expect(perubahanGaleri(sekarang, sekarang).adaPerubahan).toBe(false);
  });

  it("an id-less upload never matches a saved row by accident", () => {
    const h = perubahanGaleri(tersimpan, [
      { url: "https://r2/a.jpg", variantSku: null, sortOrder: 0 },
      { id: "g2", url: "https://r2/b.jpg", variantSku: null, sortOrder: 1 },
      { id: "g3", url: "https://r2/c.jpg", variantSku: "KAOS-M", sortOrder: 0 },
    ]);
    expect(h).toEqual({ baru: 1, dihapus: 1, digeser: 0, adaPerubahan: true });
  });
});

describe("kunciGalatUnggah", () => {
  it("maps permission, storage and file refusals to their own messages", () => {
    expect(kunciGalatUnggah(401, "unauthorized")).toBe("error.forbidden");
    expect(kunciGalatUnggah(403, "forbidden")).toBe("error.forbidden");
    expect(kunciGalatUnggah(503, "R2 storage is not configured")).toBe("errPenyimpanan");
    expect(kunciGalatUnggah(400, "image_too_large")).toBe("error.image_too_large");
    expect(kunciGalatUnggah(400, "image_mime_invalid")).toBe("error.image_mime_invalid");
  });

  it("never passes a raw server text through", () => {
    expect(kunciGalatUnggah(400, "No files provided")).toBe("errUnggah");
    expect(kunciGalatUnggah(500, undefined)).toBe("errUnggah");
  });
});

describe("kunciGalatSimpanGambar", () => {
  it("maps known codes to their messages and the rest to a generic one", () => {
    expect(kunciGalatSimpanGambar("forbidden")).toBe("error.forbidden");
    expect(kunciGalatSimpanGambar("image_jubelio_owned")).toBe("error.image_jubelio_owned");
    expect(kunciGalatSimpanGambar("item_not_found")).toBe("errBarangTidakAda");
    expect(kunciGalatSimpanGambar("invalid_request")).toBe("errSimpan");
  });
});
