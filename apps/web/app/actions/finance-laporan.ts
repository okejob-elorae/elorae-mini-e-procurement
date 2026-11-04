"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { formatDisplayDate, parseDateOnly, parseDateOnlyEnd } from "@/lib/date-only";
import { hariIniWib } from "@/lib/tanggal-isian";
import { bacaIsianAnggaran, capaianAnggaran, tahunSah, type KodeTolakAnggaran } from "@/lib/finance/anggaran/aturan";
import { bacaAnggaranTahun, bacaRealisasiBulanan, muatRealisasiVsAnggaran, type LaporanAnggaran } from "@/lib/finance/anggaran/queries";
import { simpanAnggaran } from "@/lib/finance/anggaran/writer";
import { bukuKerjaLaporan, kepalaLaporan, type SelExcel } from "@/lib/finance/reports/excel";
import { selisihPersen } from "@/lib/finance/reports/format-laporan";
import { labelKanalJurnal } from "@/lib/finance/journals/kanal";
import { muatLabaKanal, type LaporanLabaKanal } from "@/lib/finance/reports/laba-kanal-queries";
import {
  bacaKelompok,
  bacaSaringKanal,
  bacaTahunBulan,
  bacaTampilkanNol,
  periodeBulanBerjalan,
} from "@/lib/finance/reports/param-laporan";
import {
  muatPerbandinganLabaRugi,
  muatPerbandinganNeraca,
  type PerbandinganLabaRugi,
  type PerbandinganNeraca,
} from "@/lib/finance/reports/perbandingan-queries";
import { tanggalSah, type RentangTanggal } from "@/lib/finance/reports/periode-banding";
import { muatRasio, type LaporanRasio } from "@/lib/finance/reports/rasio-queries";
import { barisPohon, type BarisPohon, type SimpulNilai } from "@/lib/finance/reports/tampil-pohon";
import type { AccountType } from "@/lib/constants/enums";

/*
 * Aksi laporan keuangan lanjutan (D6): perbandingan Laba Rugi & Neraca, rasio
 * keuangan, laba per kanal/toko, anggaran vs realisasi. Membaca butuh
 * `finance_reports:view`; menyimpan anggaran `journals:manage`. Aktor dari
 * `auth()`. Tidak pernah melempar ke layar: `{ ok: false, kode }`.
 */

export type GagalLaporan = { ok: false; kode: "TANPA_AKSES" | "GAGAL" | KodeTolakAnggaran };

async function sesi(izin: string): Promise<{ id: string; nama: string } | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  if (!hasPermission(session.user.permissions ?? [], izin)) return null;
  return { id: session.user.id, nama: session.user.name ?? session.user.email ?? "-" };
}

async function aman<T>(nama: string, fn: () => Promise<T>): Promise<T | GagalLaporan> {
  try {
    return await fn();
  } catch (e) {
    console.error(`[finance-laporan] ${nama} gagal`, e);
    return { ok: false, kode: "GAGAL" };
  }
}

function dicetakPada(): string {
  const jam = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
  return `${formatDisplayDate(new Date())} ${jam} WIB`;
}

const tgl = (s: string) => formatDisplayDate(parseDateOnly(s));
const labelRentang = (r: RentangTanggal) => `${tgl(r.dari)} – ${tgl(r.sampai)}`;
const tanggalHariIni = () => hariIniWib();

type Atribusi = { disiapkanOleh: string; dicetak: string };

/* ───────────────────────── Perbandingan ───────────────────────── */

export type LaporanPerbandinganLabaRugi = PerbandinganLabaRugi & Atribusi & { ok: true };
export type LaporanPerbandinganNeraca = PerbandinganNeraca & Atribusi & { ok: true };

