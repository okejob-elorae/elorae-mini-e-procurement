"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, CheckCircle2, CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDisplayDate, parseDateOnly } from "@/lib/date-only";
import { cn } from "@/lib/utils";
import { butirSaldoAwal } from "@/lib/finance/saldo-awal/kesiapan";
import { perluSpanduk, type KesiapanBukuBesar } from "./kesiapan";
import type { AksesSpanduk } from "./baca";

type Props = {
  kesiapan: KesiapanBukuBesar | null;
  akses: AksesSpanduk;
  /** Di halaman Jurnal tab "Tertunda" sudah ada; tautannya tidak perlu diulang. */
  tanpaTautanTertunda?: boolean;
};

/**
 * Spanduk yang SAMA di Jurnal dan keempat laporan keuangan: selama buku besar
 * belum aktif, angka Rp 0 di laporan bukan angka sungguhan. Penjelasannya ada
 * di Bantuan halaman masing-masing.
 */
export function SpandukBukuBesar({ kesiapan, akses, tanpaTautanTertunda }: Props) {
  const t = useTranslations("financeLedgerStatus");
  const locale = useLocale();
  if (!kesiapan || !perluSpanduk(kesiapan)) return null;

  const butir: { ok: boolean; teks: string }[] = [
    {
      ok: !kesiapan.alasan.includes("PEMETAAN"),
      teks: t("mapping", { done: kesiapan.jumlahWajibTerpetakan, total: kesiapan.totalPeranWajib }),
    },
    { ok: kesiapan.jumlahJurnal > 0, teks: t("journals", { count: kesiapan.jumlahJurnal }) },
    {
      ok: kesiapan.tanggalMulai != null,
      teks: kesiapan.tanggalMulai
        ? t("cutover", { date: formatDisplayDate(parseDateOnly(kesiapan.tanggalMulai), locale) })
        : t("noCutover"),
    },
  ];
  if (kesiapan.jurnalTertunda > 0) {
    butir.push({ ok: false, teks: t("pending", { count: kesiapan.jurnalTertunda }) });
  }
  // Saldo awal: hanya diberitahukan, tidak menahan "aktif" (lib/finance/saldo-awal/kesiapan.ts).
  const saldoAwal = kesiapan.saldoAwal ? butirSaldoAwal(kesiapan.saldoAwal) : null;
  if (saldoAwal) butir.push({ ok: saldoAwal.ok, teks: t(saldoAwal.kunci, { n: saldoAwal.n, total: saldoAwal.total }) });
  const tampilSaldoAwal = akses.jurnal && saldoAwal !== null && !saldoAwal.ok;
  // Status PKP (lib/finance/pajak/ppn.ts): belum ditetapkan = tanpa PPN di jurnal mana pun.
  const pkpBelum = kesiapan.statusPkp === "BELUM_DITETAPKAN";
  if (kesiapan.statusPkp) {
    butir.push({ ok: !pkpBelum, teks: t(`pkp.${kesiapan.statusPkp}`) });
  }
  const tampilPajak = akses.jurnal && pkpBelum;

  const tampilTertunda = !tanpaTautanTertunda && akses.jurnal && kesiapan.jurnalTertunda > 0;

  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
      <div className="min-w-0 flex-1 space-y-2">
        <p className="font-medium">
          {!kesiapan.aktif
            ? t("titleInactive")
            : kesiapan.jurnalTertunda > 0
              ? t("titlePending", { count: kesiapan.jurnalTertunda })
              : t("titlePkp")}
        </p>
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          {butir.map((b) => (
            <li
              key={b.teks}
              className={cn("flex items-center gap-1.5", b.ok ? "text-muted-foreground" : "text-foreground")}
            >
              {b.ok ? (
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden />
              ) : (
                <CircleAlert className="h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden />
              )}
              {b.teks}
            </li>
          ))}
        </ul>
        {(akses.baganAkun || akses.pemetaan || tampilTertunda || tampilSaldoAwal || tampilPajak) && (
          <div className="flex flex-wrap gap-2">
            {akses.baganAkun && (
              <Button variant="outline" size="sm" asChild>
                <Link href="/backoffice/finance/coa">{t("linkCoa")}</Link>
              </Button>
            )}
            {akses.pemetaan && (
              <Button variant="outline" size="sm" asChild>
                <Link href="/backoffice/finance/account-mapping">{t("linkMapping")}</Link>
              </Button>
            )}
            {tampilTertunda && (
              <Button variant="outline" size="sm" asChild>
                <Link href="/backoffice/finance/journals?status=tertunda">{t("linkPending")}</Link>
              </Button>
            )}
            {tampilSaldoAwal && (
              <Button variant="outline" size="sm" asChild>
                <Link href="/backoffice/finance/saldo-awal">{t("linkOpening")}</Link>
              </Button>
            )}
            {tampilPajak && (
              <Button variant="outline" size="sm" asChild>
                <Link href="/backoffice/finance/pajak">{t("linkPajak")}</Link>
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
