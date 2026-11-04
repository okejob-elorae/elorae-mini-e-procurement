import { prisma, type Prisma, type StockLedgerRefType } from "@elorae/db";

/**
 * Nilai yang benar-benar bergerak di kartu stok gudang utama per DOKUMEN —
 * KHUSUS SERVER. Satu pembaca untuk pengeluaran bahan (selisih nilai
 * pengeluaran) dan retur pemasok (jurnalnya dan rekonsiliasi persediaan),
 * supaya ketiganya membaca angka yang sama.
 *
 * Sumbernya buku besar stok (`StockLedgerEntry`). Arsip `StockMovement`
 * berhenti ditulis 2026-09-21 dan hanya dibaca untuk dokumen LAMA: dokumen
 * yang buku besarnya tidak punya baris, atau barisnya tanpa nilai (ditulis
 * 2026-09-15 … 09-21, sebelum kolom nilainya ada — arsip menyimpan nilainya).
 * Dua sumber itu tidak pernah DIJUMLAHKAN: per dokumen dipakai satu saja,
 * buku besar lebih dulu, jadi dokumen yang tercatat di keduanya tidak terhitung
 * dua kali.
 */

type Klien = Prisma.TransactionClient | typeof prisma;

/** refType buku besar stok → refType yang sama di arsip `StockMovement`. */
export const REF_ARSIP_GERAKAN = {
  MaterialIssue: "WO_ISSUE",
  VendorReturn: "VENDOR_RETURN",
} as const satisfies Partial<Record<StockLedgerRefType, string>>;

export type RefGerakDokumen = keyof typeof REF_ARSIP_GERAKAN;

export type BarisGerakDokumen = {
  itemId: string;
  /** "" = tanpa varian (null di arsip dibaca sebagai ""). */
  variantSku: string;
  /** Bertanda: keluar negatif. */
  qty: number;
  /** Rupiah, seperti yang ditulis penulisnya (keluar dicatat positif). */
  totalCost: number;
};

export type GerakDokumen = {
  /** Σ `totalCost` baris, dibulatkan ke sen. */
  total: number;
  baris: BarisGerakDokumen[];
  sumber: "BUKU_BESAR" | "ARSIP" | "TANPA_GERAKAN";
};

type BarisMentah = {
  refId: string;
  itemId: string;
  variantSku: string | null;
  qty: unknown;
  totalCost: unknown;
};

function kelompokkan(rows: readonly BarisMentah[]): Map<string, BarisMentah[]> {
  const peta = new Map<string, BarisMentah[]>();
  for (const r of rows) {
    const daftar = peta.get(r.refId) ?? [];
    daftar.push(r);
    peta.set(r.refId, daftar);
  }
  return peta;
}

const bernilai = (rows: readonly BarisMentah[]) => rows.every((r) => r.totalCost != null);

function susun(rows: readonly BarisMentah[], sumber: GerakDokumen["sumber"]): GerakDokumen {
  let sen = 0;
  const baris = rows.map((r) => {
    const totalCost = Number(r.totalCost);
    sen += Math.round(totalCost * 100);
    return { itemId: r.itemId, variantSku: r.variantSku ?? "", qty: Number(r.qty), totalCost };
  });
  return { total: sen / 100, baris, sumber };
}

/**
 * Gerakan gudang utama per dokumen. Setiap id yang diminta mendapat entri:
 * `GerakDokumen` (boleh tanpa baris — dokumen itu tidak menggerakkan stok), atau
 * `null` bila nilainya TIDAK TERCATAT (baris buku besar tanpa nilai, dan arsip
 * tidak menolong). `null` tidak pernah boleh dibaca sebagai nol oleh pemanggil.
 */
export async function gerakStokPerDokumen(
  klien: Klien,
  refType: RefGerakDokumen,
  refIds: readonly string[],
): Promise<Map<string, GerakDokumen | null>> {
  const hasil = new Map<string, GerakDokumen | null>();
  const ids = [...new Set(refIds)].filter(Boolean);
  if (ids.length === 0) return hasil;

  const buku = kelompokkan(
    await klien.stockLedgerEntry.findMany({
      where: { refType, refId: { in: ids }, locationType: "MAIN" },
      select: { refId: true, itemId: true, variantSku: true, qty: true, totalCost: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
  );
  const perluArsip = ids.filter((id) => {
    const b = buku.get(id);
    return !b || !bernilai(b);
  });
  const arsip = kelompokkan(
    perluArsip.length
      ? await klien.stockMovement.findMany({
          where: { refType: REF_ARSIP_GERAKAN[refType], refId: { in: perluArsip } },
          select: { refId: true, itemId: true, variantSku: true, qty: true, totalCost: true },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        })
      : [],
  );

  for (const id of ids) {
    const b = buku.get(id) ?? [];
    if (b.length > 0 && bernilai(b)) {
      hasil.set(id, susun(b, "BUKU_BESAR"));
      continue;
    }
    const a = arsip.get(id) ?? [];
    if (a.length > 0) {
      hasil.set(id, bernilai(a) ? susun(a, "ARSIP") : null);
      continue;
    }
    hasil.set(id, b.length > 0 ? null : { total: 0, baris: [], sumber: "TANPA_GERAKAN" });
  }
  return hasil;
}
