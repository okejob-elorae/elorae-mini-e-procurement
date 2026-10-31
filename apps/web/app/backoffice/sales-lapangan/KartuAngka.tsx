"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { AlertTriangle, CalendarCheck, ChevronRight, Footprints, ShoppingBag, Store, Wallet, type LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatIDR } from "@/lib/sales-orders/format";
import { cn } from "@/lib/utils";
import type { AngkaSales } from "./bentuk";

/** Alamat dokumen sumber tiap kartu; kartu tanpa alamat tidak bisa diklik. */
export type TautanKartu = { kunjungan?: string; pesanan?: string; pelunasan?: string; janggal?: string };

/**
 * Enam angka utama, dipakai dasbor tim dan rincian per sales supaya keduanya
 * menyebut hal yang sama dengan kata yang sama. Kartu yang punya `tautan`
 * membuka daftar sumbernya.
 */
export function KartuAngka({ angka, tautan }: { angka: AngkaSales; tautan?: TautanKartu }) {
  const t = useTranslations("salesLapangan");
  const persen = (x: number | null) => (x === null ? "—" : `${x}%`);

  return (
    <div className="anim-stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
      <Kartu
        ikon={Footprints}
        href={tautan?.kunjungan}
        label={t("kpi.visits")}
        nilai={String(angka.kunjungan)}
        kaki={t("kpi.visitsFoot", { toko: angka.tokoDikunjungi, hari: angka.hariAktif })}
        kaki2={
          angka.jadwal
            ? t("table.subSchedule", { dikunjungi: angka.jadwal.dikunjungi, direncanakan: angka.jadwal.direncanakan })
            : undefined
        }
      />
      <Kartu
        ikon={CalendarCheck}
        label={t("kpi.effective")}
        nilai={persen(angka.persenEfektif)}
        kaki={t("kpi.effectiveFoot", { efektif: angka.efektif, kunjungan: angka.kunjungan })}
      />
      <Kartu
        ikon={ShoppingBag}
        href={tautan?.pesanan}
        label={t("kpi.orders")}
        nilai={formatIDR(angka.pesanan.nilaiPutus)}
        kaki={t("kpi.ordersFoot", {
          jumlah: angka.pesanan.jumlah,
          putus: angka.pesanan.putus,
          konsi: angka.pesanan.konsi,
        })}
      />
      <Kartu
        ikon={Wallet}
        href={tautan?.pelunasan}
        label={t("kpi.collections")}
        nilai={formatIDR(angka.pelunasan.nilaiTerverifikasi)}
        kaki={t("kpi.collectionsFoot", {
          terverifikasi: angka.pelunasan.terverifikasi,
          dilaporkan: angka.pelunasan.dilaporkan,
          nilai: formatIDR(angka.pelunasan.nilaiDilaporkan),
        })}
      />
      <Kartu ikon={Store} label={t("kpi.newStores")} nilai={String(angka.tokoBaru)} kaki={t("kpi.newStoresFoot")} />
      <Kartu
        ikon={AlertTriangle}
        href={tautan?.janggal}
        label={t("kpi.flags")}
        nilai={String(angka.janggal)}
        kaki={t("kpi.flagsFoot", { kunjungan: angka.kunjungan })}
        nada={angka.janggal > 0 ? "text-amber-600 dark:text-amber-500" : undefined}
      />
    </div>
  );
}

function Kartu({
  ikon: Ikon,
  href,
  label,
  nilai,
  kaki,
  kaki2,
  nada,
}: {
  ikon: LucideIcon;
  href?: string;
  label: string;
  nilai: string;
  kaki: string;
  /** Baris kedua opsional (mis. kepatuhan jadwal kantor). */
  kaki2?: string;
  nada?: string;
}) {
  const kartu = (
    // Satu padding vertikal saja: milik Card (CSS kantor menimpa `py-0` pada Card, jadi isi tidak menambah `py-4`).
    <Card className={cn("h-full", href && "transition-colors group-hover:border-foreground/30 group-hover:bg-muted/40")}>
      <CardContent className="space-y-1">
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          <Ikon className="h-4 w-4" aria-hidden />
          {label}
          {href ? <ChevronRight className="ml-auto h-4 w-4" aria-hidden /> : null}
        </span>
        <p className={cn("text-xl font-semibold tabular-nums", nada)}>{nilai}</p>
        <p className="text-xs text-muted-foreground">{kaki}</p>
        {kaki2 ? <p className="text-xs text-muted-foreground">{kaki2}</p> : null}
      </CardContent>
    </Card>
  );
  if (!href) return kartu;
  return (
    <Link href={href} className="group block h-full rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {kartu}
    </Link>
  );
}
