/**
 * "Bahan kurang" — bahan baku yang masih harus dikeluarkan ke perintah kerja
 * tetapi stoknya tidak cukup. Murni, supaya aturannya teruji tanpa basis data.
 *
 * Aturan sebelumnya terbalik. Ia hanya melihat perintah kerja IN_PRODUCTION /
 * PARTIAL dan membandingkan `plannedQty` PENUH dengan stok di gudang. Padahal
 * mengeluarkan bahan (`issueMaterials`) itulah yang memindahkan perintah kerja
 * ke IN_PRODUCTION — dan pada saat yang sama mengurangi stoknya. Jadi bahan
 * yang sudah keluar dihitung dua kali sebagai kebutuhan dan tidak lagi ada di
 * stok: begitu bahan dikeluarkan, beranda berteriak "kurang" untuk bahan yang
 * sudah di tangan vendor. Sebaliknya perintah kerja DRAFT/ISSUED, yang bahannya
 * belum keluar sama sekali, tidak dihitung — kekurangan yang nyata tak terlihat.
 *
 * Aturan sekarang: kebutuhan = Σ (rencana − sudah dikeluarkan) per bahan, atas
 * perintah kerja yang masih bisa menerima bahan; dibandingkan dengan stok
 * TERSEDIA (di tangan − dipesan), bukan stok di tangan.
 *
 * `issuedQty` per baris rencana ditulis `issueMaterials` ke `consumptionPlan`
 * (kumulatif, per bahan). Itu satu-satunya catatan "sudah dikeluarkan" per
 * perintah kerja.
 */

/**
 * Perintah kerja yang masih bisa menerima bahan. COMPLETED dan CANCELLED tidak.
 * PARTIAL (barang jadi diterima sebagian) ikut: bahan yang belum dikeluarkan
 * masih dibutuhkan untuk menyelesaikannya — kalau semuanya sudah keluar,
 * sisanya nol dan ia tidak menyumbang apa-apa.
 */
export const STATUS_WO_BUTUH_BAHAN = ["DRAFT", "ISSUED", "IN_PRODUCTION", "PARTIAL"] as const;

export type BarisRencana = { itemId?: string | null; plannedQty?: unknown; issuedQty?: unknown };

export type WoUntukBahan = {
  woId: string;
  docNumber: string;
  vendorId: string;
  vendorName: string;
  vendorCode: string | null;
  rencana: readonly BarisRencana[];
};

export type KekuranganWo = { woId: string; docNumber: string; neededQty: number };

export type KekuranganVendor = {
  vendorId: string;
  vendorName: string;
  vendorCode: string | null;
  workOrders: KekuranganWo[];
};

export type KekuranganBahan = {
  itemId: string;
  /** Masih harus dikeluarkan: Σ (rencana − sudah dikeluarkan). */
  totalNeeded: number;
  /** Stok tersedia: di tangan − dipesan. */
  available: number;
  deficit: number;
  vendors: KekuranganVendor[];
};

const angka = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Baca `consumptionPlan` (JSON atau string JSON). Bentuk rusak = tanpa baris. */
export function bacaRencana(raw: unknown): BarisRencana[] {
  if (Array.isArray(raw)) return raw as BarisRencana[];
  if (typeof raw === "string") {
    try {
      const p = JSON.parse(raw) as unknown;
      return Array.isArray(p) ? (p as BarisRencana[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function hitungKekuranganBahan(
  wos: readonly WoUntukBahan[],
  tersediaPerItem: ReadonlyMap<string, number>,
): KekuranganBahan[] {
  const kebutuhan = new Map<string, number>();
  const sumbangan = new Map<
    string,
    Map<string, { vendorName: string; vendorCode: string | null; wo: Map<string, KekuranganWo> }>
  >();

  for (const wo of wos) {
    for (const baris of wo.rencana) {
      if (!baris?.itemId) continue;
      const sisa = angka(baris.plannedQty) - angka(baris.issuedQty);
      if (!(sisa > 0)) continue;
      kebutuhan.set(baris.itemId, (kebutuhan.get(baris.itemId) ?? 0) + sisa);

      let perVendor = sumbangan.get(baris.itemId);
      if (!perVendor) sumbangan.set(baris.itemId, (perVendor = new Map()));
      let v = perVendor.get(wo.vendorId);
      if (!v) perVendor.set(wo.vendorId, (v = { vendorName: wo.vendorName, vendorCode: wo.vendorCode, wo: new Map() }));
      const ada = v.wo.get(wo.woId);
      if (ada) ada.neededQty += sisa;
      else v.wo.set(wo.woId, { woId: wo.woId, docNumber: wo.docNumber, neededQty: sisa });
    }
  }

  const hasil: KekuranganBahan[] = [];
  for (const [itemId, totalNeeded] of kebutuhan) {
    const available = tersediaPerItem.get(itemId) ?? 0;
    const deficit = totalNeeded - Math.max(0, available);
    if (!(deficit > 0)) continue;
    const vendors = Array.from(sumbangan.get(itemId)?.entries() ?? [])
      .map(([vendorId, v]) => ({
        vendorId,
        vendorName: v.vendorName,
        vendorCode: v.vendorCode,
        workOrders: Array.from(v.wo.values()).sort((a, b) =>
          a.docNumber.localeCompare(b.docNumber, undefined, { numeric: true }),
        ),
      }))
      .sort((a, b) => a.vendorName.localeCompare(b.vendorName, undefined, { sensitivity: "base" }));
    hasil.push({ itemId, totalNeeded, available, deficit, vendors });
  }
  return hasil.sort((a, b) => b.deficit - a.deficit);
}
