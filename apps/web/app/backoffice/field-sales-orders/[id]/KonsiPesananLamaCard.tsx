"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { PackageCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { batalKirimPesananLamaAction } from "@/app/actions/field-sales-orders-konsi-lama";
import { BATAS_ALASAN_BATAL_KIRIM, type PenerimaDiharapkan } from "@/lib/field-sales/konsi-transfer/pesanan-lama-aturan";
import type { FieldSalesDeliveryStatus } from "@/lib/field-sales/queries";
import { formatDisplayDateTime } from "@/lib/date-only";
import { dinamis } from "@/lib/i18n/dinamis";
import { DELIVERY_BADGE_CLASS, DELIVERY_BADGE_VARIANT } from "../delivery-status-badge";

/** Pesanan konsinyasi lama di halaman kantor — dari `bacaPesananKonsiCadanganLama` + riwayat konfirmasinya. */
export type PesananLamaKantor = {
  /** Masih ada sisa yang dicadangkan dan menunggu konfirmasi toko. */
  menunggu: boolean;
  baris: Array<{ lineId: string; productName: string; variantSku: string; sisa: number }>;
  penerima: PenerimaDiharapkan;
  namaPemegang: string | null;
  kedatangan: Array<{
    transferId: string;
    docNo: string;
    createdAt: Date;
    oleh: string | null;
    pcs: number;
    pcsSesudahOpname: number;
  }>;
};

const ACTION_SLOT_CLASS = [
  "flex flex-wrap gap-2 justify-end",
  "max-sm:col-start-1 max-sm:row-start-2 max-sm:row-span-1",
  "max-sm:justify-self-start max-sm:justify-start",
].join(" ");

/**
 * Pesanan konsinyasi LAMA (disetujui sebelum alur per antaran berjalan, cadangannya masih
 * ditahan). Kantor TIDAK mengonfirmasi barang sampai — itu pekerjaan SPG toko (atau salesman
 * pemegang toko tanpa SPG) dari HP. Yang bisa dilakukan di sini hanya "Tidak jadi dikirim": sisa
 * ditutup dan cadangannya dilepas, dengan alasan, tercatat di jejak. Tombolnya memeriksa izin yang
 * sama dengan aksinya (`field_sales_orders:deliver`).
 */
export function KonsiPesananLamaCard({
  orderId,
  deliveryStatus,
  pesananLama,
  canDeliver,
}: {
  orderId: string;
  deliveryStatus: FieldSalesDeliveryStatus;
  pesananLama: PesananLamaKantor;
  canDeliver: boolean;
}) {
  const t = useTranslations("fieldSalesOrders.pesananLama");
  const td = dinamis(t);
  const tDelivery = useTranslations("fieldSalesOrders");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [buka, setBuka] = useState(false);
  const [alasan, setAlasan] = useState("");

  const sisaPcs = pesananLama.baris.reduce((n, b) => n + b.sisa, 0);
  const penerimaTeks =
    pesananLama.penerima === "SPG"
      ? t("penerimaSPG")
      : pesananLama.penerima === "SALESMAN"
        ? t("penerimaSALESMAN", { nama: pesananLama.namaPemegang ?? t("pemegangTanpaNama") })
        : t("penerimaTANPA_PENERIMA");

  function tandai(): void {
    const teks = alasan.trim();
    if (!teks) return;
    startTransition(async () => {
      try {
        const r = await batalKirimPesananLamaAction(orderId, teks);
        if (r.ok) {
          toast.success(t("berhasil"));
          setBuka(false);
          setAlasan("");
          router.refresh();
          return;
        }
        toast.error(td(`err.${r.code}`));
      } catch {
        toast.error(tDelivery("errGeneric"));
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <PackageCheck className="h-5 w-5" />
          {t("judul")}
          {pesananLama.menunggu ? (
            <Badge variant="outline" className="border-amber-500/40 text-amber-700">
              {t("lencanaMenunggu")}
            </Badge>
          ) : (
            <Badge variant={DELIVERY_BADGE_VARIANT[deliveryStatus]} className={DELIVERY_BADGE_CLASS[deliveryStatus]}>
              {tDelivery(`delivery.status.${deliveryStatus}`)}
            </Badge>
          )}
        </CardTitle>
        {pesananLama.menunggu && canDeliver && (
          <CardAction className={ACTION_SLOT_CLASS}>
            <Button variant="outline" className="h-10" disabled={isPending} onClick={() => setBuka(true)}>
              {t("tidakJadiDikirim")}
            </Button>
          </CardAction>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{t("penjelasan")}</p>
        {pesananLama.menunggu && <p className="text-sm">{penerimaTeks}</p>}

        {pesananLama.menunggu && (
          <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("sisaJudul", { pcs: sisaPcs })}</div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tDelivery("colProduct")}</TableHead>
                  <TableHead>{tDelivery("colVariant")}</TableHead>
                  <TableHead className="text-right">{t("kolomSisa")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pesananLama.baris.map((b) => (
                  <TableRow key={b.lineId}>
                    <TableCell className="min-w-[12rem] whitespace-normal">{b.productName}</TableCell>
                    <TableCell className="font-mono text-sm">{b.variantSku || "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{b.sisa}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <div className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("riwayatJudul")}</div>
          {pesananLama.kedatangan.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("riwayatKosong")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("kolomDokumen")}</TableHead>
                  <TableHead>{t("kolomTanggal")}</TableHead>
                  <TableHead>{t("kolomOleh")}</TableHead>
                  <TableHead className="text-right">{t("kolomPcs")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pesananLama.kedatangan.map((k) => (
                  <TableRow key={k.transferId}>
                    <TableCell className="font-mono whitespace-nowrap">
                      {k.docNo}
                      {k.pcsSesudahOpname > 0 && (
                        <div className="whitespace-normal font-sans text-xs text-muted-foreground">
                          {t("sesudahOpname", { pcs: k.pcsSesudahOpname })}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{formatDisplayDateTime(k.createdAt)}</TableCell>
                    <TableCell>{k.oleh ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{k.pcs}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </CardContent>

      <AlertDialog
        open={buka}
        onOpenChange={(open) => {
          if (isPending) return;
          setBuka(open);
          if (!open) setAlasan("");
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("dialogJudul")}</AlertDialogTitle>
            <AlertDialogDescription>{t("dialogIsi", { pcs: sisaPcs })}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1">
            <Label htmlFor="konsi-lama-alasan" className="text-xs text-muted-foreground">
              {t("alasanLabel")}
            </Label>
            <Textarea
              id="konsi-lama-alasan"
              value={alasan}
              onChange={(e) => setAlasan(e.target.value.slice(0, BATAS_ALASAN_BATAL_KIRIM))}
              disabled={isPending}
              rows={3}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-10" disabled={isPending}>
              {tCommon("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="h-10"
              disabled={isPending || !alasan.trim()}
              onClick={(e) => {
                /* Keep the dialog open so the pending label is visible; it closes on success. */
                e.preventDefault();
                tandai();
              }}
            >
              {isPending ? tDelivery("delivery.submitting") : t("tidakJadiDikirim")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
