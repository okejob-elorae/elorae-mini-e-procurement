"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowLeft, ClipboardList } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatIDR } from "@/lib/sales-orders/format";
import type { PesananTokoPortal } from "@/lib/field-sales/portal-writer";

/**
 * "Pesanan saya" di portal toko. Datanya sudah disaring di server: tanpa harga
 * untuk konsinyasi, tanpa alasan penolakan, tanggal sudah diformat (WIB).
 */
export function PesananTokoClient({
  token,
  namaToko,
  konsi,
  pesanan,
}: {
  token: string;
  namaToko: string;
  konsi: boolean;
  pesanan: PesananTokoPortal[];
}) {
  const t = useTranslations("portalToko");
  return (
    <>
      <header className="sticky top-0 z-10 border-b bg-background/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="icon" aria-label={t("kembaliKeKatalog")}>
            <Link href={`/toko/${token}`}>
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold">{t("pesananSaya")}</h1>
            <p className="truncate text-xs text-muted-foreground">{namaToko}</p>
          </div>
        </div>
      </header>
      <main className="flex flex-1 flex-col gap-3 p-4">
        {konsi && <p className="text-sm text-muted-foreground">{t("riwayat.konsi")}</p>}
        {pesanan.length === 0 ? (
          <Card className="py-0">
            <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <ClipboardList className="h-5 w-5" aria-hidden />
              </span>
              <p className="text-sm text-muted-foreground">{t("riwayat.kosong")}</p>
              <Button asChild>
                <Link href={`/toko/${token}`}>{t("riwayat.mulai")}</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          pesanan.map((p) => (
            <Card key={p.orderNo} className="gap-2 py-3">
              <CardContent className="flex flex-col gap-2 px-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-mono text-sm font-semibold">{p.orderNo}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.tanggal} · {p.dariPortal ? t("riwayat.dariPortal") : t("riwayat.dariSalesman")}
                    </p>
                  </div>
                  <Badge variant={p.keadaan === "DITOLAK" ? "destructive" : p.keadaan === "MENUNGGU" ? "outline" : "secondary"}>
                    {t(`keadaan.${p.keadaan}`)}
                  </Badge>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{t("riwayat.ringkas", { baris: p.baris.length, pcs: p.jumlahPcs })}</span>
                  {p.total !== undefined && <span className="font-semibold tabular-nums">{formatIDR(p.total)}</span>}
                </div>
                {p.keadaan === "DITOLAK" && <p className="text-xs text-muted-foreground">{t("riwayat.ditolakIsi")}</p>}
                <details className="text-sm">
                  <summary className="cursor-pointer py-2 text-muted-foreground">{t("riwayat.lihatBarang")}</summary>
                  <ul className="flex flex-col gap-1 pt-1">
                    {p.baris.map((b, i) => (
                      <li key={i} className="flex justify-between gap-2">
                        {/* Baris bonus sudah bernama "… (bonus)" dari penulis pesanan. */}
                        <span className="min-w-0">{b.nama}</span>
                        <span className="shrink-0 tabular-nums">{t("riwayat.pcs", { qty: b.qty })}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              </CardContent>
            </Card>
          ))
        )}
      </main>
    </>
  );
}
