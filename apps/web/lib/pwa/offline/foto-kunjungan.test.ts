import { describe, expect, it } from "vitest";
import { bacaPetaFoto, catatJumlah, rapikanPetaFoto, tambahSatu } from "./foto-kunjungan";
import { fotoMilikKunjungan } from "./photo-queue";

const KINI = Date.parse("2026-10-03T06:00:00.000Z");
const HARI = 86_400_000;

describe("jumlah foto kunjungan yang sudah sampai ke server", () => {
  it("reads only well-formed entries", () => {
    expect(bacaPetaFoto(null)).toEqual({});
    expect(bacaPetaFoto("bukan json")).toEqual({});
    expect(bacaPetaFoto("[1,2]")).toEqual({});
    expect(bacaPetaFoto(JSON.stringify({ v1: { n: 2, t: KINI }, v2: { n: -1, t: KINI }, v3: { n: 1.5, t: KINI }, v4: "x" }))).toEqual({ v1: { n: 2, t: KINI } });
  });

  it("never lowers a count the phone already knows — a photo it just uploaded may not be on a page loaded earlier", () => {
    let p = catatJumlah({}, "v1", 1, KINI);
    p = tambahSatu(p, "v1", KINI);
    expect(p.v1.n).toBe(2);
    p = catatJumlah(p, "v1", 1, KINI);
    expect(p.v1.n).toBe(2);
    p = catatJumlah(p, "v1", 3, KINI);
    expect(p.v1.n).toBe(3);
  });

  it("forgets visits older than three days and keeps at most 50", () => {
    const lama = { lama: { n: 1, t: KINI - 4 * HARI }, baru: { n: 1, t: KINI - HARI } };
    expect(Object.keys(rapikanPetaFoto(lama, KINI))).toEqual(["baru"]);
    const banyak = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`v${i}`, { n: 1, t: KINI - i * 1000 }]));
    const rapi = rapikanPetaFoto(banyak, KINI);
    expect(Object.keys(rapi)).toHaveLength(50);
    expect(rapi.v0).toBeDefined();
    expect(rapi.v59).toBeUndefined();
  });
});

describe("foto milik satu kunjungan", () => {
  const foto = [
    { localId: "a", visitId: "v1", visitClientId: null },
    { localId: "b", visitId: "", visitClientId: "hp-1" },
    { localId: "c", visitId: "v2", visitClientId: null },
    { localId: "d", visitId: "", visitClientId: "hp-2" },
  ];

  it("matches by the server visit or by the phone's check-in id — photos taken before the check-in reached the server count too", () => {
    expect(fotoMilikKunjungan(foto, { visitId: "v1", visitClientId: "hp-1" }).map((f) => f.localId)).toEqual(["a", "b"]);
    expect(fotoMilikKunjungan(foto, { visitId: null, visitClientId: "hp-2" }).map((f) => f.localId)).toEqual(["d"]);
    expect(fotoMilikKunjungan(foto, { visitId: "v2", visitClientId: null }).map((f) => f.localId)).toEqual(["c"]);
  });

  it("an empty server id never matches the photos queued without one", () => {
    expect(fotoMilikKunjungan(foto, { visitId: "", visitClientId: null })).toEqual([]);
  });
});