export async function getPerbandinganLabaRugiAction(input: { dari?: string; sampai?: string }): Promise<LaporanPerbandinganLabaRugi | GagalLaporan> {
  const s = await sesi(PERMISSIONS.FINANCE_REPORTS_VIEW);
  if (!s) return { ok: false, kode: "TANPA_AKSES" };
  return aman("perbandingan laba rugi", async () => ({
    ok: true as const,
    ...(await muatPerbandinganLabaRugi(periodeBulanBerjalan(input, tanggalHariIni()))),
    disiapkanOleh: s.nama,
    dicetak: dicetakPada(),
  }));
}

export async function getPerbandinganNeracaAction(input: { tanggal?: string }): Promise<LaporanPerbandinganNeraca | GagalLaporan> {
  const s = await sesi(PERMISSIONS.FINANCE_REPORTS_VIEW);
  if (!s) return { ok: false, kode: "TANPA_AKSES" };
  return aman("perbandingan neraca", async () => ({
    ok: true as const,
    ...(await muatPerbandinganNeraca(tanggalSah(input.tanggal) ?? tanggalHariIni())),
    disiapkanOleh: s.nama,
    dicetak: dicetakPada(),
  }));
}

/** Kolom angka perbandingan: ini | sebelumnya | selisih | % | tahun lalu | selisih | %. */
function selBanding(nilai: number[]): SelExcel[] {
  const a = selisihPersen(nilai[0] ?? 0, nilai[1] ?? 0);
  const b = selisihPersen(nilai[0] ?? 0, nilai[2] ?? 0);
  return [nilai[0] ?? 0, nilai[1] ?? 0, a.selisih, { persen: a.persen }, nilai[2] ?? 0, b.selisih, { persen: b.persen }];
}

function barisExcelPohon(rows: BarisPohon[], sel: (nilai: number[]) => SelExcel[]): SelExcel[][] {
  return rows.map((r) => {
    const label = `${"    ".repeat(r.level + 1)}${r.code} ${r.name}`;
    if (r.jenis === "judul") return [label];
    if (r.jenis === "jumlah") return [`${"    ".repeat(r.level + 1)}Jumlah ${r.code} ${r.name}`, ...sel(r.nilai)];
    return [label, ...sel(r.nilai)];
  });
}

function bagianExcel(judul: string, akar: SimpulNilai[], total: number[], labelTotal: string, nol: boolean, sel: (n: number[]) => SelExcel[]): SelExcel[][] {
  return [[judul.toUpperCase()], ...barisExcelPohon(barisPohon(akar, { tampilkanNol: nol }), sel), [labelTotal, ...sel(total)]];
}

