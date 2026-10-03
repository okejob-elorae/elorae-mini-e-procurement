"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Megaphone, Pin, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { KEADAAN_PENGUMUMAN, type KeadaanPengumuman } from "@/lib/pengumuman/aturan";
import type { BarisPengumumanKantor } from "@/lib/pengumuman/queries";
import { LencanaAudiens, LencanaKeadaan } from "./Lencana";

export function PengumumanPageClient({
  baris,
  keadaan,
  q,
  terpotong,
  canManage,
}: {
  baris: BarisPengumumanKantor[];
  keadaan: KeadaanPengumuman | "SEMUA";
  q: string;
  terpotong: number | null;
  canManage: boolean;
}) {
  const t = useTranslations("pengumuman");
  const router = useRouter();
  const sp = useSearchParams();
  const [, startTransition] = useTransition();
  const [cari, setCari] = useState(q);

  function pushParam(key: string, value: string | undefined) {
    const params = new URLSearchParams(sp.toString());
    if (!value) params.delete(key);
    else params.set(key, value);
    const qs = params.toString();
    startTransition(() => router.push(`/backoffice/pengumuman${qs ? `?${qs}` : ""}`));
  }

  useEffect(() => {
    const h = setTimeout(() => {
      if (cari !== q) pushParam("q", cari.trim() || undefined);
    }, 300);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cari]);

  const adaSaringan = keadaan !== "SEMUA" || q !== "";
  const buat = canManage ? (
    <Button asChild>
      <Link href="/backoffice/pengumuman/baru">
        <Plus className="mr-2 h-4 w-4" />
        {t("buat")}
      </Link>
    </Button>
  ) : null;

  return (
    <div className="space-y-6">
      <PageHeader title={t("judul")} description={t("deskripsi")} actions={buat} />

      <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input placeholder={t("cari")} value={cari} onChange={(e) => setCari(e.target.value)} className="pl-9" aria-label={t("cari")} />
        </div>
        <Tabs value={keadaan} onValueChange={(v) => pushParam("keadaan", v === "SEMUA" ? undefined : v)}>
          <TabsList aria-label={t("saringKeadaan")} className="flex-wrap">
            <TabsTrigger value="SEMUA">{t("semuaKeadaan")}</TabsTrigger>
            {KEADAAN_PENGUMUMAN.map((k) => (
              <TabsTrigger key={k} value={k}>
                {t(`keadaan.${k}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Megaphone className="h-5 w-5" aria-hidden />
            {t("daftarJudul")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {baris.length === 0 ? (
            adaSaringan ? (
              <EmptyState icon={Megaphone} title={t("kosongSaringJudul")} description={t("kosongSaringIsi")} />
            ) : (
              <EmptyState
                icon={Megaphone}
                title={t("kosongJudul")}
                description={t("kosongIsi")}
                action={
                  canManage ? (
                    <Button asChild variant="outline">
                      <Link href="/backoffice/pengumuman/baru">{t("buat")}</Link>
                    </Button>
                  ) : undefined
                }
              />
            )
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("kolom.judul")}</TableHead>
                    <TableHead>{t("kolom.sasaran")}</TableHead>
                    <TableHead>{t("kolom.keadaan")}</TableHead>
                    <TableHead>{t("kolom.terbit")}</TableHead>
                    <TableHead className="hidden 2xl:table-cell">{t("kolom.berakhir")}</TableHead>
                    <TableHead className="text-right">{t("kolom.dibaca")}</TableHead>
                    <TableHead className="hidden 2xl:table-cell">{t("kolom.pembuat")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {baris.map((b) => (
                    <TableRow
                      key={b.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => startTransition(() => router.push(`/backoffice/pengumuman/${b.id}`))}
                    >
                      <TableCell className="min-w-[12rem] max-w-[22rem] whitespace-normal">
                        <Link
                          href={`/backoffice/pengumuman/${b.id}`}
                          className="font-medium hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {b.pinned ? <Pin className="mr-1 inline h-3.5 w-3.5 text-amber-700 dark:text-amber-400" aria-label={t("disematkan")} /> : null}
                          {b.title}
                        </Link>
                        {b.requireAck ? <div className="text-xs text-muted-foreground">{t("wajibKonfirmasi")}</div> : null}
                      </TableCell>
                      <TableCell>
                        <LencanaAudiens audience={b.audience} />
                      </TableCell>
                      <TableCell>
                        <LencanaKeadaan keadaan={b.keadaan} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm tabular-nums">{b.terbit}</TableCell>
                      <TableCell className="hidden whitespace-nowrap text-sm tabular-nums 2xl:table-cell">{b.kedaluwarsa ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {b.dibaca}
                        <span className="text-muted-foreground"> / {b.penerima}</span>
                        {b.requireAck ? (
                          <div className="text-xs text-muted-foreground">{t("dikonfirmasiN", { n: b.dikonfirmasi })}</div>
                        ) : null}
                      </TableCell>
                      <TableCell className="hidden text-sm 2xl:table-cell">{b.pembuat}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {terpotong ? <p className="mt-3 text-xs text-muted-foreground">{t("terpotong", { n: terpotong })}</p> : null}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
