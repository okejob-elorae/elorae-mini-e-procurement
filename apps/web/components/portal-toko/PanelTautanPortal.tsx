"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Copy, Link2, Loader2, MessageCircle, Plus } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { tautanWhatsApp } from "@/lib/salesman/dasbor";
import {
  buatTautanPortalAksi,
  cabutTautanPortalAksi,
  daftarTautanPortalAksi,
  type HasilDaftarTautan,
} from "@/app/actions/portal-toko";

const PILIHAN_HARI = [7, 30, 90, 180, 365];

type DataTautan = Extract<HasilDaftarTautan, { ok: true }>;

/**
 * Kelola tautan portal pesan mandiri satu toko — dipakai kartu toko di kantor
 * (`TautanPortalCard`) dan lembar di HP pemegang toko (`TombolPortalToko`).
 *
 * Yang tersimpan hanya hash token, jadi alamat lengkap tautan HANYA bisa
 * ditampilkan sekali, tepat setelah dibuat. Tautan lama tidak bisa dibagikan
 * ulang; buat yang baru, lalu cabut yang lama.
 */
export function PanelTautanPortal({
  storeId,
  namaToko,
  teleponToko,
}: {
  storeId: string;
  namaToko: string;
  teleponToko: string | null;
}) {
  const t = useTranslations("portalToko.kelola");
  const [data, setData] = useState<DataTautan | null>(null);
  const [galatMuat, setGalatMuat] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [hari, setHari] = useState<string>("");
  const [baru, setBaru] = useState<{ url: string; berlakuSampai: string } | null>(null);
  const [sibuk, mulai] = useTransition();

  const pesanGalat = useCallback(
    (code: string) => {
      const dikenal = ["FORBIDDEN", "UNAUTHORIZED", "TOKO_TIDAK_ADA", "PORTAL_NONAKTIF", "TOKO_NONAKTIF", "TANPA_PEMEGANG", "TERLALU_BANYAK", "TIDAK_SAH", "TIDAK_ADA"];
      return t(`galat.${dikenal.includes(code) ? code : "LAIN"}`);
    },
    [t],
  );

  const muat = useCallback(async () => {
    try {
      const r = await daftarTautanPortalAksi(storeId);
      if (!r.ok) {
        setGalatMuat(pesanGalat(r.code));
        return;
      }
      setGalatMuat(null);
      setData(r);
      setHari((h) => h || String(r.masaBerlakuHari));
    } catch {
      setGalatMuat(t("galat.LAIN"));
    }
  }, [storeId, pesanGalat, t]);

  useEffect(() => {
    void muat();
  }, [muat]);

  const buat = () =>
    mulai(async () => {
      const r = await buatTautanPortalAksi({ storeId, label, hari: hari ? Number(hari) : null });
      if (!r.ok) {
        toast.error(pesanGalat(r.code));
        return;
      }
      setBaru({ url: `${window.location.origin}/toko/${r.token}`, berlakuSampai: r.berlakuSampai });
      setLabel("");
      toast.success(t("dibuat"));
      await muat();
    });

  const cabut = (id: string) =>
    mulai(async () => {
      const r = await cabutTautanPortalAksi(id);
      if (!r.ok) {
        toast.error(pesanGalat(r.code));
        return;
      }
      toast.success(t("dicabut"));
      await muat();
    });

  const salin = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t("disalin"));
    } catch {
      toast.error(t("gagalSalin"));
    }
  };

  if (galatMuat) return <p className="text-sm text-destructive">{galatMuat}</p>;
  if (!data) {
    return (
      <div className="flex justify-center py-6">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label={t("memuat")} />
      </div>
    );
  }

  const bisaBuat = data.portalAktif && data.adaPemegang && data.tokoAktif;
  const pilihan = [...new Set([...PILIHAN_HARI, data.masaBerlakuHari])].sort((a, b) => a - b);
  const pesanWa = baru ? t("pesanWa", { toko: namaToko, url: baru.url, sampai: baru.berlakuSampai }) : "";
  const urlWa = baru ? tautanWhatsApp(teleponToko, pesanWa) ?? `https://wa.me/?text=${encodeURIComponent(pesanWa)}` : "";

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{t("penjelasan")}</p>

      {!data.portalAktif && <p className="rounded-md border p-3 text-sm text-muted-foreground">{t("portalMati")}</p>}
      {data.portalAktif && !data.tokoAktif && <p className="rounded-md border p-3 text-sm text-muted-foreground">{t("tokoNonaktif")}</p>}
      {data.portalAktif && data.tokoAktif && !data.adaPemegang && (
        <p className="rounded-md border p-3 text-sm text-muted-foreground">{t("tanpaPemegang")}</p>
      )}

      {baru && (
        <div className="flex flex-col gap-2 rounded-md border border-primary/40 bg-primary/5 p-3">
          <p className="text-sm font-medium">{t("baruJudul")}</p>
          <p className="text-xs text-muted-foreground">{t("baruIsi", { sampai: baru.berlakuSampai })}</p>
          <Input readOnly value={baru.url} onFocus={(e) => e.currentTarget.select()} aria-label={t("alamatTautan")} />
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => void salin(baru.url)}>
              <Copy className="h-4 w-4" aria-hidden />
              {t("salin")}
            </Button>
            <Button asChild>
              <a href={urlWa} target="_blank" rel="noopener noreferrer">
                <MessageCircle className="h-4 w-4" aria-hidden />
                {t("kirimWa")}
              </a>
            </Button>
          </div>
        </div>
      )}

      {bisaBuat && (
        <div className="flex flex-col gap-3 rounded-md border p-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`portal-label-${storeId}`}>{t("label")}</Label>
            <Input
              id={`portal-label-${storeId}`}
              value={label}
              maxLength={60}
              placeholder={t("labelContoh")}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>{t("masaBerlaku")}</Label>
            <Select value={hari} onValueChange={setHari}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pilihan.map((h) => (
                  <SelectItem key={h} value={String(h)}>
                    {h === data.masaBerlakuHari ? t("hariBawaan", { hari: h }) : t("hari", { hari: h })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type="button" onClick={buat} disabled={sibuk}>
            {sibuk ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
            {t("buat")}
          </Button>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">{t("daftarJudul")}</p>
        {data.tautan.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("kosong")}</p>
        ) : (
          data.tautan.map((l) => (
            <div key={l.id} className="flex items-start gap-3 rounded-md border p-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <Link2 className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0 flex-1 text-sm">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium">{l.label ?? t("tanpaLabel")}</span>
                  <Badge variant={l.keadaan === "AKTIF" ? "secondary" : "outline"}>{t(`keadaan.${l.keadaan}`)}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">{t("dibuatOleh", { tanggal: l.dibuat, nama: l.pembuat ?? "—" })}</p>
                {l.keadaan === "DICABUT" && l.dicabut ? (
                  <p className="text-xs text-muted-foreground">{t("dicabutPada", { tanggal: l.dicabut })}</p>
                ) : (
                  l.berlakuSampai && <p className="text-xs text-muted-foreground">{t("berlakuSampai", { tanggal: l.berlakuSampai })}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  {l.terakhirDipakai ? t("terakhirDipakai", { tanggal: l.terakhirDipakai }) : t("belumDipakai")}
                </p>
              </div>
              {l.keadaan === "AKTIF" && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button type="button" variant="outline" size="sm" disabled={sibuk}>
                      {t("cabut")}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{t("cabutJudul")}</AlertDialogTitle>
                      <AlertDialogDescription>{t("cabutIsi")}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{t("batal")}</AlertDialogCancel>
                      <AlertDialogAction onClick={() => cabut(l.id)}>{t("cabut")}</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
