"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Scissors } from "lucide-react";
import { tandaiSalesDipotongAction } from "@/app/actions/barang-hilang";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { dinamis } from "@/lib/i18n/dinamis";
import { newLocalId } from "@/lib/pwa/id-lokal";
import { bacaIsianRupiah, BATAS_TEKS_HILANG, keSen, tulisIsianRupiah } from "@/lib/spg/hilang";
import { formatIDR } from "@/lib/sales-orders/format";

/**
 * Laporan komisi salesman: kantor menandai beban barang hilang (bagian SALES)
 * sudah dipotong dari komisi bulan ini. Penggajian salesman belum ada di
 * sistem, jadi potongannya terjadi di luar dan dicatat di sini. Jumlahnya
 * dibagikan ke beban terlama dulu; satu kunci per formulir (klik ganda aman).
 */
export function TandaiDipotongDialog({
  salesmanId,
  nama,
  bulan,
  bulanLabel,
  sisa,
  saran,
  maksPotongPersen,
}: {
  salesmanId: string;
  nama: string;
  bulan: string;
  bulanLabel: string;
  sisa: number;
  saran: number;
  maksPotongPersen: number;
}) {
  const t = useTranslations("komisiSalesmanHilang");
  const td = dinamis(t);
  const router = useRouter();
  const [buka, setBuka] = useState(false);
  const [sibuk, mulai] = useTransition();
  const [kunci, setKunci] = useState(() => newLocalId());
  const [jumlah, setJumlah] = useState(saran > 0 ? tulisIsianRupiah(saran) : "");
  const [catatan, setCatatan] = useState("");

  const angka = bacaIsianRupiah(jumlah);
  const kurang =
    angka === null || angka <= 0 ? t("kurangJumlah") : keSen(angka) > keSen(sisa) ? t("melebihiSisa", { sisa: formatIDR(sisa) }) : null;

  const kirim = () =>
    mulai(async () => {
      if (angka === null) return;
      let r: Awaited<ReturnType<typeof tandaiSalesDipotongAction>>;
      try {
        r = await tandaiSalesDipotongAction({ salesmanId, bulan, jumlah: angka, kunci, catatan: catatan.trim() || null });
      } catch {
        toast.error(t("err.NETWORK"));
        return;
      }
      if (!r.ok) {
        toast.error(td(`err.${r.code}`));
        return;
      }
      toast.success(t("ok", { nilai: formatIDR(r.dipotong), nama }));
      setBuka(false);
      setKunci(newLocalId());
      setCatatan("");
      router.refresh();
    });

  return (
    <Dialog
      open={buka}
      onOpenChange={(o) => {
        setBuka(o);
        if (o) setJumlah(saran > 0 ? tulisIsianRupiah(saran) : "");
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="mt-1">
          <Scissors className="mr-1.5 h-3.5 w-3.5" />
          {t("tombol")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("judul", { nama })}</DialogTitle>
          <DialogDescription>{t("deskripsi", { bulan: bulanLabel, sisa: formatIDR(sisa), persen: maksPotongPersen })}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor={`potong-${salesmanId}`}>{t("jumlah")}</Label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Rp</span>
              <Input
                id={`potong-${salesmanId}`}
                inputMode="decimal"
                value={jumlah}
                onChange={(e) => setJumlah(e.target.value.replace(/[^\d.,]/g, "").slice(0, 20))}
                className="w-44 text-right tabular-nums"
                aria-invalid={kurang !== null}
              />
            </div>
            <p className="text-xs text-muted-foreground">{saran > 0 ? t("saran", { nilai: formatIDR(saran) }) : t("tanpaSaran")}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`potong-catatan-${salesmanId}`}>{t("catatan")}</Label>
            <Textarea id={`potong-catatan-${salesmanId}`} value={catatan} maxLength={BATAS_TEKS_HILANG} onChange={(e) => setCatatan(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter className="flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
          {kurang ? <p className="text-xs text-muted-foreground sm:mr-auto">{kurang}</p> : null}
          <Button onClick={kirim} disabled={sibuk || kurang !== null}>
            {sibuk ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            {t("simpan")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
