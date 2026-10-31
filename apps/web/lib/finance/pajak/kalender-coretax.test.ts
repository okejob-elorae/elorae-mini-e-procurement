import { describe, expect, it } from "vitest";
import { beriStatus, cocokSaring, geserKeHariKerja, kalenderPajak, kewajibanMasa } from "./kalender";
import { susunFaktur, xmlFakturKeluaran } from "./coretax";
import { PPN_BAWAAN } from "./ppn";

const kal = kalenderPajak([{ tanggal: "2026-11-16", nama: "uji libur" }]);

describe("kalender pajak", () => {
  it("jatuh tempo masa September 2026 menurut profil, digeser dari hari libur", () => {
    const k = kewajibanMasa("2026-09", { pkp: true, finalUmkm: true, pphNormal: false, potongan: ["PPH23"] }, kal);
    const peta = Object.fromEntries(k.map((b) => [b.kunci, b.jatuhTempo]));
    expect(peta).toEqual({
      "SETOR:PPH23:2026-09": "2026-10-15",
      "SETOR:PPH_FINAL:2026-09": "2026-10-15",
      "LAPOR:PPH_UNIFIKASI:2026-09": "2026-10-20",
      "UNGGAH_FAKTUR:FAKTUR:2026-09": "2026-10-20",
      "SETOR:PPN:2026-09": "2026-11-02",
      "LAPOR:PPN:2026-09": "2026-11-02",
    });
    // 31 Okt 2026 hari Sabtu → Senin 2 Nov.
    expect(k.find((b) => b.kunci === "SETOR:PPN:2026-09")!.jatuhTempoAturan).toBe("2026-10-31");
    // 15 Nov 2026 Minggu, 16 Nov tanggal merah uji → Selasa 17 Nov.
    expect(geserKeHariKerja("2026-11-15", kal)).toBe("2026-11-17");
  });

  it("bukan PKP, tanpa potongan: hanya kewajiban rezim yang dipilih", () => {
    expect(kewajibanMasa("2026-09", { pkp: false, finalUmkm: false, pphNormal: true, potongan: [] }, kal).map((b) => b.kunci)).toEqual(["SETOR:PPH25:2026-09"]);
  });

  it("status setoran dan saringan Beranda memakai definisi yang sama", () => {
    const [b] = kewajibanMasa("2026-09", { pkp: false, finalUmkm: false, pphNormal: false, potongan: ["PPH21"] }, kal);
    const segera = beriStatus(b, { terutang: 500_000, disetor: 0 }, "2026-10-13");
    expect(segera).toMatchObject({ status: "BELUM", tenggat: "SEGERA", sisa: 500_000, perluTindakan: true });
    expect(cocokSaring(segera, "segera")).toBe(true);
    expect(cocokSaring(segera, "lewat")).toBe(false);
    const lewat = beriStatus(b, { terutang: 500_000, disetor: 200_000 }, "2026-10-16");
    expect(lewat).toMatchObject({ status: "SEBAGIAN", tenggat: "LEWAT", sisa: 300_000, perluTindakan: true });
    expect(beriStatus(b, { terutang: 500_000, disetor: 500_000 }, "2026-10-16")).toMatchObject({ status: "LUNAS", perluTindakan: false });
    expect(beriStatus(b, { terutang: 0, disetor: 0 }, "2026-10-16")).toMatchObject({ status: "NIHIL", perluTindakan: false });
    expect(beriStatus(b, { terutang: 500_000, disetor: 0 }, "2026-10-01")).toMatchObject({ tenggat: "NANTI", perluTindakan: false });
    expect(beriStatus(b, { terutang: null, disetor: 0 }, "2026-10-16")).toMatchObject({ status: "TANPA_ANGKA", perluTindakan: false });
  });
});

