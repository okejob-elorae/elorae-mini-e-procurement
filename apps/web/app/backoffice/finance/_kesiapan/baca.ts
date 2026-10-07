import { prisma } from "@elorae/db";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { listAccountMappings } from "@/lib/finance/journals/mapping";
import { readGlCutover } from "@/lib/finance/sales/sweep";
import { hitungJurnalTertunda } from "@/lib/finance/jurnal-tertunda";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import { nilaiKesiapan, type KesiapanBukuBesar } from "./kesiapan";

/** Tautan spanduk yang boleh ditawarkan — tautan ke halaman yang menolak pembaca hanya memantulkannya ke Beranda. */
export type AksesSpanduk = { baganAkun: boolean; pemetaan: boolean; jurnal: boolean };

export function aksesSpanduk(permissions: string[]): AksesSpanduk {
  return {
    baganAkun: hasPermission(permissions, PERMISSIONS.COA_VIEW),
    pemetaan: hasPermission(permissions, PERMISSIONS.JOURNALS_VIEW),
    jurnal: hasPermission(permissions, PERMISSIONS.JOURNALS_VIEW),
  };
}

/**
 * Data spanduk "Buku besar belum aktif". Tidak pernah melempar: kegagalan
 * membaca hanya menyembunyikan spanduk, laporan tetap tampil.
 *
 * `jurnalTertunda` boleh diberikan pemanggil yang sudah menghitungnya (halaman
 * Jurnal), supaya tidak dihitung dua kali.
 */
export async function bacaKesiapanBukuBesar(opts: { jurnalTertunda?: number } = {}): Promise<KesiapanBukuBesar | null> {
  try {
    const [pemetaan, jumlahJurnal, tanggalMulai, jurnalTertunda] = await Promise.all([
      listAccountMappings(),
      prisma.journal.count(),
      readGlCutover(),
      opts.jurnalTertunda !== undefined ? Promise.resolve(opts.jurnalTertunda) : hitungJurnalTertunda(),
    ]);
    return nilaiKesiapan({
      peranTerpetakan: pemetaan.filter((m) => m.chartAccountId && m.typeValid).map((m) => m.role),
      jumlahJurnal,
      tanggalMulai: tanggalMulai ? formatDateOnlyJakarta(tanggalMulai) : null,
      jurnalTertunda,
    });
  } catch (e) {
    console.error("[kesiapan-buku-besar] gagal membaca kesiapan buku besar", e);
    return null;
  }
}

/** Hari ini WIB ("YYYY-MM-DD") — label periode laporan bila isian tanggalnya kosong. */
export function hariIniWib(): string {
  return formatDateOnlyJakarta(new Date());
}
