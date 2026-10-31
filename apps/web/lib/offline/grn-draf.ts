import type { PendingGRN } from "./db";
import type { ImportedRoll } from "@/lib/grn/roll-import/types";

/*
 * Draf GRN di perangkat.
 *
 * GRN TIDAK punya jalur luring: antrean `pendingGRNs` lama tidak pernah dikirim
 * ke server, padahal layarnya berjanji "akan disinkronkan". GRN menggerakkan
 * stok, harga rata-rata, status PO, dan jurnal hutang, dan tabelnya tidak punya
 * kunci idempotensi — memutar ulang dari antrean bisa menerima barang dua kali.
 * Jadi menyimpan GRN butuh sinyal, dan isian formulir disimpan sebagai draf di
 * perangkat (per pengguna) supaya sinyal putus atau muat ulang tidak menghapus
 * apa pun. Draf hilang hanya saat GRN tersimpan atau pengguna membuangnya.
 *
 * Modul ini murni (tanpa Dexie); tabelnya disuntikkan, bentuknya sama dengan
 * Dexie `Table` (get/put/delete).
 */

export const VERSI_DRAF_GRN = 1 as const;

/** Satu baris formulir GRN seperti di `GRNForm` (dengan `id` baris). */
export type BarisIsianGrn = {
  id: string;
  itemId: string;
  itemType?: string;
  sku: string;
  nameId: string;
  uomId: string;
  uomCode: string;
  variantSku?: string;
  qty: number;
  unitCost: number;
  rollValues?: string[];
  /**
   * Kain: roll dari impor Excel (panjang + nomor roll + catatan). Bila ada, ia
   * menggantikan `rollValues` dan qty = jumlah panjangnya. Tidak ada = roll
   * diketik (atau bukan kain).
   */
  importedRolls?: ImportedRoll[];
  poOrderedQty?: number | null;
  poAlreadyReceivedQty?: number | null;
};

export type IsianGrn = {
  poId: string;
  supplierId: string;
  categoryId: string;
  notes: string;
  /** `localId` GRN lama di `pendingGRNs` yang sedang dimuat ke formulir. */
  pendingLamaId: number | null;
  /**
   * Kunci kiriman GRN (`idempotencyKey`), dibuat SEKALI per isian. Ikut draf:
   * GRN yang disimpan ulang sesudah sinyal putus atau muat ulang membawa kunci
   * yang sama, jadi server mengembalikan GRN yang sudah tercatat — barang tidak
   * diterima dua kali. Kosong = belum ada (draf lama); formulir membuatkannya.
   */
  kunciKirim?: string;
  lines: BarisIsianGrn[];
};

export type BarisDrafGrn = {
  itemId: string;
  itemType: string;
  sku: string;
  nameId: string;
  uomId: string;
  uomCode: string;
  variantSku?: string;
  qty: number;
  unitCost: number;
  rollValues: string[];
  /** Lihat `BarisIsianGrn.importedRolls`; tidak ada pada draf yang ditulis sebelum roll impor ikut draf. */
  importedRolls?: ImportedRoll[];
  poOrderedQty: number | null;
  poAlreadyReceivedQty: number | null;
};

export type DrafGrn = {
  versi: typeof VERSI_DRAF_GRN;
  poId: string;
  supplierId: string;
  categoryId: string;
  notes: string;
  pendingLamaId: number | null;
  /** Lihat `IsianGrn.kunciKirim`. "" pada draf yang ditulis sebelum kunci ada. */
  kunciKirim: string;
  lines: BarisDrafGrn[];
  /** Epoch ms saat draf ditulis. */
  disimpanPada: number;
};

export function drafDariIsian(isian: IsianGrn, sekarang: number): DrafGrn {
  return {
    versi: VERSI_DRAF_GRN,
    poId: isian.poId,
    supplierId: isian.supplierId,
    categoryId: isian.categoryId,
    notes: isian.notes,
    pendingLamaId: isian.pendingLamaId,
    kunciKirim: isian.kunciKirim ?? "",
    lines: isian.lines.map((l) => {
      const baris: BarisDrafGrn = {
        itemId: l.itemId,
        itemType: l.itemType ?? "",
        sku: l.sku,
        nameId: l.nameId,
        uomId: l.uomId,
        uomCode: l.uomCode,
        qty: l.qty,
        unitCost: l.unitCost,
        rollValues: [...(l.rollValues ?? [])],
        poOrderedQty: l.poOrderedQty ?? null,
        poAlreadyReceivedQty: l.poAlreadyReceivedQty ?? null,
      };
      if (l.variantSku) baris.variantSku = l.variantSku;
      if (l.importedRolls !== undefined) baris.importedRolls = salinRoll(l.importedRolls);
      return baris;
    }),
    disimpanPada: sekarang,
  };
}

