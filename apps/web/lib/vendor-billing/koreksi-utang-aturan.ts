import { Decimal } from "decimal.js";
import type { AutoJournalLine } from "@/lib/finance/journal";
import type { PostingRole } from "@/lib/constants/journal-roles";
import { pisahPpn, ppnBerlaku, type PengaturanPpn } from "@/lib/finance/pajak/ppn";
import { memoDpp } from "@/lib/finance/pajak/jurnal-ppn";
import { ppnKapitalisasiGrn } from "@/lib/finance/operasional/grn-kapitalisasi";
import { nilaiJasaKumulatif, type LangkahJasa } from "@/lib/production/biaya-jasa";
import { splitCents } from "./bill-paid-rule";

/*
 * Koreksi utang pemasok dari selisih harga invoice — aturan MURNI (tanpa Prisma), diuji di
 * `koreksi-utang-aturan.test.ts`.
 *
 * Keputusan pemilik 2026-11-02:
 * - P20: harga di PO/WO adalah patokan pembayaran; invoice tidak membuat utang kedua.
 * - P27 + P53: harga invoice yang BERBEDA dari utang tercatat penerimaannya — lebih tinggi MAUPUN
 *   lebih rendah — menunggu keputusan admin/pemilik. Diterima → utang dikoreksi. Atau, bila invoice
 *   lebih tinggi, invoicenya dikoreksi turun ke harga penerimaan. Invoice tidak pernah dikoreksi naik.
 * - P50: selama menunggu, SELURUH penerimaan itu (satu GRN, atau satu langkah WO) belum bisa dibayar.
 * - P49: selisih yang diterima menaikkan (atau menurunkan) HPP penerimaan itu — sisa stoknya dinilai
 *   ulang, yang sudah terjual tidak dikoreksi dan bagiannya menjadi HPP periode itu
 *   (`PURCHASE_PRICE_VARIANCE`, akun bertipe HPP).
 * PPN-nya mengikuti penerimaan: kunci GRN ber-PPN masukan (PKP, baris PO "Exclude PPN") → PPN masukan
 * terpisah; ber-PPN dikapitalisasi (bukan PKP) → PPN ikut nilai persediaan; tanpa PO / "Include PPN"
 * → selisih apa adanya. Langkah WO: status PKP Elorae pada tanggal TIAP penerimaan barang jadinya.
 */

export const STATUS_KOREKSI_UTANG = {
  MENUNGGU: "MENUNGGU",
  DITERIMA: "DITERIMA",
  INVOICE_DIKOREKSI: "INVOICE_DIKOREKSI",
  DIBATALKAN: "DIBATALKAN",
} as const;
export type StatusKoreksiUtang = (typeof STATUS_KOREKSI_UTANG)[keyof typeof STATUS_KOREKSI_UTANG];

export const KEPUTUSAN_SELISIH = ["TERIMA", "KOREKSI_INVOICE"] as const;
export type KeputusanSelisih = (typeof KEPUTUSAN_SELISIH)[number];

/** Selisih utang di bawah Rp 0,01 bukan selisih. */
export const MIN_SELISIH = 0.01;

/** Panjang catatan keputusan. */
export const MAKS_CATATAN_KEPUTUSAN = 500;

export type ModePpnGrn = "PPN_MASUKAN" | "PPN_MODAL" | "TANPA";

/** Satu dokumen penerimaan × barang × varian yang memikul bagian selisih. Rupiah, bertanda. */
export type RincianSelisih = {
  dokumen: "GRN" | "FG_RECEIPT";
  dokumenId: string;
  nomor: string;
  itemId: string;
  variantSku: string | null;
  tipeBarang: string | null;
  qty: number;
  /** Bagian yang masuk nilai persediaan. */
  persediaan: number;
  /** Bagian PPN masukan. */
  ppnMasukan: number;
};

export type SelisihUtang = {
  /** Perubahan hutang usaha (PPN termasuk), bertanda: + = invoice lebih tinggi. */
  jumlah: number;
  /** Bagian DPP-nya (dasar potongan PPh untuk jasa). */
  dpp: number;
  ppnMasukan: number;
  /** Bagian yang masuk nilai persediaan (jumlah − ppnMasukan). */
  persediaan: number;
  rincian: RincianSelisih[];
};

const sen = (n: number) => Math.round(Number((n * 100).toFixed(4)));
const rp = (s: number) => s / 100;
const round2 = (n: number) => Math.round(n * 100) / 100;

const KOSONG: SelisihUtang = { jumlah: 0, dpp: 0, ppnMasukan: 0, persediaan: 0, rincian: [] };

