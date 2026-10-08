"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { RollupNode } from "@/lib/finance/reports/rollup";
import { barisPohon, dariRollup } from "@/lib/finance/reports/tampil-pohon";
import { rupiahLaporan } from "@/lib/finance/reports/format-laporan";
import { TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/** Tautan buku besar per akun; null = baris tanpa tautan. */
type TautanAkun = (accountId: string) => string | null;

type Props = {
  title: string;
  nodes: RollupNode[];
  total: number;
  totalLabel: string;
  emptyLabel: string;
  /** Tautan nama akun ke buku besarnya (periode yang sama); tanpa ini nama tidak bertautan. */
  tautanAkun?: TautanAkun;
  /** Tampilkan akun bernilai nol (bawaan disembunyikan). */
  tampilkanNol?: boolean;
};

/** Kepala tabel tiga kolom yang dipakai bersama `ReportSection`. */
export function KepalaKolomLaporan() {
  const t = useTranslations("financeReports.kolom");
  return (
    <TableHeader>
      <TableRow>
        <TableHead>{t("akun")}</TableHead>
        <TableHead className="w-40 text-right">{t("rincian")}</TableHead>
        <TableHead className="w-40 text-right">{t("jumlah")}</TableHead>
      </TableRow>
    </TableHeader>
  );
}

/** Baris laba kotor/bersih/total gabungan: angka di kolom jumlah. */
export function BarisTotalLaporan({ label, nilai, tebal = true, negatifMerah = false }: { label: string; nilai: number; tebal?: boolean; negatifMerah?: boolean }) {
  return (
    <TableRow className={tebal ? "border-t-2 font-bold" : "font-semibold"}>
      <TableCell>{label}</TableCell>
      <TableCell />
      <TableCell className={`text-right tabular-nums ${negatifMerah && nilai < 0 ? "text-destructive" : ""}`}>{rupiahLaporan(nilai)}</TableCell>
    </TableRow>
  );
}

/**
 * Satu bagian laporan (Laba Rugi, Neraca) dalam tiga kolom: akun | rincian |
 * jumlah. Akun induk = judul kelompok TANPA angka; akun rinci di kolom
 * rincian; subtotal induk ("Jumlah …") dan total bagian di kolom jumlah —
 * satu angka tidak lagi tampil dua-tiga kali di kolom yang sama (audit G8).
 * Aturan barisnya `barisPohon` (`lib/finance/reports/tampil-pohon.ts`), sama
 * dengan versi cetak dan Excel.
 */
export function ReportSection({ title, nodes, total, totalLabel, emptyLabel, tautanAkun, tampilkanNol = false }: Props) {
  const t = useTranslations("financeReports.kolom");
  const baris = barisPohon(dariRollup(nodes), { tampilkanNol });
  const indent = (level: number) => ({ paddingLeft: `${level * 20 + 12}px` });

  return (
    <>
      <TableRow className="bg-muted/40 hover:bg-muted/40">
        <TableCell colSpan={3} className="font-semibold uppercase text-xs tracking-wide">
          {title}
        </TableCell>
      </TableRow>
      {baris.length === 0 ? (
        <TableRow>
          <TableCell colSpan={3} className="pl-6 text-muted-foreground text-sm">
            {emptyLabel}
          </TableCell>
        </TableRow>
      ) : (
        baris.map((b) => {
          if (b.jenis === "judul") {
            return (
              <TableRow key={`j-${b.accountId}`}>
                <TableCell colSpan={3} className="font-medium" style={indent(b.level)}>
                  <span className="font-mono text-xs text-muted-foreground mr-2">{b.code}</span>
                  {b.name}
                </TableCell>
              </TableRow>
            );
          }
          if (b.jenis === "jumlah") {
            return (
              <TableRow key={`s-${b.accountId}`}>
                <TableCell className="font-medium" style={indent(b.level)}>
                  {t("jumlahKelompok", { nama: b.name })}
                </TableCell>
                <TableCell />
                <TableCell className="text-right tabular-nums font-medium border-t">{rupiahLaporan(b.nilai[0])}</TableCell>
              </TableRow>
            );
          }
          const href = !b.sendiriInduk ? tautanAkun?.(b.accountId) ?? null : null;
          return (
            <TableRow key={`a-${b.accountId}${b.sendiriInduk ? "-sendiri" : ""}`}>
              <TableCell style={indent(b.level)}>
                <span className="font-mono text-xs text-muted-foreground mr-2">{b.code}</span>
                {href ? (
                  <Link href={href} className="underline underline-offset-4">
                    {b.name}
                  </Link>
                ) : (
                  b.name
                )}
                {b.sendiriInduk ? <span className="ml-1 text-xs text-muted-foreground">{t("langsung")}</span> : null}
              </TableCell>
              <TableCell className="text-right tabular-nums">{rupiahLaporan(b.nilai[0])}</TableCell>
              <TableCell />
            </TableRow>
          );
        })
      )}
      <TableRow className="font-semibold">
        <TableCell className="pl-3">{totalLabel}</TableCell>
        <TableCell />
        <TableCell className="text-right tabular-nums border-t">{rupiahLaporan(total)}</TableCell>
      </TableRow>
    </>
  );
}
