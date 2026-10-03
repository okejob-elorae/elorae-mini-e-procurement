"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ImageIcon, Plus, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { dinamis } from "@/lib/i18n/dinamis";
import { formatIDR } from "@/lib/sales-orders/format";
import { STATUS_BIAYA } from "@/lib/salesman/biaya";
import type { BiayaSayaBulan } from "@/lib/salesman/biaya-queries";
import { cn } from "@/lib/utils";
import { IkonKategori, nadaStatus } from "./tampilan";

export function BiayaSayaClient({
  bulan,
  pilihanBulan,
  aktif,
  data,
}: {
  bulan: string;
  pilihanBulan: { kunci: string; label: string }[];
  aktif: boolean;
  data: BiayaSayaBulan;
}) {
  const t = useTranslations("pwa.biaya");
  const td = dinamis(t);
  const router = useRouter();

  return (
    <div className="space-y-4 p-4">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h1 className="text-2xl font-bold">{t("judul")}</h1>
          <p className="text-sm text-muted-foreground">{t("subjudul")}</p>
        </div>
        {aktif ? (
          <Button asChild className="shrink-0">
            <Link href="/pwa/biaya/baru">
              <Plus className="mr-1 h-4 w-4" aria-hidden />
              {t("ajukan")}
            </Link>
          </Button>
        ) : null}
      </header>

      {!aktif ? (
        <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">{t("nonaktif")}</p>
      ) : null}

      <section className="beranda-kartu space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="beranda-judul">{t("ringkasanJudul")}</h2>
          <Select value={bulan} onValueChange={(v) => router.replace(`/pwa/biaya?bulan=${v}`)}>
            <SelectTrigger className="w-44" aria-label={t("pilihBulan")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pilihanBulan.map((b) => (
                <SelectItem key={b.kunci} value={b.kunci}>
                  {b.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <ul className="grid grid-cols-2 gap-2">
          {STATUS_BIAYA.map((s) => (
            <li key={s} className="rounded-lg border px-3 py-2">
              <span className="block text-xs text-muted-foreground">{td(`status.${s}`)}</span>
              <span className="block font-semibold tabular-nums">{formatIDR(data.perStatus[s].nilai)}</span>
              <span className="block text-xs text-muted-foreground">{t("jumlahKlaim", { n: data.perStatus[s].jumlah })}</span>
            </li>
          ))}
        </ul>
      </section>

      {data.baris.length === 0 ? (
        <section className="beranda-kartu space-y-2 text-center">
          <Receipt className="mx-auto h-8 w-8 text-muted-foreground/50" aria-hidden />
          <p className="text-sm text-muted-foreground">{t("kosong")}</p>
        </section>
      ) : (
        <section className="beranda-kartu beranda-kartu-daftar" aria-label={t("daftarJudul")}>
          <ul className="divide-y">
            {data.baris.map((b) => {
              return (
                <li key={b.id} className="flex min-h-14 gap-3 px-4 py-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                    <IkonKategori kategori={b.kategori} className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      <span className="min-w-0">
                        <span className="block font-medium leading-tight">{td(`kategori.${b.kategori}`)}</span>
                        <span className="block text-xs text-muted-foreground">
                          {b.tanggal}
                          {b.toko ? ` · ${b.toko}` : ""}
                        </span>
                      </span>
                      <span className="shrink-0 font-semibold tabular-nums">{formatIDR(b.nilai)}</span>
                    </div>
                    {b.catatan ? <p className="text-sm text-muted-foreground">{b.catatan}</p> : null}
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", nadaStatus(b.status))}>
                        {td(`status.${b.status}`)}
                      </span>
                      {b.fotoUrl ? (
                        <a
                          href={b.fotoUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex min-h-11 items-center gap-1 text-xs font-medium underline decoration-primary decoration-2 underline-offset-4"
                        >
                          <ImageIcon className="h-3.5 w-3.5" aria-hidden />
                          {t("lihatStruk")}
                        </a>
                      ) : null}
                    </div>
                    {b.alasanTolak ? (
                      <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                        {t("alasanTolak", { alasan: b.alasanTolak })}
                      </p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {data.total.jumlah > 0 ? (
        <p className="text-center text-xs text-muted-foreground">
          {t("totalBulan", { n: data.total.jumlah, nilai: formatIDR(data.total.nilai) })}
        </p>
      ) : null}
    </div>
  );
}
