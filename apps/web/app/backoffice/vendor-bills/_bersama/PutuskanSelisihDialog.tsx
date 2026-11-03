"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatIDR } from "@/lib/sales-orders/format";
import { putuskanSelisihHargaAction } from "@/app/actions/vendor-bill-koreksi";

export type KoreksiUntukDialog = {
  id: string;
  vendorInvoiceNo: string;
  penerimaan: string;
  barang: string;
  qty: number;
  recordedPrice: number;
  invoicePrice: number;
  amount: number;
  /** Baris ikut membukukan ongkos jahit lama: "Koreksi invoice" ditolak (ADA_CMT_LAMA). */
  adaCmtLama: boolean;
  /** Barang yang ditagih pada kunci GRN ini sudah diretur ke pemasok: "Terima" ditolak (ADA_RETUR). */
  adaRetur: boolean;
  /** Sudah dibayar atas penerimaan itu (sen), untuk kalimat lebih bayar saat invoice lebih rendah (P53). */
  dibayarSen: number | null;
  /** Utang penerimaan sekarang (sen). */
  utangSen: number | null;
};

/**
 * Putuskan satu selisih harga invoice (keputusan pemilik 2026-11-02, P27 + P53): Terima (dua arah), atau
 * Koreksi invoice ke harga penerimaan (hanya invoice lebih tinggi, dan tidak untuk baris yang ikut
 * membukukan ongkos jahit lama). Terima tidak ditawarkan kalau barang yang ditagih sudah diretur ke
 * pemasok (`ADA_RETUR`, penulisnya juga menolak). Hanya dibuka pemegang `vendor_bills:decide_price`.
 */
export function PutuskanSelisihDialog({ koreksi, onClose }: { koreksi: KoreksiUntukDialog | null; onClose: () => void }) {
  const t = useTranslations("vendorBills.selisih");
  const router = useRouter();
  const [catatan, setCatatan] = useState("");
  const [pending, mulai] = useTransition();

  if (!koreksi) return null;
  const naik = koreksi.amount > 0;
  const bolehKoreksi = naik && !koreksi.adaCmtLama;
  const lebihBayarSen =
    !naik && koreksi.dibayarSen != null && koreksi.utangSen != null ? koreksi.dibayarSen - (koreksi.utangSen + Math.round(koreksi.amount * 100)) : 0;

  const putuskan = (keputusan: "TERIMA" | "KOREKSI_INVOICE") =>
    mulai(async () => {
      const r = await putuskanSelisihHargaAction({ koreksiId: koreksi.id, keputusan, catatan: catatan || undefined });
      if (!r.ok) {
        toast.error(r.kode === "UNMAPPED_ROLE" ? t("galat.UNMAPPED_ROLE", { peran: r.peran ?? "" }) : t.has(`galat.${r.kode}`) ? t(`galat.${r.kode}`) : t("galat.GAGAL"));
        return;
      }
      toast.success(keputusan === "TERIMA" ? t("diterimaToast") : t("dikoreksiToast"));
      setCatatan("");
      onClose();
      router.refresh();
    });

  return (
    <Dialog open onOpenChange={(v) => !v && !pending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("dialogJudul", { invoice: koreksi.vendorInvoiceNo })}</DialogTitle>
          <DialogDescription>
            {t("dialogIsi", {
              penerimaan: koreksi.penerimaan,
              barang: koreksi.barang,
              qty: koreksi.qty.toLocaleString("id-ID"),
              tercatat: formatIDR(koreksi.recordedPrice),
              invoice: formatIDR(koreksi.invoicePrice),
            })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          {koreksi.adaRetur ? (
            <p className="text-amber-700 dark:text-amber-400">{t("galat.ADA_RETUR")}</p>
          ) : (
            <p>{naik ? t("terimaNaik", { selisih: formatIDR(koreksi.amount) }) : t("terimaTurun", { selisih: formatIDR(-koreksi.amount) })}</p>
          )}
          {!koreksi.adaRetur && lebihBayarSen > 0 && (
            <p className="text-amber-700 dark:text-amber-400">
              {t("lebihBayar", { dibayar: formatIDR((koreksi.dibayarSen ?? 0) / 100), lebih: formatIDR(lebihBayarSen / 100) })}
            </p>
          )}
          {naik && !koreksi.adaCmtLama && <p className="text-muted-foreground">{t("koreksiInvoiceIsi", { harga: formatIDR(koreksi.recordedPrice) })}</p>}
          {naik && koreksi.adaCmtLama && <p className="text-muted-foreground">{t("galat.ADA_CMT_LAMA")}</p>}
          {!naik && !koreksi.adaRetur && <p className="text-muted-foreground">{t("tidakBolehNaik")}</p>}
          <div className="space-y-2">
            <Label htmlFor="catatan-selisih">{t("catatan")}</Label>
            <Textarea id="catatan-selisih" rows={2} maxLength={500} value={catatan} onChange={(e) => setCatatan(e.target.value)} />
          </div>
        </div>
        <DialogFooter className="gap-2">
          {bolehKoreksi && (
            <Button variant="outline" disabled={pending} onClick={() => putuskan("KOREKSI_INVOICE")}>
              {t("koreksiInvoice", { harga: formatIDR(koreksi.recordedPrice) })}
            </Button>
          )}
          {!koreksi.adaRetur && (
            <Button disabled={pending} onClick={() => putuskan("TERIMA")}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("terima")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
