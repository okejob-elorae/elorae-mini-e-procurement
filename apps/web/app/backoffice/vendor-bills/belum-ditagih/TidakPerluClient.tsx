"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Ban } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { BarisTidakPerlu } from "@/lib/vendor-billing/tidak-perlu-invoice-queries";
import { batalkanTidakPerluInvoiceAction } from "@/app/actions/vendor-bill-permintaan";
import { AlasanDialog } from "./AlasanDialog";

/** Tab "Tidak perlu invoice" (P52): pembebasan yang berlaku dan yang sudah dibatalkan. */
export function TidakPerluClient({ baris, canManage }: { baris: BarisTidakPerlu[]; canManage: boolean }) {
  const t = useTranslations("vendorBills.tidakPerlu");
  const router = useRouter();
  const [batal, setBatal] = useState<BarisTidakPerlu | null>(null);
  return (
    <>
      <Card className="py-0">
        <CardHeader className="pt-6">
          <CardTitle className="flex items-center gap-2">
            <Ban className="h-5 w-5" />
            {t("judulTabel")}
          </CardTitle>
        </CardHeader>
        <CardContent className="pb-6">
          {baris.length === 0 ? (
            <EmptyState icon={Ban} title={t("kosong")} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("kolomPenerimaan")}</TableHead>
                    <TableHead className="text-right">{t("kolomQty")}</TableHead>
                    <TableHead>{t("kolomAlasan")}</TableHead>
                    <TableHead>{t("kolomStatus")}</TableHead>
                    <TableHead className="w-[110px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {baris.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell className="align-top whitespace-normal">
                        <div className="font-medium">{b.nomor}</div>
                        <div className="text-xs text-muted-foreground">
                          {b.supplierName}
                          {b.barang ? ` · ${b.barang}` : ""}
                          {b.variantSku ? ` · ${b.variantSku}` : ""}
                        </div>
                      </TableCell>
                      <TableCell className="align-top text-right">{b.qty.toLocaleString("id-ID")}</TableCell>
                      <TableCell className="align-top whitespace-normal text-sm">
                        {b.reason}
                        <div className="text-xs text-muted-foreground">{t("olehPada", { oleh: b.createdBy, tanggal: b.createdAt })}</div>
                      </TableCell>
                      <TableCell className="align-top whitespace-normal">
                        <Badge variant={b.cancelledAt ? "outline" : "secondary"}>{b.cancelledAt ? t("dibatalkan") : t("berlaku")}</Badge>
                        {b.cancelReason && <div className="text-xs text-muted-foreground">{b.cancelReason}</div>}
                      </TableCell>
                      <TableCell className="align-top">
                        {canManage && !b.cancelledAt && (
                          <Button size="sm" variant="ghost" onClick={() => setBatal(b)}>
                            {t("batalkan")}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
      <AlasanDialog
        buka={batal != null}
        judul={t("batalJudul", { nomor: batal?.nomor ?? "" })}
        isi={t("batalIsi")}
        tombol={t("batalkan")}
        onTutup={() => setBatal(null)}
        onKirim={async (alasan) => {
          if (!batal) return false;
          const r = await batalkanTidakPerluInvoiceAction({ waiverId: batal.id, alasan });
          if (!r.ok) {
            toast.error(t.has(`galat.${r.kode}`) ? t(`galat.${r.kode}`) : t("galat.GAGAL"));
            return false;
          }
          toast.success(t("dibatalkanToast"));
          router.refresh();
          return true;
        }}
      />
    </>
  );
}