/** Baris GRN: selisih atas qty yang ditagih, dengan PPN mengikuti mode kuncinya. */
export function selisihUtangBarisGrn(a: {
  qty: number;
  hargaInvoice: number;
  hargaTercatat: number;
  itemId: string;
  variantSku: string | null;
  tipeBarang?: string | null;
  mode: ModePpnGrn;
  tarifPo: number | null;
  pengaturan: PengaturanPpn;
  tanggalGrn: Date;
  grnId: string;
  nomorGrn?: string;
}): SelisihUtang {
  const dasar = round2(a.qty * (a.hargaInvoice - a.hargaTercatat));
  if (Math.abs(dasar) < MIN_SELISIH) return KOSONG;
  const tanda = dasar < 0 ? -1 : 1;
  let ppn = 0;
  let modal = 0;
  if (a.mode === "PPN_MASUKAN") {
    ppn = tanda * pisahPpn(Math.abs(dasar), { termasukPpn: false, pengaturan: a.pengaturan, tanggal: a.tanggalGrn }).ppn;
  } else if (a.mode === "PPN_MODAL") {
    modal =
      tanda *
      (ppnKapitalisasiGrn({
        baris: [{ itemId: a.itemId, variantSku: a.variantSku, nilai: Math.abs(dasar) }],
        barisPo: [{ itemId: a.itemId, variantSku: a.variantSku, ppnIncluded: false }],
        tarifPo: a.tarifPo,
        pengaturan: a.pengaturan,
        tanggal: a.tanggalGrn,
      })[0] ?? 0);
  }
  const persediaan = round2(dasar + modal);
  const jumlah = round2(persediaan + ppn);
  if (Math.abs(jumlah) < MIN_SELISIH) return KOSONG;
  return {
    jumlah,
    dpp: dasar,
    ppnMasukan: round2(ppn),
    persediaan,
    rincian: [
      {
        dokumen: "GRN",
        dokumenId: a.grnId,
        nomor: a.nomorGrn ?? "",
        itemId: a.itemId,
        variantSku: a.variantSku,
        tipeBarang: a.tipeBarang ?? null,
        qty: a.qty,
        persediaan,
        ppnMasukan: round2(ppn),
      },
    ],
  };
}

/** Satu penerimaan barang jadi yang memikul bagian potong langkah ini, dengan pembagian variannya. */
export type BagianPenerimaanJasa = {
  fgReceiptId: string;
  nomor: string;
  tanggal: Date;
  qty: number;
  /** Varian barang jadi penerimaan itu dan porsinya (qty masuk di kartu stok). Kosong = tanpa varian. */
  varian: ReadonlyArray<{ variantSku: string; porsi: number }>;
};

/**
 * Langkah WO: hanya potong yang hutangnya dibukukan penerimaan barang jadi. Per penerimaan, kumulatif
 * di dalam baris tagihan: Δ = nilai jasa kumulatif pada harga invoice − pada harga jasa WO (tagihan,
 * DPP, PPN). Elorae PKP pada tanggal penerimaan itu → PPN masukan = ΔPPN dan persediaan = ΔDPP; bila
 * tidak → persediaan = Δtagihan. Hutang = Σ Δtagihan.
 */
export function selisihUtangLangkah(a: {
  langkah: LangkahJasa;
  hargaInvoice: number;
  bagian: readonly BagianPenerimaanJasa[];
  itemId: string;
  tipeBarang?: string | null;
  pengaturan: PengaturanPpn;
}): SelisihUtang {
  const dgnHarga = (harga: number): LangkahJasa => ({ ...a.langkah, servicePrice: harga });
  let kumulatif = new Decimal(0);
  let jumlahSen = 0;
  let dppSen = 0;
  let ppnSen = 0;
  let persediaanSen = 0;
  const rincian: RincianSelisih[] = [];
  for (const b of a.bagian) {
    if (!(b.qty > 0)) continue;
    const sebelum = kumulatif;
    const sesudah = kumulatif.plus(b.qty);
    kumulatif = sesudah;
    const nilai = (harga: number, q: Decimal) => nilaiJasaKumulatif(dgnHarga(harga), q, a.pengaturan);
    const inv = { a: nilai(a.hargaInvoice, sebelum), b: nilai(a.hargaInvoice, sesudah) };
    const wo = { a: nilai(Number(a.langkah.servicePrice), sebelum), b: nilai(Number(a.langkah.servicePrice), sesudah) };
    const d = (k: "tagihan" | "dpp" | "ppn") =>
      sen(inv.b[k].minus(inv.a[k]).toNumber()) - sen(wo.b[k].minus(wo.a[k]).toNumber());
    const tagihan = d("tagihan");
    const dpp = d("dpp");
    const ppn = d("ppn");
    const pkp = ppnBerlaku(a.pengaturan, b.tanggal);
    const masukan = pkp ? ppn : 0;
    const persediaan = pkp ? dpp : tagihan;
    jumlahSen += tagihan;
    dppSen += dpp;
    ppnSen += masukan;
    persediaanSen += persediaan;
    const varian = b.varian.filter((v) => v.porsi > 0);
    const bobot = varian.length > 0 ? varian.map((v) => v.porsi) : [1];
    const bagiP = splitCents(Math.abs(persediaan), bobot).map((x) => Math.sign(persediaan) * x);
    const bagiM = splitCents(Math.abs(masukan), bobot).map((x) => Math.sign(masukan) * x);
    const qtyBagi = varian.length > 0 ? varian.map((v) => v.porsi) : [b.qty];
    const totalPorsi = qtyBagi.reduce((s, q) => s + q, 0);
    bobot.forEach((_, i) => {
      if (bagiP[i] === 0 && bagiM[i] === 0) return;
      rincian.push({
        dokumen: "FG_RECEIPT",
        dokumenId: b.fgReceiptId,
        nomor: b.nomor,
        itemId: a.itemId,
        variantSku: varian.length > 0 ? varian[i].variantSku : null,
        tipeBarang: a.tipeBarang ?? "FINISHED_GOOD",
        qty: round2((b.qty * qtyBagi[i]) / (totalPorsi || 1)),
        persediaan: rp(bagiP[i]),
        ppnMasukan: rp(bagiM[i]),
      });
    });
  }
  if (Math.abs(jumlahSen) < 1) return KOSONG;
  return { jumlah: rp(jumlahSen), dpp: rp(dppSen), ppnMasukan: rp(ppnSen), persediaan: rp(persediaanSen), rincian };
}

