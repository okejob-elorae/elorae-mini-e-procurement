import type { Prisma } from "@elorae/db";
import { lacakLapisan, sisaLapisan, type EntriLapisan } from "./sisa-lapisan";

/*
 * Pembaca kartu stok untuk aturan lapisan (`sisa-lapisan.ts`). KHUSUS SERVER, dipanggil di dalam
 * transaksi keputusan selisih harga (`koreksi-utang-writer.ts`), sesudah baris saldonya dikunci.
 */

type Tx = Prisma.TransactionClient;

export type LokasiTujuan = { jenis: "STORE" | "VAN"; lokasiId: string };

/** MAIN → Gudang Toko konsinyasi (`KonsiTransfer`) dan MAIN → van kanvas (`VanLoad`): barang masih milik Elorae. */
export const REF_PINDAH_MILIK_SENDIRI: ReadonlySet<string> = new Set(["KonsiTransfer", "VanLoad"]);

const kunciVarian = (v: string | null | undefined) => v?.trim() ?? "";

async function entriLokasi(
  tx: Tx,
  lokasi: { jenis: "MAIN" | "STORE" | "VAN"; lokasiId: string },
  itemId: string,
  variantSku: string | null,
): Promise<Array<EntriLapisan & { id: string }>> {
  const rows = await tx.stockLedgerEntry.findMany({
    where: { locationType: lokasi.jenis, locationId: lokasi.lokasiId, itemId, variantSku: kunciVarian(variantSku) },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, qty: true, balanceQty: true, refType: true, refId: true },
  });
  return rows.map((r) => ({ id: r.id, qty: Number(r.qty), balanceQty: Number(r.balanceQty), refType: r.refType, refId: r.refId }));
}

/** Entri sesudah entri TERAKHIR yang ber-ref ini di lokasi itu; null bila ref itu tidak ada di sana. */
function sesudahRef<T extends { refType: string; refId: string }>(entri: readonly T[], refType: string, refId: string): T[] | null {
  let i = -1;
  for (let k = 0; k < entri.length; k++) if (entri[k].refType === refType && entri[k].refId === refId) i = k;
  return i < 0 ? null : entri.slice(i + 1);
}

export type SebaranLapisan = {
  /** Bagian (0..1) penerimaan itu yang masih di Gudang Utama. */
  utama: number;
  /** Bagian yang masih di Gudang Toko konsinyasi atau van, per lokasi. */
  tujuan: Array<LokasiTujuan & { porsi: number }>;
};

/**
 * Di mana sisa lapisan satu penerimaan sekarang: bagian di Gudang Utama, dan bagian yang dibawa
 * pindah ke Gudang Toko konsinyasi atau van lalu belum keluar dari sana. Penerimaan yang tidak ada
 * di kartu stok (tidak pernah tercatat bergerak) dianggap tidak tersisa di mana pun.
 */
export async function bacaSebaranLapisan(
  tx: Tx,
  a: { refType: string; refId: string; itemId: string; variantSku: string | null },
): Promise<SebaranLapisan> {
  const utama = await entriLokasi(tx, { jenis: "MAIN", lokasiId: "" }, a.itemId, a.variantSku);
  const sesudah = sesudahRef(utama, a.refType, a.refId);
  if (!sesudah) return { utama: 0, tujuan: [] };
  const jejak = lacakLapisan(sesudah, (e) => REF_PINDAH_MILIK_SENDIRI.has(e.refType));
  const perLokasi = new Map<string, LokasiTujuan & { porsi: number }>();
  for (const d of jejak.dibawa) {
    const masuk = await tx.stockLedgerEntry.findFirst({
      where: {
        refType: d.refType,
        refId: d.refId,
        itemId: a.itemId,
        variantSku: kunciVarian(a.variantSku),
        locationType: { in: ["STORE", "VAN"] },
        qty: { gt: 0 },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { locationType: true, locationId: true },
    });
    // Kiriman konsinyasi yang masih dalam perjalanan (`KonsiTransfer` IN_TRANSIT) belum punya entri masuk
    // di toko, jadi bagiannya ikut terhitung sudah keluar. Menilainya ulang butuh sisi penerimaan toko dan
    // biaya konsinyasi yang ikut membawanya — belum dibangun.
    if (!masuk || (masuk.locationType !== "STORE" && masuk.locationType !== "VAN")) continue;
    const lokasi: LokasiTujuan = { jenis: masuk.locationType, lokasiId: masuk.locationId };
    const di = await entriLokasi(tx, lokasi, a.itemId, a.variantSku);
    const lanjut = sesudahRef(di, d.refType, d.refId);
    const porsi = lanjut ? d.porsi * sisaLapisan(lanjut) : 0;
    if (porsi <= 0) continue;
    const kunci = `${lokasi.jenis}|${lokasi.lokasiId}`;
    const ada = perLokasi.get(kunci);
    if (ada) ada.porsi += porsi;
    else perLokasi.set(kunci, { ...lokasi, porsi });
  }
  return { utama: jejak.sisa, tujuan: [...perLokasi.values()] };
}

/** Bagian (0..1) Gudang Utama saja — `bacaSebaranLapisan(...).utama`. */
export async function bacaSisaLapisan(
  tx: Tx,
  a: { refType: string; refId: string; itemId: string; variantSku: string | null },
): Promise<number> {
  return (await bacaSebaranLapisan(tx, a)).utama;
}

/** Bagian (0..1) penilaian ulang ber-ref ini yang masih ada di satu lokasi sejak entrinya sendiri. */
export async function bacaSisaSejakEntri(
  tx: Tx,
  a: { lokasi: { jenis: "MAIN" | "STORE" | "VAN"; lokasiId: string }; refType: string; refId: string; itemId: string; variantSku: string | null },
): Promise<number> {
  const di = await entriLokasi(tx, a.lokasi, a.itemId, a.variantSku);
  const sesudah = sesudahRef(di, a.refType, a.refId);
  return sesudah ? sisaLapisan(sesudah) : 0;
}
