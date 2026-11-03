import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guard: every receivable writer keeps BOTH column families in step.
 *
 * A `Receivable` carries two sets of money columns — the team's (`originalAmount`,
 * `outstandingAmount`, `status`) and the receivables module's (`amount`, `outstanding`). The one
 * credit figure (`computeStoreCreditExposure`) reads the team's `outstandingAmount`, so a creator
 * that wrote only `amount`/`outstanding` would count Rp 0 toward every credit limit, silently, in
 * both credit layers (owner decision Q10, 2026-11-02).
 *
 * The contract (docs/landmines/finance-ar.md):
 * - every create writes `originalAmount = amount` and `outstandingAmount = outstanding` = the opening
 *   balance: the whole amount for a nota, a manual invoice, a sell-through report or a konsi cycle;
 *   the imported `sisa` for an import (with `paidBeforeImport = amount − sisa` and the status
 *   derived from them — never "fixed" to the whole amount, or every invoice paid before import
 *   would count in full toward every credit limit);
 * - every correction of a receivable's VALUE writes `amount` AND `originalAmount` in the same call,
 *   and re-runs `hitungUlangPiutang` (or `hitungUlangPiutangDanTahanan`) in the same function, which
 *   is what brings `outstandingAmount`/`status` — the figure the credit gate reads — down with it;
 * - a void writes `status VOIDED` with `outstandingAmount 0` and `outstanding 0` in the same call.
 *   The credit figure skips VOIDED rows by status, but Keuangan → Piutang (`listReceivables`,
 *   `getStorePiutangSummary`) sums `outstandingAmount` over every status on the invariant that a
 *   PAID/WRITTEN_OFF/VOIDED row carries 0 — a void that kept its balance would be counted beside
 *   the bill that replaced it (a konsi cycle unlocked and locked again).
 *
 * The scan is textual on purpose: it reads every source file under `apps/web/lib`, `apps/web/app`
 * and `packages/db/src`, so a new writer cannot opt out by living somewhere new.
 */

const AKAR_WEB = path.resolve(__dirname, "../../..");
const AKAR_REPO = path.resolve(AKAR_WEB, "../..");
const AKAR_PINDAI = [path.join(AKAR_WEB, "lib"), path.join(AKAR_WEB, "app"), path.join(AKAR_REPO, "packages/db/src")];

function berkasSumber(dir: string): string[] {
  const hasil: string[] = [];
  for (const nama of readdirSync(dir)) {
    if (nama === "node_modules") continue;
    const penuh = path.join(dir, nama);
    if (statSync(penuh).isDirectory()) {
      hasil.push(...berkasSumber(penuh));
    } else if (/\.(ts|tsx)$/.test(nama) && !/\.(test|spec)\.tsx?$/.test(nama) && !/^test-fixtures/.test(nama)) {
      hasil.push(penuh);
    }
  }
  return hasil;
}

/** The text from `buka` (an opening `(` or `{`) to its matching closer, by counting. */
function sampaiPenutup(teks: string, buka: number): string {
  const pembuka = teks[buka];
  const penutup = pembuka === "(" ? ")" : "}";
  let dalam = 0;
  for (let i = buka; i < teks.length; i++) {
    if (teks[i] === pembuka) dalam++;
    else if (teks[i] === penutup && --dalam === 0) return teks.slice(buka, i + 1);
  }
  return teks.slice(buka);
}

