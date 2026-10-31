import { prisma, type Prisma } from "@elorae/db";
import { SUMBER_VOUCHER_KAS, STATUS_VOUCHER } from "@/lib/finance/kas/aturan";
import { SUMBER_PEMBAYARAN_PEMASOK, STATUS_PEMBAYARAN } from "@/lib/purchasing/pembayaran-aturan";

/*
 * Jurnal yang TIDAK boleh dicocokkan dengan mutasi bank (uji akuntansi
 * gelombang 2, R3) — KHUSUS SERVER. Membatalkan voucher atau pembayaran
 * meninggalkan jurnal aslinya BERLAKU dan menambah jurnal pembaliknya;
 * pasangan itu bernilai nol di rekening, jadi uang itu tidak pernah lewat
 * bank. Mencocokkan mutasi ke salah satunya menyembunyikan mutasi sungguhan
 * yang belum tercatat.
 *
 * Dianggap batal:
 * - jurnal pembalik (`reversalOfId` terisi) dan jurnal yang punya pembalik
 *   BERLAKU — voucher kas, pembayaran pemasok dokumen, setoran pajak, jurnal
 *   manual yang dibalik, akrual berulang;
 * - pasangan sumber yang membalik dengan sourceId yang sama tanpa
 *   `reversalOfId` (`PASANGAN_BALIK`: tandai lunas PO, pembayaran termin KOL);
 * - jurnal voucher kas / pembayaran pemasok yang dokumennya berstatus batal
 *   (pengaman bila pembaliknya tidak ada).
 */

/** sourceType → sourceType pembaliknya (sourceId sama, tanpa `reversalOfId`). */
export const PASANGAN_BALIK: Readonly<Record<string, string>> = {
  SUPPLIER_PAYMENT: "SUPPLIER_PAYMENT_REVERSAL",
  KOL_PAYMENT: "KOL_PAYMENT_REVERSAL",
};

type Klien = Prisma.TransactionClient | typeof prisma;
type JurnalCek = { id: string; sourceType: string | null; sourceId: string | null; reversalOfId: string | null };

/** Id jurnal (dari `jurnal`) yang termasuk pasangan batal. */
export async function jurnalTerbatalkan(klien: Klien, jurnal: readonly JurnalCek[]): Promise<Set<string>> {
  const hasil = new Set<string>();
  if (jurnal.length === 0) return hasil;
  for (const j of jurnal) if (j.reversalOfId) hasil.add(j.id);

  const ids = jurnal.map((j) => j.id);
  const dibalik = await klien.journal.findMany({
    where: { reversalOfId: { in: ids }, status: "POSTED" },
    select: { reversalOfId: true },
  });
  for (const b of dibalik) if (b.reversalOfId) hasil.add(b.reversalOfId);

  // Pasangan sumber tanpa reversalOfId: asli dan pembaliknya sama-sama keluar.
  const balikKeAsli = new Map(Object.entries(PASANGAN_BALIK).map(([asli, balik]) => [balik, asli]));
  const cari = new Map<string, Set<string>>();
  for (const j of jurnal) {
    if (!j.sourceType || !j.sourceId) continue;
    const lawan = PASANGAN_BALIK[j.sourceType] ?? balikKeAsli.get(j.sourceType);
    if (!lawan) continue;
    const s = cari.get(lawan) ?? new Set<string>();
    s.add(j.sourceId);
    cari.set(lawan, s);
  }
  if (cari.size > 0) {
    const lawan = await klien.journal.findMany({
      where: { status: "POSTED", OR: [...cari.entries()].map(([sourceType, s]) => ({ sourceType, sourceId: { in: [...s] } })) },
      select: { sourceType: true, sourceId: true },
    });
    const ada = new Set(lawan.map((l) => `${l.sourceType}|${l.sourceId}`));
    for (const j of jurnal) {
      if (!j.sourceType || !j.sourceId) continue;
      const t = PASANGAN_BALIK[j.sourceType] ?? balikKeAsli.get(j.sourceType);
      if (t && ada.has(`${t}|${j.sourceId}`)) hasil.add(j.id);
    }
  }

  // Dokumen yang batal walau pembaliknya tidak ada.
  const voucherIds = jurnal.filter((j) => j.sourceType === SUMBER_VOUCHER_KAS && j.sourceId).map((j) => j.sourceId!);
  const bayarIds = jurnal.filter((j) => j.sourceType === SUMBER_PEMBAYARAN_PEMASOK && j.sourceId).map((j) => j.sourceId!);
  const [voucherBatal, bayarBatal] = await Promise.all([
    voucherIds.length
      ? klien.cashVoucher.findMany({ where: { id: { in: voucherIds }, status: STATUS_VOUCHER.BATAL }, select: { id: true } })
      : Promise.resolve([]),
    bayarIds.length
      ? klien.supplierPayment.findMany({ where: { id: { in: bayarIds }, status: STATUS_PEMBAYARAN.BATAL }, select: { id: true } })
      : Promise.resolve([]),
  ]);
  const dokBatal = new Set([...voucherBatal.map((v) => `${SUMBER_VOUCHER_KAS}|${v.id}`), ...bayarBatal.map((b) => `${SUMBER_PEMBAYARAN_PEMASOK}|${b.id}`)]);
  for (const j of jurnal) if (dokBatal.has(`${j.sourceType}|${j.sourceId}`)) hasil.add(j.id);
  return hasil;
}

/** Pilihan `journal` untuk `jurnalTerbatalkan`. */
export const PILIH_JURNAL_CEK = { id: true, sourceType: true, sourceId: true, reversalOfId: true } as const;
