import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { bacaLembar } from './baris';

/**
 * Pilihan baca SheetJS, bukan penguraiannya sendiri.
 *
 * Ada di berkas terpisah karena yang diuji di sini adalah SATU pilihan pada
 * `XLSX.read` — dan pilihan itu pernah merusak nilai uang sebelum pengurai
 * sempat melihatnya.
 */

const CSV = [
  '"No. Faktur","Kode Toko","Jatuh Tempo","Grand Total","Sisa Piutang"',
  '"INV-1","TK-1","20/09/2026","900.000",""',
  '"INV-2","TK-1","20/09/2026","1.250.000",""',
  '"INV-3","TK-1","20/09/2026","2.400.000","0"',
].join('\n');

function baca(opts: XLSX.ParsingOptions) {
  const wb = XLSX.read(CSV, { type: 'string', ...opts });
  const lembar = wb.Sheets[wb.SheetNames[0]];
  const sel = XLSX.utils.sheet_to_json<unknown[]>(lembar, { header: 1, raw: true, defval: '' });
  return bacaLembar(sel);
}

describe('pilihan baca CSV', () => {
  it('membaca 900.000 sebagai sembilan ratus ribu, bukan sembilan ratus', () => {
    // Ini bug uang yang nyata: tanpa `raw: true`, SheetJS menganggap titiknya
    // pemisah desimal dan nilainya sampai ke pengurai sudah seribu kali lebih
    // kecil. Hanya angka bertitik SATU yang kena — yang bertitik dua selamat
    // karena bukan angka sah — jadi ia lolos justru pada nilai di bawah sejuta.
    const { baris } = baca({ raw: true });
    expect(baris[0].nilai).toBe(900_000);
  });

  it('TANPA raw: true nilainya memang rusak — inilah yang dijaga', () => {
    const { baris } = baca({});
    expect(baris[0].nilai).toBe(900);
  });

  it('tidak mengganggu angka bertitik banyak', () => {
    const { baris } = baca({ raw: true });
    expect(baris[1].nilai).toBe(1_250_000);
  });

  it('tetap membedakan sisa nol dari sisa kosong', () => {
    const { baris } = baca({ raw: true });
    expect(baris[1].sisaTertulis).toBeUndefined();
    expect(baris[2].sisaTertulis).toBe(0);
  });
});
