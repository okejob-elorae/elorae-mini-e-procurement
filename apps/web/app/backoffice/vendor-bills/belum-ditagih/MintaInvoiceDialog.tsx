"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Copy, Loader2, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { newLocalId } from "@/lib/pwa/id-lokal";
import { SALURAN_PERMINTAAN, susunPesanMintaInvoice, tautanWaPermintaan, type SaluranPermintaan } from "@/lib/vendor-billing/permintaan-invoice-pesan";
import { mintaInvoiceAction, mintaUlangInvoiceAction } from "@/app/actions/vendor-bill-permintaan";

export type BarisPesan = { nomor: string; keterangan: string; tanggal: string; qty: number; nilaiSen: number | null };

/**
 * "Minta invoice" / "Minta ulang" (Q18, P19): saluran, catatan, pratinjau pesan yang disiapkan sistem,
 * "Salin pesan", "Catat & buka WhatsApp" (membuka WhatsApp tanpa menunggu), "Catat saja". Kunci kiriman
 * dibuat sekali per isian dan diganti sesudah berhasil.
 */
export function MintaInvoiceDialog({
  buka,
  onTutup,
  supplierId,
  namaPemasok,
  telepon,
  sumber,
  baris,
  ulang,
}: {
  buka: boolean;
  onTutup: () => void;
  supplierId: string;
  namaPemasok: string;
  telepon: string | null;
  /** Minta baru: sumber yang diminta. */
  sumber?: Array<{ jenis: "GRN" | "WO_STEP"; id: string }>;
  baris: BarisPesan[];
  /** Minta ulang: permintaan yang ditindaklanjuti. */
  ulang?: { requestId: string; tanggal: string } | null;
}) {
  const t = useTranslations("vendorBills.permintaan");
  const router = useRouter();
  const [saluran, setSaluran] = useState<SaluranPermintaan>("WHATSAPP");
  const [catatan, setCatatan] = useState("");
  const [kunci, setKunci] = useState(() => newLocalId());
  const [sibuk, setSibuk] = useState(false);
  const pesan = useMemo(() => susunPesanMintaInvoice({ namaPemasok, baris, ulang: ulang ? { tanggal: ulang.tanggal } : null, catatan }), [namaPemasok, baris, ulang, catatan]);

  const catat = async (bukaWa: boolean) => {
    if (bukaWa) window.open(tautanWaPermintaan(telepon, pesan), "_blank", "noopener,noreferrer");
    setSibuk(true);
    try {
      const r = ulang
        ? await mintaUlangInvoiceAction({ requestId: ulang.requestId, saluran, catatan: catatan || undefined })
        : await mintaInvoiceAction({ supplierId, sumber: sumber ?? [], saluran, catatan: catatan || undefined, idempotencyKey: kunci });
      if (!r.ok) {
        toast.error(t.has(`galat.${r.kode}`) ? t(`galat.${r.kode}`) : t("galat.GAGAL"));
        return;
      }
      toast.success(ulang ? t("diulangToast") : t("dicatatToast"));
      setKunci(newLocalId());
      setCatatan("");
      onTutup();
      router.refresh();
    } catch {
      toast.error(t("galat.GAGAL"));
    } finally {
      setSibuk(false);
    }
  };

  return (
    <Dialog open={buka} onOpenChange={(v) => !v && !sibuk && onTutup()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{ulang ? t("ulangJudul", { pemasok: namaPemasok }) : t("dialogJudul", { pemasok: namaPemasok })}</DialogTitle>
          <DialogDescription>{t("dialogIsi")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label>{t("saluranLabel")}</Label>
            <Select value={saluran} onValueChange={(v) => setSaluran(v as SaluranPermintaan)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SALURAN_PERMINTAAN.map((s) => (
                  <SelectItem key={s} value={s}>
                    {t(`saluran.${s}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="catatan-minta">{t("catatan")}</Label>
            <Textarea id="catatan-minta" rows={2} maxLength={1000} value={catatan} onChange={(e) => setCatatan(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>{t("pratinjau")}</Label>
            <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-xs">{pesan}</pre>
          </div>
        </div>
        <DialogFooter className="flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={sibuk}
            onClick={() => {
              void navigator.clipboard?.writeText(pesan).then(
                () => toast.success(t("disalin")),
                () => toast.error(t("gagalSalin")),
              );
            }}
          >
            <Copy className="mr-2 h-4 w-4" />
            {t("salin")}
          </Button>
          <Button variant="outline" disabled={sibuk} onClick={() => void catat(false)}>
            {t("catatSaja")}
          </Button>
          <Button disabled={sibuk} onClick={() => void catat(true)}>
            {sibuk ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MessageCircle className="mr-2 h-4 w-4" />}
            {t("catatBukaWa")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
