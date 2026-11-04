import type { EntriBantuan } from "../jenis";
import { ENTRI as dashboard } from "./dashboard";
import { ENTRI as navGroupMasterData } from "./navGroupMasterData";
import { ENTRI as inventory } from "./inventory";
import { ENTRI as sales } from "./sales";
import { ENTRI as navGroupFieldTeam } from "./navGroupFieldTeam";
import { ENTRI as navGroupSpg } from "./navGroupSpg";
import { ENTRI as production } from "./production";
import { ENTRI as navGroupPurchasing } from "./navGroupPurchasing";
import { ENTRI as navGroupReceivables } from "./navGroupReceivables";
import { ENTRI as konsinyasi } from "./konsinyasi";
import { ENTRI as navGroupCreative } from "./navGroupCreative";
import { ENTRI as navGroupLedger } from "./navGroupLedger";
import { ENTRI as navGroupReports } from "./navGroupReports";
import { ENTRI as jubelio } from "./jubelio";
import { ENTRI as navGroupArchive } from "./navGroupArchive";
import { ENTRI as settings } from "./settings";
import { ENTRI as pwaSalesman } from "./pwaSalesman";
import { ENTRI as pwaSpg } from "./pwaSpg";
import { ENTRI as pwaBersama } from "./pwaBersama";

/**
 * Semua penjelasan halaman. Kelompoknya ditentukan `bagian` tiap entri (sama
 * dengan grup menu samping tempat halamannya), bukan nama berkasnya: sejak menu
 * gabungan 2026-11-04 `sales.ts` berisi Penjualan Marketplace dan Penjualan
 * Canvassing, `navGroupReceivables.ts` berisi Keuangan (termasuk pembayaran
 * pemasok), `navGroupLedger.ts` berisi Pembukuan, dan `konsinyasi.ts` berisi
 * Penjualan Konsinyasi. Urutan kelompok mengikuti `BAGIAN_KANTOR` lalu
 * `BAGIAN_HP`; urutan di dalam satu kelompok adalah urutan entri di sini.
 *
 * Halaman baru dengan penjelasan menambah entrinya di sini, BUKAN di bawah
 * judul halamannya (`daftar.test.ts` menjaga rute, kunci i18n, dan duplikat).
 */
export const DAFTAR_BANTUAN: readonly EntriBantuan[] = [
  ...dashboard, ...navGroupMasterData, ...inventory, ...sales, ...navGroupFieldTeam, ...navGroupSpg, ...production, ...navGroupPurchasing, ...navGroupReceivables, ...konsinyasi, ...navGroupCreative, ...navGroupLedger, ...navGroupReports, ...jubelio, ...navGroupArchive, ...settings, ...pwaSalesman, ...pwaSpg, ...pwaBersama,
];
