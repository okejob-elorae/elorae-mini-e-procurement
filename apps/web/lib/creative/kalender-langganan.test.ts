import { describe, expect, it } from "vitest";
import type { KalenderKreatif } from "./agenda-queries";
import {
  acaraKalenderKreatif,
  alamatLangganan,
  asalPermintaan,
  ASAL_SAH,
  rentangLangganan,
  tokenDariSegmen,
} from "./kalender-langganan";

const ASAL = "https://elorae.cloud";

function kalender(hari: KalenderKreatif["hari"]): KalenderKreatif {
  return { dari: "2026-09-10", sampai: "2027-01-08", hari, dealBelumKirim: { jumlah: 0, contoh: [] } };
}

describe("rentangLangganan", () => {
  it("30 hari ke belakang sampai 90 hari ke depan dari hari ini (WIB)", () => {
    expect(rentangLangganan("2026-10-10")).toEqual({ dari: "2026-09-10", sampai: "2027-01-08" });
  });
});

describe("alamatLangganan", () => {
  it("https, webcal, dan tautan tambah Google dengan cid webcal yang di-encode", () => {
    const a = alamatLangganan("https://elorae.cloud", "TOKEN_abc-123");
    expect(a.https).toBe("https://elorae.cloud/api/kreatif/kalender/TOKEN_abc-123");
    expect(a.webcal).toBe("webcal://elorae.cloud/api/kreatif/kalender/TOKEN_abc-123");
    expect(a.google).toBe(
      `https://calendar.google.com/calendar/r?cid=${encodeURIComponent("webcal://elorae.cloud/api/kreatif/kalender/TOKEN_abc-123")}`,
    );
  });

  it("asal http (lokal) tetap menjadi webcal", () => {
    expect(alamatLangganan("http://localhost:3000", "t").webcal).toBe("webcal://localhost:3000/api/kreatif/kalender/t");
  });

  it("pola asal yang diterima aksi: skema + host, tanpa jalur", () => {
    expect(ASAL_SAH.test("https://elorae.cloud")).toBe(true);
    expect(ASAL_SAH.test("http://localhost:3000")).toBe(true);
    expect(ASAL_SAH.test("https://elorae.cloud/backoffice")).toBe(false);
    expect(ASAL_SAH.test("javascript:alert(1)")).toBe(false);
  });
});

describe("tokenDariSegmen", () => {
  it("akhiran .ics dibuang; selain itu apa adanya", () => {
    expect(tokenDariSegmen("abc.ics")).toBe("abc");
    expect(tokenDariSegmen("abc")).toBe("abc");
    expect(tokenDariSegmen("abc.ICS")).toBe("abc");
  });
});

describe("asalPermintaan", () => {
  const kepala = (isi: Record<string, string>) => (n: string) => isi[n.toLowerCase()] ?? null;

  it("memakai X-Forwarded-Proto dan X-Forwarded-Host dari reverse proxy (nilai pertama)", () => {
    expect(asalPermintaan(kepala({ "x-forwarded-proto": "https, http", "x-forwarded-host": "elorae.cloud, web:3000" }), "http://web:3000")).toBe(
      "https://elorae.cloud",
    );
  });

  it("tanpa kepala proxy: host + skema cadangan", () => {
    expect(asalPermintaan(kepala({ host: "localhost:3000" }), "http://localhost:3000")).toBe("http://localhost:3000");
  });

  it("host atau skema yang aneh → asal cadangan", () => {
    expect(asalPermintaan(kepala({ host: "evil.com/path" }), "http://localhost:3000")).toBe("http://localhost:3000");
    expect(asalPermintaan(kepala({ "x-forwarded-proto": "javascript", host: "elorae.cloud" }), "https://elorae.cloud")).toBe("https://elorae.cloud");
  });
});

