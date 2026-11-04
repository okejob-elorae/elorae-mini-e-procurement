"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { AlertTriangle, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { cn } from "@/lib/utils";
import { dinamis } from "@/lib/i18n/dinamis";
import type { PelunasanToko, TagihanSiklus } from "@/lib/konsinyasi/queries";
import { tulisRupiah } from "./jumlah-bayar";

/**
 * Tanpa tanda — tandanya ditulis di depan baris (− potongan, + beban). Sen
 * ditulis kalau ada: tagihan konsinyasi bisa berpecahan sen, dan sisa 40 sen
 * yang tampil sebagai "Rp 0" tidak bisa dimengerti siapa pun.
 */
const rupiah = tulisRupiah;
const uang = (n: number) => `${Math.round(n * 100) < 0 ? "−" : ""}${rupiah(n)}`;
const tanggal = (iso: string) =>
  new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta" });

const NADA_BKM: Record<string, StatusTone> = { DIKIRIM: "waiting", TERVERIFIKASI: "settled", DITOLAK: "attention", DIBATALKAN: "inactive" };

/**
 * Ringkasan tagihan siklus ke toko: laku resmi − potongan promo ditanggung Elorae + beban barang
 * hilang ke toko. Saat angka dikunci, tagihan ini lahir di Piutang (nomornya = nomor konsi) dan
 * dilunasi lewat BKM seperti tagihan lain — kartu ini hanya membacanya; pembayaran toko tidak
 * dicatat di halaman konsinyasi lagi.
 */
export function TagihanKonsiCard({ tagihan, pelunasan }: { tagihan: TagihanSiklus; pelunasan: PelunasanToko }) {
  const t = useTranslations("konsinyasi.tagihan");
  const tk = dinamis(useTranslations("konsinyasi"));
  const promoBerubah = tagihan.beku && Math.round(tagihan.promoEloraeSekarang) !== Math.round(tagihan.promoElorae);
  const piutang = pelunasan.tagihan;
  const sisa = pelunasan.sisa ?? 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-baseline gap-x-2 text-base">
          {t("title")}
          <span className="text-sm font-normal text-muted-foreground">{tagihan.pakaiPpn ? t("denganPpn") : t("tanpaPpn")}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <dl className="max-w-xl space-y-2 text-sm">
          <Baris label={t("sold")}>
            {tagihan.lakuResmi === null ? <Redup>{t("notLocked")}</Redup> : uang(tagihan.lakuResmi)}
          </Baris>
          <Baris label={t("promo")} keterangan={tagihan.beku ? t("promoFrozen") : t("promoLive")}>
            {tagihan.promoElorae === 0 ? rupiah(0) : `${tagihan.promoElorae > 0 ? "−" : "+"} ${rupiah(tagihan.promoElorae)}`}
          </Baris>
          <Baris label={t("loss")}>
            {tagihan.bebanHilang === null ? (
              <Redup>{t("atLock")}</Redup>
            ) : tagihan.bebanHilang === 0 ? (
              rupiah(0)
            ) : (
              `+ ${rupiah(tagihan.bebanHilang)}`
            )}
          </Baris>
          <Baris label={t("total")} tebal className="border-t pt-2">
            {tagihan.total === null ? <Redup>{t("totalAfterLock")}</Redup> : uang(tagihan.total)}
          </Baris>
          {tagihan.beku && (
            <Baris label={t("remaining")} tebal className="border-t pt-2">
              {pelunasan.lunas ? <StatusPill tone="settled">{t("settled")}</StatusPill> : uang(sisa)}
            </Baris>
          )}
        </dl>

        {promoBerubah && (
          <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/[0.06] p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
            <span>{t("promoChanged", { value: uang(tagihan.promoEloraeSekarang) })}</span>
          </p>
        )}

        {tagihan.beku && (
          <div className="space-y-3 border-t pt-4">
            <div>
              <h3 className="text-sm font-semibold">{t("receivableTitle")}</h3>
              <p className="text-xs text-muted-foreground">{t("receivableHint")}</p>
            </div>

            {piutang === null ? (
              <p className="text-sm text-muted-foreground">{t("noReceivable")}</p>
            ) : (
              <>
                <dl className="max-w-xl space-y-2 text-sm">
                  <Baris label={t("invoiceNo")}>
                    <span className="font-mono">{piutang.invoiceNo}</span>
                  </Baris>
                  <Baris label={t("invoiceDate")}>{tanggal(piutang.invoiceDate)}</Baris>
                  <Baris label={t("dueDate")}>{tanggal(piutang.dueDate)}</Baris>
                  <Baris label={t("collector")}>{piutang.penjual ?? "—"}</Baris>
                  <Baris label={t("state")}>{tk(`tagihan.keadaan_${piutang.keadaanTampil}`)}</Baris>
                </dl>
                <Link
                  href={`/backoffice/piutang?cari=${encodeURIComponent(piutang.invoiceNo)}`}
                  className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                >
                  {t("openReceivable")}
                  <ExternalLink className="h-3.5 w-3.5" />
                </Link>

                <div className="space-y-2">
                  <h4 className="text-sm font-medium">{t("bkmTitle")}</h4>
                  {piutang.bkm.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t("noBkm")}</p>
                  ) : (
                    <ul className="divide-y rounded-md border text-sm">
                      {piutang.bkm.map((b) => (
                        <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
                          <div className="min-w-0">
                            <Link href={`/backoffice/pelunasan/${b.id}`} className="font-mono font-medium hover:underline">
                              {b.docNo}
                            </Link>
                            <p className="text-xs text-muted-foreground">
                              {tanggal(b.tanggal)} · {t("bkmSettles", { value: rupiah(b.dilunasi) })}
                            </p>
                          </div>
                          <StatusPill tone={NADA_BKM[b.status] ?? "inactive"}>{tk(`tagihan.bkm_${b.status}`)}</StatusPill>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {piutang.penghalangBuka && (
                  <p className="flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{tk(`tagihan.lockedBy_${piutang.penghalangBuka}`)}</span>
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Baris({
  label,
  keterangan,
  tebal,
  className,
  children,
}: {
  label: string;
  keterangan?: string;
  tebal?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4", className)}>
      <dt className={cn(tebal ? "font-semibold" : "text-muted-foreground")}>
        {label}
        {keterangan && <span className="block text-xs font-normal text-muted-foreground">{keterangan}</span>}
      </dt>
      <dd className={cn("shrink-0 text-right tabular-nums", tebal && "text-base font-semibold")}>{children}</dd>
    </div>
  );
}

function Redup({ children }: { children: React.ReactNode }) {
  return <span className="text-sm font-normal text-muted-foreground">{children}</span>;
}
