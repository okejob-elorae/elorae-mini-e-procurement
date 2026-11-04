/**
 * Logika murni kartu stok gudang (tanpa Prisma — aman dites dan diimpor di mana pun).
 *
 * Kartu stok dirakit dari DUA buku yang sama-sama menggerakkan `InventoryValue`:
 *  - `StockMovement`: GRN, produksi (keluar bahan / terima hasil), retur pemasok,
 *    opname, penyesuaian manual, rekonsiliasi Jubelio. Arah IN/OUT dari `type`,
 *    ADJUSTMENT dari tanda `qty`.
 *  - `StockAdjustment`: penjualan marketplace (FULFILLMENT_CONSUME), pengiriman
 *    lapangan, van, retur, tukar barang, transfer konsi, webhook Jubelio, dll.
 *    Tanda `qtyChange` TIDAK seragam antar-penulis, jadi arah diambil dari
 *    `type` (POSITIVE/NEGATIVE) dan besarnya dari |qtyChange|.
 *
 * Penyesuaian manual, opname, dan rekonsiliasi menulis ke KEDUA buku untuk satu
 * kejadian; baris StockAdjustment-nya dibuang bila pasangannya ada.
 *
 * Saldo dijangkar ke saldo sekarang (`InventoryValue`), bukan dijumlah dari nol:
 * saldo akhir kartu selalu sama dengan stok yang benar-benar tercatat, dan stok
 * yang masuk tanpa dokumen apa pun (mis. stok awal dari katalog Jubelio) muncul
 * sebagai `tanpaDokumen` di saldo awal, bukan sebagai saldo yang meleset.
 */

export type BarisMovementKartu = {
  id: string;
  itemId: string;
  variantSku: string | null;
  type: "IN" | "OUT" | "ADJUSTMENT";
  refType: string;
  refId: string;
  refDocNumber: string;
  qty: number;
  unitCost: number | null;
  notes: string | null;
  createdAt: Date;
};

export type BarisPenyesuaianKartu = {
  id: string;
  itemId: string;
  docNumber: string;
  type: "POSITIVE" | "NEGATIVE";
  qtyChange: number;
  /** Stok baris InventoryValue sebelum/sesudah (dipakai menilai pergeseran harga rata-rata). */
  prevQty?: number | null;
  newQty?: number | null;
  prevAvgCost: number;
  newAvgCost: number;
  source: string;
  externalRef: string | null;
  reason: string;
  createdAt: Date;
};

/** Satu gerakan stok gudang, dari buku mana pun. `qty` bertanda (+ masuk, − keluar). */
export type GerakanKartu = {
  id: string;
  itemId: string;
  tanggal: Date;
  /** Kode jenis: refType StockMovement atau source StockAdjustment. Label lewat i18n. */
  jenis: string;
  docNumber: string | null;
  variantSku: string | null;
  catatan: string | null;
  qty: number;
  hargaSatuan: number | null;
  /** Nilai rupiah bertanda bila diketahui pasti; tanpa ini = qty × hargaSatuan. */
  nilai?: number | null;
  /** Halaman rincian dokumennya di kantor; null bila dokumen itu tidak punya halaman sendiri. */
  tautan?: string | null;
};

export type BarisKartuStok = {
  id: string;
  date: Date;
  docNumber: string | null;
  /** Lihat `GerakanKartu.tautan`. */
  tautan?: string | null;
  jenis: string;
  variantSku: string | null;
  notes: string | null;
  in: number | null;
  out: number | null;
  balance: number;
  unitCost: number | null;
  balanceValue: number;
};

export type KartuStokTersusun = {
  openingBalance: number;
  openingValue: number;
  closingBalance: number;
  closingValue: number;
  /**
   * Bagian saldo awal yang tidak punya dokumen gerakan sama sekali
   * (saldo awal − Σ gerakan sebelum `dari`). null = tidak bisa dihitung.
   */
  tanpaDokumen: number | null;
  movements: BarisKartuStok[];
};

/** refType StockMovement yang punya kembaran StockAdjustment. */
export const REF_BERPASANGAN = ["ADJUSTMENT", "OPNAME", "RECON"] as const;

/** Bulatkan ke 2 desimal (kolom qty dan rupiah di skema berskala 2). */
function dua(x: number): number {
  const r = Math.round(x * 100) / 100;
  return r === 0 ? 0 : r; // buang -0
}

/** Kunci pasangan sebuah StockMovement, atau null bila jenisnya tidak pernah berpasangan. */
export function kunciPasanganMovement(m: Pick<BarisMovementKartu, "refType" | "refId" | "itemId">): string | null {
  if (!(REF_BERPASANGAN as readonly string[]).includes(m.refType)) return null;
  return `${m.refType}|${m.refId}|${m.itemId}`;
}