export async function exportPerbandinganExcel(input: {
  jenis: "laba-rugi" | "neraca";
  dari?: string;
  sampai?: string;
  tanggal?: string;
  nol?: string;
}): Promise<{ ok: true; base64: string; filename: string } | GagalLaporan> {
  const s = await sesi(PERMISSIONS.FINANCE_REPORTS_VIEW);
  if (!s) return { ok: false, kode: "TANPA_AKSES" };
  const nol = bacaTampilkanNol(input.nol);
  return aman("ekspor perbandingan", async () => {
    if (input.jenis === "neraca") {
      const r = await muatPerbandinganNeraca(tanggalSah(input.tanggal) ?? tanggalHariIni());
      const kepala: SelExcel[] = ["Keterangan", `Per ${tgl(r.kolom[0])}`, `Per ${tgl(r.kolom[1])}`, "Selisih", "%", `Per ${tgl(r.kolom[2])}`, "Selisih", "%"];
      const baris: SelExcel[][] = [
        ...kepalaLaporan("Perbandingan Neraca", `Per ${tgl(r.kolom[0])}`, s.nama, dicetakPada()),
        kepala,
        ...bagianExcel("Aset", r.aset, r.total.aset, "Total aset", nol, selBanding),
        ...bagianExcel("Liabilitas", r.liabilitas, r.total.liabilitas, "Total liabilitas", nol, selBanding),
        ...bagianExcel("Ekuitas", r.ekuitas, r.total.ekuitas, "Total ekuitas", nol, selBanding),
        ...(r.total.labaTahunLalu.some((v) => v !== 0) ? [["Laba (rugi) tahun lalu belum ditutup", ...selBanding(r.total.labaTahunLalu)]] : []),
        ["Laba (rugi) tahun berjalan", ...selBanding(r.total.labaTahunBerjalan)],
        ["Total liabilitas dan ekuitas", ...selBanding(r.total.liabilitasEkuitas)],
      ];
      return { ok: true as const, ...bukuKerjaLaporan([{ nama: "Perbandingan Neraca", baris, lebar: [48, 18, 18, 18, 9, 18, 18, 9] }], `perbandingan-neraca-${r.kolom[0]}.xlsx`) };
    }
    const r = await muatPerbandinganLabaRugi(periodeBulanBerjalan(input, tanggalHariIni()));
    const kepala: SelExcel[] = ["Keterangan", labelRentang(r.kolom[0]), labelRentang(r.kolom[1]), "Selisih", "%", labelRentang(r.kolom[2]), "Selisih", "%"];
    const baris: SelExcel[][] = [
      ...kepalaLaporan("Perbandingan Laba Rugi", `Periode ${labelRentang(r.kolom[0])}`, s.nama, dicetakPada()),
      kepala,
      ...bagianExcel("Pendapatan", r.pendapatan, r.total.pendapatan, "Total pendapatan", nol, selBanding),
      ...bagianExcel("Harga pokok penjualan", r.hpp, r.total.hpp, "Total harga pokok penjualan", nol, selBanding),
      ["Laba kotor", ...selBanding(r.total.labaKotor)],
      ...bagianExcel("Beban operasional", r.beban, r.total.beban, "Total beban operasional", nol, selBanding),
      ["Laba bersih", ...selBanding(r.total.labaBersih)],
    ];
    return {
      ok: true as const,
      ...bukuKerjaLaporan([{ nama: "Perbandingan Laba Rugi", baris, lebar: [48, 18, 18, 18, 9, 18, 18, 9] }], `perbandingan-laba-rugi-${r.kolom[0].dari}.xlsx`),
    };
  });
}

/* ───────────────────────── Rasio ───────────────────────── */

export type LaporanRasioAksi = LaporanRasio & Atribusi & { ok: true };

export async function getRasioAction(input: { dari?: string; sampai?: string }): Promise<LaporanRasioAksi | GagalLaporan> {
  const s = await sesi(PERMISSIONS.FINANCE_REPORTS_VIEW);
  if (!s) return { ok: false, kode: "TANPA_AKSES" };
  return aman("rasio", async () => ({
    ok: true as const,
    ...(await muatRasio(periodeBulanBerjalan(input, tanggalHariIni()))),
    disiapkanOleh: s.nama,
    dicetak: dicetakPada(),
  }));
}

