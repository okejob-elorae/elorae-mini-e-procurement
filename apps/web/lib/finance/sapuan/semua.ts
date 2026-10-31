import { semuaSumberSapuan, type SumberSapuan } from "./registri";
import "@/lib/finance/lapangan/sapuan";
import "@/lib/finance/lapangan/sapuan-faktur";
import "@/lib/finance/sapuan/sumber-lama";
import "@/lib/production/sapuan";
import "@/lib/finance/aset/sapuan";
import "@/lib/finance/berulang/sapuan";
import "@/lib/finance/operasional/sapuan";
import "@/lib/finance/kas/sapuan";
import "@/lib/purchasing/pembayaran-sapuan";

/*
 * Daftar modul sumber sapuan. Setiap sumber jurnal otomatis menambah SATU
 * baris impor di bawah ini (alat Edit — berkas bersama), lalu mendaftarkan
 * dirinya di modul itu lewat `daftarkanSumberSapuan`. Lihat `./registri.ts`.
 *
 * Contoh:
 *   import "@/lib/finance/lapangan/sapuan";
 */

/** Semua sumber sapuan — SATU-SATUNYA pintu masuk runner sapuan. */
export function sumberSapuanTerdaftar(): readonly SumberSapuan[] {
  return semuaSumberSapuan();
}
