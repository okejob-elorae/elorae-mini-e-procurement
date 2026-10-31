"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Plus, Tag, Trash2 } from "lucide-react";
import { simpanPengaturanBrandAction } from "@/app/actions/kreatif-brand";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { TagsInput } from "@/components/ui/tags-input";
import { BATAS_BRAND, normalBrand, normalTagar, validasiBrand, type KompetitorBrand, type PengaturanBrand } from "@/lib/creative/brand-collab";
import { dinamis } from "@/lib/i18n/dinamis";

/**
 * "Brand & kompetitor" (Kreatif → Pengaturan): akun dan tagar Elorae yang
 * membuat video KOL masuk Performa video otomatis, daftar kompetitor yang
 * diberi lencana, dan sakelar pembuatan otomatis. Satu baris `SystemSetting`
 * (`kreatif.brand`) dan satu jejak per simpan. Penjelasannya di Bantuan.
 */
export function KartuBrandKreatif({ awal, bolehMengelola }: { awal: PengaturanBrand; bolehMengelola: boolean }) {
  const t = useTranslations("kreatifRuang.brand.pengaturan");
  const tp = useTranslations("kreatifRuang.pengaturan");
  const td = dinamis(t);
  const router = useRouter();
  const [akun, setAkun] = useState<string[]>(awal.akunElorae);
  const [tagar, setTagar] = useState<string[]>(awal.tagarElorae);
  const [kompetitor, setKompetitor] = useState<KompetitorBrand[]>(awal.kompetitor);
  const [otomatis, setOtomatis] = useState(awal.otomatisKePerforma);
  const [baru, setBaru] = useState({ handle: "", nama: "" });
  const [menyimpan, mulai] = useTransition();

  const isian = { akunElorae: akun, tagarElorae: tagar, kompetitor, otomatisKePerforma: otomatis };
  const v = validasiBrand(isian);
  const pesanGalat = v.ok ? null : td(`err.${v.kode}`, { nilai: v.nilai ?? "" });

  const tambahKompetitor = () => {
    const handle = normalBrand(baru.handle);
    if (!handle) {
      toast.error(td("err.HANDLE_TIDAK_SAH", { nilai: baru.handle.trim() }));
      return;
    }
    if (!kompetitor.some((k) => k.handle === handle)) setKompetitor((x) => [...x, { handle, nama: baru.nama.trim() }]);
    setBaru({ handle: "", nama: "" });
  };

  const simpan = () => {
    if (!v.ok) {
      toast.error(pesanGalat);
      return;
    }
    mulai(async () => {
      const r = await simpanPengaturanBrandAction(isian);
      if (!r.ok) {
        if (r.kode === "TANPA_AKSES") toast.error(tp("errAkses"));
        else if (r.kode === "GAGAL") toast.error(tp("errGagal"));
        else toast.error(td(`err.${r.kode}`, { nilai: "nilai" in r ? (r.nilai ?? "") : "" }));
        return;
      }
      setAkun(r.pengaturan.akunElorae);
      setTagar(r.pengaturan.tagarElorae);
      setKompetitor(r.pengaturan.kompetitor);
      toast.success(t("ok"));
      router.refresh();
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Tag className="h-5 w-5" aria-hidden />
          {t("judul")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            simpan();
          }}
        >
          <div className="grid gap-x-6 gap-y-4 lg:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="brand-akun">{t("akunElorae")}</Label>
              <TagsInput
                id="brand-akun"
                value={akun}
                onChange={(x) => setAkun(x.map((h) => normalBrand(h) || h.trim()))}
                disabled={!bolehMengelola}
                maxTags={BATAS_BRAND.akunElorae}
                aria-describedby="brand-akun-petunjuk"
                aria-label={t("akunElorae")}
              />
              <p id="brand-akun-petunjuk" className="text-xs text-muted-foreground">
                {t("akunEloraePetunjuk")}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="brand-tagar">{t("tagarElorae")}</Label>
              <TagsInput
                id="brand-tagar"
                value={tagar}
                onChange={(x) => setTagar(x.map((h) => normalTagar(h) || h.trim()))}
                disabled={!bolehMengelola}
                maxTags={BATAS_BRAND.tagarElorae}
                aria-describedby="brand-tagar-petunjuk"
                aria-label={t("tagarElorae")}
              />
              <p id="brand-tagar-petunjuk" className="text-xs text-muted-foreground">
                {t("tagarEloraePetunjuk")}
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t("kompetitor")}</Label>
            {kompetitor.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("kompetitorKosong")}</p>
            ) : (
              <ul className="divide-y rounded-md border">
                {kompetitor.map((k, i) => (
                  <li key={k.handle} className="flex items-center gap-2 px-3 py-1.5">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">@{k.handle}</span>
                    <Input
                      value={k.nama}
                      maxLength={100}
                      disabled={!bolehMengelola}
                      aria-label={`${t("namaKompetitor")} @${k.handle}`}
                      placeholder={t("namaKompetitor")}
                      className="h-8 max-w-56"
                      onChange={(e) => setKompetitor((x) => x.map((y, j) => (j === i ? { ...y, nama: e.target.value } : y)))}
                    />
                    {bolehMengelola ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="text-destructive"
                        aria-label={t("hapusKompetitor", { handle: k.handle })}
                        title={t("hapusKompetitor", { handle: k.handle })}
                        onClick={() => setKompetitor((x) => x.filter((_, j) => j !== i))}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {bolehMengelola ? (
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={baru.handle}
                  maxLength={100}
                  placeholder={t("handleKompetitor")}
                  aria-label={t("handleKompetitor")}
                  className="h-9 w-full sm:w-56"
                  onChange={(e) => setBaru((x) => ({ ...x, handle: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      tambahKompetitor();
                    }
                  }}
                />
                <Input
                  value={baru.nama}
                  maxLength={100}
                  placeholder={t("namaKompetitor")}
                  aria-label={t("namaKompetitor")}
                  className="h-9 w-full sm:w-56"
                  onChange={(e) => setBaru((x) => ({ ...x, nama: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      tambahKompetitor();
                    }
                  }}
                />
                <Button type="button" variant="outline" size="sm" onClick={tambahKompetitor} disabled={!baru.handle.trim()}>
                  <Plus className="h-4 w-4" />
                  {t("tambahKompetitor")}
                </Button>
              </div>
            ) : null}
          </div>

          <div className="flex items-center gap-3">
            <Switch id="brand-otomatis" checked={otomatis} onCheckedChange={setOtomatis} disabled={!bolehMengelola} />
            <Label htmlFor="brand-otomatis" className="font-normal">
              {t("otomatis")}
            </Label>
          </div>

          {pesanGalat ? <p className="text-sm text-destructive">{pesanGalat}</p> : null}

          {bolehMengelola ? (
            <Button type="submit" disabled={menyimpan || !v.ok}>
              {menyimpan ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {t("simpan")}
            </Button>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}
