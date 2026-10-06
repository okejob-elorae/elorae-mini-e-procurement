/*
 * Opname gudang dihitung BUTA. Selama status CREATED/COUNTING angka sistem
 * (snapshot) dan selisihnya tidak pernah sampai ke layar — tidak di tampilan,
 * tidak di muatan (yang terbaca di devtools). Penghitung yang melihat angka
 * sistem cenderung mencocokkan, dan selisih yang nyata hilang.
 *
 * Sesudah dikirim untuk persetujuan, angkanya tampil untuk pemegang izin
 * approve (layar persetujuan). Sesudah disetujui, untuk semua yang boleh
 * melihat opname. Opname yang dibatalkan tetap hanya untuk pemegang approve:
 * snapshot-nya hampir sama dengan stok hari ini, dan penghitung bisa langsung
 * membuka opname baru.
 *
 * Hitungan hanya bisa diubah selama menghitung (`masihMenghitung`) — sesudah
 * dikirim, pemegang approve yang juga penghitung sudah melihat angka sistem.
 *
 * Modul murni, aman diimpor komponen klien.
 */

/** Status opname yang masih menerima hitungan. */
export const STATUS_MENGHITUNG = ["CREATED", "COUNTING"] as const;

export function masihMenghitung(status: string): boolean {
  return (STATUS_MENGHITUNG as readonly string[]).includes(status);
}

/** Boleh melihat angka sistem dan selisih opname ini? */
export function angkaSistemTampil(status: string, bolehSetujui: boolean): boolean {
  if (status === "APPROVED") return true;
  if (status === "SUBMITTED" || status === "CANCELLED") return bolehSetujui;
  // CREATED, COUNTING, dan status yang tidak dikenal.
  return false;
}

/** Kolom angka sistem baris barang: snapshot, selisih, dan jejak saat persetujuan. */
const KOLOM_BARANG = ["snapshotQty", "variance", "currentQtyAtApproval", "hadDriftWarning"] as const;
/** Kolom angka sistem rol kain. */
const KOLOM_ROL = ["snapshotLength", "variance"] as const;

function tanpaKolom<T extends object, K extends string>(baris: readonly T[], kolom: readonly K[]): Omit<T, K>[] {
  return baris.map((b) => {
    const salinan = { ...b } as Record<string, unknown>;
    for (const k of kolom) delete salinan[k];
    return salinan as Omit<T, K>;
  });
}

export function barangTanpaAngka<T extends object>(baris: readonly T[]): Omit<T, (typeof KOLOM_BARANG)[number]>[] {
  return tanpaKolom(baris, KOLOM_BARANG);
}

export function rolTanpaAngka<T extends object>(baris: readonly T[]): Omit<T, (typeof KOLOM_ROL)[number]>[] {
  return tanpaKolom(baris, KOLOM_ROL);
}

/** Baris tinjauan tanpa angka sistem: nama, ukuran/SKU, dan yang dihitung. */
export type BarisButa = { id: string; label: string; sublabel: string | undefined; counted: number | null };

const angkaAtauKosong = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

type BarangMuatan = { id: string; itemName: string; variantSku?: string | null; countedQty?: unknown };
type RolMuatan = { id: string; rollCode: string; itemName: string; countedLength?: unknown };

/** Baris tinjauan buta dari muatan opname (yang angka sistemnya sudah dibuang). */
export function barisButa(opname: { scope: string; items?: readonly BarangMuatan[]; rolls?: readonly RolMuatan[] }): BarisButa[] {
  if (opname.scope === "FABRIC") {
    return (opname.rolls ?? []).map((r) => ({ id: r.id, label: r.rollCode, sublabel: r.itemName, counted: angkaAtauKosong(r.countedLength) }));
  }
  return (opname.items ?? []).map((r) => ({
    id: r.id,
    label: r.itemName,
    sublabel: r.variantSku?.trim() || undefined,
    counted: angkaAtauKosong(r.countedQty),
  }));
}

export type SaringanButa = "all" | "pending" | "counted";

/** Saring (belum/sudah dihitung) dan cari (nama/SKU); yang belum dihitung di atas. */
export function saringBarisButa(baris: readonly BarisButa[], saring: SaringanButa, cari: string): BarisButa[] {
  const q = cari.trim().toUpperCase();
  return baris
    .filter((b) => (saring === "pending" ? b.counted === null : saring === "counted" ? b.counted !== null : true))
    .filter((b) => !q || b.label.toUpperCase().includes(q) || (b.sublabel?.toUpperCase().includes(q) ?? false))
    .sort((a, b) => {
      const belum = Number(b.counted === null) - Number(a.counted === null);
      return belum !== 0 ? belum : a.label.localeCompare(b.label);
    });
}