const POLA_BUAT = /\.receivable\.(create|createMany|upsert)\(/g;
const POLA_UBAH = /\.receivable\.(update|updateMany)\(/g;
/** The `amount` key itself — not `paidAmount`, `outstandingAmount` or `originalAmount`. */
const KUNCI_AMOUNT = /(^|[^\w.$])amount\s*[:,}]/;
const POLA_HITUNG_ULANG = /\bhitungUlangPiutang(DanTahanan)?\(/;
const KUNCI_BATAL = /\bstatus\s*:\s*["']VOIDED["']/;
/** A literal zero, also as a Decimal. */
const NOL = String.raw`(0|D\(0\)|new (Prisma\.)?Decimal\(0\))(?![\w.])`;
const SISA_TIM_NOL = new RegExp(String.raw`\boutstandingAmount\s*:\s*` + NOL);
/** `outstanding` itself — not `outstandingAmount`. */
const SISA_NOL = new RegExp(String.raw`(^|[^\w.$])outstanding\s*:\s*` + NOL);
/** A top-level declaration starts at column 0. */
const AWAL_DEKLARASI = /^(export |async function |function |const |let )/m;

type Panggilan = { baris: number; teks: string; index: number };

function cariPanggilan(sumber: string, pola: RegExp): Panggilan[] {
  const hasil: Panggilan[] = [];
  for (const m of sumber.matchAll(new RegExp(pola.source, "g"))) {
    const buka = (m.index ?? 0) + m[0].length - 1;
    hasil.push({ index: m.index ?? 0, baris: sumber.slice(0, m.index).split("\n").length, teks: sampaiPenutup(sumber, buka) });
  }
  return hasil;
}

/** The `data: { … }` object of a call, or null when data is not an object literal. */
function objekData(panggilan: string): string | null {
  const m = /\bdata\s*:\s*\{/.exec(panggilan);
  if (!m) return null;
  return sampaiPenutup(panggilan, m.index + m[0].length - 1);
}

/** The top-level declaration that contains `index` — from the last column-0 declaration before it to the next. */
function deklarasiPembungkus(sumber: string, index: number): string {
  const sebelum = sumber.slice(0, index);
  let awal = 0;
  for (const m of sebelum.matchAll(new RegExp(AWAL_DEKLARASI.source, "gm"))) awal = m.index ?? 0;
  const sesudah = sumber.slice(index);
  const berikut = new RegExp(AWAL_DEKLARASI.source, "m").exec(sesudah);
  return sumber.slice(awal, berikut ? index + berikut.index : sumber.length);
}

function pelanggaranBuat(sumber: string): Panggilan[] {
  return cariPanggilan(sumber, POLA_BUAT).filter((p) => !p.teks.includes("outstandingAmount") || !p.teks.includes("originalAmount"));
}

function pelanggaranUbah(sumber: string): Panggilan[] {
  return cariPanggilan(sumber, POLA_UBAH).filter((p) => {
    const data = objekData(p.teks);
    if (data === null || !KUNCI_AMOUNT.test(data)) return false;
    return !data.includes("originalAmount") || !POLA_HITUNG_ULANG.test(deklarasiPembungkus(sumber, p.index));
  });
}

function pelanggaranBatal(sumber: string): Panggilan[] {
  return cariPanggilan(sumber, POLA_UBAH).filter((p) => {
    const data = objekData(p.teks);
    if (data === null || !KUNCI_BATAL.test(data)) return false;
    return !SISA_TIM_NOL.test(data) || !SISA_NOL.test(data);
  });
}

describe("receivable writers keep both column families in step", () => {
  it("the matcher reads a call to its closing paren and tells the amount key apart", () => {
    const baik = `const r = await tx.receivable.create({ data: { amount: x, outstanding: x, originalAmount: x, outstandingAmount: x } });`;
    const buruk = `await tx.receivable.create({\n  data: { amount: f(x), outstanding: x },\n});`;
    expect(pelanggaranBuat(baik)).toEqual([]);
    expect(pelanggaranBuat(buruk)).toHaveLength(1);
    expect(pelanggaranBuat(`await prisma.receivableItem.create({ data: {} });`)).toEqual([]);

    expect(KUNCI_AMOUNT.test("{ paidAmount: 1, outstandingAmount: 2 }")).toBe(false);
    expect(KUNCI_AMOUNT.test("{ amount: 1 }")).toBe(true);
    expect(KUNCI_AMOUNT.test("{ status, amount }")).toBe(true);
  });

  it("the matcher demands originalAmount and a recompute for a value correction, and ignores other updates", () => {
    const koreksiBaik = [
      "export async function koreksi(tx: Klien, id: string) {",
      "  await tx.receivable.update({ where: { id }, data: { amount: 5, originalAmount: 5 } });",
      "  await hitungUlangPiutang(tx, id);",
      "}",
    ].join("\n");
    const tanpaAsal = koreksiBaik.replace(", originalAmount: 5", "");
    const tanpaHitung = koreksiBaik.replace("  await hitungUlangPiutang(tx, id);\n", "");
    const lainFungsi = [tanpaHitung, "export async function lain(tx: Klien, id: string) {", "  await hitungUlangPiutang(tx, id);", "}"].join("\n");
    expect(pelanggaranUbah(koreksiBaik)).toEqual([]);
    expect(pelanggaranUbah(tanpaAsal)).toHaveLength(1);
    expect(pelanggaranUbah(tanpaHitung)).toHaveLength(1);
    expect(pelanggaranUbah(lainFungsi)).toHaveLength(1);
    expect(pelanggaranUbah(`await tx.receivable.update({ where: { id }, data: { status: "VOIDED", outstandingAmount: 0, outstanding: 0 } });`)).toEqual([]);
    expect(pelanggaranUbah(`await tx.receivable.update({ where: { id }, data: kolomSisa(sisa) });`)).toEqual([]);
  });

  it("the matcher demands both balances at zero on a void, and ignores a VOIDED filter", () => {
    const batal = (data: string) => `await tx.receivable.updateMany({ where: { id, status: r.status }, data: ${data} });`;
    expect(pelanggaranBatal(batal(`{ status: "VOIDED", outstanding: 0, outstandingAmount: 0 }`))).toEqual([]);
    expect(pelanggaranBatal(batal(`{ status: "VOIDED", outstandingAmount: D(0), outstanding: new Prisma.Decimal(0), invoiceNo: menjadi }`))).toEqual([]);
    expect(pelanggaranBatal(batal(`{ status: "VOIDED", invoiceNo: menjadi }`))).toHaveLength(1);
    expect(pelanggaranBatal(batal(`{ status: "VOIDED", outstandingAmount: 0 }`))).toHaveLength(1);
    expect(pelanggaranBatal(batal(`{ status: "VOIDED", outstanding: 0 }`))).toHaveLength(1);
    expect(pelanggaranBatal(batal(`{ status: "VOIDED", outstanding: 0.5, outstandingAmount: 0 }`))).toHaveLength(1);
    expect(pelanggaranBatal(`await tx.receivable.count({ where: { status: "VOIDED" } });`)).toEqual([]);
    expect(pelanggaranBatal(`await tx.receivable.updateMany({ where: { status: "VOIDED" }, data: { note: null } });`)).toEqual([]);
  });

  it("every create writes outstandingAmount and originalAmount, every value correction stays in step, and every void zeroes both balances", () => {
    let pembuat = 0;
    const pelanggar: string[] = [];
    for (const akar of AKAR_PINDAI) {
      for (const berkas of berkasSumber(akar)) {
        const sumber = readFileSync(berkas, "utf8");
        const relatif = path.relative(AKAR_REPO, berkas);
        pembuat += cariPanggilan(sumber, POLA_BUAT).length;
        for (const p of pelanggaranBuat(sumber)) pelanggar.push(`${relatif}:${p.baris} create tanpa outstandingAmount/originalAmount`);
        for (const p of pelanggaranUbah(sumber)) pelanggar.push(`${relatif}:${p.baris} amount diubah tanpa originalAmount atau hitungUlangPiutang`);
        for (const p of pelanggaranBatal(sumber)) pelanggar.push(`${relatif}:${p.baris} VOIDED tanpa outstandingAmount 0 dan outstanding 0`);
      }
    }
    expect(pelanggar).toEqual([]);
    // The nota, the manual invoice, the import and the sell-through report — a walker that found none would pass vacuously.
    expect(pembuat).toBeGreaterThanOrEqual(4);
  });
});
