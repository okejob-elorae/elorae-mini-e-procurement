"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@elorae/db";
import type { DocNumberConfig, DocType } from "@elorae/db";
import { hasPermission, requirePermission, PERMISSIONS } from "@/lib/rbac";
import { auth } from "@/lib/auth";
import { notifyDocNumberAltered } from "@/lib/notifications/events";
import { getActorName } from "@/lib/notifications/actor-name";
import {
  findPrefixConflict,
  validateDocNumberConfigInput,
  type DocNumberConfigErrorCode,
} from "@/lib/doc-numbers/validate";
import { docNumberPeriod } from "@/lib/doc-numbers/period";
import { DOC_TYPE_GROUP, type DocTypeGroup } from "@/lib/doc-numbers/doc-type-groups";
import { periksaIsianNomor, type GalatIsianNomor } from "@/app/backoffice/settings/documents/jenis-dokumen";

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
  { prefix: string; resetPeriod: "YEARLY" | "MONTHLY"; padding: number }
> = {
  PO: { prefix: "PO/", resetPeriod: "YEARLY", padding: 4 },
  GRN: { prefix: "GRN/", resetPeriod: "MONTHLY", padding: 4 },
  WO: { prefix: "WO/", resetPeriod: "YEARLY", padding: 4 },
  ADJ: { prefix: "ADJ/", resetPeriod: "MONTHLY", padding: 4 },
  RET: { prefix: "RET/", resetPeriod: "MONTHLY", padding: 4 },
  ISSUE: { prefix: "ISS/", resetPeriod: "MONTHLY", padding: 4 },
  RECEIPT: { prefix: "RCPT/", resetPeriod: "MONTHLY", padding: 4 },
  OPN: { prefix: "OPN/", resetPeriod: "MONTHLY", padding: 4 },
  PUTUS: { prefix: "PUTUS/", resetPeriod: "YEARLY", padding: 4 },
  KONSI: { prefix: "KONSI/", resetPeriod: "YEARLY", padding: 4 },
  VANLOAD: { prefix: "VLOAD/", resetPeriod: "YEARLY", padding: 4 },
  VANSALE: { prefix: "VSALE/", resetPeriod: "YEARLY", padding: 4 },
  VANRECON: { prefix: "VRCN/", resetPeriod: "YEARLY", padding: 4 },
  SPGSALE: { prefix: "SPG/", resetPeriod: "YEARLY", padding: 4 },
  DELIVERY: { prefix: "DLV/", resetPeriod: "MONTHLY", padding: 4 },
  FIELDRET: { prefix: "FRET/", resetPeriod: "MONTHLY", padding: 4 },
  KONSITRF: { prefix: "KTRF/", resetPeriod: "YEARLY", padding: 4 },
  STOCKTAKE: { prefix: "STK/", resetPeriod: "MONTHLY", padding: 4 },
  PAYMENT: { prefix: "KWT/", resetPeriod: "MONTHLY", padding: 4 },
  BKM: { prefix: "BKM/", resetPeriod: "YEARLY", padding: 4 },
  STORETRF: { prefix: "STRF/", resetPeriod: "YEARLY", padding: 4 },
  SELLTHRU: { prefix: "SLT/", resetPeriod: "YEARLY", padding: 4 },
  ITEMREQ: { prefix: "REQ/", resetPeriod: "MONTHLY", padding: 4 },
  VENDOR_BILL: { prefix: "BILL/", resetPeriod: "MONTHLY", padding: 4 },
  VENDOR_PAYMENT: { prefix: "VPAY/", resetPeriod: "MONTHLY", padding: 4 },
  CASHOUT: { prefix: "BKK/", resetPeriod: "MONTHLY", padding: 4 },
  CASHIN: { prefix: "BKMK/", resetPeriod: "MONTHLY", padding: 4 },
  CASHTRF: { prefix: "TRF/", resetPeriod: "MONTHLY", padding: 4 },
  SUPPAY: { prefix: "BYR/", resetPeriod: "MONTHLY", padding: 4 },
  ASSET: { prefix: "AT/", resetPeriod: "YEARLY", padding: 4 },
};

const PERIODE_SAH = ["YEARLY", "MONTHLY", "NEVER"] as const;

/* Compile-time pin: a Prisma `DocType` member missing from the settings grouping is a type error here. */
const DOC_TYPE_GROUP_COVERS_PRISMA: Record<DocType, DocTypeGroup> = DOC_TYPE_GROUP;
void DOC_TYPE_GROUP_COVERS_PRISMA;

export async function getDocNumberConfigs(): Promise<DocNumberConfigRow[]> {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");
  requirePermission(session.user.permissions, PERMISSIONS.SETTINGS_DOCUMENTS_VIEW);

  let configs = await prisma.docNumberConfig.findMany({ orderBy: { docType: "asc" } });
  /**
   * Seed every missing doc type, not just an empty table: a type that has never issued a number
   * has no row, and the editor would otherwise show it with a blank prefix and the wrong reset
   * period. The seeder inserts with `skipDuplicates`, so existing counters are never touched.
   */
  if (configs.length < Object.keys(DEFAULT_CONFIGS).length) {
    await seedDocNumberConfigs();
    configs = await prisma.docNumberConfig.findMany({ orderBy: { docType: "asc" } });
  }
  return configs.map((c: DocNumberConfig) => ({
    id: c.id,
    docType: c.docType,
    prefix: c.prefix,
    resetPeriod: c.resetPeriod,
    padding: c.padding,
    lastNumber: c.lastNumber,
    year: c.year,
    month: c.month,
  }));
}

