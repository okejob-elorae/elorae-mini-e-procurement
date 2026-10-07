'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@elorae/db';
import type { DocNumberConfig, DocType } from '@elorae/db';
import { hasPermission, PERMISSIONS } from '@/lib/rbac';
import { auth } from '@/lib/auth';
import { getActorName, notifyDocNumberAltered } from '@/app/actions/notifications';
import { periksaIsianNomor, type GalatIsianNomor } from '@/app/backoffice/settings/documents/jenis-dokumen';

export type DocNumberConfigRow = {
  /** Kosong bila barisnya belum tersimpan — layar menampilkan bawaan generator. */
  id: string;
  docType: DocType;
  prefix: string;
  resetPeriod: string;
  padding: number;
  lastNumber: number;
  year: number;
  month: number;
};

const DEFAULT_CONFIGS: Record<
  DocType,
  { prefix: string; resetPeriod: 'YEARLY' | 'MONTHLY'; padding: number }
> = {
  PO: { prefix: 'PO/', resetPeriod: 'YEARLY', padding: 4 },
  GRN: { prefix: 'GRN/', resetPeriod: 'MONTHLY', padding: 4 },
  WO: { prefix: 'WO/', resetPeriod: 'YEARLY', padding: 4 },
  ADJ: { prefix: 'ADJ/', resetPeriod: 'MONTHLY', padding: 4 },
  RET: { prefix: 'RET/', resetPeriod: 'MONTHLY', padding: 4 },
  ISSUE: { prefix: 'ISS/', resetPeriod: 'MONTHLY', padding: 4 },
  RECEIPT: { prefix: 'RCPT/', resetPeriod: 'MONTHLY', padding: 4 },
  OPN: { prefix: 'OPN/', resetPeriod: 'MONTHLY', padding: 4 },
  PUTUS: { prefix: 'PUTUS/', resetPeriod: 'YEARLY', padding: 4 },
  KONSI: { prefix: 'KONSI/', resetPeriod: 'YEARLY', padding: 4 },
  VANLOAD: { prefix: 'VLOAD/', resetPeriod: 'YEARLY', padding: 4 },
  VANSALE: { prefix: 'VSALE/', resetPeriod: 'YEARLY', padding: 4 },
  VANRECON: { prefix: 'VRCN/', resetPeriod: 'YEARLY', padding: 4 },
  SPGSALE: { prefix: 'SPG/', resetPeriod: 'YEARLY', padding: 4 },
  DELIVERY: { prefix: 'DLV/', resetPeriod: 'MONTHLY', padding: 4 },
};

const PERIODE_SAH = ['YEARLY', 'MONTHLY', 'NEVER'] as const;

/**
 * Konfigurasi SEMUA jenis dokumen. Jenis yang barisnya belum ada (generator
 * membuatnya saat nomor pertama dibagikan) ditampilkan dengan bawaan generator
 * dan `id` kosong, supaya bisa diatur sebelum dokumen pertamanya dibuat.
 */
export async function getDocNumberConfigs(): Promise<DocNumberConfigRow[]> {
  const session = await auth();
  if (!session?.user?.id) throw new Error('Unauthorized');
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.SETTINGS_DOCUMENTS_VIEW)) {
    throw new Error('Forbidden');
  }
  const configs = await prisma.docNumberConfig.findMany({
    orderBy: { docType: 'asc' },
  });
  const now = new Date();
  const ada = new Set(configs.map((c) => c.docType));
  const baris: DocNumberConfigRow[] = configs.map((c: DocNumberConfig) => ({
    id: c.id,
    docType: c.docType,
    prefix: c.prefix,
    resetPeriod: c.resetPeriod,
    padding: c.padding,
    lastNumber: c.lastNumber,
    year: c.year,
    month: c.month,
  }));
  for (const [docType, def] of Object.entries(DEFAULT_CONFIGS) as [DocType, (typeof DEFAULT_CONFIGS)[DocType]][]) {
    if (ada.has(docType)) continue;
    baris.push({
      id: '',
      docType,
      prefix: def.prefix,
      resetPeriod: def.resetPeriod,
      padding: def.padding,
      lastNumber: 0,
      year: now.getFullYear(),
      month: now.getMonth() + 1,
    });
  }
  return baris;
}

export type IsianNomorDokumen = {
  docType: DocType;
  prefix: string;
  resetPeriod: 'YEARLY' | 'MONTHLY' | 'NEVER';
  padding: number;
};

export type HasilSimpanNomor =
  | { ok: true; diubah: number }
  | { ok: false; code: 'UNAUTHORIZED' | 'FORBIDDEN' | 'JENIS_TIDAK_DIKENAL' | 'PERIODE_TIDAK_SAH' | GalatIsianNomor; docType?: DocType };

/**
 * Simpan beberapa baris sekaligus (satu tombol Simpan di layar). Semua baris
 * diperiksa dulu; satu yang salah membatalkan semuanya, jadi tidak ada simpan
 * setengah jalan. Penghitung (`lastNumber`) tidak disentuh.
 */
export async function simpanNomorDokumenAction(isian: IsianNomorDokumen[]): Promise<HasilSimpanNomor> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, code: 'UNAUTHORIZED' };
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.SETTINGS_DOCUMENTS_MANAGE)) {
    return { ok: false, code: 'FORBIDDEN' };
  }
  if (!Array.isArray(isian)) return { ok: false, code: 'JENIS_TIDAK_DIKENAL' };
  for (const b of isian) {
    if (!b || typeof b.docType !== 'string' || !Object.prototype.hasOwnProperty.call(DEFAULT_CONFIGS, b.docType)) {
      return { ok: false, code: 'JENIS_TIDAK_DIKENAL' };
    }
    if (!(PERIODE_SAH as readonly string[]).includes(b.resetPeriod)) {
      return { ok: false, code: 'PERIODE_TIDAK_SAH', docType: b.docType };
    }
    const galat = periksaIsianNomor({ prefix: typeof b.prefix === 'string' ? b.prefix : '', padding: b.padding });
    if (galat) return { ok: false, code: galat, docType: b.docType };
  }
  if (isian.length === 0) return { ok: true, diubah: 0 };

  const now = new Date();
  await prisma.$transaction(
    isian.map((b) =>
      prisma.docNumberConfig.upsert({
        where: { docType: b.docType },
        create: {
          docType: b.docType,
          prefix: b.prefix.trim(),
          resetPeriod: b.resetPeriod,
          // Sudah diperiksa periksaIsianNomor (angka bulat 1–8); "4" dari pemanggil lain jadi 4.
          padding: Number(b.padding),
          lastNumber: 0,
          year: now.getFullYear(),
          month: now.getMonth() + 1,
        },
        update: {
          prefix: b.prefix.trim(),
          resetPeriod: b.resetPeriod,
          padding: Number(b.padding),
        },
      }),
    ),
  );

  const userId = session.user.id;
  getActorName(userId)
    .then((triggeredByName) =>
      Promise.all(isian.map((b) => notifyDocNumberAltered(b.docType, triggeredByName))),
    )
    .catch(() => {});

  revalidatePath('/backoffice/settings/documents');
  return { ok: true, diubah: isian.length };
}
