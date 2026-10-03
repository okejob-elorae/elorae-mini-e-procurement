"use server";

import * as XLSX from "xlsx";
import { auth } from "@/lib/auth";
import { formatDisplayDateTime } from "@/lib/date-only";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { rentangBulanWib } from "@/lib/salesman/komisi";
import { laporanKomisiBulan } from "@/lib/salesman/komisi-queries";
import { potonganHilangSalesBulan } from "@/lib/spg/hilang-queries";

/**
 * Ekspor laporan komisi salesman ke Excel.
 *
 * Datanya dibaca ULANG di server (bukan dikirim dari tabel di layar), jadi
 * berkasnya selalu angka yang sama dengan laporan. Teks judul dan kepala
 * kolom datang dari klien: bahasa aplikasi hanya diketahui klien, dan setiap
 * teks yang dilihat pengguna harus lewat i18n.
 */

export type LabelEksporKomisi = {
  judul: string;
  bulan: string;
  disiapkan: string;
  dicetak: string;
  kolom: {
    salesman: string;
    omzet: string;
    target: string;
    capaian: string;
    dasar: string;
    bagianPenjual: string;
    bagianPenagih: string;
    tarif: string;
    komisi: string;
    /** Beban barang hilang bagian SALES: sisa belum lunas dan yang ditandai dipotong bulan ini. */
    bebanHilang: string;
    dipotongHilang: string;
  };
  total: string;
  catatan: string;
};

export type HasilEksporKomisi =
  | { ok: true; base64: string; filename: string }
  | { ok: false; code: "UNAUTHORIZED" | "FORBIDDEN" | "INVALID" };

const teksSah = (x: unknown, maks = 300): x is string => typeof x === "string" && x.length <= maks;

export async function eksporLaporanKomisi(bulan: string, label: LabelEksporKomisi): Promise<HasilEksporKomisi> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, code: "UNAUTHORIZED" };
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.FIELD_SALES_ORDERS_APPROVE)) {
    return { ok: false, code: "FORBIDDEN" };
  }
  if (!rentangBulanWib(bulan) || !label || typeof label !== "object" || !label.kolom || typeof label.kolom !== "object") {
    return { ok: false, code: "INVALID" };
  }
  const semuaTeks = [label.judul, label.bulan, label.disiapkan, label.dicetak, label.total, ...Object.values(label.kolom)];
  if (!semuaTeks.every((x) => teksSah(x)) || !teksSah(label.catatan, 2_000)) return { ok: false, code: "INVALID" };

  const { skema, baris } = await laporanKomisiBulan(bulan);
  const tertagih = skema.dasar === "TERTAGIH";
  const potongan = await potonganHilangSalesBulan(
    baris.map((b) => ({ salesmanId: b.salesmanId, komisi: b.hasil.komisi })),
    bulan,
  );
  const hilang = (id: string) => potongan.per[id] ?? { sisa: 0, dipotongBulanIni: 0, saran: 0 };
  const k = label.kolom;

  // Persen disimpan sebagai angka (1,5 → 1.5) supaya bisa dihitung di Excel.
  const kepala = [
    k.salesman,
    k.omzet,
    k.target,
    k.capaian,
    k.dasar,
    ...(tertagih ? [k.bagianPenjual, k.bagianPenagih] : []),
    k.tarif,
    k.komisi,
    k.bebanHilang,
    k.dipotongHilang,
  ];
  const isi = baris.map((b) => [
    b.nama,
    Math.round(b.omzet),
    b.target ?? "",
    b.hasil.capaianPersen ?? "",
    b.hasil.dasarNilai,
    ...(tertagih ? [b.tertagih.bagianPenjual, b.tertagih.bagianPenagih] : []),
    b.hasil.tarifDipakai,
    b.hasil.komisi,
    hilang(b.salesmanId).sisa,
    hilang(b.salesmanId).dipotongBulanIni,
  ]);
  const jumlah = (f: (b: (typeof baris)[number]) => number) => baris.reduce((n, b) => n + f(b), 0);
  const total = [
    label.total,
    Math.round(jumlah((b) => b.omzet)),
    "",
    "",
    jumlah((b) => b.hasil.dasarNilai),
    ...(tertagih ? [jumlah((b) => b.tertagih.bagianPenjual), jumlah((b) => b.tertagih.bagianPenagih)] : []),
    "",
    jumlah((b) => b.hasil.komisi),
    jumlah((b) => hilang(b.salesmanId).sisa),
    jumlah((b) => hilang(b.salesmanId).dipotongBulanIni),
  ];

  const disiapkan = session.user.name ?? session.user.email ?? "-";
  const rows: (string | number)[][] = [
    [label.judul],
    [label.bulan],
    [`${label.disiapkan}: ${disiapkan}`],
    [`${label.dicetak}: ${formatDisplayDateTime(new Date())} WIB`],
    [],
    kepala,
    ...isi,
    total,
    [],
    [label.catatan],
  ];

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "Komisi");
  const buffer = Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
  return { ok: true, base64: buffer.toString("base64"), filename: `komisi-salesman-${bulan}.xlsx` };
}