function salinRoll(rolls: readonly ImportedRoll[]): ImportedRoll[] {
  return rolls.map((r) => ({ length: r.length, ref: r.ref, notes: r.notes }));
}

/** Ada yang layak disimpan? Saring kategori saja bukan isian. */
export function drafBermakna(draf: DrafGrn, jumlahFoto: number): boolean {
  return (
    draf.supplierId !== "" ||
    draf.poId !== "" ||
    draf.notes.trim() !== "" ||
    draf.lines.some((l) => l.itemId !== "") ||
    jumlahFoto > 0
  );
}

function teks(v: unknown): v is string {
  return typeof v === "string";
}

function angka(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function angkaAtauNull(v: unknown): number | null | undefined {
  if (v === null) return null;
  return angka(v) ? v : undefined;
}

function teksAtauNull(v: unknown): v is string | null {
  return v === null || teks(v);
}

/** Roll impor dari simpanan; null bila satu saja rusak (barisnya ikut dibuang — qty-nya jumlah roll itu). */
function bacaRollImpor(v: unknown): ImportedRoll[] | null {
  if (!Array.isArray(v)) return null;
  const hasil: ImportedRoll[] = [];
  for (const r of v) {
    if (!r || typeof r !== "object") return null;
    const roll = r as Record<string, unknown>;
    if (!angka(roll.length) || !teksAtauNull(roll.ref) || !teksAtauNull(roll.notes)) return null;
    hasil.push({ length: roll.length, ref: roll.ref, notes: roll.notes });
  }
  return hasil;
}

function bacaBaris(v: unknown): BarisDrafGrn | null {
  if (!v || typeof v !== "object") return null;
  const b = v as Record<string, unknown>;
  if (![b.itemId, b.itemType, b.sku, b.nameId, b.uomId, b.uomCode].every(teks)) return null;
  if (!angka(b.qty) || !angka(b.unitCost)) return null;
  if (b.variantSku !== undefined && !teks(b.variantSku)) return null;
  if (!Array.isArray(b.rollValues) || !b.rollValues.every(teks)) return null;
  const dipesan = angkaAtauNull(b.poOrderedQty);
  const diterima = angkaAtauNull(b.poAlreadyReceivedQty);
  if (dipesan === undefined || diterima === undefined) return null;
  const rollImpor = b.importedRolls === undefined ? undefined : bacaRollImpor(b.importedRolls);
  if (rollImpor === null) return null;
  const baris: BarisDrafGrn = {
    itemId: b.itemId as string,
    itemType: b.itemType as string,
    sku: b.sku as string,
    nameId: b.nameId as string,
    uomId: b.uomId as string,
    uomCode: b.uomCode as string,
    qty: b.qty,
    unitCost: b.unitCost,
    rollValues: [...(b.rollValues as string[])],
    poOrderedQty: dipesan,
    poAlreadyReceivedQty: diterima,
  };
  if (b.variantSku) baris.variantSku = b.variantSku as string;
  if (rollImpor) baris.importedRolls = rollImpor;
  return baris;
}

/** Kunci kiriman yang diterima server (8–100 huruf, lihat `grnSchema`), selain itu "". */
function kunciKirimSah(v: unknown): string {
  if (!teks(v)) return "";
  const k = v.trim();
  return k.length >= 8 && k.length <= 100 ? k : "";
}

/** Simpanan dari perangkat → draf sah, atau null (rusak / versi lain). Baris rusak dibuang. */
export function bacaDrafGrn(mentah: unknown): DrafGrn | null {
  if (!mentah || typeof mentah !== "object") return null;
  const d = mentah as Record<string, unknown>;
  if (d.versi !== VERSI_DRAF_GRN) return null;
  if (![d.poId, d.supplierId, d.categoryId, d.notes].every(teks)) return null;
  if (!Array.isArray(d.lines) || !angka(d.disimpanPada)) return null;
  if (d.pendingLamaId !== null && !angka(d.pendingLamaId)) return null;
  return {
    versi: VERSI_DRAF_GRN,
    poId: d.poId as string,
    supplierId: d.supplierId as string,
    categoryId: d.categoryId as string,
    notes: d.notes as string,
    pendingLamaId: d.pendingLamaId as number | null,
    // Draf lama tanpa kunci (atau kunci rusak) tetap sah; formulir membuatkan kunci baru.
    kunciKirim: kunciKirimSah(d.kunciKirim),
    lines: d.lines.map(bacaBaris).filter((b): b is BarisDrafGrn => b !== null),
    disimpanPada: d.disimpanPada,
  };
}

/** Draf → baris formulir (id baru `draf-N`; minimal satu baris kosong). */
export function barisDariDraf(
  draf: DrafGrn,
): Array<Required<Omit<BarisIsianGrn, "variantSku" | "importedRolls">> & { variantSku?: string; importedRolls?: ImportedRoll[] }> {
  if (draf.lines.length === 0) {
    return [
      {
        id: "draf-0",
        itemId: "",
        itemType: "",
        sku: "",
        nameId: "",
        uomId: "",
        uomCode: "",
        qty: 0,
        unitCost: 0,
        rollValues: [],
        poOrderedQty: null,
        poAlreadyReceivedQty: null,
      },
    ];
  }
  return draf.lines.map((l, i) => ({
    ...l,
    rollValues: [...l.rollValues],
    ...(l.importedRolls ? { importedRolls: salinRoll(l.importedRolls) } : {}),
    id: `draf-${i}`,
  }));
}

/**
 * GRN lama yang dulu "disimpan di perangkat" dan tidak pernah terkirim → draf
 * formulir, supaya bisa disimpan sekarang lewat jalur biasa.
 */
export function drafDariGrnLama(
  lama: PendingGRN,
  barang: ReadonlyMap<string, { type?: string; uomCode?: string }>,
  sekarang: number,
): DrafGrn {
  return {
    versi: VERSI_DRAF_GRN,
    poId: lama.poId ?? "",
    supplierId: lama.supplierId,
    categoryId: "",
    notes: lama.notes ?? "",
    pendingLamaId: lama.localId ?? null,
    // GRN lama tidak pernah sampai ke server: isian baru, kunci baru (dibuat formulir).
    kunciKirim: "",
    lines: lama.items.map((it) => {
      const info = barang.get(it.itemId);
      const rolls = it.rolls ?? [];
      const baris: BarisDrafGrn = {
        itemId: it.itemId,
        itemType: info?.type ?? (rolls.length > 0 ? "FABRIC" : ""),
        sku: it.sku ?? "",
        nameId: it.name ?? "",
        uomId: it.uomId,
        uomCode: info?.uomCode ?? "",
        qty: it.qty,
        unitCost: it.unitCost,
        rollValues: rolls.map((r) => String(r.length)),
        poOrderedQty: null,
        poAlreadyReceivedQty: null,
      };
      if (it.variantSku) baris.variantSku = it.variantSku;
      return baris;
    }),
    disimpanPada: sekarang,
  };
}

/** Foto GRN lama (data URL base64) → berkas; selain itu null. */
export function fotoDariDataUrl(dataUrl: string, nama: string): File | null {
  const cocok = /^data:([^;,]+);base64,([\s\S]*)$/.exec(dataUrl);
  if (!cocok) return null;
  try {
    const biner = atob(cocok[2]);
    const bita = new Uint8Array(biner.length);
    for (let i = 0; i < biner.length; i++) bita[i] = biner.charCodeAt(i);
    return new File([bita], nama, { type: cocok[1] });
  } catch {
    return null;
  }
}

/**
 * Kunci draf (id pengguna) untuk formulir yang sedang terbuka. next-auth
 * mengambil ulang sesi saat tab terlihat lagi; tanpa sinyal sesinya jadi null
 * sampai halaman dimuat ulang. Kunci tidak boleh ikut kosong: draf akan berhenti
 * tersimpan, dan draf lama tidak terhapus setelah GRN tersimpan.
 */
export function kunciDrafLengket(sebelumnya: string, idSesi: string): string {
  return idSesi || sebelumnya;
}

/** Angka satu baris PO terbaru (varian kosong = tanpa varian). */
export type AngkaPoBaris = { itemId: string; variantSku: string; dipesan: number; diterima: number | null };

/**
 * Draf yang dipulihkan memakai angka "dipesan / sudah diterima" dari PO
 * terbaru, bukan dari saat draf ditulis. Baris dipasangkan menurut barang +
 * varian, berurutan; baris yang tidak ada di PO kehilangan angkanya. Isian lain
 * (qty, harga, roll) tidak disentuh.
 */
export function segarkanAngkaPo<
  T extends { itemId: string; variantSku?: string; poOrderedQty?: number | null; poAlreadyReceivedQty?: number | null },
>(lines: T[], po: readonly AngkaPoBaris[]): T[] {
  const terpakai = new Set<number>();
  return lines.map((l) => {
    if (!l.itemId) return l;
    const varian = l.variantSku?.trim() ?? "";
    const i = po.findIndex((p, idx) => !terpakai.has(idx) && p.itemId === l.itemId && p.variantSku.trim() === varian);
    if (i < 0) return { ...l, poOrderedQty: null, poAlreadyReceivedQty: null };
    terpakai.add(i);
    return { ...l, poOrderedQty: po[i].dipesan, poAlreadyReceivedQty: po[i].diterima };
  });
}

export type AlasanTidakBisaSimpanGrn = "BUTUH_SINYAL";

/** Kenapa tombol simpan GRN mati (null = boleh). */
export function alasanTidakBisaSimpanGrn(k: { daring: boolean }): AlasanTidakBisaSimpanGrn | null {
  return k.daring ? null : "BUTUH_SINYAL";
}

/**
 * Galat karena sambungan putus (fetch aksi server gagal), bukan penolakan
 * server. Saat itu GRN mungkin sudah tercatat atau belum — layar tidak boleh
 * menebak.
 */
export function galatSambungan(err: unknown): boolean {
  if (!(err instanceof TypeError)) return false;
  return /failed to fetch|load failed|networkerror|network request failed/i.test(err.message);
}

export type BarisSimpananDrafGrn = {
  /** Id pengguna — komputer gudang bisa dipakai bergantian. */
  kunci: string;
  draf: DrafGrn;
  foto: Blob[];
  diperbarui: number;
};

/** Bentuk minimal Dexie `Table<BarisSimpananDrafGrn, string>`. */
export interface TabelDrafGrn {
  get(kunci: string): Promise<BarisSimpananDrafGrn | undefined>;
  put(baris: BarisSimpananDrafGrn): Promise<unknown>;
  delete(kunci: string): Promise<void>;
}

/** Tulis draf (atau hapus bila isian kosong). Tidak pernah melempar; false = tidak tersimpan. */
export async function simpanDrafGrn(
  tabel: TabelDrafGrn,
  kunci: string,
  draf: DrafGrn,
  foto: Blob[],
): Promise<boolean> {
  if (!kunci) return false;
  try {
    if (!drafBermakna(draf, foto.length)) {
      await tabel.delete(kunci);
      return true;
    }
    await tabel.put({ kunci, draf, foto: [...foto], diperbarui: draf.disimpanPada });
    return true;
  } catch {
    return false;
  }
}

/** Baca draf pengguna; simpanan rusak dibuang. Tidak pernah melempar. */
export async function ambilDrafGrn(
  tabel: TabelDrafGrn,
  kunci: string,
): Promise<{ draf: DrafGrn; foto: Blob[] } | null> {
  if (!kunci) return null;
  try {
    const baris = await tabel.get(kunci);
    if (!baris) return null;
    const draf = bacaDrafGrn(baris.draf);
    if (!draf) {
      await tabel.delete(kunci);
      return null;
    }
    const foto = Array.isArray(baris.foto) ? baris.foto.filter((f) => f instanceof Blob) : [];
    return { draf, foto };
  } catch {
    return null;
  }
}

export async function hapusDrafGrn(tabel: TabelDrafGrn, kunci: string): Promise<void> {
  if (!kunci) return;
  try {
    await tabel.delete(kunci);
  } catch {
    // Draf yang gagal dihapus dibaca lagi lain kali; tidak menggagalkan GRN.
  }
}