describe("acaraKalenderKreatif", () => {
  it("tenggat → acara sepanjang hari dengan tautan ke tab yang tepat dan nominal jatuh tempo", () => {
    const data = kalender({
      "2026-10-12": {
        tenggat: [
          {
            jenis: "JATUH_TEMPO_BAYAR",
            jumlah: 1,
            nilai: 1500000,
            baris: [{ id: "k1:JATUH_TEMPO_BAYAR:t1", kolaborasiId: "k1", campaignId: null, judul: "@nadia", sub: "BRIEF/2026/0001", nilai: 1500000, lewat: true }],
          },
        ],
        kejadian: [],
        agenda: [],
      },
    });
    const [a] = acaraKalenderKreatif(data, { asal: ASAL });
    expect(a.uid).toBe("tenggat-k1-JATUH_TEMPO_BAYAR-t1@elorae-kreatif");
    expect(a.mulai).toEqual({ tanggal: "2026-10-12" });
    expect(a.ringkasan).toBe("⚠ Jatuh tempo bayar · @nadia (lewat)");
    expect(a.url).toBe("https://elorae.cloud/backoffice/kreatif/kolaborasi/k1?tab=pembayaran");
    expect(a.keterangan).toContain("BRIEF/2026/0001");
    expect(a.keterangan).toContain("Rp 1.500.000");
    expect(a.keterangan).toContain("Buka di Elorae: https://elorae.cloud/backoffice/kreatif/kolaborasi/k1?tab=pembayaran");
  });

  it("kejadian kolaborasi dan campaign; views ditulis dengan titik", () => {
    const data = kalender({
      "2026-10-01": {
        tenggat: [],
        kejadian: [
          { jenis: "TAYANG", jumlah: 1, nilai: 12345, baris: [{ id: "tayang:c9", kolaborasiId: "k2", campaignId: null, judul: "@budi", sub: "BRIEF/2026/0002", nilai: 12345 }] },
          { jenis: "CAMPAIGN_MULAI", jumlah: 1, nilai: null, baris: [{ id: "mulai:cp1", kolaborasiId: null, campaignId: "cp1", judul: "Lebaran", sub: null, nilai: null }] },
        ],
        agenda: [],
      },
    });
    const acara = acaraKalenderKreatif(data, { asal: ASAL });
    const tayang = acara.find((x) => x.uid === "kejadian-tayang-c9@elorae-kreatif")!;
    expect(tayang.ringkasan).toBe("Konten tayang · @budi");
    expect(tayang.keterangan).toContain("12.345 views");
    expect(tayang.url).toBe("https://elorae.cloud/backoffice/kreatif/kolaborasi/k2?tab=konten");
    const mulai = acara.find((x) => x.uid === "kejadian-mulai-cp1@elorae-kreatif")!;
    expect(mulai.url).toBe("https://elorae.cloud/backoffice/kreatif/campaign/cp1");
    expect(mulai.ringkasan).toBe("Campaign mulai · Lebaran");
  });

  it("kelompok yang terpotong mendapat satu acara 'lainnya' ke hari itu di Kalender", () => {
    const data = kalender({
      "2026-10-05": {
        tenggat: [
          {
            jenis: "ANGKA_H1",
            jumlah: 3,
            nilai: null,
            baris: [{ id: "k3:ANGKA_H1:", kolaborasiId: "k3", campaignId: null, judul: "@a", sub: null, nilai: null }],
          },
        ],
        kejadian: [],
        agenda: [],
      },
    });
    const acara = acaraKalenderKreatif(data, { asal: ASAL });
    expect(acara).toHaveLength(2);
    const lain = acara.find((x) => x.uid.startsWith("lainnya-"))!;
    expect(lain.uid).toBe("lainnya-tenggat-ANGKA_H1-2026-10-05@elorae-kreatif");
    expect(lain.ringkasan).toBe("⚠ Angka H+1 · 2 lainnya");
    expect(lain.url).toBe("https://elorae.cloud/backoffice/kreatif/kalender?bulan=2026-10&tanggal=2026-10-05");
  });

  it("agenda berjam → waktu WIB diubah ke UTC; tanpa jam → sepanjang hari; isi persiapan dan kaitan", () => {
    const dasar = {
      jenis: "MEETING" as const,
      checklist: [
        { teks: "Siapkan brief", selesai: true },
        { teks: "Kirim deck", selesai: false },
      ],
      catatan: "Bahas fee, tanggal tayang",
      campaignId: "cp1",
      campaignNama: "Lebaran",
      kolId: "kol1",
      kolNama: "Nadia",
      kolaborasiId: "k1",
      kolaborasiDocNo: "BRIEF/2026/0001",
      ingatHari: 0,
      selesai: false,
    };
    const data = kalender({
      "2026-10-12": {
        tenggat: [],
        kejadian: [],
        agenda: [
          { ...dasar, id: "ag1", judul: "Call @nadia", tanggal: "2026-10-12", jam: "10:30" },
          { ...dasar, id: "ag2", judul: "Rekap", tanggal: "2026-10-12", jam: null, selesai: true },
        ],
      },
    });
    const acara = acaraKalenderKreatif(data, { asal: ASAL });
    const berjam = acara.find((x) => x.uid === "agenda-ag1@elorae-kreatif")!;
    expect(berjam.mulai).toEqual({ waktu: new Date("2026-10-12T03:30:00.000Z") });
    expect(berjam.ringkasan).toBe("Call @nadia");
    expect(berjam.keterangan).toContain("Meeting / call");
    expect(berjam.keterangan).toContain("☑ Siapkan brief");
    expect(berjam.keterangan).toContain("☐ Kirim deck");
    expect(berjam.keterangan).toContain("Bahas fee, tanggal tayang");
    expect(berjam.keterangan).toContain("Kolaborasi: BRIEF/2026/0001");
    expect(berjam.url).toBe("https://elorae.cloud/backoffice/kreatif/kalender?bulan=2026-10&tanggal=2026-10-12&agenda=ag1");
    const seharian = acara.find((x) => x.uid === "agenda-ag2@elorae-kreatif")!;
    expect(seharian.mulai).toEqual({ tanggal: "2026-10-12" });
    expect(seharian.ringkasan).toBe("✓ Rekap");
  });

  it("jam yang tidak sah dibaca sebagai sepanjang hari, bukan Invalid Date", () => {
    const data = kalender({
      "2026-10-12": {
        tenggat: [],
        kejadian: [],
        agenda: [
          {
            id: "ag3",
            judul: "X",
            tanggal: "2026-10-12",
            jam: "25:99",
            jenis: "TUGAS",
            checklist: [],
            catatan: null,
            campaignId: null,
            campaignNama: null,
            kolId: null,
            kolNama: null,
            kolaborasiId: null,
            kolaborasiDocNo: null,
            ingatHari: 0,
            selesai: false,
          },
        ],
      },
    });
    expect(acaraKalenderKreatif(data, { asal: ASAL })[0].mulai).toEqual({ tanggal: "2026-10-12" });
  });

  it("UID hanya memuat huruf, angka, dan tanda hubung sebelum @", () => {
    const data = kalender({
      "2026-10-12": {
        tenggat: [],
        kejadian: [{ jenis: "KIRIM", jumlah: 1, nilai: null, baris: [{ id: "kirim:a b/c", kolaborasiId: "k1", campaignId: null, judul: "x", sub: null, nilai: null }] }],
        agenda: [],
      },
    });
    expect(acaraKalenderKreatif(data, { asal: ASAL })[0].uid).toBe("kejadian-kirim-a-b-c@elorae-kreatif");
  });
});
