import type { EntriBantuan } from "../jenis";
import { ENTRI as dashboard } from "./dashboard";
import { ENTRI as navGroupMasterData } from "./navGroupMasterData";
import { ENTRI as inventory } from "./inventory";
import { ENTRI as sales } from "./sales";
import { ENTRI as navGroupFieldTeam } from "./navGroupFieldTeam";
import { ENTRI as navGroupSpg } from "./navGroupSpg";
import { ENTRI as production } from "./production";
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
 * Semua penjelasan halaman, satu berkas per kelompok menu. Urutan kelompok
 * mengikuti `BAGIAN_KANTOR` lalu `BAGIAN_HP`; urutan di dalam berkas adalah
 * urutan di halaman Bantuan.
 *
 * Halaman baru dengan penjelasan menambah entrinya di sini, BUKAN di bawah
 * judul halamannya (`daftar.test.ts` menjaga rute, kunci i18n, dan duplikat).
 */
export const DAFTAR_BANTUAN: readonly EntriBantuan[] = [
  ...dashboard, ...navGroupMasterData, ...inventory, ...sales, ...navGroupFieldTeam, ...navGroupSpg, ...production, ...navGroupReceivables, ...konsinyasi, ...navGroupCreative, ...navGroupLedger, ...navGroupReports, ...jubelio, ...navGroupArchive, ...settings, ...pwaSalesman, ...pwaSpg, ...pwaBersama,
];
