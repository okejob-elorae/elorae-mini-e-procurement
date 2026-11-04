"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { BarChart3, BookImage, ClipboardCheck, Copy, Plus, Trash2 } from "lucide-react";
import {
  aturAktifTemplateChecklistAction,
  hapusTemplateChecklistAction,
  type HasilUbahTemplate,
} from "@/app/actions/checklist-toko";
import type { BarisTemplateChecklist } from "@/lib/salesman/checklist-queries";
import { dinamis } from "@/lib/i18n/dinamis";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function TemplateListClient({ baris, bolehKelola }: { baris: BarisTemplateChecklist[]; bolehKelola: boolean }) {
  const t = useTranslations("checklistToko");
  const td = dinamis(t);
  const router = useRouter();
  const [sibuk, mulai] = useTransition();
  const [hapus, setHapus] = useState<BarisTemplateChecklist | null>(null);

  const laporGagal = (r: HasilUbahTemplate) => {
    if (!r.ok) toast.error(td(`err.${r.kode}`));
  };

  const aturAktif = (id: string, aktif: boolean) =>
    mulai(async () => {
      const r = await aturAktifTemplateChecklistAction(id, aktif);
      if (!r.ok) return laporGagal(r);
      toast.success(aktif ? t("diaktifkan") : t("dinonaktifkan"));
      router.refresh();
    });

  const hapusSekarang = () =>
    mulai(async () => {
      if (!hapus) return;
      const r = await hapusTemplateChecklistAction(hapus.id);
      setHapus(null);
      if (!r.ok) return laporGagal(r);
      toast.success(t("dihapus"));
      router.refresh();
    });

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("judul")}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href="/backoffice/checklist-toko/laporan">
                <BarChart3 className="h-4 w-4" aria-hidden />
                {t("keLaporan")}
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/backoffice/panduan-display">
                <BookImage className="h-4 w-4" aria-hidden />
                {t("kePanduan")}
              </Link>
            </Button>
            {bolehKelola ? (
              <>
                <Button asChild variant="outline">
                  <Link href="/backoffice/checklist-toko/baru?bawaan=1">
                    <Copy className="h-4 w-4" aria-hidden />
                    {t("salinBawaan")}
                  </Link>
                </Button>
                <Button asChild>
                  <Link href="/backoffice/checklist-toko/baru">
                    <Plus className="h-4 w-4" aria-hidden />
                    {t("templateBaru")}
                  </Link>
                </Button>
              </>
            ) : null}
          </div>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ClipboardCheck className="h-4 w-4" aria-hidden />
            {t("daftarJudul")}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {baris.length === 0 ? (
            <EmptyState
              icon={ClipboardCheck}
              title={t("kosongJudul")}
              description={t("kosongIsi")}
              action={
                bolehKelola ? (
                  <Button asChild>
                    <Link href="/backoffice/checklist-toko/baru?bawaan=1">
                      <Copy className="h-4 w-4" aria-hidden />
                      {t("salinBawaan")}
                    </Link>
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("kolNama")}</TableHead>
                    <TableHead>{t("kolJenisToko")}</TableHead>
                    <TableHead className="text-right">{t("kolPertanyaan")}</TableHead>
                    <TableHead className="text-right">{t("kolBobot")}</TableHead>
                    <TableHead className="text-right">{t("kolHasil")}</TableHead>
                    <TableHead className="hidden 2xl:table-cell">{t("kolDiubah")}</TableHead>
                    <TableHead>{t("kolAktif")}</TableHead>
                    {bolehKelola ? <TableHead className="w-0" /> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {baris.map((b) => (
                    <TableRow key={b.id} className={b.isActive ? undefined : "text-muted-foreground"}>
                      <TableCell className="whitespace-normal font-medium">
                        <Link href={`/backoffice/checklist-toko/${b.id}`} className="hover:underline">
                          {b.nama}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{b.termsType ? td(`jenisToko.${b.termsType}`) : t("jenisToko.SEMUA")}</Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{b.jumlahPertanyaan}</TableCell>
                      <TableCell className="text-right tabular-nums">{b.totalBobot}</TableCell>
                      <TableCell className="text-right tabular-nums">{b.jumlahHasil}</TableCell>
                      <TableCell className="hidden 2xl:table-cell">{b.diubah}</TableCell>
                      <TableCell>
                        <Switch
                          checked={b.isActive}
                          disabled={!bolehKelola || sibuk}
                          onCheckedChange={(v) => aturAktif(b.id, v)}
                          aria-label={t("kolAktif")}
                        />
                      </TableCell>
                      {bolehKelola ? (
                        <TableCell>
                          {b.jumlahHasil === 0 ? (
                            <Button variant="ghost" size="icon" aria-label={t("hapus")} disabled={sibuk} onClick={() => setHapus(b)}>
                              <Trash2 className="h-4 w-4" aria-hidden />
                            </Button>
                          ) : null}
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={hapus !== null} onOpenChange={(o) => (!o ? setHapus(null) : undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("hapusJudul")}</AlertDialogTitle>
            <AlertDialogDescription>{t("hapusIsi", { nama: hapus?.nama ?? "" })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sibuk}>{t("batal")}</AlertDialogCancel>
            <AlertDialogAction disabled={sibuk} onClick={hapusSekarang}>
              {t("hapus")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