describe("faktur keluaran Coretax", () => {
  const nota = {
    nomor: "DLV/2026/0007",
    tanggal: "2026-10-05",
    pembeli: { nama: "Toko Sinar & Jaya", alamat: "Jl. Mawar 1", npwp: "01.234.567.8-901.000", pkp: true },
    diskonNota: 11_100,
    baris: [
      { nama: "Kaos <Hitam>", qty: 3, hargaSatuan: 111_000, diskon: 0 },
      { nama: "Celana", qty: 1, hargaSatuan: 222_000, diskon: 22_200 },
    ],
  };

  it("DPP, DPP nilai lain, dan PPN per baris memenuhi rumus Coretax; harga × qty − diskon = DPP", () => {
    const { faktur, peringatan } = susunFaktur(nota, PPN_BAWAAN);
    for (const b of faktur.baris) {
      expect(Math.round((b.harga * b.qty - b.totalDiskon) * 100)).toBe(b.dpp * 100);
      expect(b.dppNilaiLain).toBe(Math.round((b.dpp * 11) / 12));
      expect(b.ppn).toBe(Math.round(b.dppNilaiLain * 0.12));
      expect(b.totalDiskon).toBeGreaterThanOrEqual(0);
    }
    // Diskon nota 11.100 dibagi menurut nilai baris dalam rupiah penuh: 6.938 ke baris pertama.
    expect(faktur.baris[0]).toMatchObject({ harga: 100_000, qty: 3 });
    // DPP + PPN = total nota, kecuali selisih pembulatan rumus Coretax (≤ Rp1 per baris) yang diperingatkan.
    const selisih = faktur.jumlahDpp + faktur.jumlahPpn - (333_000 + 222_000 - 22_200 - 11_100);
    expect(Math.abs(selisih)).toBeLessThanOrEqual(faktur.baris.length);
    expect(peringatan.map((p) => p.kode)).toEqual(selisih !== 0 ? ["SELISIH_PPN"] : []);
    // Harga bulat tanpa diskon nota: tidak ada selisih sama sekali.
    const bersih = susunFaktur({ ...nota, diskonNota: 0, baris: [{ nama: "Kaos", qty: 2, hargaSatuan: 111_000, diskon: 0 }] }, PPN_BAWAAN);
    expect(bersih.faktur.baris[0]).toMatchObject({ harga: 100_000, totalDiskon: 0, dpp: 200_000, dppNilaiLain: 183_333, ppn: 22_000 });
    expect(bersih.peringatan).toEqual([]);
  });

  it("XML: struktur TaxInvoiceBulk, karakter di-escape, pembeli tanpa NPWP diberi identitas kosong + peringatan", () => {
    const { faktur } = susunFaktur(nota, PPN_BAWAAN);
    const tanpa = susunFaktur({ ...nota, nomor: "DLV/2026/0008", pembeli: { nama: "Toko B", alamat: null, npwp: null, pkp: false } }, PPN_BAWAAN);
    expect(tanpa.peringatan.map((p) => p.kode)).toContain("PEMBELI_TANPA_NPWP");
    const xml = xmlFakturKeluaran([faktur, tanpa.faktur], { npwp: "0098765432109000", nitku: null, nama: "PT Elorae" });
    expect(xml).toContain("<TIN>0098765432109000</TIN>");
    expect(xml).toContain("<SellerIDTKU>0098765432109000000000</SellerIDTKU>");
    expect(xml).toContain("<TrxCode>04</TrxCode>");
    expect(xml).toContain("<BuyerTin>0012345678901000</BuyerTin><BuyerDocument>TIN</BuyerDocument>");
    expect(xml).toContain("<BuyerName>Toko Sinar &amp; Jaya</BuyerName>");
    expect(xml).toContain("<Name>Kaos &lt;Hitam&gt;</Name>");
    expect(xml).toContain("<BuyerTin>0000000000000000</BuyerTin><BuyerDocument>Other ID</BuyerDocument>");
    expect((xml.match(/<TaxInvoice>/g) ?? []).length).toBe(2);
    expect(() => xmlFakturKeluaran([faktur], { npwp: null, nitku: null, nama: null })).toThrow();
  });
});
