"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { FileText, Loader2, Plus, ShoppingCart } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { RuangKerjaTahap } from "@/lib/production/jadwal-queries";
import { createWorkOrderFromStage } from "@/app/actions/planning";
import { formatDisplayDate } from "@/lib/date-only";
import { getStatusMeta } from "@/lib/ui/status-map";
import { TAUTAN_DOKUMEN } from "@/app/backoffice/purchase-orders/tautan-dokumen";
import { alasanTidakBisaBuatWo, bolehWoBaru } from "./ruang-kerja";
import type { IzinRuang } from "./RuangKerjaClient";

type Props = {
  data: Pick<RuangKerjaTahap, "tahap" | "wo" | "po">;
  izin: IzinRuang;
};

/** SPK tahap (buat WO dari tahap) dan PO yang dibuat untuk tahap ini. */
export function KartuDokumen({ data, izin }: Props) {
  const t = useTranslations("jadwalProduksi.ruang");
  const tStatus = useTranslations("statuses");
  const tWo = useTranslations("planning.toasts");
  const locale = useLocale();
  const router = useRouter();
  const [membuatWo, setMembuatWo] = useState(false);
  const berjalan = useRef(false);

  const { tahap, wo, po } = data;
  const alasanWo = alasanTidakBisaBuatWo(tahap);
  const tampilBuatWo = izin.buatWo && bolehWoBaru(wo);

  const buatWo = async () => {
    if (berjalan.current) return;
    berjalan.current = true;
    setMembuatWo(true);
    try {
      const hasil = await createWorkOrderFromStage(tahap.id);
      if (!hasil.ok) {
        toast.error(
          hasil.code === "SUDAH_ADA_WO"
            ? tWo("woDariTahap.SUDAH_ADA_WO", { docNumber: hasil.docNumber ?? "" })
            : tWo.has(`woDariTahap.${hasil.code}`)
              ? tWo(`woDariTahap.${hasil.code}`)
              : tWo("createWoFailed"),
        );
        return;
      }
      toast.success(tWo("woDariTahap.berhasil", { docNumber: hasil.docNumber }));
      router.push(`/backoffice/work-orders/${hasil.id}`);
    } catch {
      toast.error(tWo("createWoFailed"));
    } finally {
      berjalan.current = false;
      setMembuatWo(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          {t("dokumenJudul")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {izin.lihatSpk ? (
          <section className="space-y-2">
            <h3 className="text-sm font-medium">{t("spk")}</h3>
            <div className="flex flex-wrap items-center gap-3">
              {wo ? (
                <>
                  <Link href={`/backoffice/work-orders/${wo.id}`} className={TAUTAN_DOKUMEN}>
                    {wo.docNumber}
                  </Link>
                  {(() => {
                    const meta = getStatusMeta("workOrder", wo.status);
                    return <StatusPill tone={meta.tone}>{tStatus(meta.labelKey)}</StatusPill>;
                  })()}
                </>
              ) : (
                <span className="text-sm text-muted-foreground">{t("spkBelum")}</span>
              )}
              {tampilBuatWo ? (
                <Button
                  type="button"
                  size="sm"
                  variant={wo ? "outline" : "default"}
                  disabled={membuatWo || !!alasanWo}
                  onClick={() => void buatWo()}
                >
                  {membuatWo ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                  {t("buatWo")}
                </Button>
              ) : null}
            </div>
            {tampilBuatWo && alasanWo ? (
              <p className="text-sm text-muted-foreground">{tWo(`woDariTahap.${alasanWo}`)}</p>
            ) : null}
          </section>
        ) : null}

        {izin.lihatPo ? (
          <section className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium">{t("po")}</h3>
              {izin.buatPo ? (
                <Button asChild size="sm" variant="outline">
                  <Link href={`/backoffice/purchase-orders/new?planStageId=${encodeURIComponent(tahap.id)}`}>
                    <ShoppingCart className="mr-2 h-4 w-4" />
                    {t("buatPo")}
                  </Link>
                </Button>
              ) : null}
            </div>
            {po.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("poKosong")}</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("kolNoPo")}</TableHead>
                      <TableHead className="min-w-[140px]">{t("kolPemasok")}</TableHead>
                      <TableHead>{t("kolStatus")}</TableHead>
                      <TableHead>{t("kolTiba")}</TableHead>
                      <TableHead className="text-right">{t("kolTotal")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {po.map((p) => {
                      const meta = getStatusMeta("purchaseOrder", p.status);
                      return (
                        <TableRow key={p.id}>
                          <TableCell>
                            <Link href={`/backoffice/purchase-orders/${p.id}`} className={TAUTAN_DOKUMEN}>
                              {p.docNumber}
                            </Link>
                          </TableCell>
                          <TableCell className="whitespace-normal">{p.supplierName}</TableCell>
                          <TableCell>
                            <StatusPill tone={meta.tone}>{tStatus(meta.labelKey)}</StatusPill>
                          </TableCell>
                          <TableCell>{p.etaDate ? formatDisplayDate(p.etaDate, locale) : "—"}</TableCell>
                          <TableCell className="text-right whitespace-nowrap">
                            Rp {p.grandTotal.toLocaleString("id-ID")}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </section>
        ) : null}

        {!izin.lihatSpk && !izin.lihatPo ? (
          <p className="text-sm text-muted-foreground">{t("dokumenTanpaIzin")}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
