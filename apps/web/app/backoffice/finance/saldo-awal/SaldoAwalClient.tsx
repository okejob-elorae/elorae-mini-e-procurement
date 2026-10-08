"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, Landmark } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { formatDisplayDate, parseDateOnly } from "@/lib/date-only";
import { formatRupiah } from "@/lib/format/rupiah";
import { cn } from "@/lib/utils";
import {
  JENIS_SALDO_AWAL,
  SLUG_JENIS_SALDO_AWAL,
  type EntriHutang,
  type EntriPiutangMarketplace,
  type EntriPiutangToko,
  type JenisSaldoAwal,
} from "@/lib/finance/saldo-awal/jenis";
import type { StatusJenisSaldoAwal } from "@/lib/finance/saldo-awal/kesiapan";
import type { PeriodeTertutup } from "@/lib/finance/saldo-awal/tanggal";
import type { AkunSaldoAwal, KeadaanJenisSaldoAwal } from "@/lib/finance/saldo-awal/queries";
import { EditorAkun } from "./EditorAkun";
import { EditorPersediaan } from "./EditorPersediaan";
import { EditorPiutangToko } from "./EditorPiutangToko";
import { EditorMarketplace } from "./EditorMarketplace";
import { EditorHutang } from "./EditorHutang";
import type { KonteksSaldoAwal } from "./AksiSaldoAwal";

export type DataJenis =
  | { jenis: "ACCOUNTS"; akun: AkunSaldoAwal[] }
  | { jenis: "INVENTORY" }
  | { jenis: "AR_STORE"; hitungan: EntriPiutangToko[] }
  | { jenis: "AR_MARKETPLACE"; hitungan: EntriPiutangMarketplace[] }
  | { jenis: "AP"; hitungan: EntriHutang[]; pemasok: { id: string; kode: string; nama: string }[] };

type Props = {
  jenis: JenisSaldoAwal;
  tanggalMulai: string | null;
  tanggalJurnal: string | null;
  keadaan: Record<JenisSaldoAwal, KeadaanJenisSaldoAwal> | null;
  data: DataJenis;
  periodeTertutup: PeriodeTertutup | null;
  jurnalSebelum: number;
  peranBelum: string[];
  gagal: boolean;
  bolehMengelola: boolean;
  bolehBaganAkun: boolean;
};

export const NADA_STATUS: Record<StatusJenisSaldoAwal, StatusTone> = {
  BELUM: "inactive",
  DRAF: "waiting",
  DIPOSTING: "settled",
  BEDA_TANGGAL: "attention",
};

function Peringatan({ children }: { children: ReactNode }) {
  return (
    <div role="status" className="flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
      <div className="min-w-0 flex-1 space-y-2">{children}</div>
    </div>
  );
}

