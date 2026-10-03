"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { KeadaanPesanan } from "@/lib/field-sales/pwa-queries";
import type { KeadaanPiutang } from "@/lib/receivables/rules";
import { formatIDR } from "@/lib/sales-orders/format";
import { cn } from "@/lib/utils";

/** Bentuk kartu yang dikirim server — semua tanggal SUDAH diformat di server. */
export type RingkasanTokoView = {
  storeId: string;
  jenisToko: "PUTUS" | "KONSI";
  tagihan: {
    sisa: number;
    fakturTerbuka: number;
    lewatJanji: number;
    fakturLewatJanji: number;
    lebih: number;
    bolehLihat: boolean;
    faktur: Array<{
      id: string;
      invoiceNo: string;
      keadaan: KeadaanPiutang;
      sisa: number;
      tanggal: string;
      jenisTanggal: "janji" | "jatuhTempo";
      lewat: boolean;
    }>;
  } | null;
  favorit: Array<{ itemId: string; nama: string; pcs: number }>;
  pesananTerakhir: {
    id: string;
    orderNo: string;
    tanggal: string;
    keadaan: KeadaanPesanan;
    total: number | null;
    milikSaya: boolean;
  } | null;
  kunjunganTerakhir: { tanggal: string; oleh: string; olehSaya: boolean } | null;
};

/* Nada keadaan faktur: sama dengan layar Tagihan. */
const NADA_FAKTUR: Record<KeadaanPiutang, string> = {
  lewat: "bg-destructive/10 text-red-800 dark:text-red-300",
  tertahan: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  klaim: "bg-primary/15 text-foreground",
  tt: "bg-muted text-muted-foreground",
  belum: "bg-primary/15 text-foreground",
  lunas: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
};

/**
 * Ringkasan toko di atas halaman toko: tagihan, barang yang biasa dibeli,
 * pesanan dan kunjungan terakhir. Dibuat ringkas untuk HP — daftar faktur
 * dilipat, angka utamanya selalu terlihat.
 */
