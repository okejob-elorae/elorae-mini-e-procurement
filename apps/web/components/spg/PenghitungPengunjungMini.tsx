"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { AlertTriangle, CheckCircle2, ChevronRight, Clock, CloudOff, Footprints, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { usePenghitungPengunjung, type AwalPengunjung, type StatusSinkron } from "./usePenghitungPengunjung";

/** Satu baris keadaan kiriman: tersimpan di server, menunggu, tanpa sinyal, ditolak. */
export function KeteranganSinkronPengunjung({ status, className }: { status: StatusSinkron; className?: string }) {
  const t = useTranslations("pwaSpgPengunjung");
  const ikon = {
    tersimpan: <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden />,
    menunggu: <Clock className="h-4 w-4" aria-hidden />,
    mengirim: <Loader2 className="h-4 w-4 animate-spin" aria-hidden />,
    luring: <CloudOff className="h-4 w-4 text-amber-700 dark:text-amber-300" aria-hidden />,
    ditolak: <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden />,
  }[status];
  return (
    <p className={cn("flex items-start gap-2 text-sm text-muted-foreground", className)} role="status">
      <span className="mt-0.5 shrink-0">{ikon}</span>
      <span>{t(`status.${status}`)}</span>
    </p>
  );
}

/**
 * Kartu ringkas penghitung pengunjung untuk beranda SPG: angka saya hari ini,
 * total toko, dan tombol +1 — memakai catatan HP yang SAMA dengan layar penuh
 * (`/pwa/spg/pengunjung`), jadi ketukan di salah satunya tampil di keduanya.
 *
 * `awal` boleh kosong: kartu lalu mengambil angka server sendiri saat tampil.
 * Pasang hanya untuk SPG (toko tetap) — `storeId` hanya membedakan catatan di
 * HP; server selalu memakai toko tetap SPG dari sesi.
 */
export function PenghitungPengunjungMini({
  userId,
  storeId,
  awal,
  className,
}: {
  userId: string;
  storeId: string;
  awal?: AwalPengunjung | null;
  className?: string;
}) {
  const t = useTranslations("pwaSpgPengunjung");
  const p = usePenghitungPengunjung({ userId, storeId, awal });

  return (
    <Card className={cn("py-0", className)}>
      <CardContent className="space-y-2 p-4">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
            <Footprints className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold leading-tight">{t("mini.judul")}</p>
            <p className="text-sm tabular-nums text-muted-foreground" aria-live="polite">
              {t("mini.ringkas", { saya: p.saya, toko: p.totalToko })}
            </p>
          </div>
          <Button size="lg" className="h-12 shrink-0 px-4 text-base" onClick={p.tambah} aria-label={t("tambahLabel")}>
            <Plus className="h-5 w-5" aria-hidden />1
          </Button>
        </div>
        <div className="flex items-center justify-between gap-2">
          {p.status === "tersimpan" ? <span /> : <KeteranganSinkronPengunjung status={p.status} className="text-xs" />}
          <Link href="/pwa/spg/pengunjung" className="flex shrink-0 items-center gap-1 text-sm font-medium text-primary">
            {t("mini.buka")}
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
