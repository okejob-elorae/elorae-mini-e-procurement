import { describe, expect, it } from "vitest";
import { adaSusulanSesudahLapor, dariNrt, ringkasKerjaRetur } from "./return-queries";

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

  it("hitungan yatim yang dihitung SEBELUM laporan tetapi DIJADIKAN susulan sesudahnya terhitung 'sesudah laporan' → giliran sales lagi", () => {
    const b = dariNrt(
      nota({
        charges: beban("DITEMUKAN", siang),
        followUps: [{ physicalAmount: 50_000, createdAt: pagi, dijodohkanAt: new Date(siang.getTime() + 60_000) }],
      }),
    );
    expect(b.giliran).toBe("sales");
  });

  it("hitungan yatim yang dihitung DAN dijadikan susulan sebelum laporan tetap 'sebelum laporan' → giliran gudang", () => {
    const b = dariNrt(
      nota({
        charges: beban("DITEMUKAN", siang),
        followUps: [{ physicalAmount: 50_000, createdAt: pagi, dijodohkanAt: new Date(pagi.getTime() + 60_000) }],
      }),
    );
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

/*
 * Aturan giliran yang sama dipakai HP pemegang toko (`selisihReturSaya`): kalau kantor bilang
 * "giliran sales" tetapi HP tidak menampilkan tombol Ditemukan / Tidak ditemukan, pemegang disuruh
 * melapor tanpa jalan untuk melapor.
 */
describe("adaSusulanSesudahLapor — satu aturan untuk daftar kantor dan HP pemegang", () => {
  const sore = new Date("2026-11-02T09:00:00.000Z");

  it("belum dilapor → tidak pernah 'sesudah laporan'", () => {
    expect(adaSusulanSesudahLapor([{ createdAt: sore }], null)).toBe(false);
  });

  it("tanpa susulan → false", () => {
    expect(adaSusulanSesudahLapor([], siang)).toBe(false);
  });

  it("dicatat sesudah laporan → true; dicatat sebelum laporan → false", () => {
    expect(adaSusulanSesudahLapor([{ createdAt: sore }], siang)).toBe(true);
    expect(adaSusulanSesudahLapor([{ createdAt: pagi }], siang)).toBe(false);
  });

  it("dicatat sebelum laporan tetapi dijadikan susulan sesudahnya → true", () => {
    expect(adaSusulanSesudahLapor([{ createdAt: pagi, dijodohkanAt: sore }], siang)).toBe(true);
  });

  it("dijadikan susulan yang (tak mungkin) lebih awal dari pencatatannya tidak memundurkan waktunya", () => {
    expect(adaSusulanSesudahLapor([{ createdAt: sore, dijodohkanAt: pagi }], siang)).toBe(true);
  });

  it("tepat pada saat laporan bukan 'sesudah'", () => {
    expect(adaSusulanSesudahLapor([{ createdAt: siang, dijodohkanAt: null }], siang)).toBe(false);
  });
});