/**
 * One `INSERT IGNORE`, not an upsert per type: Prisma's upsert on MariaDB is find-then-create, so
 * a `generateDocNumber` creating the same row in between would fail the page load on P2002.
 */
async function seedDocNumberConfigs() {
  const { year, month } = docNumberPeriod(new Date());
  await prisma.docNumberConfig.createMany({
    data: (Object.keys(DEFAULT_CONFIGS) as DocType[]).map((docType) => ({
      docType,
      prefix: DEFAULT_CONFIGS[docType].prefix,
      resetPeriod: DEFAULT_CONFIGS[docType].resetPeriod,
      padding: DEFAULT_CONFIGS[docType].padding,
      lastNumber: 0,
      year,
      month,
    })),
    skipDuplicates: true,
  });
}

export type UpdateDocNumberConfigResult =
  | { ok: true }
  | { ok: false; code: DocNumberConfigErrorCode }
  | { ok: false; code: "DUPLICATE_PREFIX"; conflictsWith: DocType };

export async function updateDocNumberConfig(
  docType: string,
  config: { prefix: string; resetPeriod: string; padding: number }
): Promise<UpdateDocNumberConfigResult> {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");
  requirePermission(session.user.permissions, PERMISSIONS.SETTINGS_DOCUMENTS_MANAGE);

  const parsed = validateDocNumberConfigInput({ docType, ...config });
  if (!parsed.ok) return parsed;
  const { prefix, resetPeriod, padding } = parsed.value;
  const type = parsed.value.docType as DocType;

  /**
   * A type with no row yet is checked at its default prefix, which `generateDocNumber` creates it
   * with on first use. Read-then-write outside a transaction: two admins saving the same prefix
   * at the same instant can both pass, accepted for an admin-only settings screen.
   */
  const storedRows = await prisma.docNumberConfig.findMany({ select: { docType: true, prefix: true } });
  const storedPrefix = new Map(storedRows.map((row) => [row.docType, row.prefix] as const));
  const prefixRows = (Object.keys(DEFAULT_CONFIGS) as DocType[]).map((rowType) => ({
    docType: rowType,
    prefix: storedPrefix.get(rowType) ?? DEFAULT_CONFIGS[rowType].prefix,
  }));
  const conflictsWith = findPrefixConflict(type, prefix, prefixRows);
  if (conflictsWith) return { ok: false, code: "DUPLICATE_PREFIX", conflictsWith };

  await prisma.docNumberConfig.upsert({
    where: { docType: type },
    create: {
      docType: type,
      prefix,
      resetPeriod,
      padding,
      lastNumber: 0,
      ...docNumberPeriod(new Date()),
    },
    update: { prefix, resetPeriod, padding },
  });

  getActorName(session.user.id)
    .then((triggeredByName) => notifyDocNumberAltered(type, triggeredByName))
    .catch(() => {});

  revalidatePath("/backoffice/settings/documents");
  return { ok: true };
}

export type IsianNomorDokumen = {
  docType: DocType;
  prefix: string;
  resetPeriod: "YEARLY" | "MONTHLY" | "NEVER";
  padding: number;
};

export type HasilSimpanNomor =
  | { ok: true; diubah: number }
  | { ok: false; code: "UNAUTHORIZED" | "FORBIDDEN" | "JENIS_TIDAK_DIKENAL" | "PERIODE_TIDAK_SAH" | GalatIsianNomor; docType?: DocType };

/**
 * Simpan beberapa baris sekaligus (satu tombol Simpan di layar). Semua baris
 * diperiksa dulu; satu yang salah membatalkan semuanya, jadi tidak ada simpan
 * setengah jalan. Penghitung (`lastNumber`) tidak disentuh.
 */
export async function simpanNomorDokumenAction(isian: IsianNomorDokumen[]): Promise<HasilSimpanNomor> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, code: "UNAUTHORIZED" };
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.SETTINGS_DOCUMENTS_MANAGE)) {
    return { ok: false, code: "FORBIDDEN" };
  }
  if (!Array.isArray(isian)) return { ok: false, code: "JENIS_TIDAK_DIKENAL" };
  for (const b of isian) {
    if (!b || typeof b.docType !== "string" || !Object.prototype.hasOwnProperty.call(DEFAULT_CONFIGS, b.docType)) {
      return { ok: false, code: "JENIS_TIDAK_DIKENAL" };
    }
    if (!(PERIODE_SAH as readonly string[]).includes(b.resetPeriod)) {
      return { ok: false, code: "PERIODE_TIDAK_SAH", docType: b.docType };
    }
    const galat = periksaIsianNomor({ prefix: typeof b.prefix === "string" ? b.prefix : "", padding: b.padding });
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
          ...docNumberPeriod(now),
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

  revalidatePath("/backoffice/settings/documents");
  return { ok: true, diubah: isian.length };
}
