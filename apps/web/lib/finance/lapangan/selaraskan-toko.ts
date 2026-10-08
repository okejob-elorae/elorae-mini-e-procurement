import { prisma } from "@elorae/db";
import { SUMBER_LAPANGAN, type SumberLapangan } from "./aturan";
import { cariKlaimTanpaJurnal, cariNotaTanpaJurnal, cariReturTanpaJurnal, cariTukarTanpaJurnal } from "./sapuan";
import { postingJurnalLapanganAman, type KodeGagalPosting } from "./tertunda";

/*
 * Penyelarasan massal untuk layar Rekonsiliasi piutang — KHUSUS SERVER.
 * Setiap dokumen lewat pintu yang sama dengan kait pasca-commit
 * (`postingJurnalLapanganAman`): idempoten, tidak pernah melempar, kegagalan
 * menjadi JOURNAL_PENDING.
 */

export type HasilMassal = {
  diperiksa: number;
  berubah: number;
  gagal: { sumber: SumberLapangan; id: string; kode: KodeGagalPosting }[];
};

const BUKAN_GAGAL = new Set<KodeGagalPosting>(["NOTHING_TO_POST", "BELUM_BERLAKU", "GL_CUTOVER_NOT_CONFIGURED"]);

async function jalankan(daftar: { sumber: SumberLapangan; id: string }[], userId: string): Promise<HasilMassal> {
  const hasil: HasilMassal = { diperiksa: 0, berubah: 0, gagal: [] };
  for (const d of daftar) {
    hasil.diperiksa += 1;
    const r = await postingJurnalLapanganAman(d.sumber, d.id, userId);
    if (r.ok) {
      if (r.created) hasil.berubah += 1;
    } else if (!BUKAN_GAGAL.has(r.code)) {
      hasil.gagal.push({ sumber: d.sumber, id: d.id, kode: r.code });
    }
  }
  return hasil;
}

/**
 * Semua dokumen lapangan satu toko: nota, BKM (semua status — yang batal
 * sesudah terverifikasi ikut dibalik), hitungan gudang, tukar barang.
 */
export async function selaraskanJurnalToko(storeId: string, userId: string): Promise<HasilMassal> {
  const [nota, bkm, nri, tukar] = await Promise.all([
    prisma.fieldSalesDelivery.findMany({ where: { order: { storeId, orderType: "PUTUS" } }, select: { id: true }, orderBy: { invoiceDate: "asc" } }),
    prisma.paymentClaim.findMany({ where: { storeId }, select: { id: true }, orderBy: { createdAt: "asc" } }),
    prisma.warehouseReturn.findMany({
      where: { status: "FINAL", OR: [{ storeId }, { storeReturn: { storeId } }] },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.storeExchange.findMany({ where: { storeId, status: "SELESAI" }, select: { id: true }, orderBy: { createdAt: "asc" } }),
  ]);
  return jalankan(
    [
      ...nota.map((d) => ({ sumber: SUMBER_LAPANGAN.NOTA, id: d.id })),
      ...bkm.map((d) => ({ sumber: SUMBER_LAPANGAN.BKM, id: d.id })),
      ...nri.map((d) => ({ sumber: SUMBER_LAPANGAN.RETUR, id: d.id })),
      ...tukar.map((d) => ({ sumber: SUMBER_LAPANGAN.TUKAR, id: d.id })),
    ],
    userId,
  );
}

export type DokumenTanpaJurnalLapangan = { sumber: SumberLapangan; id: string; tanggal: string; label: string };

/** Dokumen lapangan tanpa jurnal sejak tanggal mulai buku besar, `batas` per jenis. */
export async function dokumenLapanganTanpaJurnal(batas: number, sampai = new Date()): Promise<DokumenTanpaJurnalLapangan[]> {
  const opsi = { sejak: new Date(0), sampai, batas };
  const [nota, bkm, retur, tukar] = await Promise.all([
    cariNotaTanpaJurnal(opsi),
    cariKlaimTanpaJurnal(opsi),
    cariReturTanpaJurnal(opsi),
    cariTukarTanpaJurnal(opsi),
  ]);
  const ubah = (sumber: SumberLapangan) => (d: { id: string; tanggal: Date; label: string }) => ({ sumber, id: d.id, tanggal: d.tanggal.toISOString(), label: d.label });
  return [
    ...nota.map(ubah(SUMBER_LAPANGAN.NOTA)),
    ...bkm.map(ubah(SUMBER_LAPANGAN.BKM)),
    ...retur.map(ubah(SUMBER_LAPANGAN.RETUR)),
    ...tukar.map(ubah(SUMBER_LAPANGAN.TUKAR)),
  ];
}

/** Posting setiap dokumen tanpa jurnal (dibatasi `batas` per jenis). */
export async function postingSemuaTanpaJurnal(userId: string, batas = 100): Promise<HasilMassal> {
  const daftar = await dokumenLapanganTanpaJurnal(batas);
  return jalankan(daftar, userId);
}
