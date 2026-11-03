import { describe, expect, it } from "vitest";
import { dariNrt, ringkasKerjaRetur } from "./return-queries";

/*
 * Baris daftar kerja retur, murni (tanpa basis data). Dulu nilai fisiknya hanya
 * hitungan asli: nota yang selisihnya sudah ditutup barang susulan tetap tampil
 * "menunggu keputusan" tanpa beban yang bisa diputuskan, dan kartu keputusannya
 * menyebut angka gudang yang sudah tidak berlaku.
 */

const pagi = new Date("2026-11-02T01:00:00.000Z");
const siang = new Date("2026-11-02T06:00:00.000Z");

type Nota = Parameters<typeof dariNrt>[0];

const nota = (p: Partial<Nota> = {}): Nota => ({
  id: "nrt-1",
  noNrt: "NRT-4510",
  storeId: "s1",
  claimDate: new Date("2026-11-01T00:00:00.000Z"),
  deliveryMethod: "SALES",
  claimedAmount: 300_000,
  photoUrl: null,
  status: "SELISIH",
  store: { name: "Toko Sinar Jaya", salesmanId: "pemegang" },
  salesmanId: "budi",
  salesman: { name: "Budi" },
  warehouseReturn: { noNri: "NRI/26/11/0001", physicalAmount: 100_000, status: "FINAL" },
  followUps: [],
  charges: [{ id: "c1", status: "TERBUKA", bearer: null, amount: 200_000, checkStatus: "DITANYAKAN", checkedAt: null }],
  deductions: [{ amount: 300_000 }],
  ...p,
});

describe("dariNrt — nilai fisik = hitungan asli + barang susulan final", () => {
  it("susulan menambah nilai fisik dan mengecilkan selisihnya", () => {
    const b = dariNrt(nota({ followUps: [{ physicalAmount: 130_000, createdAt: siang }] }));
    expect(b.nilaiFisik).toBe(230_000);
    expect(b.selisih).toBe(70_000);
    expect(b.langkah).toBe("keputusan");
    expect(b.jumlahSusulan).toBe(1);
  });

  it("susulan yang menutup selisihnya (beban terbuka sudah dihapus penulisnya) → beres", () => {
    const b = dariNrt(
      nota({
        status: "COCOK",
        followUps: [
          { physicalAmount: 150_000, createdAt: pagi },
          { physicalAmount: 50_000, createdAt: siang },
        ],
        charges: [],
      }),
    );
    expect(b.nilaiFisik).toBe(300_000);
    expect(b.selisih).toBe(0);
    expect(b.langkah).toBe("beres");
    expect(b.giliran).toBe("tidak_ada");
    expect(b.cekSelisih).toBeNull();
  });

  it("hitungan asli yang masih draft: belum ada nilai fisik, susulan tidak membuatnya ada", () => {
    const b = dariNrt(
      nota({
        warehouseReturn: { noNri: "NRI/26/11/0001", physicalAmount: 100_000, status: "DRAFT" },
        followUps: [{ physicalAmount: 200_000, createdAt: siang }],
        charges: [],
      }),
    );
    expect(b.nilaiFisik).toBeNull();
    expect(b.langkah).toBe("cek");
    expect(b.giliran).toBe("gudang");
  });

  it("ringkasan 'tertahan' memakai selisih sesudah susulan", () => {
    const b = dariNrt(nota({ followUps: [{ physicalAmount: 130_000, createdAt: siang }] }));
    // Dipotong 300.000 atas klaim 300.000, yang masih kurang 70.000.
    expect(ringkasKerjaRetur([b]).nilaiTertahan).toBeCloseTo(70_000, 6);
  });
});

describe("dariNrt — giliran membaca hasil cek sales pemegang toko", () => {
  const beban = (checkStatus: string, checkedAt: Date | null) => [
    { id: "c1", status: "TERBUKA", bearer: null, amount: 200_000, checkStatus, checkedAt },
  ];

  it("belum dilaporkan sales → giliran sales menanyakan ke toko dan SPG", () => {
    const b = dariNrt(nota());
    expect(b.giliran).toBe("sales");
    expect(b.cekSelisih).toBe("DITANYAKAN");
  });

  it("dilaporkan ditemukan, susulannya belum dihitung → giliran gudang", () => {
    expect(dariNrt(nota({ charges: beban("DITEMUKAN", pagi) })).giliran).toBe("gudang");
  });

  it("susulan yang DICATAT sesudah laporan (walau diterima di hari yang sama) → sisa, giliran sales lagi", () => {
    const b = dariNrt(nota({ charges: beban("DITEMUKAN", pagi), followUps: [{ physicalAmount: 50_000, createdAt: siang }] }));
    expect(b.giliran).toBe("sales");
  });

  it("susulan yang dicatat sebelum laporan tidak dihitung sebagai 'sesudah laporan'", () => {
    const b = dariNrt(nota({ charges: beban("DITEMUKAN", siang), followUps: [{ physicalAmount: 50_000, createdAt: pagi }] }));
    expect(b.giliran).toBe("gudang");
  });

  it("tidak ditemukan → giliran kantor memutuskan", () => {
    expect(dariNrt(nota({ charges: beban("TIDAK_DITEMUKAN", pagi) })).giliran).toBe("keuangan");
  });

  it("toko tanpa salesman pemegang: tidak ada yang bisa menanyakan → giliran kantor", () => {
    expect(dariNrt(nota({ store: { name: "Toko Tanpa Pemegang", salesmanId: null } })).giliran).toBe("keuangan");
  });

  it("beban yang sudah diputuskan → beres, hasil ceknya tetap terbawa", () => {
    const b = dariNrt(
      nota({ charges: [{ id: "c1", status: "DITETAPKAN", bearer: "GUDANG", amount: 200_000, checkStatus: "TIDAK_DITEMUKAN", checkedAt: pagi }] }),
    );
    expect(b.langkah).toBe("beres");
    expect(b.giliran).toBe("tidak_ada");
    expect(b.cekSelisih).toBe("TIDAK_DITEMUKAN");
    expect(b.penanggung).toBe("GUDANG");
  });
});
