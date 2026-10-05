'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@elorae/db';
import { auth } from '@/lib/auth';
import { runSerializable } from "@/lib/db/tx-retry";
import { hasPermission, PERMISSIONS } from '@/lib/rbac';
import { KUNCI_BATAS_HARI, KUNCI_TARGET, KUNCI_TOKO_TERKUNCI, tulisTargetBulan } from '@/lib/salesman/pengaturan';
import { bacaAturanKredit, KUNCI_ATURAN_KREDIT, MODE_KREDIT, type AturanKredit, type ModeKredit } from '@/lib/salesman/kredit';
import { bacaHariKerjaSpg, KUNCI_HARI_KERJA_SPG, periksaHariKerjaSpg } from "@/lib/salesman/izin";

/**
 * Pengaturan dasbor salesman: batas hari kunjungan dan target bulanan.
 *
 * Dijaga `field_sales_orders:approve` — orang yang menyetujui pesanan salesman
 * adalah orang yang menetapkan targetnya. Izin itu sudah ada di prod, jadi
 * tidak ada yang perlu di-seed. Hasilnya dikembalikan sebagai kode, bukan
 * dilempar, supaya pesan galat tidak disamarkan Next di produksi.
 */

type Hasil = { ok: true } | { ok: false; code: 'UNAUTHORIZED' | 'FORBIDDEN' | 'INVALID' };

async function bolehUbah(): Promise<Hasil | null> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, code: 'UNAUTHORIZED' };
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.FIELD_SALES_ORDERS_APPROVE)) {
    return { ok: false, code: 'FORBIDDEN' };
  }
  return null;
}

const segarkan = () => {
  revalidatePath('/backoffice/settings/salesman');
  revalidatePath('/pwa');
};

/** `null` menghapus pengaturan — dasbor kembali memakai bawaan dan menyebut "belum diatur". */
export async function simpanBatasHariKunjungan(hari: number | null): Promise<Hasil> {
  const tolak = await bolehUbah();
  if (tolak) return tolak;
  if (hari === null) {
    await prisma.systemSetting.deleteMany({ where: { key: KUNCI_BATAS_HARI } });
    segarkan();
    return { ok: true };
  }
  if (!Number.isInteger(hari) || hari < 1 || hari > 365) return { ok: false, code: 'INVALID' };
  await prisma.systemSetting.upsert({
    where: { key: KUNCI_BATAS_HARI },
    create: { key: KUNCI_BATAS_HARI, value: String(hari) },
    update: { value: String(hari) },
  });
  segarkan();
  return { ok: true };
}

/**
 * Simpan target satu bulan untuk beberapa salesman sekaligus. Salesman yang
 * tidak disebut tidak tersentuh; `null` atau 0 menghapus targetnya.
 */
export async function simpanTargetBulan(bulan: string, isi: Record<string, number | null>): Promise<Hasil> {
  const tolak = await bolehUbah();
  if (tolak) return tolak;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(bulan)) return { ok: false, code: 'INVALID' };
  for (const v of Object.values(isi)) {
    if (v !== null && (!Number.isFinite(v) || v < 0 || v > 1e13)) return { ok: false, code: 'INVALID' };
  }
  const dikenal = await prisma.user.count({ where: { id: { in: Object.keys(isi) } } });
  if (dikenal !== Object.keys(isi).length) return { ok: false, code: 'INVALID' };

  if (Object.keys(isi).length === 0) return { ok: true };
  // Semua target hidup di SATU baris JSON: baca-ubah-tulis harus satu transaksi
  // serializable, atau dua admin yang menyimpan bersamaan saling menimpa
  // (target salesman lain hilang diam-diam). Yang kalah diulang dengan JSON terbaru.
  await runSerializable(async (tx) => {
    const sekarang = await tx.systemSetting.findUnique({ where: { key: KUNCI_TARGET }, select: { value: true } });
    let nilai = sekarang?.value ?? "{}";
    for (const [userId, jumlah] of Object.entries(isi)) nilai = tulisTargetBulan(nilai, userId, bulan, jumlah);
    await tx.systemSetting.upsert({
      where: { key: KUNCI_TARGET },
      create: { key: KUNCI_TARGET, value: nilai },
      update: { value: nilai },
    });
  });
  segarkan();
  return { ok: true };
}

