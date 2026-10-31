import { PEMBILANG_DPP_NILAI_LAIN, PENYEBUT_DPP_NILAI_LAIN, pisahPpn, type PengaturanPpn } from "./ppn";
import { nitkuEfektif, rapikanNpwp, type IdentitasPajak } from "./identitas";

/**
 * Ekspor FAKTUR PAJAK KELUARAN ke format impor Coretax (XML "TaxInvoiceBulk")
 * dari nota tagihan putus — murni, aman untuk komponen klien.
 *
 * Coretax TIDAK menghitung DPP nilai lain sendiri (riset 2026-10-08), jadi
 * setiap baris membawa `TaxBase` (DPP), `OtherTaxBase` (11/12 × DPP) dan `VAT`
 * yang SUDAH dihitung; `VAT` = pembulatan(OtherTaxBase × 12%) — rumus Coretax —
 * yang bisa berbeda ≤ Rp1 dari PPN di buku besar untuk harga termasuk PPN
 * (`selarasCoretax` di `ppn.ts`); selisihnya dilaporkan sebagai peringatan.
 *
 * - Kode transaksi 04 (DPP nilai lain, barang non-mewah), "Normal".
 * - Harga nota termasuk PPN (`hargaJualTermasukPpn`) dipecah per baris:
 *   `Price` = harga satuan tanpa PPN (2 desimal), `TotalDiscount` = selisih
 *   sampai `Price × Qty − TotalDiscount = TaxBase` persis.
 * - Pembeli tanpa NPWP tercatat (skema toko belum punya kolom NPWP/NITKU):
 *   `BuyerTin` 0000000000000000, dokumen "Other ID" — WAJIB dilengkapi di
 *   Coretax sebelum diunggah; tiap faktur seperti itu diberi peringatan.
 * - Kode satuan dan nama tag diambil dari struktur templat DJP; PERIKSA
 *   dengan sheet "Ref" templat terbaru sebelum unggah pertama.
 */

export const KODE_TRANSAKSI_FAKTUR = "04";
/** Kode satuan Coretax untuk "Piece" — [perlu dicek dengan sheet Ref templat DJP]. */
export const KODE_SATUAN_BAWAAN = "UM.0021";
/** Kode barang umum bila tidak ada kode HS. */
export const KODE_BARANG_UMUM = "000000";
const TIN_KOSONG = "0000000000000000";

export type BarisNotaUntukFaktur = {
  nama: string;
  qty: number;
  /** Harga satuan seperti di nota (termasuk PPN bila pengaturan mengatakan demikian). */
  hargaSatuan: number;
  /** Diskon baris seperti di nota (bersifat sama dengan harganya). */
  diskon: number;
};

export type NotaUntukFaktur = {
  /** Nomor nota tagihan (RefDesc). */
  nomor: string;
  /** "YYYY-MM-DD" tanggal faktur (tanggal nota tagihan). */
  tanggal: string;
  pembeli: { nama: string; alamat: string | null; npwp: string | null; email?: string | null; pkp?: boolean };
  /** Diskon tingkat nota (dibagi ke baris secara proporsional). */
  diskonNota?: number;
  baris: BarisNotaUntukFaktur[];
};

export type BarisFaktur = {
  nama: string;
  satuan: string;
  harga: number;
  qty: number;
  totalDiskon: number;
  dpp: number;
  dppNilaiLain: number;
  tarif: number;
  ppn: number;
};

export type FakturKeluaran = {
  nomor: string;
  tanggal: string;
  pembeli: NotaUntukFaktur["pembeli"];
  baris: BarisFaktur[];
  jumlahDpp: number;
  jumlahPpn: number;
};

export type PeringatanFaktur = { nomor: string | null; kode: "PEMBELI_TANPA_NPWP" | "PEMBELI_PKP_TANPA_NPWP" | "SELISIH_PPN" | "TANPA_BARIS"; teks: string };

const keSen = (n: number): number => Math.sign(n) * Math.round(Number((Math.abs(n) * 100).toFixed(4)));
const bulat = (n: number) => Math.round(n);
const bagiBulat = (a: number, b: number) => Math.floor((2 * a + b) / (2 * b));

