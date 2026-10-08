import { prisma } from "@elorae/db";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { listAccountMappings } from "@/lib/finance/journals/mapping";
import { readGlCutover } from "@/lib/finance/sales/sweep";
import { hitungJurnalTertunda } from "@/lib/finance/jurnal-tertunda";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import { SARING_JURNAL_BERLAKU } from "@/lib/finance/journals/status-jurnal";
import { bacaKesiapanSaldoAwal } from "@/lib/finance/saldo-awal/queries";
import { bacaPengaturanPpn } from "@/lib/finance/pajak/ppn-pengaturan";
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
      prisma.journal.count({ where: SARING_JURNAL_BERLAKU }),
      readGlCutover(),
      opts.jurnalTertunda !== undefined ? Promise.resolve(opts.jurnalTertunda) : hitungJurnalTertunda(),
    ]);
    const teksMulai = tanggalMulai ? formatDateOnlyJakarta(tanggalMulai) : null;
    // Tidak pernah melempar (null menyembunyikan butirnya saja).
    const saldoAwal = await bacaKesiapanSaldoAwal(teksMulai);
    // Status PKP: PKP → peran PPN ikut wajib; belum ditetapkan → spanduk mengingatkan.
    const { statusPkp } = await bacaPengaturanPpn();
    return nilaiKesiapan({
      peranTerpetakan: pemetaan.filter((m) => m.chartAccountId && m.typeValid).map((m) => m.role),
      jumlahJurnal,
      tanggalMulai: teksMulai,
      jurnalTertunda,
      saldoAwal,
      statusPkp,
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