export function RingkasanToko({ r }: { r: RingkasanTokoView }) {
  const t = useTranslations("pwa.ringkasanToko");
  const tp = useTranslations("pwa.pesananSaya");
  const tAnalisa = useTranslations("pwaAnalisaToko");

  return (
    <section className="beranda-kartu space-y-3" aria-labelledby="ringkasan-toko-judul">
      <h2 id="ringkasan-toko-judul" className="beranda-judul">
        {t("title")}
      </h2>

      {r.tagihan ? (
        <div className="space-y-2">
          {/* Sisa tagihan satu baris penuh, dua angka lain di bawahnya: tiga kolom
              sempit dulu memotong angka uang ("Rp 18.450.…") di HP. */}
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
            <div className="col-span-2 min-w-0">
              <dt className="text-[11px] leading-tight text-muted-foreground">{t("sisa")}</dt>
              <dd className="text-xl font-semibold tabular-nums">{formatIDR(r.tagihan.sisa)}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-[11px] leading-tight text-muted-foreground">{t("lewat")}</dt>
              <dd
                className={cn(
                  "text-base font-semibold tabular-nums",
                  r.tagihan.lewatJanji > 0 && "text-destructive",
                )}
              >
                {formatIDR(r.tagihan.lewatJanji)}
              </dd>
              {r.tagihan.fakturLewatJanji > 0 ? (
                <dd className="text-[11px] leading-tight text-destructive">{t("lewatCount", { count: r.tagihan.fakturLewatJanji })}</dd>
              ) : null}
            </div>
            <div className="min-w-0">
              <dt className="text-[11px] leading-tight text-muted-foreground">{t("terbuka")}</dt>
              <dd className="text-base font-semibold tabular-nums">{r.tagihan.fakturTerbuka}</dd>
            </div>
          </dl>

          {r.tagihan.faktur.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noBill")}</p>
          ) : (
            <Collapsible>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="group -mx-2 w-[calc(100%+1rem)] justify-between px-2">
                  <span>{t("invoicesToggle", { count: r.tagihan.fakturTerbuka })}</span>
                  <ChevronDown className="h-4 w-4 transition-transform group-data-[state=open]:rotate-180" aria-hidden />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <ul className="divide-y text-sm">
                  {r.tagihan.faktur.map((f) => (
                    <li key={f.id} className="flex items-start justify-between gap-3 py-2">
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{f.invoiceNo}</span>
                        <span className={cn("block text-xs", f.lewat ? "font-medium text-destructive" : "text-muted-foreground")}>
                          {f.jenisTanggal === "janji" ? t("invoicePromise", { date: f.tanggal }) : t("invoiceDue", { date: f.tanggal })}
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        <span className="font-semibold tabular-nums">{formatIDR(f.sisa)}</span>
                        <Badge variant="outline" className={cn("border-transparent", NADA_FAKTUR[f.keadaan])}>
                          {t(`keadaan.${f.keadaan}`)}
                        </Badge>
                      </span>
                    </li>
                  ))}
                </ul>
                {r.tagihan.lebih > 0 ? (
                  <p className="pt-1 text-xs text-muted-foreground">{t("invoicesMore", { count: r.tagihan.lebih })}</p>
                ) : null}
              </CollapsibleContent>
            </Collapsible>
          )}

          {r.tagihan.bolehLihat && r.tagihan.fakturTerbuka > 0 ? (
            <Link
              href={`/pwa/piutang/${r.storeId}`}
              className="inline-flex min-h-11 items-center gap-1 text-sm font-medium underline decoration-primary decoration-2 underline-offset-4"
            >
              {t("seeBills")}
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Link>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t("konsiNoBill")}</p>
      )}

      <div className="space-y-1.5 border-t pt-3">
        <h3 className="text-xs font-medium text-muted-foreground">{t("favoritesTitle")}</h3>
        {r.favorit.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("favoritesEmpty")}</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {r.favorit.map((f) => (
              <li key={f.itemId} className="max-w-full rounded-full bg-background/70 px-2.5 py-1 text-xs">
                <span className="font-medium">{f.nama}</span>
                <span className="text-muted-foreground"> · {t("favoritePcs", { pcs: f.pcs })}</span>
              </li>
            ))}
          </ul>
        )}
        {/* Kategori, ukuran/warna terlaris, dan laku vs kiriman: halaman analisa toko. */}
        <Link
          href={`/pwa/stores/${r.storeId}/analisa`}
          className="inline-flex min-h-11 items-center gap-1 text-sm font-medium underline decoration-primary decoration-2 underline-offset-4"
        >
          {tAnalisa("linkFromStore")}
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>

      <dl className="grid grid-cols-2 gap-3 border-t pt-3 text-sm">
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">{t("lastOrder")}</dt>
          {r.pesananTerakhir ? (
            <dd className="space-y-0.5">
              {r.pesananTerakhir.milikSaya ? (
                <Link
                  href={`/pwa/orders/${r.pesananTerakhir.id}`}
                  className="block truncate font-mono text-xs font-medium underline decoration-primary decoration-2 underline-offset-4"
                >
                  {r.pesananTerakhir.orderNo}
                </Link>
              ) : (
                <span className="block truncate font-mono text-xs">{r.pesananTerakhir.orderNo}</span>
              )}
              <span className="block font-medium">{r.pesananTerakhir.tanggal}</span>
              <span className="block text-xs text-muted-foreground">
                {tp(`keadaan.${r.pesananTerakhir.keadaan}`)}
                {r.pesananTerakhir.total !== null ? ` · ${formatIDR(r.pesananTerakhir.total)}` : null}
              </span>
            </dd>
          ) : (
            <dd className="text-muted-foreground">{t("lastOrderNone")}</dd>
          )}
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">{t("lastVisit")}</dt>
          {r.kunjunganTerakhir ? (
            <dd className="space-y-0.5">
              <span className="block font-medium">{r.kunjunganTerakhir.tanggal}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {r.kunjunganTerakhir.olehSaya ? t("byYou") : t("byName", { name: r.kunjunganTerakhir.oleh })}
              </span>
            </dd>
          ) : (
            <dd className="text-muted-foreground">{t("lastVisitNone")}</dd>
          )}
        </div>
      </dl>
    </section>
  );
}