export function SaldoAwalClient(p: Props) {
  const t = useTranslations("saldoAwal");
  const tPeran = useTranslations("financeAccountMapping.role");
  const locale = useLocale();
  const tgl = (s: string | null) => (s ? formatDisplayDate(parseDateOnly(s), locale) : "—");
  const teksPeriode = (pt: PeriodeTertutup) => (pt.bulan === null ? String(pt.tahun) : `${String(pt.bulan).padStart(2, "0")}/${pt.tahun}`);

  const totalEkuitas = p.keadaan
    ? JENIS_SALDO_AWAL.reduce((s, j) => s + Math.round((p.keadaan![j].posting?.ekuitas ?? 0) * 100), 0) / 100
    : 0;

  const terkunci = !p.tanggalMulai ? t("alasan.tanpaMulai") : p.periodeTertutup ? t("alasan.periode", { periode: teksPeriode(p.periodeTertutup) }) : null;
  const konteks: KonteksSaldoAwal = {
    tanggalMulai: p.tanggalMulai,
    tanggalJurnal: p.tanggalJurnal,
    terkunci,
    bolehMengelola: p.bolehMengelola,
  };
  const keadaanIni = p.keadaan?.[p.jenis] ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("judul")}
        meta={
          p.tanggalMulai
            ? `${t("meta", { mulai: tgl(p.tanggalMulai), jurnal: tgl(p.tanggalJurnal) })} · ${t("ekuitasTotal", { nilai: formatRupiah(totalEkuitas) })}`
            : t("metaTanpaMulai")
        }
      />

      {!p.tanggalMulai ? (
        <Peringatan>
          <p>{t("peringatan.tanpaMulai")}</p>
          <Button variant="outline" size="sm" asChild>
            <Link href="/backoffice/finance/mulai-buku-besar">{t("peringatan.tautanMulai")}</Link>
          </Button>
        </Peringatan>
      ) : null}
      {p.periodeTertutup ? (
        <Peringatan>
          <p>{t("peringatan.periodeTertutup", { periode: teksPeriode(p.periodeTertutup) })}</p>
        </Peringatan>
      ) : null}
      {p.jurnalSebelum > 0 ? (
        <Peringatan>
          <p>{t("peringatan.jurnalSebelum", { n: p.jurnalSebelum })}</p>
        </Peringatan>
      ) : null}
      {p.peranBelum.length > 0 ? (
        <Peringatan>
          <p>{t("peringatan.peranBelum", { peran: p.peranBelum.map((r) => tPeran(r as never)).join(", ") })}</p>
          <div className="flex flex-wrap gap-2">
            {p.bolehBaganAkun ? (
              <Button variant="outline" size="sm" asChild>
                <Link href="/backoffice/finance/coa">{t("peringatan.tautanTemplat")}</Link>
              </Button>
            ) : null}
            <Button variant="outline" size="sm" asChild>
              <Link href="/backoffice/finance/account-mapping">{t("peringatan.tautanPemetaan")}</Link>
            </Button>
          </div>
        </Peringatan>
      ) : null}

      {p.gagal || !p.keadaan ? (
        <p className="text-sm text-destructive">{t("gagalMuat")}</p>
      ) : (
        <>
          <nav aria-label={t("judul")} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {JENIS_SALDO_AWAL.map((j) => {
              const k = p.keadaan![j];
              const aktif = j === p.jenis;
              return (
                <Link
                  key={j}
                  href={`/backoffice/finance/saldo-awal?jenis=${SLUG_JENIS_SALDO_AWAL[j]}`}
                  scroll={false}
                  replace
                  aria-current={aktif ? "page" : undefined}
                  className={cn(
                    "rounded-lg border bg-card p-3 transition-colors hover:bg-muted/50",
                    aktif && "border-primary ring-1 ring-primary",
                  )}
                >
                  <p className="text-sm font-medium">{t(`jenis.${j}`)}</p>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <StatusPill tone={NADA_STATUS[k.status]}>{t(`status.${k.status}`)}</StatusPill>
                    {k.posting ? <span className="text-xs tabular-nums text-muted-foreground">{formatRupiah(k.posting.ekuitas)}</span> : null}
                  </div>
                </Link>
              );
            })}
          </nav>

          {keadaanIni ? <RingkasStatus keadaan={keadaanIni} tanggalMulai={p.tanggalMulai} /> : null}

          {p.data.jenis === "ACCOUNTS" && keadaanIni ? <EditorAkun akun={p.data.akun} keadaan={keadaanIni} konteks={konteks} /> : null}
          {p.data.jenis === "INVENTORY" && keadaanIni ? <EditorPersediaan keadaan={keadaanIni} konteks={konteks} /> : null}
          {p.data.jenis === "AR_STORE" && keadaanIni ? <EditorPiutangToko hitungan={p.data.hitungan} keadaan={keadaanIni} konteks={konteks} /> : null}
          {p.data.jenis === "AR_MARKETPLACE" && keadaanIni ? (
            <EditorMarketplace hitungan={p.data.hitungan} keadaan={keadaanIni} konteks={konteks} />
          ) : null}
          {p.data.jenis === "AP" && keadaanIni ? (
            <EditorHutang hitungan={p.data.hitungan} pemasok={p.data.pemasok} keadaan={keadaanIni} konteks={konteks} />
          ) : null}
        </>
      )}
    </div>
  );
}

function RingkasStatus({ keadaan, tanggalMulai }: { keadaan: KeadaanJenisSaldoAwal; tanggalMulai: string | null }) {
  const t = useTranslations("saldoAwal");
  const locale = useLocale();
  const { posting, draf } = keadaan;
  if (!posting && !draf && keadaan.jumlahDibalik === 0) return null;
  return (
    <Card className="py-0">
      <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 p-4 text-sm">
        <Landmark className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        {posting ? (
          <span>
            {posting.olehNama
              ? t("diposting", { tanggal: formatDisplayDate(posting.diposting, locale), nama: posting.olehNama })
              : t("dipostingTanpaNama", { tanggal: formatDisplayDate(posting.diposting, locale) })}
            {" · "}
            {t("ekuitasJenis", { nilai: formatRupiah(posting.ekuitas) })}
            {" · "}
            {posting.journalId ? (
              <Link className="text-tautan underline-offset-4 hover:underline" href={`/backoffice/finance/journals/${posting.journalId}`}>
                {t("lihatJurnal")}
              </Link>
            ) : (
              t("tanpaJurnal")
            )}
          </span>
        ) : null}
        {posting && tanggalMulai && posting.tanggalMulai !== tanggalMulai ? (
          <span className="text-amber-700 dark:text-amber-400">
            {t("bedaTanggal", { tanggal: formatDisplayDate(parseDateOnly(posting.tanggalMulai), locale) })}
          </span>
        ) : null}
        {draf ? <span className="text-muted-foreground">{t("drafDisimpan", { tanggal: formatDisplayDate(draf.diubah, locale) })}</span> : null}
        {keadaan.jumlahDibalik > 0 ? <span className="text-muted-foreground">{t("dibalik", { n: keadaan.jumlahDibalik })}</span> : null}
      </CardContent>
    </Card>
  );
}
