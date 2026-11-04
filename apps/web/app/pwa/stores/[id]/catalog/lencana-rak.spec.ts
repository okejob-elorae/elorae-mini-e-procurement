import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/*
 * "Di rak: N" di katalog salesman — saldo buku stok toko SPG (pcs). Lencananya
 * dirender sungguhan; sambungannya ke kartu barang dan lembar varian dijaga
 * statis (repo ini tidak punya pustaka render untuk lembar/portal).
 */

vi.mock("next-intl", () => ({
  useTranslations:
    (ns: string) =>
    (k: string, p?: Record<string, unknown>) =>
      `${ns}.${k}${p ? JSON.stringify(p) : ""}`,
}));

const { LencanaRak } = await import("./LencanaRak");
const render = (jumlah?: number) =>
  renderToStaticMarkup(createElement(LencanaRak, { jumlah })).replace(/&quot;/g, '"');

describe("LencanaRak", () => {
  it("menampilkan saldo rak, termasuk 0 dan minus apa adanya", () => {
    expect(render(4)).toContain('pwa.catalog.diRak{"jumlah":4}');
    expect(render(0)).toContain('pwa.catalog.diRak{"jumlah":0}');
    expect(render(-2)).toContain('pwa.catalog.diRak{"jumlah":-2}');
  });

  it("toko atau barang tanpa buku: tidak ada apa-apa", () => {
    expect(render(undefined)).toBe("");
  });
});

describe("sambungan di katalog", () => {
  const DIR = path.resolve(__dirname);
  const SHELL = readFileSync(path.join(DIR, "CatalogShell.tsx"), "utf8");
  const SHEET = readFileSync(path.join(DIR, "VariantSheet.tsx"), "utf8");

  it("kartu barang memakai saldo per barang, lembar varian saldo per varian", () => {
    expect(SHELL).toMatch(/<LencanaRak jumlah=\{it\.diRak\} \/>/);
    expect(SHEET).toMatch(/<LencanaRak jumlah=\{v\.diRak\} \/>/);
  });

  it("tidak ada salinan teks rak di luar lencana", () => {
    expect(SHELL).not.toContain('t("diRak"');
    expect(SHEET).not.toContain('t("diRak"');
  });
});
