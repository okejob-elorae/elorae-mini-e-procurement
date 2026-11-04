import { esc, fmtDocDate, printCssBase, printPagePortrait } from "@/lib/print/print-theme";
import type { BarisLembar, LembarPalet } from "@/lib/production-colors/palet/lembar";
import type { KeterbacaanSablon, PeranSablon } from "@/lib/production-colors/sablon/saran";

export type LabelPaletWarna = {
  title: string;
  untitled: string;
  date: string;
  rule: string;
  ruleName: string;
  createdBy: string;
  fabric: string;
  inks: string;
  swatches: string;
  base: string;
  codes: string;
  colColor: string;
  colShare: string;
  colReadability: string;
  role: (peran: PeranSablon) => string;
  readability: (k: KeterbacaanSablon) => string;
  recipes: (berat: number, maksTinta: number) => string;
  noRecipe: string;
  estimate: string;
  notes: string[];
  printedFrom: string;
  mockup: string;
};

/**
 * Lembar spesifikasi satu palet warna, A4 tegak — untuk tukang sablon,
 * desainer, atau arsip. Dibuka lewat dialog cetak browser, jadi "Simpan
 * sebagai PDF" di sana yang menghasilkan PDF-nya.
 */
export function buildPaletWarnaPrintHtml(opts: {
  lembar: LembarPalet;
  tanggal: Date | string | null;
  dibuatOleh: string | null;
  /** Teks SVG kaos dari `svgKaos` — sudah aman. `null` untuk palet bebas. */
  kaosSvg: string | null;
  labels: LabelPaletWarna;
  /** Angka satu desimal sesuai bahasa layar. */
  angka: (n: number) => string;
}): string {
  const { lembar, labels, angka } = opts;
  const nama = lembar.nama || labels.untitled;
  const berkain = lembar.kain !== null;

  const ubin = (hex: string, besar = false) =>
    `<span class="ubin${besar ? " besar" : ""}" style="background:${esc(hex)}"></span>`;
  const pantoneC = (b: BarisLembar) =>
    b.pantoneC ? `${esc(b.pantoneC.kode)}${b.pantoneC.deltaE < 0.05 ? "" : ` <span class="de">ΔE ${esc(angka(b.pantoneC.deltaE))}</span>`}` : "—";
  const pantoneTcx = (b: BarisLembar) =>
    b.pantoneTcx
      ? `${esc(`${b.pantoneTcx.kode} ${b.pantoneTcx.nama ?? ""}`.trim())}${b.pantoneTcx.deltaE < 0.05 ? "" : ` <span class="de">ΔE ${esc(angka(b.pantoneTcx.deltaE))}</span>`}`
      : "—";

  const kepala = berkain
    ? `<div class="hero">
    ${opts.kaosSvg ? `<figure class="kaos" aria-label="${esc(labels.mockup)}">${opts.kaosSvg}</figure>` : ""}
    <div class="hero-isi">
      <p class="block-label">${esc(labels.fabric)}</p>
      <div class="kain">${ubin(lembar.kain!.hex, true)}<div><p class="payee-name">${esc(lembar.kain!.nama ?? lembar.kain!.hex)}</p><p class="mono">${esc(lembar.kain!.hex)}</p></div></div>
      <p class="block-label">${esc(labels.inks)}</p>
      <ul class="tinta">${lembar.baris
        .map(
          (b) => `<li>${ubin(b.hex)}<span class="huruf">${esc(b.label)}</span><span class="nama">${b.pantoneC && b.pantoneC.deltaE < 0.05 ? esc(b.pantoneC.kode) : esc(b.hex)}<small>${b.peran ? esc(labels.role(b.peran)) : ""}</small></span><span class="porsi">${b.porsi ?? 0}%</span>
          <span class="bar"><span style="width:${Math.max(0, Math.min(100, b.porsi ?? 0))}%;background:${esc(b.hex)}"></span></span></li>`,
        )
        .join("")}</ul>
    </div>
  </div>`
    : `<p class="block-label">${esc(labels.swatches)}</p>
  <div class="deret">${lembar.baris
    .map((b) => `<div class="deret-ubin"><span style="background:${esc(b.hex)}"></span><p><b>${esc(b.label)}</b>${b.dasar ? ` · ${esc(labels.base)}` : ""}</p><p class="mono">${esc(b.hex)}</p></div>`)
    .join("")}</div>`;

  const kolomSablon = berkain
    ? `<th class="right">${esc(labels.colShare)}</th><th>${esc(labels.colReadability)}</th>`
    : "";
  const barisKode = lembar.baris
    .map(
      (b) => `<tr>
      <td class="col-warna">${ubin(b.hex)}<b>${esc(b.label)}</b></td>
      <td class="mono">${esc(b.hex)}</td>
      <td class="mono">${b.rgb.join(" · ")}</td>
      <td class="mono">${b.cmyk.join(" · ")}</td>
      <td>${pantoneC(b)}</td>
      <td>${pantoneTcx(b)}</td>
      ${berkain ? `<td class="right">${b.porsi ?? 0}%</td><td>${b.keterbacaan ? `${esc(labels.readability(b.keterbacaan))} <span class="de">${esc(angka(b.kontras ?? 0))}</span>` : "—"}</td>` : ""}
    </tr>`,
    )
    .join("");

  const resep =
    berkain && lembar.berat !== null
      ? `<p class="section-title">${esc(labels.recipes(lembar.berat, lembar.maksTinta))}</p>
  <table class="data resep"><tbody>${lembar.baris
    .map(
      (b) => `<tr>
      <td class="col-warna">${ubin(b.hex)}<b>${esc(b.label)}</b></td>
      <td>${
        b.resep
          ? b.resep.bagian.map((x) => `<span class="bahan">${esc(x.nama)} <span class="mono">${esc(angka(x.persen))}% · ${x.gram} g</span></span>`).join('<span class="plus">+</span>')
          : esc(labels.noRecipe)
      }</td>
      <td class="right">${b.resep ? `<span class="de">${esc(labels.estimate)} ΔE ${esc(angka(b.resep.deltaE))}</span>` : ""}</td>
    </tr>`,
    )
    .join("")}</tbody></table>`
      : "";

  return `<!DOCTYPE html>
<html lang="id"><head><meta charset="utf-8"><title>${esc(labels.title)} — ${esc(nama)}</title>
<style>${printCssBase}${printPagePortrait}
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .mono { font-family: var(--mono); }
  .de { font-family: var(--mono); font-size: 8pt; color: #6b7280; white-space: nowrap; }
  .ubin { display:inline-block; width:14px; height:14px; border-radius:3px; box-shadow: inset 0 0 0 1px rgba(0,0,0,.15); vertical-align:-2px; margin-right:8px; }
  .ubin.besar { width:44px; height:44px; border-radius:6px; margin:0; flex-shrink:0; }
  .hero { display:flex; gap:28px; align-items:flex-start; margin-bottom: 8px; page-break-inside: avoid; }
  .kaos { margin:0; width:62mm; flex-shrink:0; }
  .kaos svg { display:block; width:100%; height:auto; }
  .hero-isi { flex:1; min-width:0; }
  .kain { display:flex; gap:12px; align-items:center; margin-bottom:22px; }
  .kain p { margin:0; }
  ul.tinta { list-style:none; margin:0; padding:0; }
  ul.tinta li { display:grid; grid-template-columns: 22px 18px 1fr auto; column-gap:8px; align-items:center; padding:7px 0 9px; border-bottom:1px solid #f3f4f6; }
  ul.tinta .ubin { margin:0; }
  ul.tinta .huruf { font-weight:700; }
  ul.tinta .nama { font-weight:600; }
  ul.tinta .nama small { display:block; font-weight:400; font-size:8pt; color:#6b7280; }
  ul.tinta .porsi { font-family: var(--mono); font-weight:700; font-size:12pt; }
  ul.tinta .bar { grid-column: 2 / -1; height:4px; border-radius:2px; background:#f3f4f6; margin-top:6px; overflow:hidden; }
  ul.tinta .bar span { display:block; height:100%; }
  .deret { display:grid; grid-template-columns: repeat(${lembar.baris.length}, 1fr); gap:8px; margin: 4px 0 8px; }
  .deret-ubin span { display:block; height:34mm; border-radius:6px; box-shadow: inset 0 0 0 1px rgba(0,0,0,.12); }
  .deret-ubin p { margin:6px 0 0; font-size:9pt; }
  .col-warna { white-space:nowrap; }
  table.data thead th { white-space:nowrap; letter-spacing:0.06em; }
  table.data.kode thead th.right, table.data.kode tbody td.right { padding-right:14px; }
  table.data td.mono { font-size:9pt; white-space:nowrap; }
  table.resep .bahan { white-space:nowrap; }
  table.resep .plus { color:#9ca3af; margin: 0 6px; }
  .catatan { margin-top: 18px; font-size: 8pt; color:#6b7280; line-height:1.5; page-break-inside: avoid; }
  .catatan p { margin: 0 0 2px; }
</style></head>
<body>
  <div class="doc-top">
    <div><h1 class="doc-title">${esc(labels.title)}</h1><p class="doc-sub">${esc(nama)}</p></div>
    <div class="doc-ref">
      <span class="lbl">${esc(labels.date)}</span><span class="val">${esc(fmtDocDate(opts.tanggal ?? new Date()))}</span>
      <span class="lbl">${esc(labels.rule)}</span><span class="val">${esc(labels.ruleName)}</span>
      ${opts.dibuatOleh ? `<span class="lbl">${esc(labels.createdBy)}</span><span class="val">${esc(opts.dibuatOleh)}</span>` : ""}
    </div>
  </div>
  ${kepala}
  <p class="section-title">${esc(labels.codes)}</p>
  <table class="data kode"><thead><tr>
    <th>${esc(labels.colColor)}</th><th>HEX</th><th>RGB</th><th>CMYK*</th><th>Pantone C</th><th>Pantone TCX</th>${kolomSablon}
  </tr></thead><tbody>${barisKode}</tbody></table>
  ${resep}
  <div class="catatan">${labels.notes.map((c) => `<p>${esc(c)}</p>`).join("")}<p>${esc(labels.printedFrom)}</p></div>
</body></html>`;
}
