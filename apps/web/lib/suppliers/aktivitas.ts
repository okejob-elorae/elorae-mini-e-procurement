import { hitungUtangPo } from "@/lib/purchase-orders/utang";
import { pisahUtangPo } from "@/app/backoffice/supplier-payments/nilai-utang";

/*
 * Ringkasan kerja per pemasok untuk daftar pemasok (kolom "Sedang dikerjakan",
 * "Utang", "Terakhir"). Murni — pemuatnya `aktivitas-queries.ts`.
 *
 * Satu definisi per angka, sama dengan layar asalnya:
 *  - PO terbuka = SUBMITTED/PARTIAL, terlambat = tanggal tiba sebelum awal hari
 *    ini WIB (`overduePOWhere`);
 *  - utang = barang yang SUDAH diterima pada PO yang belum dibayar, dikurangi
 *    kredit retur (`pisahUtangPo`, register pembayaran pemasok) — komitmen PO
 *    yang barangnya belum datang bukan utang;
 *  - SPK berjalan = ISSUED/IN_PRODUCTION/PARTIAL di penjahit itu.
 * Bagian yang tidak boleh dilihat penampil bernilai null, dan "terakhir" hanya
 * dihitung dari dokumen yang boleh ia lihat.
 */

type Angka = number | string | { toString(): string };

export type PoAktivitas = {
  id: string;
  supplierId: string;
  status: string;
  etaDate: Date | null;
  paymentDueDate: Date | null;
  paidAt: Date | null;
  createdAt: Date;
  grandTotal: Angka;
  ppnRatePercent: Angka | null;
  closedAt: Date | null;
  items: ReadonlyArray<{ qty: Angka; receivedQty: Angka; price: Angka; ppnIncluded: boolean }>;
};

export type SpkAktivitas = {
  vendorId: string;
  status: string;
  plannedQty: Angka;
  targetDate: Date | null;
  createdAt: Date;
};

export type AktivitasPemasok = {
  po: { terbuka: number; terlambat: number; tibaTerdekat: string | null } | null;
  spk: { berjalan: number; pcs: number; terlambat: number } | null;
  utang: { nilai: number; jatuhTempo: string | null; lewatTempo: boolean } | null;
  terakhir: string | null;
};

const PO_TERBUKA = new Set(["SUBMITTED", "PARTIAL"]);
const PO_BERUTANG = new Set(["SUBMITTED", "PARTIAL", "CLOSED", "OVER"]);
const PO_BUKAN_ORDER = new Set(["DRAFT", "CANCELLED"]);
const SPK_BERJALAN = new Set(["ISSUED", "IN_PRODUCTION", "PARTIAL"]);
const SPK_BUKAN_ORDER = new Set(["DRAFT", "CANCELLED"]);

function angka(v: Angka | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : Number(v.toString());
  return Number.isFinite(n) ? n : 0;
}

function terbaru(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return b > a ? b : a;
}

function terdahulu(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return b < a ? b : a;
}

export function ringkasAktivitasPemasok(input: {
  supplierIds: readonly string[];
  po: readonly PoAktivitas[];
  spk: readonly SpkAktivitas[];
  /** Σ kredit retur pemasok per PO. */
  kredit: ReadonlyMap<string, number>;
  /** PO (bukan draf/batal) atau penerimaan barang terbaru per pemasok — termasuk yang sudah lunas dan tidak ada di `po`. */
  terakhirPembelian: ReadonlyMap<string, Date>;
  /** SPK (bukan draf/batal) terbaru per penjahit — termasuk yang sudah selesai dan tidak ada di `spk`. */
  terakhirSpk: ReadonlyMap<string, Date>;
  awalHariIni: Date;
  lihatPo: boolean;
  lihatUtang: boolean;
  lihatSpk: boolean;
}): Record<string, AktivitasPemasok> {
  type Kerja = {
    terbuka: number;
    terlambat: number;
    tiba: Date | null;
    utangSen: number;
    jatuhTempo: Date | null;
    spk: number;
    pcs: number;
    spkTerlambat: number;
    terakhir: Date | null;
  };
  const kerja = new Map<string, Kerja>(
    input.supplierIds.map((id) => [
      id,
      { terbuka: 0, terlambat: 0, tiba: null, utangSen: 0, jatuhTempo: null, spk: 0, pcs: 0, spkTerlambat: 0, terakhir: null },
    ]),
  );

  for (const p of input.po) {
    const k = kerja.get(p.supplierId);
    if (!k) continue;
    if (input.lihatPo) {
      if (PO_TERBUKA.has(p.status)) {
        k.terbuka += 1;
        if (p.etaDate && p.etaDate < input.awalHariIni) k.terlambat += 1;
        else if (p.etaDate) k.tiba = terdahulu(k.tiba, p.etaDate);
      }
      if (!PO_BUKAN_ORDER.has(p.status)) k.terakhir = terbaru(k.terakhir, p.createdAt);
    }
    if (input.lihatUtang && PO_BERUTANG.has(p.status) && !p.paidAt) {
      const kreditRetur = input.kredit.get(p.id) ?? 0;
      const rincian = hitungUtangPo(
        { status: p.status, grandTotal: p.grandTotal, ppnRatePercent: p.ppnRatePercent, closedAt: p.closedAt, items: p.items },
        kreditRetur,
      );
      const { utangDiterima } = pisahUtangPo({
        grandTotal: p.grandTotal,
        ppnRatePercent: p.ppnRatePercent == null ? null : angka(p.ppnRatePercent),
        utang: { utang: rincian.utang, kreditRetur },
        items: p.items,
      });
      const sen = Math.round(utangDiterima * 100);
      if (sen > 0) {
        k.utangSen += sen;
        k.jatuhTempo = terdahulu(k.jatuhTempo, p.paymentDueDate);
      }
    }
  }

  if (input.lihatPo) {
    for (const [supplierId, tanggal] of input.terakhirPembelian) {
      const k = kerja.get(supplierId);
      if (k) k.terakhir = terbaru(k.terakhir, tanggal);
    }
  }

  if (input.lihatSpk) {
    for (const [vendorId, tanggal] of input.terakhirSpk) {
      const k = kerja.get(vendorId);
      if (k) k.terakhir = terbaru(k.terakhir, tanggal);
    }
    for (const s of input.spk) {
      const k = kerja.get(s.vendorId);
      if (!k) continue;
      if (SPK_BERJALAN.has(s.status)) {
        k.spk += 1;
        k.pcs += angka(s.plannedQty);
        if (s.targetDate && s.targetDate < input.awalHariIni) k.spkTerlambat += 1;
      }
      if (!SPK_BUKAN_ORDER.has(s.status)) k.terakhir = terbaru(k.terakhir, s.createdAt);
    }
  }

  const hasil: Record<string, AktivitasPemasok> = {};
  for (const [id, k] of kerja) {
    hasil[id] = {
      po: input.lihatPo ? { terbuka: k.terbuka, terlambat: k.terlambat, tibaTerdekat: k.tiba?.toISOString() ?? null } : null,
      spk: input.lihatSpk ? { berjalan: k.spk, pcs: Math.round(k.pcs), terlambat: k.spkTerlambat } : null,
      utang: input.lihatUtang
        ? {
            nilai: k.utangSen / 100,
            jatuhTempo: k.jatuhTempo?.toISOString() ?? null,
            lewatTempo: Boolean(k.jatuhTempo && k.jatuhTempo < input.awalHariIni),
          }
        : null,
      terakhir: k.terakhir?.toISOString() ?? null,
    };
  }
  return hasil;
}
