import { describe, expect, it } from "vitest";
import { csvTagihan, namaBerkasTagihan } from "./bayar-csv";
import { angkaCsv, csvPerforma, namaBerkasPeriode, selCsv, susunCsv } from "./laporan-csv";

const BOM = String.fromCharCode(0xfeff);
const baris = (csv: string) => csv.replace(BOM, "").trimEnd().split("\r\n");

describe("selCsv dan susunCsv", () => {
  it("mengutip koma, kutip, dan baris baru; angka tanpa titik ribuan", () => {
    expect(selCsv("Toko, Jakarta")).toBe('"Toko, Jakarta"');
    expect(selCsv('kata "aku"')).toBe('"kata ""aku"""');
    expect(selCsv("baris\nkedua")).toBe('"baris\nkedua"');
    expect(selCsv(1_250_000)).toBe("1250000");
    expect(selCsv(0.1 + 0.2)).toBe("0.30");
    expect(selCsv(null)).toBe("");
    expect(selCsv(Number.NaN)).toBe("");
    expect(angkaCsv(1234.5)).toBe("1234.50");
  });

  it("menjinakkan sel yang terbaca rumus", () => {
    expect(selCsv("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(selCsv("@nadia")).toBe("'@nadia");
    expect(selCsv("-tes")).toBe("'-tes");
  });

  it("diawali BOM dan memakai CRLF", () => {
    const csv = susunCsv([["a", 1], ["b", 2]]);
    expect(csv.startsWith(BOM)).toBe(true);
    expect(csv).toBe(`${BOM}a,1\r\nb,2\r\n`);
  });

  it("nama berkas mengikuti periode", () => {
    expect(namaBerkasPeriode("performa", "2026-10-07", "2026-10-07")).toBe("performa-2026-10-07.csv");
    expect(namaBerkasPeriode("performa", "2026-10-01", "2026-10-07")).toBe("performa-2026-10-01_sd_2026-10-07.csv");
    expect(namaBerkasTagihan("2026-10-07")).toBe("tagihan-kol-2026-10-07.csv");
  });
});

describe("csvTagihan", () => {
  it("judul, kepala, baris, lalu TOTAL aman-sen", () => {
    const csv = csvTagihan(
      [
        { username: "@nadia", namaKol: "Nadia", namaPenerima: "Nadia P", campaign: "Lebaran", tahap: "TAYANG", fee: 1_000_000.1, dibayar: 400_000, sisa: 600_000.1, payStatus: "SEBAGIAN", paidAt: "2026-10-03", catatan: "DP\nBCA" },
        { username: null, namaKol: "Rina", namaPenerima: "Rina", campaign: null, tahap: "DIBAYAR", fee: 500_000.2, dibayar: 500_000.2, sisa: 0, payStatus: "LUNAS", paidAt: "2026-10-05", catatan: null },
      ],
      "Daftar tagihan KOL — dibuat 7 Okt 2026",
    );
    const b = baris(csv);
    expect(b[0]).toBe("Daftar tagihan KOL — dibuat 7 Okt 2026");
    expect(b[1]).toBe("No,Username,Nama KOL,Nama penerima,Campaign,Tahap,Fee,Dibayar,Sisa,Status bayar,Tanggal bayar,Catatan");
    expect(b[2]).toBe("1,nadia,Nadia,Nadia P,Lebaran,Tayang,1000000.10,400000,600000.10,Dibayar sebagian,2026-10-03,DP BCA");
    expect(b[3]).toBe("2,,Rina,Rina,,Dibayar,500000.20,500000.20,0,Lunas,2026-10-05,");
    expect(b[4]).toBe("");
    expect(b[5]).toBe("TOTAL,,,,,,1500000.30,900000.20,600000.10,,,");
  });
});

describe("csvPerforma", () => {
  it("baris periode, satu baris per kolaborasi, TOTAL dengan ROAS dan CPM dari totalnya", () => {
    const csv = csvPerforma(
      [
        {
          username: "nadia",
          namaKol: "Nadia",
          platform: "TIKTOK",
          pengikut: 85_000,
          campaign: "Lebaran",
          docNo: "BRIEF/2026/0001",
          tahap: "TAYANG",
          jenis: "BAYAR",
          fee: 1_000_000,
          pphGrossUp: 25_641,
          views: 100_000,
          jumlahKonten: 2,
          orders: 10,
          gmv: 3_000_000,
          komisi: 0,
          biayaKirim: 150_000,
          boost: 0,
          totalBiaya: 1_150_000,
          roas: 2.61,
        },
        {
          username: null,
          namaKol: "Rina",
          platform: null,
          pengikut: 0,
          campaign: null,
          docNo: "BRIEF/2026/0002",
          tahap: "DEAL",
          jenis: "BARTER",
          fee: 0,
          pphGrossUp: 0,
          views: 0,
          jumlahKonten: 0,
          orders: 0,
          gmv: 0,
          komisi: 0,
          biayaKirim: 50_000,
          boost: 0,
          totalBiaya: 50_000,
          roas: 0,
        },
      ],
      { dari: "2026-10-01", sampai: "2026-10-07" },
    );
    const b = baris(csv);
    expect(b[0]).toBe("Periode: 2026-10-01 s/d 2026-10-07");
    expect(b[1]).toContain(",Jenis,Fee disepakati,PPh gross-up,Konten,");
    expect(b[2]).toBe("1,nadia,Nadia,TikTok,85000,Lebaran,BRIEF/2026/0001,Tayang,Berbayar,1000000,25641,2,100000,10,3000000,0,150000,0,1150000,2.61,11500");
    expect(b[3].startsWith("2,,Rina,,0,,BRIEF/2026/0002,Deal,Barter,")).toBe(true);
    expect(b[5]).toBe("TOTAL,,,,,,,,,1000000,25641,2,100000,10,3000000,0,200000,0,1200000,2.50,12000");
    expect(baris(csvPerforma([], null))[0]).toBe("Periode: semua");
  });
});