/** Peran persediaan yang bisa dinilai ulang: Gudang Utama (bahan/barang jadi), Gudang Toko konsinyasi, van. */
export type PeranStokKoreksi = Extract<PostingRole, "INVENTORY" | "INVENTORY_FG" | "INVENTORY_CONSIGNMENT" | "INVENTORY_VAN">;

/** Baris satu sisi bernilai bertanda: + = debit, − = kredit. Nol dibuang. */
function barisBertanda(role: PostingRole, nilaiSen: number, memo?: string): AutoJournalLine[] {
  const n = Math.round(nilaiSen);
  if (n === 0) return [];
  return [{ role, debit: n > 0 ? rp(n) : 0, credit: n < 0 ? rp(-n) : 0, ...(memo ? { memo } : {}) }];
}

/**
 * Jurnal selisih yang diterima. Invoice lebih tinggi: DR persediaan tiap lokasi (sisa stok), DR
 * `PURCHASE_PRICE_VARIANCE` (yang sudah keluar), DR `PPN_MASUKAN`, CR `AP`. Lebih rendah: cerminnya.
 * Seimbang bila jumlah = Σ stok + keluar + PPN masukan (dijaga pemanggil dalam sen). Baris nol dibuang.
 */
export function barisJurnalKoreksiUtang(s: {
  jumlah: number;
  dpp: number;
  ppnMasukan: number;
  stok: ReadonlyArray<{ peran: PeranStokKoreksi; nilai: number }>;
  keluar: number;
}): AutoJournalLine[] {
  const perPeran = new Map<PeranStokKoreksi, number>();
  for (const x of s.stok) perPeran.set(x.peran, (perPeran.get(x.peran) ?? 0) + sen(x.nilai));
  const urutan: PeranStokKoreksi[] = ["INVENTORY", "INVENTORY_FG", "INVENTORY_CONSIGNMENT", "INVENTORY_VAN"];
  return [
    ...urutan.flatMap((p) => barisBertanda(p, perPeran.get(p) ?? 0)),
    ...barisBertanda("PURCHASE_PRICE_VARIANCE", sen(s.keluar)),
    ...barisBertanda("PPN_MASUKAN", sen(s.ppnMasukan), memoDpp(Math.abs(s.dpp))),
    ...barisBertanda("AP", -sen(s.jumlah)),
  ];
}

/** Pembalik saat tagihannya dibatalkan: semua sisi dicerminkan (nilai stok yang dibalik dihitung ulang pemanggil). */
export function barisJurnalBalikKoreksiUtang(s: {
  jumlah: number;
  dpp: number;
  ppnMasukan: number;
  stok: ReadonlyArray<{ peran: PeranStokKoreksi; nilai: number }>;
  keluar: number;
}): AutoJournalLine[] {
  return barisJurnalKoreksiUtang({
    jumlah: -s.jumlah,
    dpp: s.dpp,
    ppnMasukan: -s.ppnMasukan,
    stok: s.stok.map((x) => ({ peran: x.peran, nilai: -x.nilai })),
    keluar: -s.keluar,
  });
}

/**
 * "Koreksi invoice" hanya untuk invoice yang LEBIH TINGGI dari utang tercatat (P53: invoice tidak
 * pernah dikoreksi naik), dan tidak untuk baris yang ikut membukukan ongkos jahit lama: bagian itu
 * sudah dijurnal tagihan pada harga invoice — batalkan tagihannya lalu catat ulang (Q17).
 */
export function bolehKoreksiInvoice(k: { jumlah: number; adaCmtLama: boolean }): "OK" | "KOREKSI_TIDAK_BOLEH_NAIK" | "ADA_CMT_LAMA" {
  if (!(k.jumlah > 0)) return "KOREKSI_TIDAK_BOLEH_NAIK";
  if (k.adaCmtLama) return "ADA_CMT_LAMA";
  return "OK";
}