export async function exportRasioExcel(input: { dari?: string; sampai?: string }): Promise<{ ok: true; base64: string; filename: string } | GagalLaporan> {
  const s = await sesi(PERMISSIONS.FINANCE_REPORTS_VIEW);
  if (!s) return { ok: false, kode: "TANPA_AKSES" };
  return aman("ekspor rasio", async () => {
    const r = await muatRasio(periodeBulanBerjalan(input, tanggalHariIni()));
    const a = r.ini;
    const b = r.lalu;
    const baris: SelExcel[][] = [
      ...kepalaLaporan("Rasio Keuangan", `Periode ${labelRentang(r.periode)}`, s.nama, dicetakPada()),
      ["Rasio", labelRentang(r.periode), labelRentang(r.sebelumnya), "Rumus"],
      ["Margin laba kotor", { persen: a.marginKotor }, { persen: b.marginKotor }, "Laba kotor ÷ pendapatan bersih"],
      ["Margin laba bersih", { persen: a.marginBersih }, { persen: b.marginBersih }, "Laba bersih ÷ pendapatan bersih"],
      ["Rasio lancar", { rasio: a.rasioLancar }, { rasio: b.rasioLancar }, "Aset lancar ÷ liabilitas lancar (akhir periode)"],
      ["Rasio cepat", { rasio: a.rasioCepat }, { rasio: b.rasioCepat }, "(Aset lancar − persediaan − dibayar dimuka) ÷ liabilitas lancar"],
      ["Perputaran persediaan (kali)", { rasio: a.perputaranPersediaan }, { rasio: b.perputaranPersediaan }, "HPP ÷ rata-rata persediaan"],
      ["Umur persediaan (hari)", { hari: a.hariPersediaan }, { hari: b.hariPersediaan }, "Jumlah hari ÷ perputaran persediaan"],
      ["Umur piutang / DSO (hari)", { hari: a.dso }, { hari: b.dso }, "Rata-rata piutang dagang ÷ pendapatan bersih × jumlah hari"],
      ["Umur utang / DPO (hari)", { hari: a.dpo }, { hari: b.dpo }, "Rata-rata utang usaha ÷ HPP × jumlah hari"],
      [],
      ["Komponen", labelRentang(r.periode), labelRentang(r.sebelumnya)],
      ["Pendapatan bersih", a.komponen.pendapatan, b.komponen.pendapatan],
      ["Harga pokok penjualan", a.komponen.hpp, b.komponen.hpp],
      ["Laba kotor", a.komponen.labaKotor, b.komponen.labaKotor],
      ["Laba bersih", a.komponen.labaBersih, b.komponen.labaBersih],
      ["Aset lancar (akhir)", a.komponen.asetLancar, b.komponen.asetLancar],
      ["Persediaan (akhir)", a.komponen.persediaan, b.komponen.persediaan],
      ["Dibayar dimuka (akhir)", a.komponen.dibayarDimuka, b.komponen.dibayarDimuka],
      ["Liabilitas lancar (akhir)", a.komponen.liabilitasLancar, b.komponen.liabilitasLancar],
      ["Rata-rata persediaan", a.komponen.rataPersediaan, b.komponen.rataPersediaan],
      ["Rata-rata piutang dagang", a.komponen.rataPiutang, b.komponen.rataPiutang],
      ["Rata-rata utang usaha", a.komponen.rataHutang, b.komponen.rataHutang],
      ["Jumlah hari", { hari: a.komponen.hari }, { hari: b.komponen.hari }],
      ...(a.komponen.akunTakTerklasifikasi > 0
        ? [
            [] as SelExcel[],
            [`${a.komponen.akunTakTerklasifikasi} akun aset belum diklasifikasi di Klasifikasi Arus Kas dan tidak dihitung sebagai aset lancar.`] as SelExcel[],
          ]
        : []),
    ];
    return { ok: true as const, ...bukuKerjaLaporan([{ nama: "Rasio", baris, lebar: [34, 22, 22, 64] }], `rasio-keuangan-${r.periode.dari}.xlsx`) };
  });
}

/* ───────────────────────── Laba per kanal ───────────────────────── */

export type LaporanLabaKanalAksi = LaporanLabaKanal & Atribusi & { ok: true; periode: RentangTanggal; kelompok: "kanal" | "toko"; kanal: string | null };

export async function getLabaKanalAction(input: {
  dari?: string;
  sampai?: string;
  kelompok?: string;
  kanal?: string;
}): Promise<LaporanLabaKanalAksi | GagalLaporan> {
  const s = await sesi(PERMISSIONS.FINANCE_REPORTS_VIEW);
  if (!s) return { ok: false, kode: "TANPA_AKSES" };
  return aman("laba kanal", async () => {
    const periode = periodeBulanBerjalan(input, tanggalHariIni());
    const kelompok = bacaKelompok(input.kelompok);
    const kanal = bacaSaringKanal(input.kanal);
    const hasil = await muatLabaKanal({ from: parseDateOnly(periode.dari), to: parseDateOnlyEnd(periode.sampai)!, kelompok, kanal });
    return { ok: true as const, ...hasil, periode, kelompok, kanal, disiapkanOleh: s.nama, dicetak: dicetakPada() };
  });
}