/**
 * Kunci yang akan dimiliki pasangan StockMovement sebuah penyesuaian:
 * opname → refId = id opname (externalRef), rekonsiliasi → refId = id run
 * (externalRef), selain itu → refId = id penyesuaian (penyesuaian manual, stok awal UMKM).
 */
export function kunciPasanganPenyesuaian(
  a: Pick<BarisPenyesuaianKartu, "id" | "itemId" | "source" | "externalRef">,
): string {
  if (a.source === "ERP_OPNAME" && a.externalRef) return `OPNAME|${a.externalRef}|${a.itemId}`;
  if (a.source === "JUBELIO_RECONCILE" && a.externalRef) return `RECON|${a.externalRef}|${a.itemId}`;
  return `ADJUSTMENT|${a.id}|${a.itemId}`;
}

/**
 * Qty bertanda sebuah StockMovement: IN selalu masuk, OUT selalu keluar (baris
 * lama yang menulis OUT dengan qty positif tidak membalik arah); ADJUSTMENT
 * (opname, penyesuaian, rekonsiliasi) memakai tanda qty-nya.
 */
export function qtyBertandaMovement(m: Pick<BarisMovementKartu, "type" | "qty">): number {
  const besar = Math.abs(m.qty);
  if (m.type === "IN") return dua(besar);
  if (m.type === "OUT") return dua(-besar);
  return dua(m.qty);
}

/**
 * Rincian dokumen sebuah StockMovement menurut `refType`. Hanya jenis yang
 * `refId`-nya PASTI id dokumen yang punya halaman: GRN (dan pembalikannya),
 * opname gudang, retur pemasok, rekonsiliasi, penyesuaian manual. Keluar bahan
 * dan terima hasil produksi menunjuk dokumen tanpa halaman sendiri → null.
 */
export function tautanMovement(refType: string, refId: string | null | undefined): string | null {
  const id = (refId ?? "").trim();
  if (!id || id === "temp") return null;
  const e = encodeURIComponent(id);
  switch (refType) {
    case "GRN":
    case "GRN_OWNER_DECLINE":
      return `/backoffice/inventory/grn/${e}`;
    case "OPNAME":
      return `/backoffice/inventory/stock-opname/${e}`;
    case "VENDOR_RETURN":
      return `/backoffice/vendor-returns/${e}`;
    case "RECON":
      return `/backoffice/inventory/reconciliation/${e}`;
    case "ADJUSTMENT":
      return `/backoffice/inventory/adjustment/${e}`;
    default:
      return null;
  }
}

/** Setiap StockAdjustment punya rincian di halaman penyesuaian (sumber apa pun). */
export function tautanPenyesuaian(id: string | null | undefined): string | null {
  const v = (id ?? "").trim();
  return v ? `/backoffice/inventory/adjustment/${encodeURIComponent(v)}` : null;
}

export function gerakanDariMovement(m: BarisMovementKartu): GerakanKartu {
  return {
    id: m.id,
    itemId: m.itemId,
    tanggal: m.createdAt,
    jenis: m.refType,
    docNumber: m.refDocNumber || null,
    variantSku: m.variantSku,
    catatan: m.notes,
    qty: qtyBertandaMovement(m),
    hargaSatuan: m.unitCost,
    tautan: tautanMovement(m.refType, m.refId),
  };
}

/** Qty bertanda sebuah penyesuaian: arah dari `type`, besar dari |qtyChange|. */
export function qtyBertandaPenyesuaian(a: Pick<BarisPenyesuaianKartu, "type" | "qtyChange">): number {
  const besar = Math.abs(a.qtyChange);
  return dua(a.type === "NEGATIVE" ? -besar : besar);
}

/**
 * Nilai rupiah bertanda sebuah penyesuaian yang MENGGESER harga rata-rata
 * (mis. sisa van kembali dengan harga van: penulisnya menyetel totalValue =
 * newQty × newAvgCost). Nilai yang benar-benar berpindah = nilai baris sesudah −
 * nilai baris sebelum, bukan qty × harga rata-rata baru. null bila harga rata-rata
 * tidak bergeser atau prevQty/newQty tidak cocok dengan qty-nya (tidak bisa dipercaya).
 */
