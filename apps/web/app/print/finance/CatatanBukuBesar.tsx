"use client";

import type { KesiapanCetak } from "@/app/backoffice/finance/_kesiapan/aksi";
import { LEDGER_NOT_ACTIVE_NOTE, ledgerPendingNote } from "@/lib/finance/reports/disclosures";

/**
 * Catatan yang sama dengan spanduk di layar, untuk lembar yang dikirim ke luar
 * aplikasi: selama buku besar belum aktif, Rp 0 di laporan bukan angka sungguhan.
 */
export function CatatanBukuBesar({ kesiapan }: { kesiapan: KesiapanCetak | null }) {
  if (!kesiapan) return null;
  const teks = !kesiapan.aktif
    ? LEDGER_NOT_ACTIVE_NOTE
    : kesiapan.jurnalTertunda > 0
      ? ledgerPendingNote(kesiapan.jurnalTertunda)
      : null;
  if (!teks) return null;
  return <p className="mb-4 border border-black px-3 py-2 text-center text-sm font-semibold">{teks}</p>;
}
