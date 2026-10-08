"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { TanggalInput } from "@/components/ui/tanggal-input";
import { ambilPengaturanPajakAction, simpanIdentitasPajakAction, simpanPengaturanPpnAction, simpanProfilPajakAction } from "@/app/actions/finance-pajak";
import { SEMUA_STATUS_PKP, tarifEfektif, type PengaturanPpn } from "@/lib/finance/pajak/ppn";
import { SEMUA_BENTUK_USAHA, SEMUA_REZIM_PPH, finalUmkmPerluDicek, type ProfilPajak } from "@/lib/finance/pajak/profil";
import type { IdentitasPajak } from "@/lib/finance/pajak/identitas";

/**
 * Pengaturan → Pajak: status PKP & PPN perusahaan (`pajak.ppn`), profil PPh
 * (`pajak.profil`) dan identitas pajak (`pajak.identitas`). Setiap simpan
 * tercatat di jejak audit. Mengubah butuh `settings_tax:manage`.
 */
export function KartuPajakPerusahaan() {
  const t = useTranslations("tax.perusahaan");
  const [data, setData] = useState<{ ppn: PengaturanPpn; profil: ProfilPajak; identitas: IdentitasPajak; bolehUbah: boolean } | null>(null);
  const [ppn, setPpn] = useState<{ statusPkp: string; tarifPersen: string; pakaiDppNilaiLain: boolean; hargaJualTermasukPpn: boolean; berlakuSejak: string } | null>(null);
  const [profil, setProfil] = useState<{ bentukUsaha: string; rezimPph: string; sejak: string; npwp: string; nitku: string; nama: string } | null>(null);
  const [simpanPpn, mulaiPpn] = useTransition();
  const [simpanProfil, mulaiProfil] = useTransition();

  useEffect(() => {
    let batal = false;
    ambilPengaturanPajakAction()
      .then((h) => {
        if (batal) return;
        if (!h.ok) {
          toast.error(t("gagalMuat"));
          return;
        }
        setData(h);
        setPpn({
          statusPkp: h.ppn.statusPkp,
          tarifPersen: String(h.ppn.tarifPersen),
          pakaiDppNilaiLain: h.ppn.pakaiDppNilaiLain,
          hargaJualTermasukPpn: h.ppn.hargaJualTermasukPpn,
          berlakuSejak: h.ppn.berlakuSejak ?? "",
        });
        setProfil({
          bentukUsaha: h.profil.bentukUsaha,
          rezimPph: h.profil.rezimPph,
          sejak: h.profil.sejak ?? "",
          npwp: h.identitas.npwp ?? "",
          nitku: h.identitas.nitku ?? "",
          nama: h.identitas.nama ?? "",
        });
      })
      .catch(() => !batal && toast.error(t("gagalMuat")));
    return () => {
      batal = true;
    };
  }, [t]);

  const bolehUbah = data?.bolehUbah ?? false;

  const kirimPpn = () =>
    mulaiPpn(async () => {
      if (!ppn) return;
      const h = await simpanPengaturanPpnAction({
        statusPkp: ppn.statusPkp,
        tarifPersen: ppn.tarifPersen,
        pakaiDppNilaiLain: ppn.pakaiDppNilaiLain,
        hargaJualTermasukPpn: ppn.hargaJualTermasukPpn,
        berlakuSejak: ppn.berlakuSejak || null,
      });
      if (!h.ok) toast.error(t.has(`err.${h.kode}`) ? t(`err.${h.kode}`) : t("err.GAGAL"));
      else toast.success(t("ppnTersimpan"));
    });

  const kirimProfil = () =>
    mulaiProfil(async () => {
      if (!profil) return;
      const a = await simpanProfilPajakAction({ bentukUsaha: profil.bentukUsaha, rezimPph: profil.rezimPph, sejak: profil.sejak || null });
      if (!a.ok) {
        toast.error(t.has(`err.${a.kode}`) ? t(`err.${a.kode}`) : t("err.GAGAL"));
        return;
      }
      const b = await simpanIdentitasPajakAction({ npwp: profil.npwp, nitku: profil.nitku, nama: profil.nama });
      if (!b.ok) {
        toast.error(t.has(`err.${b.kode}`) ? t(`err.${b.kode}`) : t("err.GAGAL"));
        return;
      }
      toast.success(t("profilTersimpan"));
    });

  if (!data || !ppn || !profil) {
    return (
      <Card className="max-w-2xl">
        <CardContent>
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {t("memuat")}
          </p>
        </CardContent>
      </Card>
    );
  }

  const tarifAngka = Number(ppn.tarifPersen);
  const efektif = Number.isFinite(tarifAngka) ? tarifEfektif({ ...data.ppn, tarifPersen: tarifAngka, pakaiDppNilaiLain: ppn.pakaiDppNilaiLain }) : null;
  const perluDicek = finalUmkmPerluDicek({ bentukUsaha: profil.bentukUsaha as ProfilPajak["bentukUsaha"], rezimPph: profil.rezimPph as ProfilPajak["rezimPph"], sejak: null });

  return (
    <div className="space-y-6">
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>{t("ppnJudul")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {ppn.statusPkp === "BELUM_DITETAPKAN" ? (
            <p className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {t("pkpBelum")}
            </p>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="pajak-status-pkp">{t("statusPkp")}</Label>
              <Select value={ppn.statusPkp} onValueChange={(v) => setPpn({ ...ppn, statusPkp: v })} disabled={!bolehUbah}>
                <SelectTrigger id="pajak-status-pkp">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEMUA_STATUS_PKP.map((s) => (
                    <SelectItem key={s} value={s}>
                      {t(`status.${s}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pajak-tarif">{t("tarif")}</Label>
              <Input id="pajak-tarif" inputMode="decimal" value={ppn.tarifPersen} disabled={!bolehUbah} onChange={(e) => setPpn({ ...ppn, tarifPersen: e.target.value })} className="max-w-[120px]" />
              {efektif != null ? <p className="text-xs text-muted-foreground">{t("efektif", { persen: String(efektif).replace(".", ",") })}</p> : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pajak-sejak">{t("berlakuSejak")}</Label>
              <TanggalInput id="pajak-sejak" value={ppn.berlakuSejak} disabled={!bolehUbah} onChange={(e) => setPpn({ ...ppn, berlakuSejak: e.target.value })} />
            </div>
          </div>
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="pajak-nilai-lain" className="font-normal">
              {t("nilaiLain")}
            </Label>
            <Switch id="pajak-nilai-lain" checked={ppn.pakaiDppNilaiLain} disabled={!bolehUbah} onCheckedChange={(v) => setPpn({ ...ppn, pakaiDppNilaiLain: v })} />
          </div>
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="pajak-termasuk" className="font-normal">
              {t("termasukPpn")}
            </Label>
            <Switch id="pajak-termasuk" checked={ppn.hargaJualTermasukPpn} disabled={!bolehUbah} onCheckedChange={(v) => setPpn({ ...ppn, hargaJualTermasukPpn: v })} />
          </div>
          {bolehUbah ? (
            <Button onClick={kirimPpn} disabled={simpanPpn}>
              {simpanPpn ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {t("simpan")}
            </Button>
          ) : null}
        </CardContent>
      </Card>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>{t("profilJudul")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="pajak-bentuk">{t("bentukUsaha")}</Label>
              <Select value={profil.bentukUsaha} onValueChange={(v) => setProfil({ ...profil, bentukUsaha: v })} disabled={!bolehUbah}>
                <SelectTrigger id="pajak-bentuk">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEMUA_BENTUK_USAHA.map((b) => (
                    <SelectItem key={b} value={b}>
                      {t(`bentuk.${b}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pajak-rezim">{t("rezim")}</Label>
              <Select value={profil.rezimPph} onValueChange={(v) => setProfil({ ...profil, rezimPph: v })} disabled={!bolehUbah}>
                <SelectTrigger id="pajak-rezim">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEMUA_REZIM_PPH.map((r) => (
                    <SelectItem key={r} value={r}>
                      {t(`rezimPilihan.${r}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pajak-rezim-sejak">{t("rezimSejak")}</Label>
              <TanggalInput id="pajak-rezim-sejak" value={profil.sejak} disabled={!bolehUbah} onChange={(e) => setProfil({ ...profil, sejak: e.target.value })} />
            </div>
          </div>
          {perluDicek ? (
            <p className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {t("finalPerluDicek")}
            </p>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="pajak-npwp">{t("npwp")}</Label>
              <Input id="pajak-npwp" inputMode="numeric" maxLength={24} value={profil.npwp} disabled={!bolehUbah} onChange={(e) => setProfil({ ...profil, npwp: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pajak-nitku">{t("nitku")}</Label>
              <Input id="pajak-nitku" inputMode="numeric" maxLength={30} value={profil.nitku} disabled={!bolehUbah} onChange={(e) => setProfil({ ...profil, nitku: e.target.value })} />
              <p className="text-xs text-muted-foreground">{t("nitkuKet")}</p>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="pajak-nama">{t("namaWp")}</Label>
              <Input id="pajak-nama" maxLength={200} value={profil.nama} disabled={!bolehUbah} onChange={(e) => setProfil({ ...profil, nama: e.target.value })} />
            </div>
          </div>
          {bolehUbah ? (
            <Button onClick={kirimProfil} disabled={simpanProfil}>
              {simpanProfil ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {t("simpan")}
            </Button>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