export async function exportLabaKanalExcel(input: {
  dari?: string;
  sampai?: string;
  kelompok?: string;
  kanal?: string;
}): Promise<{ ok: true; base64: string; filename: string } | GagalLaporan> {
  const r = await getLabaKanalAction(input);
  if (!r.ok) return r;
  const label = (k: string | null) =>
    r.kelompok === "toko" ? (k ? (r.namaToko[k] ?? k) : "Tanpa toko") : labelKanalJurnal(k);
  const sel = (b: LaporanLabaKanal["total"]): SelExcel[] => [
    b.penjualan,
    b.retur,
    b.potongan,
    b.pendapatanBersih,
    b.hpp,
    b.labaKotor,
    { persen: b.marginKotor },
    b.beban,
    b.labaKontribusi,
  ];
  const judul = r.kelompok === "toko" ? "Laba per Toko" : "Laba per Kanal";
  const baris: SelExcel[][] = [
    ...kepalaLaporan(judul, `Periode ${labelRentang(r.periode)}${r.kanal ? ` · Kanal ${labelKanalJurnal(r.kanal)}` : ""}`, r.disiapkanOleh, r.dicetak),
    [r.kelompok === "toko" ? "Toko" : "Kanal", "Penjualan", "Retur", "Potongan", "Pendapatan bersih", "HPP", "Laba kotor", "Margin kotor", "Beban kanal", "Laba kontribusi"],
    ...r.baris.map((b) => [label(b.kunci), ...sel(b)]),
    ["Total", ...sel(r.total)],
    [],
    ["Baris tanpa kanal/toko berisi beban umum dan jurnal yang belum membawa kanal; total semua baris sama dengan laba bersih Laba Rugi periode yang sama."],
    ...(r.barisTurunan > 0 ? [[`${r.barisTurunan} baris jurnal lama diberi kanal dari dokumen sumbernya.`] as SelExcel[]] : []),
  ];
  return {
    ok: true,
    ...bukuKerjaLaporan([{ nama: judul, baris, lebar: [34, 16, 14, 14, 18, 16, 16, 12, 16, 18] }], `${r.kelompok === "toko" ? "laba-per-toko" : "laba-per-kanal"}-${r.periode.dari}.xlsx`),
  };
}

/* ───────────────────────── Anggaran ───────────────────────── */

export async function simpanAnggaranAction(input: unknown): Promise<{ ok: true; diubah: number } | GagalLaporan> {
  const s = await sesi(PERMISSIONS.JOURNALS_MANAGE);
  if (!s) return { ok: false, kode: "TANPA_AKSES" };
  const isian = bacaIsianAnggaran(input);
  if (!isian.ok) return isian;
  const hasil = await aman("simpan anggaran", () => simpanAnggaran(isian.isian, { olehUserId: s.id }));
  if (hasil.ok) {
    revalidatePath("/backoffice/finance/anggaran");
    revalidatePath("/backoffice/finance/reports/anggaran");
  }
  return hasil;
}

/**
 * Bahan "salin dari tahun lalu": anggaran atau realisasi tahun sebelumnya per
 * akun per bulan. Kenaikan/penurunan persen diterapkan di layar
 * (`salinDenganPersen`) — belum tersimpan sampai pengguna menekan Simpan.
 */
export async function bahanSalinAnggaranAction(input: {
  tahun: number;
  sumber: "anggaran" | "realisasi";
}): Promise<{ ok: true; nilai: Record<string, (number | null)[]> } | GagalLaporan> {
  const s = await sesi(PERMISSIONS.JOURNALS_MANAGE);
  if (!s) return { ok: false, kode: "TANPA_AKSES" };
  if (!tahunSah(input.tahun) || !tahunSah(input.tahun - 1)) return { ok: false, kode: "TAHUN_TIDAK_SAH" };
  return aman("bahan salin anggaran", async () => {
    const peta = input.sumber === "realisasi" ? await bacaRealisasiBulanan(input.tahun - 1) : await bacaAnggaranTahun(input.tahun - 1);
    return { ok: true as const, nilai: Object.fromEntries(peta) };
  });
}

