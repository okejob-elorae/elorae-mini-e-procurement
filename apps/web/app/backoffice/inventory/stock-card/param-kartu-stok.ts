/*
 * Kartu stok per barang di URL: `?itemId=&varian=&dari=&sampai=` (YYYY-MM-DD).
 * Dengan begitu kartu stok bisa dibuka langsung untuk satu barang (mis. dari
 * rincian GRN) dan tautannya bisa dibagikan.
 */

export type ParamKartuStok = { itemId: string; varian: string; dari: string; sampai: string };

function tanggalSah(v: string | null): string | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : v;
}

export function bacaParamKartuStok(
  sp: Pick<URLSearchParams, "get">,
  bawaan: { dari: string; sampai: string },
): ParamKartuStok {
  let dari = tanggalSah(sp.get("dari")) ?? bawaan.dari;
  let sampai = tanggalSah(sp.get("sampai")) ?? bawaan.sampai;
  if (dari > sampai) [dari, sampai] = [sampai, dari];
  return { itemId: (sp.get("itemId") ?? "").trim(), varian: (sp.get("varian") ?? "").trim(), dari, sampai };
}

export function tulisParamKartuStok(p: ParamKartuStok, bawaan: { dari: string; sampai: string }): string {
  const q = new URLSearchParams();
  if (p.itemId) q.set("itemId", p.itemId);
  if (p.varian) q.set("varian", p.varian);
  if (p.dari !== bawaan.dari || p.sampai !== bawaan.sampai) {
    q.set("dari", p.dari);
    q.set("sampai", p.sampai);
  }
  return q.toString();
}