/**
 * Bagi diskon nota ke baris menurut nilai baris, dalam RUPIAH PENUH (sisa
 * rupiah ke baris terbesar) — supaya nilai bersih tiap baris tetap rupiah
 * penuh dan DPP + PPN-nya menjumlah persis. Masukan & keluaran dalam sen.
 */
function bagiDiskonNota(nilaiSen: number[], diskonSen: number): number[] {
  const total = nilaiSen.reduce((s, n) => s + n, 0);
  const diskonRp = Math.round(diskonSen / 100);
  if (diskonRp <= 0 || total <= 0) return nilaiSen.map(() => 0);
  const bagian = nilaiSen.map((n) => Math.floor((n * diskonRp) / total));
  let sisa = diskonRp - bagian.reduce((s, n) => s + n, 0);
  const urut = nilaiSen.map((n, i) => [n, i] as const).sort((a, b) => b[0] - a[0]);
  for (let k = 0; sisa > 0 && urut.length > 0; k = (k + 1) % urut.length, sisa--) bagian[urut[k][1]] += 1;
  return bagian.map((rp) => rp * 100);
}

/**
 * Susun satu faktur dari satu nota. `pengaturan` dipakai apa adanya kecuali
 * statusnya: ekspor selalu menghitung PPN (faktur hanya dibuat oleh PKP).
 */
export function susunFaktur(nota: NotaUntukFaktur, pengaturan: PengaturanPpn): { faktur: FakturKeluaran; peringatan: PeringatanFaktur[] } {
  const p: PengaturanPpn = { ...pengaturan, statusPkp: "PKP", berlakuSejak: null };
  const tgl = new Date(`${nota.tanggal}T00:00:00+07:00`);
  const tarifBp = Math.round(p.tarifPersen * 100);
  const peringatan: PeringatanFaktur[] = [];
  const barisSah = nota.baris.filter((b) => b.qty > 0);
  const bruto = barisSah.map((b) => keSen(b.hargaSatuan) * b.qty);
  const diskonBaris = barisSah.map((b) => Math.max(0, keSen(b.diskon)));
  const diskonNota = bagiDiskonNota(
    bruto.map((n, i) => Math.max(0, n - diskonBaris[i])),
    Math.max(0, keSen(nota.diskonNota ?? 0)),
  );

  let selisih = 0;
  const baris: BarisFaktur[] = barisSah.map((b, i) => {
    const netSen = Math.max(0, bruto[i] - diskonBaris[i] - diskonNota[i]);
    const pB = pisahPpn(bruto[i] / 100, { pengaturan: p, tanggal: tgl });
    const pN = pisahPpn(netSen / 100, { pengaturan: p, tanggal: tgl });
    const dpp = bulat(pN.dpp);
    let harga = Math.round((pB.dpp / b.qty) * 100) / 100;
    let totalDiskon = Math.round((harga * b.qty - dpp) * 100) / 100;
    if (totalDiskon < 0) {
      harga = Math.ceil((dpp / b.qty) * 100) / 100;
      totalDiskon = Math.round((harga * b.qty - dpp) * 100) / 100;
    }
    const dppNilaiLain = p.pakaiDppNilaiLain ? bagiBulat(dpp * PEMBILANG_DPP_NILAI_LAIN, PENYEBUT_DPP_NILAI_LAIN) : dpp;
    const ppn = bagiBulat(dppNilaiLain * tarifBp, 10_000);
    selisih += ppn - pN.ppn;
    return { nama: b.nama, satuan: KODE_SATUAN_BAWAAN, harga, qty: b.qty, totalDiskon, dpp, dppNilaiLain, tarif: p.tarifPersen, ppn };
  });

  if (baris.length === 0) peringatan.push({ nomor: nota.nomor, kode: "TANPA_BARIS", teks: `Nota ${nota.nomor} tidak punya baris barang.` });
  if (!rapikanNpwp(nota.pembeli.npwp)) {
    peringatan.push(
      nota.pembeli.pkp
        ? { nomor: nota.nomor, kode: "PEMBELI_PKP_TANPA_NPWP", teks: `${nota.pembeli.nama} toko PKP tetapi NPWP-nya belum tercatat — isi NPWP/NITKU-nya di Coretax sebelum diunggah.` }
        : { nomor: nota.nomor, kode: "PEMBELI_TANPA_NPWP", teks: `${nota.pembeli.nama} belum punya NPWP tercatat — faktur memakai identitas kosong; lengkapi di Coretax.` },
    );
  }
  if (selisih !== 0) {
    peringatan.push({
      nomor: nota.nomor,
      kode: "SELISIH_PPN",
      teks: `PPN nota ${nota.nomor} menurut rumus Coretax berbeda Rp${Math.abs(selisih)} dari PPN di buku besar (pembulatan harga termasuk PPN).`,
    });
  }

  return {
    faktur: {
      nomor: nota.nomor,
      tanggal: nota.tanggal,
      pembeli: nota.pembeli,
      baris,
      jumlahDpp: baris.reduce((s, b) => s + b.dpp, 0),
      jumlahPpn: baris.reduce((s, b) => s + b.ppn, 0),
    },
    peringatan,
  };
}

