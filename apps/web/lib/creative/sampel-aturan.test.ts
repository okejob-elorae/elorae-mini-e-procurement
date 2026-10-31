import { describe, expect, it } from "vitest";
import {
  alamatLengkap,
  barisSama,
  bacaTabSampel,
  csvAlamatKirim,
  keadaanPengiriman,
  kirimDobel,
  nomorHpTampil,
  normalisasiResi,
  rapikanBarisSampel,
  RESI_TANPA_NOMOR,
  samaResi,
  selCsv,
  tanpaNomorResi,
  umurMerah,
  type KirimanLain,
} from "./sampel-aturan";

describe("resi", () => {
  it("dirapikan tanpa spasi; kosong jadi null", () => {
    expect(normalisasiResi("  JP 1234 5678 ")).toBe("JP12345678");
    expect(normalisasiResi("   ")).toBeNull();
    expect(normalisasiResi(null)).toBeNull();
  });

  it("tanpa resi adalah tanda tetap, tidak pernah dianggap resi kembar", () => {
    expect(tanpaNomorResi(" - ")).toBe(true);
    expect(tanpaNomorResi("JNE1")).toBe(false);
    expect(samaResi(RESI_TANPA_NOMOR, RESI_TANPA_NOMOR)).toBe(false);
    expect(samaResi("jp123", "JP 123")).toBe(true);
    expect(samaResi("JP123", "JP124")).toBe(false);
  });
});

describe("keadaanPengiriman", () => {
  const kosong = { sentAt: null, trackingNo: null, stockIssuedAt: null, receivedAt: null };
  it("belum berangkat selama resi atau tanggal kirim kosong", () => {
    expect(keadaanPengiriman(kosong)).toBe("BELUM_BERANGKAT");
    expect(keadaanPengiriman({ ...kosong, trackingNo: "JNE1" })).toBe("BELUM_BERANGKAT");
    expect(keadaanPengiriman({ ...kosong, sentAt: "2026-10-01" })).toBe("BELUM_BERANGKAT");
  });
  it("berangkat = resi + tanggal kirim, atau stok sudah keluar (data pindahan)", () => {
    expect(keadaanPengiriman({ ...kosong, trackingNo: "JNE1", sentAt: "2026-10-01" })).toBe("DALAM_PERJALANAN");
    expect(keadaanPengiriman({ ...kosong, stockIssuedAt: "2026-10-01" })).toBe("DALAM_PERJALANAN");
    expect(keadaanPengiriman({ ...kosong, trackingNo: "-", sentAt: "2026-10-01", receivedAt: "2026-10-03" })).toBe("SUDAH_SAMPAI");
  });
});

describe("tab & umur", () => {
  it("tab tak dikenal jatuh ke Perlu dikirim", () => {
    expect(bacaTabSampel("dalam-perjalanan")).toBe("dalam-perjalanan");
    expect(bacaTabSampel("x")).toBe("perlu-dikirim");
    expect(bacaTabSampel(undefined)).toBe("perlu-dikirim");
  });
  it("merah baru sesudah MELEWATI ambang", () => {
    expect(umurMerah(7, 7)).toBe(false);
    expect(umurMerah(8, 7)).toBe(true);
    expect(umurMerah(null, 7)).toBe(false);
  });
});

describe("rapikanBarisSampel", () => {
  it("barang + varian yang sama dijumlah; varian null dan kosong sama", () => {
    const r = rapikanBarisSampel([
      { itemId: "a", variantSku: "A-M", qty: 1 },
      { itemId: "b", variantSku: null, qty: 2 },
      { itemId: "a", variantSku: " A-M ", qty: 2 },
      { itemId: "b", variantSku: "", qty: 1 },
      { itemId: "", variantSku: null, qty: 5 },
    ]);
    expect(r).toEqual({
      ok: true,
      baris: [
        { itemId: "a", variantSku: "A-M", qty: 3 },
        { itemId: "b", variantSku: null, qty: 3 },
      ],
    });
  });
  it("qty pecahan, nol, atau negatif ditolak", () => {
    expect(rapikanBarisSampel([{ itemId: "a", qty: 1.5 }])).toEqual({ ok: false, kode: "QTY_TIDAK_VALID" });
    expect(rapikanBarisSampel([{ itemId: "a", qty: 0 }])).toEqual({ ok: false, kode: "QTY_TIDAK_VALID" });
    expect(rapikanBarisSampel([{ itemId: "a", qty: -1 }])).toEqual({ ok: false, kode: "QTY_TIDAK_VALID" });
  });
  it("lebih dari 50 baris berbeda ditolak", () => {
    const banyak = Array.from({ length: 51 }, (_, i) => ({ itemId: `i${i}`, qty: 1 }));
    expect(rapikanBarisSampel(banyak)).toEqual({ ok: false, kode: "TERLALU_BANYAK_BARIS" });
  });
  it("barisSama mengabaikan urutan", () => {
    expect(
      barisSama(
        [
          { itemId: "a", variantSku: "M", qty: 1 },
          { itemId: "b", variantSku: null, qty: 2 },
        ],
        [
          { itemId: "b", variantSku: "", qty: 2 },
          { itemId: "a", variantSku: "M", qty: 1 },
        ],
      ),
    ).toBe(true);
    expect(barisSama([{ itemId: "a", variantSku: "M", qty: 1 }], [{ itemId: "a", variantSku: "M", qty: 2 }])).toBe(false);
  });
});

