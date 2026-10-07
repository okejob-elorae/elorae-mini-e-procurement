import { describe, expect, it } from "vitest";
import { htmlCetakRekap, labelPeriodeRekap, pecahRekap } from "./laporan-cetak";
import { susunRekap, type DataRekap } from "./rekap";

const data: DataRekap = {
  dari: "2026-10-07",
  sampai: "2026-10-07",
  dibuatPada: new Date("2026-10-07T07:30:00.000Z"),
  ringkasan: {
    kolBaru: 1,
    barangDikirim: 1,
    barangDiterima: 0,
    kontenTayang: 1,
    views: 10_000,
    orders: 2,
    gmv: 500_000,
    komisi: 0,
    biayaFee: 100_000,
    biayaKirim: 0,
    biayaBoost: 0,
  },
  posisi: [{ tahap: "DEAL", jumlah: 2 }],
  perCampaign: [],
  teratas: [{ kol: "@a&b", platform: "TikTok", gmv: 500_000, orders: 2 }],
  pengiriman: [{ kol: "<script>alert(1)</script>", platform: null, kurir: "JNE", resi: "R1" }],
  kontenTayang: [],
  kolBaru: [],
  perubahanTahap: [],
  catatan: [],
  tindakLanjut: [{ judul: "Draf menunggu review", jumlah: 1 }],
};

describe("pecahRekap", () => {
  it("membuang kepala, memisah kaki, dan memberi judul setiap blok berhuruf kapital", () => {
    const { blok, kaki } = pecahRekap(susunRekap(data));
    expect(blok.map((b) => b.judul)).toEqual([
      "RINGKASAN",
      "POSISI TAHAP (kondisi saat ini)",
      "TOP PERFORMER (1)",
      "PENGIRIMAN (1)",
      "PERLU DITINDAKLANJUTI (1)",
    ]);
    expect(blok[0].isi).toContain("- KOL baru");
    expect(kaki).toMatch(/^Dibuat otomatis oleh Elorae ERP · 07\/10\/2026 14\.30$/);
  });
});

describe("htmlCetakRekap", () => {
  const html = htmlCetakRekap({
    teks: susunRekap(data),
    brand: "Eloraé",
    periode: "Rabu, 7 Oktober 2026",
    kembaliHref: "/backoffice/kreatif/laporan?tab=rekap",
    cetakOtomatis: true,
  });

  it("terang, berkepala brand, satu h2 per blok", () => {
    expect(html).toContain('<meta name="color-scheme" content="light">');
    expect(html).toContain('<p class="merek">Eloraé</p>');
    expect(html).toContain("<h1>Rekap KOL</h1>");
    expect(html.match(/<h2>/g)).toHaveLength(5);
    expect(html).toContain("@page { margin: 18mm 16mm; }");
    expect(html).toContain(".alat { display: none; }");
  });

  it("meng-escape isi data dan tidak menaruhnya di skrip", () => {
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("@a&amp;b");
  });

  it("mencetak sendiri kecuali ?pratinjau=1", () => {
    expect(html).toContain("var otomatis = true;");
    expect(html).toContain('get("pratinjau") === "1"');
    expect(htmlCetakRekap({ teks: "", brand: "x", periode: "y", kembaliHref: "/", cetakOtomatis: false })).toContain("var otomatis = false;");
  });
});

describe("labelPeriodeRekap", () => {
  it("satu hari atau rentang dengan jumlah hari", () => {
    expect(labelPeriodeRekap({ dari: "2026-10-07", sampai: "2026-10-07" })).toBe("Rabu, 7 Oktober 2026");
    expect(labelPeriodeRekap({ dari: "2026-10-01", sampai: "2026-10-07" })).toBe("Kamis, 1 Oktober 2026 – Rabu, 7 Oktober 2026 (7 hari)");
  });
});