export function nilaiPergeseranRata(
  a: Pick<BarisPenyesuaianKartu, "prevQty" | "newQty" | "prevAvgCost" | "newAvgCost">,
  qty: number,
): number | null {
  if (qty === 0 || a.prevAvgCost === a.newAvgCost) return null;
  if (a.prevQty == null || a.newQty == null) return null;
  if (Math.abs(a.newQty - a.prevQty - qty) > 0.005) return null;
  return a.newQty * a.newAvgCost - a.prevQty * a.prevAvgCost;
}

export function gerakanDariPenyesuaian(a: BarisPenyesuaianKartu): GerakanKartu {
  const qty = qtyBertandaPenyesuaian(a);
  const geser = nilaiPergeseranRata(a, qty);
  // Barang keluar dinilai dengan rata-rata sebelum; barang masuk dengan rata-rata sesudah.
  // Bila harga rata-rata bergeser, harga satuan yang tampil = nilai yang berpindah ÷ qty.
  const harga = geser != null ? dua(geser / qty) : qty < 0 ? a.prevAvgCost : a.newAvgCost || a.prevAvgCost;
  return {
    id: a.id,
    itemId: a.itemId,
    tanggal: a.createdAt,
    jenis: a.source,
    docNumber: a.docNumber || null,
    variantSku: null,
    catatan: a.reason || null,
    qty,
    hargaSatuan: harga,
    nilai: geser,
    tautan: tautanPenyesuaian(a.id),
  };
}

/**
 * Satukan kedua buku menjadi satu daftar gerakan: penyesuaian yang pasangannya
 * ada di `kunciMovement` dibuang, gerakan nol dibuang, urut menurut waktu.
 */
export function gabungGerakan(
  movements: BarisMovementKartu[],
  penyesuaian: BarisPenyesuaianKartu[],
  kunciMovement: Set<string>,
): GerakanKartu[] {
  const semua: GerakanKartu[] = movements.map(gerakanDariMovement);
  for (const a of penyesuaian) {
    if (kunciMovement.has(kunciPasanganPenyesuaian(a))) continue;
    semua.push(gerakanDariPenyesuaian(a));
  }
  return semua
    .filter((g) => g.qty !== 0)
    .sort((x, y) => x.tanggal.getTime() - y.tanggal.getTime() || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
}

/** Nilai rupiah sebuah gerakan (nilai pasti bila ada, selain itu qty bertanda × harga satuan). */
function nilaiGerakan(g: GerakanKartu): number {
  if (g.nilai != null) return g.nilai;
  return g.hargaSatuan != null ? g.qty * g.hargaSatuan : 0;
}

/**
 * Susun kartu untuk satu rentang. `gerakan` = SEMUA gerakan sejak `dari` sampai
 * sekarang (yang sesudah `sampai` hanya dipakai menjangkar). `saldoSekarang` /
 * `nilaiSekarang` = Σ qtyOnHand / totalValue InventoryValue saat ini.
 * `qtySebelumDari` = Σ qty gerakan sebelum `dari` (null bila tidak diketahui).
 */
export function susunKartuStok(p: {
  gerakan: GerakanKartu[];
  saldoSekarang: number;
  nilaiSekarang: number;
  dari: Date;
  sampai: Date;
  qtySebelumDari: number | null;
}): KartuStokTersusun {
  const sejakDari = p.gerakan.filter((g) => g.tanggal.getTime() >= p.dari.getTime());
  let qtySejak = 0;
  let nilaiSejak = 0;
  for (const g of sejakDari) {
    qtySejak = dua(qtySejak + g.qty);
    nilaiSejak = dua(nilaiSejak + nilaiGerakan(g));
  }
  const openingBalance = dua(p.saldoSekarang - qtySejak);
  const openingValue = dua(p.nilaiSekarang - nilaiSejak);

  let saldo = openingBalance;
  let nilai = openingValue;
  const movements: BarisKartuStok[] = [];
  for (const g of sejakDari) {
    if (g.tanggal.getTime() > p.sampai.getTime()) break;
    saldo = dua(saldo + g.qty);
    nilai = dua(nilai + nilaiGerakan(g));
    movements.push({
      id: g.id,
      date: g.tanggal,
      docNumber: g.docNumber,
      tautan: g.tautan ?? null,
      jenis: g.jenis,
      variantSku: g.variantSku,
      notes: g.catatan,
      in: g.qty > 0 ? g.qty : null,
      out: g.qty < 0 ? dua(-g.qty) : null,
      balance: saldo,
      unitCost: g.hargaSatuan,
      balanceValue: nilai,
    });
  }

  return {
    openingBalance,
    openingValue,
    closingBalance: saldo,
    closingValue: nilai,
    tanpaDokumen: p.qtySebelumDari == null ? null : dua(openingBalance - p.qtySebelumDari),
    movements,
  };
}