describe("kirimDobel", () => {
  const ini = { id: "k-ini", kolId: "kol-1", waNormal: "6281234567890", campaignId: "c-1" };
  const lain = (p: Partial<KirimanLain>): KirimanLain => ({
    kolaborasiId: "k-x",
    docNo: "BRIEF/2026/0001",
    kolId: "kol-9",
    kolNama: "Lain",
    waNormal: null,
    campaignId: null,
    campaignNama: null,
    sentAt: "2026-09-01",
    ...p,
  });

  it("KOL sama di campaign sama, KOL sama di campaign lain, dan nomor WA sama semuanya diperingatkan", () => {
    const hasil = kirimDobel(ini, [
      lain({ kolaborasiId: "k-a", docNo: "A", kolId: "kol-1", campaignId: "c-2", sentAt: "2026-09-20" }),
      lain({ kolaborasiId: "k-b", docNo: "B", kolId: "kol-1", campaignId: "c-1", sentAt: "2026-08-01" }),
      lain({ kolaborasiId: "k-c", docNo: "C", kolId: "kol-7", waNormal: "081234567890", sentAt: "2026-09-25" }),
      lain({ kolaborasiId: "k-d", docNo: "D", kolId: "kol-8", waNormal: "6289999999999" }),
    ]);
    expect(hasil.map((h) => [h.docNo, h.sebab, h.campaignSama])).toEqual([
      ["B", "KOL_SAMA", true],
      ["C", "WA_SAMA", false],
      ["A", "KOL_SAMA", false],
    ]);
  });

  it("kiriman kolaborasi ini sendiri bukan dobel; beberapa paket satu kolaborasi = satu peringatan", () => {
    const hasil = kirimDobel(ini, [
      lain({ kolaborasiId: "k-ini", kolId: "kol-1" }),
      lain({ kolaborasiId: "k-a", docNo: "A", kolId: "kol-1", sentAt: "2026-09-01" }),
      lain({ kolaborasiId: "k-a", docNo: "A", kolId: "kol-1", sentAt: "2026-09-10" }),
    ]);
    expect(hasil).toHaveLength(1);
    expect(hasil[0]).toMatchObject({ kolaborasiId: "k-a", sentAt: "2026-09-10" });
  });

  it("tanpa nomor WA hanya KOL yang sama yang dicocokkan", () => {
    const hasil = kirimDobel({ ...ini, waNormal: null }, [lain({ kolaborasiId: "k-c", waNormal: null })]);
    expect(hasil).toEqual([]);
  });
});

describe("alamat", () => {
  const kol = {
    name: "Rina",
    recipientName: "Rina Putri",
    waNormal: "6281234567890",
    address: "Jl. Melati No. 5, RT 01/RW 02",
    city: "Bandung",
    province: "Jawa Barat",
    postalCode: "40111",
  };

  it("alamat lengkap siap tempel, nama penerima jatuh ke nama KOL", () => {
    expect(alamatLengkap(kol)).toBe("Rina Putri\n0812-3456-7890\nJl. Melati No. 5, RT 01/RW 02\nBandung, Jawa Barat 40111");
    expect(alamatLengkap({ name: "Rina", address: "Jl. A" })).toBe("Rina\nJl. A");
  });

  it("nomor HP dari WA dinormalkan, atau apa adanya bila tidak bisa", () => {
    expect(nomorHpTampil({ waNormal: null, phone: "0812 3456 789" })).toBe("0812-3456-789");
    expect(nomorHpTampil({ waNormal: null, phone: "123" })).toBe("123");
    expect(nomorHpTampil({ waNormal: null, phone: null })).toBeNull();
  });

  it("CSV: satu baris per barang, alamat dikutip, rumus dijinakkan", () => {
    const csv = csvAlamatKirim([
      { ...kol, docNo: "BRIEF/2026/0001", campaignNama: "Lebaran", barang: [{ nama: "Kaos", varian: "M", qty: 2 }, { nama: "Celana", varian: null, qty: 1 }] },
      { name: "=HACK()", docNo: "BRIEF/2026/0002", campaignNama: null, barang: [] },
    ]);
    const garis = csv.replace(/^﻿/, "").trimEnd().split("\r\n");
    expect(garis[0]).toBe("Nama penerima,No. HP,Alamat,Kota,Provinsi,Kode pos,Barang,Varian,Qty,No. kolaborasi,Campaign");
    expect(garis[1]).toBe('Rina Putri,0812-3456-7890,"Jl. Melati No. 5, RT 01/RW 02",Bandung,Jawa Barat,40111,Kaos,M,2,BRIEF/2026/0001,Lebaran');
    expect(garis[2]).toContain("Celana,,1,BRIEF/2026/0001");
    expect(garis[3]).toBe("'=HACK(),,,,,,,,,BRIEF/2026/0002,");
    expect(csv.startsWith("﻿")).toBe(true);
  });

  it("selCsv mengutip tanda kutip", () => {
    expect(selCsv('Kaos "oversize"')).toBe('"Kaos ""oversize"""');
    expect(selCsv(null)).toBe("");
  });
});