function esc(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function angkaXml(n: number): string {
  const sen = keSen(n);
  return sen % 100 === 0 ? String(sen / 100) : (sen / 100).toFixed(2);
}

const tag = (nama: string, isi: string | number) => `<${nama}>${typeof isi === "number" ? angkaXml(isi) : esc(isi)}</${nama}>`;
const kosong = (nama: string) => `<${nama}/>`;

/** XML impor faktur keluaran Coretax. Penjual tanpa NPWP → galat (ekspor ditolak di pemanggil). */
export function xmlFakturKeluaran(daftar: readonly FakturKeluaran[], penjual: IdentitasPajak): string {
  const npwp = rapikanNpwp(penjual.npwp);
  const idtku = nitkuEfektif({ ...penjual, npwp });
  if (!npwp || !idtku) throw new Error("NPWP perusahaan belum diisi");
  const faktur = daftar.map((f) => {
    const tin = rapikanNpwp(f.pembeli.npwp);
    const barang = f.baris
      .map((b) =>
        [
          "<GoodService>",
          tag("Opt", "A"),
          tag("Code", KODE_BARANG_UMUM),
          tag("Name", b.nama),
          tag("Unit", b.satuan),
          tag("Price", b.harga),
          tag("Qty", b.qty),
          tag("TotalDiscount", b.totalDiskon),
          tag("TaxBase", b.dpp),
          tag("OtherTaxBase", b.dppNilaiLain),
          tag("VATRate", b.tarif),
          tag("VAT", b.ppn),
          tag("STLGRate", 0),
          tag("STLG", 0),
          "</GoodService>",
        ].join(""),
      )
      .join("");
    return [
      "<TaxInvoice>",
      tag("TaxInvoiceDate", f.tanggal),
      tag("TaxInvoiceOpt", "Normal"),
      tag("TrxCode", KODE_TRANSAKSI_FAKTUR),
      kosong("AddInfo"),
      kosong("CustomDoc"),
      tag("RefDesc", f.nomor),
      kosong("FacilityStamp"),
      tag("SellerIDTKU", idtku),
      tag("BuyerTin", tin ?? TIN_KOSONG),
      tag("BuyerDocument", tin ? "TIN" : "Other ID"),
      tag("BuyerCountry", "IDN"),
      tag("BuyerDocumentNumber", "-"),
      tag("BuyerName", f.pembeli.nama || "-"),
      tag("BuyerAdress", f.pembeli.alamat || "-"),
      f.pembeli.email ? tag("BuyerEmail", f.pembeli.email) : kosong("BuyerEmail"),
      tag("BuyerIDTKU", tin ? `${tin}000000` : "000000"),
      `<ListOfGoodService>${barang}</ListOfGoodService>`,
      "</TaxInvoice>",
    ].join("");
  });
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<TaxInvoiceBulk xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="TaxInvoice.xsd">',
    tag("TIN", npwp),
    `<ListOfTaxInvoice>${faktur.join("")}</ListOfTaxInvoice>`,
    "</TaxInvoiceBulk>",
  ].join("\n");
}
