import { describe, expect, it } from "vitest";
import en from "@/lib/i18n/messages/en.json";
import id from "@/lib/i18n/messages/id.json";
import { JEJAK_ASET } from "./jejak";
import { KODE_GALAT_ASET, CARA_PEROLEHAN, SUMBER_ASET } from "./aturan";
import { KATEGORI_ASET, SEMUA_METODE } from "./kelompok";
import type { KodeTolakAset } from "./writer";
import type { KeadaanBulanJadwal } from "./queries";
import { JEJAK_BERULANG } from "@/lib/finance/berulang/jejak";
import { KODE_GALAT_TEMPLAT, SUMBER_BERULANG, type KeadaanTemplat } from "@/lib/finance/berulang/aturan";
import type { KodeTolakTemplat } from "@/lib/finance/berulang/writer";
import { JEJAK_JURNAL_MANUAL } from "@/lib/finance/jurnal-manual/jejak";
import { KODE_GALAT_JURNAL_MANUAL } from "@/lib/finance/jurnal-manual/aturan";

/*
 * Setiap nama tindakan jejak aset tetap, jurnal berulang, dan jurnal manual
 * punya label; setiap kode penolakan punya kalimat; setiap pilihan layar punya
 * teks — di kedua bahasa. Layar memetakan kode ke kunci, dan kunci yang hilang
 * tampil mentah tanpa ada yang gagal dengan berisik. Daftar kode penulis ditulis
 * sebagai `Record<Kode, true>` supaya type-check menuntut kelengkapannya.
 */

type Pesan = Record<string, unknown>;
const ambil = (pesan: Pesan, jalur: string): unknown =>
  jalur.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Pesan)[k] : undefined), pesan);

const TOLAK_ASET: Record<KodeTolakAset, true> = {
  ...(Object.fromEntries(KODE_GALAT_ASET.map((k) => [k, true])) as Record<(typeof KODE_GALAT_ASET)[number], true>),
  UNMAPPED_ROLE: true,
  NON_POSTABLE_ACCOUNT: true,
  PERIOD_CLOSED: true,
  AKUN_TIDAK_SAH: true,
  PEMASOK_TIDAK_ADA: true,
  TIDAK_DITEMUKAN: true,
  SUDAH_DISUSUTKAN: true,
  ADA_JURNAL_PEROLEHAN: true,
  BUKAN_AKTIF: true,
  BUKAN_DILEPAS: true,
  TANGGAL_LEPAS_TIDAK_SAH: true,
  HASIL_JUAL_TIDAK_SAH: true,
  AKUN_PENERIMAAN_WAJIB: true,
  ALASAN_WAJIB: true,
};
/** Kode yang hanya dikembalikan aksi (`app/actions/finance-aset.ts`). */
const AKSI_ASET = ["TANPA_AKSES", "GAGAL", "BULAN_TIDAK_SAH", "BULAN_BELUM_BERAKHIR"];

const TOLAK_TEMPLAT: Record<KodeTolakTemplat, true> = {
  ...(Object.fromEntries(KODE_GALAT_TEMPLAT.map((k) => [k, true])) as Record<(typeof KODE_GALAT_TEMPLAT)[number], true>),
  NON_POSTABLE_ACCOUNT: true,
  TIDAK_DITEMUKAN: true,
  PEMBUAT_SAMA: true,
  SUDAH_AKTIF: true,
  BUKAN_AKTIF: true,
  SUDAH_DIPOSTING: true,
};

const KEADAAN_BULAN: Record<KeadaanBulanJadwal, true> = {
  DIPOSTING: true,
  NOL: true,
  BELUM: true,
  DITUTUP: true,
  AKAN_DATANG: true,
  SESUDAH_LEPAS: true,
  SEBELUM_BUKU: true,
};
const KEADAAN_TEMPLAT: Record<KeadaanTemplat, true> = { MENUNGGU_PERSETUJUAN: true, AKTIF: true, DIHENTIKAN: true, SELESAI: true };

describe.each([
  ["id", id as Pesan],
  ["en", en as Pesan],
])("i18n aset tetap, jurnal berulang, persetujuan jurnal (%s)", (_bahasa, pesan) => {
  const ada = (jalur: string) => expect(typeof ambil(pesan, jalur), jalur).toBe("string");

  it("setiap nama tindakan jejak punya label, begitu pula entitasnya", () => {
    for (const aksi of [...Object.values(JEJAK_ASET), ...Object.values(JEJAK_BERULANG), ...Object.values(JEJAK_JURNAL_MANUAL)]) {
      ada(`auditActions.actions.${aksi}`);
    }
    for (const e of ["FixedAsset", "RecurringJournal", "Journal"]) ada(`auditActions.entities.${e}`);
  });

  it("setiap kode penolakan punya kalimat", () => {
    for (const k of [...Object.keys(TOLAK_ASET), ...AKSI_ASET]) ada(`asetTetap.err.${k}`);
    for (const k of [...Object.keys(TOLAK_TEMPLAT), "TANPA_AKSES", "GAGAL"]) ada(`jurnalBerulang.err.${k}`);
    for (const k of [...KODE_GALAT_JURNAL_MANUAL, "FORBIDDEN"]) ada(`financeJournals.persetujuan.err.${k}`);
  });

  it("setiap pilihan dan keadaan di layar punya teks", () => {
    for (const k of KATEGORI_ASET) {
      ada(`asetTetap.kategori.${k}`);
      ada(`asetTetap.contoh.${k}`);
    }
    for (const m of SEMUA_METODE) ada(`asetTetap.metode.${m}`);
    for (const c of CARA_PEROLEHAN) ada(`asetTetap.cara.${c}`);
    for (const s of ["ACTIVE", "DISPOSED", "CANCELLED"]) ada(`asetTetap.statusAset.${s}`);
    for (const k of Object.keys(KEADAAN_BULAN)) ada(`asetTetap.keadaan.${k}`);
    for (const k of Object.keys(KEADAAN_TEMPLAT)) ada(`jurnalBerulang.keadaan.${k}`);
    for (const s of ["POSTED", "DRAFT", "REJECTED"]) ada(`financeJournals.persetujuan.status.${s}`);
  });

  it("setiap jenis sumber jurnal, menu, dan baris Beranda punya teks", () => {
    for (const s of [...Object.values(SUMBER_ASET), ...Object.values(SUMBER_BERULANG)]) ada(`financeJournals.sourceTypes.${s}`);
    ada("navigation.navFinanceAsetTetap");
    ada("navigation.navFinanceJurnalBerulang");
    ada("dashboardActions.manualJournalsPendingApproval");
  });
});
