"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowLeft, Images, Loader2, Save } from "lucide-react";
import { simpanPanduanAction } from "@/app/actions/panduan-display";
import type { PanduanLengkap } from "@/lib/salesman/checklist-queries";
import { BATAS_PANDUAN } from "@/lib/salesman/checklist-toko";
import { dinamis } from "@/lib/i18n/dinamis";
import { UnggahFoto, type NilaiFoto } from "@/components/foto/UnggahFoto";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { RentangTanggalInput } from "@/components/ui/rentang-tanggal-input";

/** Radix Select tidak menerima nilai kosong. */
const SEMUA = "SEMUA";

type FotoHasil = { id: string; url: string; toko: string; oleh: string; pada: string };

export function PanduanForm({
  awal,
  area,
  foto,
  bolehKelola,
}: {
  awal: PanduanLengkap | null;
  area: { id: string; label: string }[];
  foto: FotoHasil[];
  bolehKelola: boolean;
}) {
  const t = useTranslations("panduanDisplay");
  const td = dinamis(t);
  const router = useRouter();
  const [sibuk, mulai] = useTransition();

  const [judul, setJudul] = useState(awal?.judul ?? "");
  const [isi, setIsi] = useState(awal?.isi ?? "");
  const [gambar, setGambar] = useState<NilaiFoto>(awal?.gambarUrl ? { url: awal.gambarUrl, nama: "" } : null);
  const [jenisToko, setJenisToko] = useState<string>(awal?.termsType ?? SEMUA);
  const [groupId, setGroupId] = useState<string>(awal?.groupId ?? SEMUA);
  const [mulaiTgl, setMulaiTgl] = useState(awal?.mulai ?? "");
  const [selesaiTgl, setSelesaiTgl] = useState(awal?.selesai ?? "");

  const kunci = !bolehKelola || sibuk;

  const simpan = () =>
    mulai(async () => {
      const r = await simpanPanduanAction({
        id: awal?.id ?? null,
        judul,
        isi,
        gambarUrl: gambar?.url ?? null,
        termsType: jenisToko === SEMUA ? null : jenisToko,
        groupId: groupId === SEMUA ? null : groupId,
        mulai: mulaiTgl || null,
        selesai: selesaiTgl || null,
      });
      if (!r.ok) {
        toast.error(td(`err.${r.kode}`));
        return;
      }
      toast.success(t("tersimpan"));
      if (awal) router.refresh();
      else router.push(`/backoffice/panduan-display/${r.id}`);
    });

  return (
    <div className="space-y-6">
      <div className="-ml-2">
        <Button asChild variant="ghost" size="sm">
          <Link href="/backoffice/panduan-display">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            {t("kembali")}
          </Link>
        </Button>
      </div>

      <PageHeader
        title={awal ? awal.judul : t("baru")}
        description={t("formDeskripsi")}
        meta={awal ? t("jumlahFotoMeta", { n: awal.jumlahFoto }) : undefined}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">{t("bagianIsi")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="pd-judul">
                {t("judulLabel")}
                <span className="ml-1 text-destructive">*</span>
              </Label>
              <Input id="pd-judul" value={judul} maxLength={BATAS_PANDUAN.judul} disabled={kunci} onChange={(e) => setJudul(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pd-isi">
                {t("isiLabel")}
                <span className="ml-1 text-destructive">*</span>
              </Label>
              <Textarea
                id="pd-isi"
                rows={8}
                value={isi}
                maxLength={BATAS_PANDUAN.isi}
                placeholder={t("isiPetunjuk")}
                disabled={kunci}
                onChange={(e) => setIsi(e.target.value)}
              />
            </div>
            <UnggahFoto label={t("gambarLabel")} petunjuk={t("gambarPetunjuk")} nilai={gambar} onChange={setGambar} disabled={kunci} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("bagianSasaran")}</CardTitle>
            <CardDescription>{t("sasaranPetunjuk")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="pd-jenis">{t("jenisTokoLabel")}</Label>
              <Select value={jenisToko} onValueChange={setJenisToko} disabled={kunci}>
                <SelectTrigger id="pd-jenis" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SEMUA}>{t("jenisToko.SEMUA")}</SelectItem>
                  <SelectItem value="PUTUS">{t("jenisToko.PUTUS")}</SelectItem>
                  <SelectItem value="KONSI">{t("jenisToko.KONSI")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pd-area">{t("areaLabel")}</Label>
              <Select value={groupId} onValueChange={setGroupId} disabled={kunci}>
                <SelectTrigger id="pd-area" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SEMUA}>{t("semuaArea")}</SelectItem>
                  {area.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pd-masa">{t("masaTampil")}</Label>
              <RentangTanggalInput
                id="pd-masa"
                dari={mulaiTgl}
                sampai={selesaiTgl}
                pilihanCepat={false}
                bolehTerbuka
                disabled={kunci}
                onChange={({ dari, sampai }) => {
                  setMulaiTgl(dari);
                  setSelesaiTgl(sampai);
                }}
              />
              <p className="text-xs text-muted-foreground">{t("tanggalPetunjuk")}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {bolehKelola ? (
        <div className="flex justify-end">
          <Button onClick={simpan} disabled={kunci}>
            {sibuk ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
            {t("simpan")}
          </Button>
        </div>
      ) : null}

      {awal ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Images className="h-4 w-4" aria-hidden />
              {t("fotoHasilJudul")}
            </CardTitle>
            <CardDescription>{t("fotoHasilIsi")}</CardDescription>
          </CardHeader>
          <CardContent>
            {foto.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("fotoHasilKosong")}</p>
            ) : (
              <ul className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
                {foto.map((f) => (
                  <li key={f.id} className="space-y-1">
                    <a href={f.url} target="_blank" rel="noopener noreferrer" className="block aspect-square overflow-hidden rounded-md border bg-muted">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={f.url} alt={f.toko} className="h-full w-full object-cover" loading="lazy" />
                    </a>
                    <p className="text-xs font-medium leading-tight">{f.toko}</p>
                    <p className="text-xs text-muted-foreground">
                      {f.oleh} · {f.pada}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
