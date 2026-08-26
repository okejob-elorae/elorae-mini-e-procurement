import { prisma } from '@elorae/db';
import { runSerializable } from '@/lib/db/tx-retry';
import { catatJejak, JEJAK } from './jejak';

/**
 * Master jenis potongan.
 *
 * Sebelum ini nama potongan diketik bebas di setiap BKM, jadi "Retur barang"
 * dan "retur brg" jadi dua hal berbeda — dan laporan apa pun di atas potongan
 * pecah tanpa ada yang menyadarinya.
 *
 * Yang dibawa jenisnya bukan cuma nama: `DARI_RETUR` menuntut potongan itu
 * ditautkan ke nota retur, dan tautan itulah yang membuat Aturan 2 bekerja.
 * Sebelumnya penautan sepenuhnya tergantung ingatan orang yang mengetik.
 */

export type CaraPotongan = 'NOMINAL' | 'PERSEN' | 'DARI_RETUR';

export type BarisJenisPotongan = {
  id: string;
  nama: string;
  cara: CaraPotongan;
  bolehManual: boolean;
  hanyaPkp: boolean;
  wajibCatatan: boolean;
  aktif: boolean;
  /** Berapa kali jenis ini sudah dipakai — penentu boleh dihapus atau tidak. */
  jumlahDipakai: number;
};

export async function daftarJenisPotongan(): Promise<BarisJenisPotongan[]> {
  const rows = await prisma.deductionType.findMany({
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      method: true,
      allowManual: true,
      pkpOnly: true,
      noteRequired: true,
      isActive: true,
      _count: { select: { deductions: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    nama: r.name,
    cara: r.method as CaraPotongan,
    bolehManual: r.allowManual,
    hanyaPkp: r.pkpOnly,
    wajibCatatan: r.noteRequired,
    aktif: r.isActive,
    jumlahDipakai: r._count.deductions,
  }));
}

/** Jenis yang boleh dipilih saat membuat BKM. */
export async function jenisPotonganAktif(): Promise<
  { id: string; nama: string; cara: CaraPotongan; wajibCatatan: boolean }[]
> {
  const rows = await prisma.deductionType.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, method: true, noteRequired: true },
  });
  return rows.map((r) => ({
    id: r.id,
    nama: r.name,
    cara: r.method as CaraPotongan,
    wajibCatatan: r.noteRequired,
  }));
}

export type AlasanGagalJenis = 'NAMA_WAJIB' | 'NAMA_SUDAH_ADA' | 'TIDAK_DITEMUKAN' | 'SEDANG_DIPAKAI';

export async function simpanJenisPotongan(input: {
  id?: string | null;
  nama: string;
  cara: CaraPotongan;
  bolehManual: boolean;
  hanyaPkp: boolean;
  wajibCatatan: boolean;
  aktif: boolean;
  olehUserId: string;
}): Promise<{ ok: true; id: string } | { ok: false; alasan: AlasanGagalJenis }> {
  const nama = input.nama?.trim();
  if (!nama) return { ok: false, alasan: 'NAMA_WAJIB' };

  return runSerializable(async (tx) => {
    const kembar = await tx.deductionType.findFirst({
      where: { name: nama, ...(input.id ? { NOT: { id: input.id } } : {}) },
      select: { id: true },
    });
    if (kembar) return { ok: false as const, alasan: 'NAMA_SUDAH_ADA' as const };

    const data = {
      name: nama,
      method: input.cara,
      allowManual: input.bolehManual,
      pkpOnly: input.hanyaPkp,
      noteRequired: input.wajibCatatan,
      isActive: input.aktif,
    };

    if (input.id) {
      const lama = await tx.deductionType.findUnique({
        where: { id: input.id },
        select: { name: true, method: true, isActive: true },
      });
      if (!lama) return { ok: false as const, alasan: 'TIDAK_DITEMUKAN' as const };

      await tx.deductionType.update({ where: { id: input.id }, data });
      await catatJejak(tx, {
        userId: input.olehUserId,
        action: JEJAK.JENIS_POTONGAN_DIUBAH,
        entityType: 'DeductionType',
        entityId: input.id,
        changes: { before: lama, after: data },
      });
      return { ok: true as const, id: input.id };
    }

    const baru = await tx.deductionType.create({ data, select: { id: true } });
    await catatJejak(tx, {
      userId: input.olehUserId,
      action: JEJAK.JENIS_POTONGAN_DIBUAT,
      entityType: 'DeductionType',
      entityId: baru.id,
      changes: { after: data },
    });
    return { ok: true as const, id: baru.id };
  });
}

/**
 * Nonaktifkan jenis potongan.
 *
 * Tidak menghapus. Jenis yang sudah pernah dipakai menempel pada BKM lama, dan
 * menghapusnya membuat potongan bersejarah kehilangan namanya — laporan lama
 * berubah setelah ditutup. Yang tidak dipakai lagi cukup disembunyikan dari
 * daftar pilihan.
 */
export async function nonaktifkanJenisPotongan(input: {
  id: string;
  olehUserId: string;
}): Promise<{ ok: true } | { ok: false; alasan: AlasanGagalJenis }> {
  return runSerializable(async (tx) => {
    const jenis = await tx.deductionType.findUnique({
      where: { id: input.id },
      select: { id: true, name: true, isActive: true },
    });
    if (!jenis) return { ok: false as const, alasan: 'TIDAK_DITEMUKAN' as const };

    await tx.deductionType.update({ where: { id: jenis.id }, data: { isActive: false } });
    await catatJejak(tx, {
      userId: input.olehUserId,
      action: JEJAK.JENIS_POTONGAN_DIUBAH,
      entityType: 'DeductionType',
      entityId: jenis.id,
      changes: { before: { isActive: jenis.isActive }, after: { isActive: false } },
      metadata: { name: jenis.name },
    });
    return { ok: true as const };
  });
}