/**
 * Nyalakan atau matikan kunci "hanya toko sendiri". Saat menyala, sales hanya
 * melihat dan check-in di toko yang ia pegang. Mematikan menghapus barisnya —
 * bawaan yang aman adalah mati.
 */
export async function simpanKunciToko(nyala: boolean): Promise<Hasil> {
  const tolak = await bolehUbah();
  if (tolak) return tolak;
  if (typeof nyala !== 'boolean') return { ok: false, code: 'INVALID' };
  if (nyala) {
    await prisma.systemSetting.upsert({
      where: { key: KUNCI_TOKO_TERKUNCI },
      create: { key: KUNCI_TOKO_TERKUNCI, value: '1' },
      update: { value: '1' },
    });
  } else {
    await prisma.systemSetting.deleteMany({ where: { key: KUNCI_TOKO_TERKUNCI } });
  }
  segarkan();
  revalidatePath('/pwa/stores');
  return { ok: true };
}

const bulatSah = (x: unknown, maks: number): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= maks;

/**
 * Aturan kredit toko PUTUS (mode, batas bawaan, toleransi hari). Disimpan
 * sebagai JSON di `salesman.kredit` dan dibaca lewat `bacaAturanKredit` — nilai
 * yang disimpan harus terbaca kembali persis sama, supaya layar ini tidak
 * pernah menampilkan aturan yang berbeda dari yang dipakai server saat pesanan dibuat.
 */
export async function simpanAturanKredit(isi: {
  mode: ModeKredit;
  batasNilai: number | null;
  batasFaktur: number | null;
  hariToleransi: number;
}): Promise<Hasil> {
  const tolak = await bolehUbah();
  if (tolak) return tolak;
  if (!isi || typeof isi !== 'object' || !MODE_KREDIT.includes(isi.mode)) return { ok: false, code: 'INVALID' };
  if (isi.batasNilai !== null && !bulatSah(isi.batasNilai, 9_999_999_999_999)) return { ok: false, code: 'INVALID' };
  if (isi.batasFaktur !== null && !bulatSah(isi.batasFaktur, 100_000)) return { ok: false, code: 'INVALID' };
  if (!bulatSah(isi.hariToleransi, 365)) return { ok: false, code: 'INVALID' };

  const aturan: AturanKredit = {
    mode: isi.mode,
    batasNilai: isi.batasNilai,
    batasFaktur: isi.batasFaktur,
    hariToleransi: isi.hariToleransi,
  };
  const nilai = JSON.stringify(aturan);
  if (JSON.stringify(bacaAturanKredit(nilai)) !== nilai) return { ok: false, code: 'INVALID' };

  await prisma.systemSetting.upsert({
    where: { key: KUNCI_ATURAN_KREDIT },
    create: { key: KUNCI_ATURAN_KREDIT, value: nilai },
    update: { value: nilai },
  });
  segarkan();
  revalidatePath('/backoffice/field-sales-orders');
  return { ok: true };
}

/**
 * Hari kerja SPG (`spg.hariKerja`) — kunci sendiri, bukan kolom di
 * `salesman.absensi` (lihat `KUNCI_HARI_KERJA_SPG`). Hitungan izin/cuti SPG
 * memakai ini; salesman tetap Senin–Sabtu.
 */
export async function simpanHariKerjaSpg(isi: unknown): Promise<Hasil> {
  const tolak = await bolehUbah();
  if (tolak) return tolak;
  const p = periksaHariKerjaSpg(isi);
  if (!p) return { ok: false, code: "INVALID" };
  const nilai = JSON.stringify(p);
  if (JSON.stringify({ hariKerja: bacaHariKerjaSpg(nilai) }) !== nilai) return { ok: false, code: "INVALID" };
  await prisma.systemSetting.upsert({
    where: { key: KUNCI_HARI_KERJA_SPG },
    create: { key: KUNCI_HARI_KERJA_SPG, value: nilai },
    update: { value: nilai },
  });
  segarkan();
  revalidatePath("/pwa/absen");
  revalidatePath("/backoffice/izin");
  revalidatePath("/backoffice/absensi");
  return { ok: true };
}