export type LaporanAnggaranAksi = LaporanAnggaran & Atribusi & { ok: true; cakupan: "bulan" | "ytd" };

export async function getLaporanAnggaranAction(input: {
  tahun?: string;
  bulan?: string;
  cakupan?: string;
}): Promise<LaporanAnggaranAksi | GagalLaporan> {
  const s = await sesi(PERMISSIONS.FINANCE_REPORTS_VIEW);
  if (!s) return { ok: false, kode: "TANPA_AKSES" };
  return aman("laporan anggaran", async () => {
    const p = bacaTahunBulan(input, tanggalHariIni());
    return { ok: true as const, ...(await muatRealisasiVsAnggaran(p)), cakupan: p.cakupan, disiapkanOleh: s.nama, dicetak: dicetakPada() };
  });
}

const NAMA_BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

export async function exportAnggaranExcel(input: {
  tahun?: string;
  bulan?: string;
  cakupan?: string;
  nol?: string;
}): Promise<{ ok: true; base64: string; filename: string } | GagalLaporan> {
  const r = await getLaporanAnggaranAction(input);
  if (!r.ok) return r;
  const nol = bacaTampilkanNol(input.nol);
  const beranggaran = new Set(r.akunBeranggaran);
  const sel = (type: AccountType) => (nilai: number[], accountId?: string): SelExcel[] => {
    const punya = accountId ? beranggaran.has(accountId) : true;
    const c = capaianAnggaran(type, punya ? (nilai[0] ?? 0) : null, nilai[1] ?? 0);
    return [punya ? (nilai[0] ?? 0) : null, nilai[1] ?? 0, c.selisih, { persen: c.persenCapaian }];
  };
  const bagian = (judul: string, type: AccountType, akar: SimpulNilai[], total: [number, number], labelTotal: string): SelExcel[][] => [
    [judul.toUpperCase()],
    ...barisPohon(akar, { tampilkanNol: nol }).map((b): SelExcel[] => {
      const label = `${"    ".repeat(b.level + 1)}${b.jenis === "jumlah" ? "Jumlah " : ""}${b.code} ${b.name}`;
      return b.jenis === "judul" ? [label] : [label, ...sel(type)(b.nilai, b.accountId)];
    }),
    [labelTotal, ...sel(type)(total)],
  ];
  const periode =
    r.cakupan === "bulan"
      ? `${NAMA_BULAN[r.bulan[0] - 1]} ${r.tahun}`
      : `${NAMA_BULAN[0]} – ${NAMA_BULAN[r.bulan[r.bulan.length - 1] - 1]} ${r.tahun}`;
  const baris: SelExcel[][] = [
    ...kepalaLaporan("Anggaran vs Realisasi", periode, r.disiapkanOleh, r.dicetak),
    ["Akun", "Anggaran", "Realisasi", "Selisih", "Capaian"],
    ...bagian("Pendapatan", "PENDAPATAN", r.pendapatan, r.total.pendapatan, "Total pendapatan"),
    ...bagian("Harga pokok penjualan", "HPP", r.hpp, r.total.hpp, "Total harga pokok penjualan"),
    ["Laba kotor", ...sel("PENDAPATAN")(r.total.labaKotor)],
    ...bagian("Beban operasional", "BEBAN", r.beban, r.total.beban, "Total beban operasional"),
    ["Laba bersih", ...sel("PENDAPATAN")(r.total.labaBersih)],
  ];
  return { ok: true, ...bukuKerjaLaporan([{ nama: "Anggaran", baris, lebar: [48, 18, 18, 18, 11] }], `anggaran-vs-realisasi-${r.tahun}.xlsx`) };
}
