import { esc } from "@/lib/print/print-theme";

type Teks = string | null | undefined;

export type NotaKainData = {
  docNumber: Teks;
  vendorName: Teks;
  fgName: Teks;
  /** Judul kolom konsumsi, sudah diterjemahkan. */
  labelKonsumsi: Teks;
  rolls: Array<{ rollRef?: Teks; qty?: number | string | null; notes?: Teks }>;
  materials: Array<{ itemName?: Teks; itemId?: Teks; plannedQty?: unknown; uomCode?: Teks }>;
};

/** Teks bebas → aman di dalam HTML. Kosong dicetak kosong, bukan "null". */
const t = (s: unknown): string => esc(s == null ? "" : String(s));

/**
 * Dokumen "Nota Kain per Roll" untuk `window.open` + `document.write`.
 *
 * SEMUA nilai di-escape: ref dan catatan rol diketik bebas oleh orang gudang/
 * produksi, dan jendela cetak sama asalnya dengan aplikasi — markup di catatan
 * rol akan berjalan sebagai skrip di sesi siapa pun yang mencetak nota ini.
 */
export function buildNotaKainHtml(d: NotaKainData): string {
  const barisRol = d.rolls
    .map((r) => `<tr><td>${t(r.rollRef)}</td><td>${t(Number(r.qty ?? 0))}</td><td>${t(r.notes)}</td></tr>`)
    .join("");
  const barisBahan = d.materials
    .map(
      (p) =>
        `<tr><td>${t(p.itemName ?? p.itemId)}</td><td>${t(Number(p.plannedQty ?? 0))}</td><td>${t(p.uomCode)}</td></tr>`,
    )
    .join("");
  return `
                  <html><head><title>Nota Kain per Roll - ${t(d.docNumber)}</title></head><body>
                  <h2>Nota Kain per Roll</h2>
                  <p><strong>WO:</strong> ${t(d.docNumber)}</p>
                  <p><strong>Vendor:</strong> ${t(d.vendorName)}</p>
                  <p><strong>FG:</strong> ${t(d.fgName)}</p>
                  <table border="1" cellpadding="8" style="border-collapse:collapse;width:100%">
                  <tr><th>Roll / Ref</th><th>Qty</th><th>Notes</th></tr>
                  ${barisRol}
                  </table>
                  <p style="margin-top:16px"><strong>Materials (consumption plan):</strong></p>
                  <table border="1" cellpadding="8" style="border-collapse:collapse;width:100%">
                  <tr><th>Material</th><th>${t(d.labelKonsumsi)}</th><th>UOM</th></tr>
                  ${barisBahan}
                  </table>
                  </body></html>`;
}
