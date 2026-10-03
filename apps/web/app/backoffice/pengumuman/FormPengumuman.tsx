"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { dinamis } from "@/lib/i18n/dinamis";
import { AUDIENS, BATAS_ISI, BATAS_JUDUL, type Audiens, type KolomPengumuman } from "@/lib/pengumuman/aturan";
import { simpanPengumumanAction } from "@/app/actions/pengumuman";
import { cn } from "@/lib/utils";
import { TanggalJamInput } from "@/components/ui/tanggal-input";

export type AwalFormPengumuman = {
  id: string | null;
  title: string;
  body: string;
  audience: Audiens;
  pinned: boolean;
  requireAck: boolean;
  /** "YYYY-MM-DDTHH:mm" WIB; "" = terbitkan sekarang. */
  publishedAt: string;
  /** "" = tanpa batas. */
  expiresAt: string;
  /** Sudah terbit: waktu terbit dikunci (teks, bukan isian). */
  terbitTeks: string | null;
  /** Jumlah orang yang sudah mengonfirmasi — memunculkan pilihan "minta konfirmasi ulang". */
  jumlahKonfirmasi: number;
  /** Isian awal saat saklar jadwal/berakhir baru dinyalakan (WIB, dihitung server). */
  saran: { terbit: string; berakhir: string };
};

/**
 * Formulir buat/ubah pengumuman. Validasi sebenarnya di penulis
 * (`validasiPengumuman`); di sini hanya penghitung panjang dan pesan per kolom
 * dari jawaban server. Waktu diisi dan dibaca sebagai jam WIB.
 */
export function FormPengumuman({ awal }: { awal: AwalFormPengumuman }) {
  const t = useTranslations("pengumuman.form");
  const tk = useTranslations("pengumuman");
  const td = dinamis(t);
  const router = useRouter();
  const [sibuk, mulai] = useTransition();

  const [title, setTitle] = useState(awal.title);
  const [body, setBody] = useState(awal.body);
  const [audience, setAudience] = useState<Audiens>(awal.audience);
  const [pinned, setPinned] = useState(awal.pinned);
  const [requireAck, setRequireAck] = useState(awal.requireAck);
  const [jadwalkan, setJadwalkan] = useState(awal.terbitTeks === null && awal.publishedAt !== "");
  const [publishedAt, setPublishedAt] = useState(awal.publishedAt);
  const [berakhir, setBerakhir] = useState(awal.expiresAt !== "");
  const [expiresAt, setExpiresAt] = useState(awal.expiresAt);
  const [ulang, setUlang] = useState(true);
  const [galat, setGalat] = useState<Partial<Record<KolomPengumuman, string>>>({});

  const isiBerubah = awal.id !== null && (title.trim() !== awal.title || body.trim() !== awal.body);
  const tanyaUlang = awal.id !== null && awal.requireAck && requireAck && awal.jumlahKonfirmasi > 0;

  function simpan() {
    setGalat({});
    mulai(async () => {
      let r: Awaited<ReturnType<typeof simpanPengumumanAction>>;
      try {
        r = await simpanPengumumanAction({
          id: awal.id,
          title,
          body,
          audience,
          pinned,
          requireAck,
          publishedAt: awal.terbitTeks === null && jadwalkan ? publishedAt : "",
          expiresAt: berakhir ? expiresAt : "",
          mintaKonfirmasiUlang: ulang,
        });
      } catch {
        toast.error(t("err.JARINGAN"));
        return;
      }
      if (r.ok) {
        toast.success(r.dikabarkan > 0 ? t("okTerkirim", { n: r.dikabarkan }) : t("okTersimpan"));
        router.push(`/backoffice/pengumuman/${r.id}`);
        router.refresh();
        return;
      }
      if (r.kode === "TIDAK_SAH") {
        const per: Partial<Record<KolomPengumuman, string>> = {};
        for (const g of r.galat) per[g.kolom] ??= td(`err.${g.kode}`);
        setGalat(per);
        toast.error(t("periksaIsian"));
        return;
      }
      toast.error(td(`err.${r.kode}`));
    });
  }

  const kembali = awal.id ? `/backoffice/pengumuman/${awal.id}` : "/backoffice/pengumuman";

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href={kembali}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          {t("kembali")}
        </Link>
      </Button>
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">{awal.id ? t("judulUbah") : t("judulBuat")}</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">{t("deskripsi")}</p>
      </div>

      <form
        className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]"
        onSubmit={(e) => {
          e.preventDefault();
          simpan();
        }}
      >
        <Card>
          <CardHeader>
            <CardTitle>{t("isiJudul")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="peng-title">{t("title")}</Label>
              <Input
                id="peng-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={BATAS_JUDUL}
                placeholder={t("titlePlaceholder")}
                aria-invalid={!!galat.title}
                aria-describedby="peng-title-info"
              />
              <Info id="peng-title-info" galat={galat.title} hitung={t("hitung", { n: title.trim().length, maks: BATAS_JUDUL })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="peng-body">{t("body")}</Label>
              <Textarea
                id="peng-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={12}
                placeholder={t("bodyPlaceholder")}
                aria-invalid={!!galat.body || body.trim().length > BATAS_ISI}
                aria-describedby="peng-body-info"
              />
              <Info
                id="peng-body-info"
                galat={galat.body}
                hitung={t("hitung", { n: body.trim().length, maks: BATAS_ISI })}
                lebih={body.trim().length > BATAS_ISI}
              />
              <p className="text-xs text-muted-foreground">{t("bodyHint")}</p>
            </div>
            {tanyaUlang && isiBerubah ? (
              <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
                <Checkbox id="peng-ulang" checked={ulang} onCheckedChange={(v) => setUlang(v === true)} className="mt-0.5" />
                <div className="space-y-1">
                  <Label htmlFor="peng-ulang">{t("ulangLabel")}</Label>
                  <p className="text-xs text-muted-foreground">{t("ulangHint", { n: awal.jumlahKonfirmasi })}</p>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t("sasaranJudul")}</CardTitle>
              <CardDescription>{t("sasaranHint")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="peng-audience">{t("audience")}</Label>
                <Select value={audience} onValueChange={(v) => setAudience(v as Audiens)}>
                  <SelectTrigger id="peng-audience" aria-invalid={!!galat.audience}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AUDIENS.map((a) => (
                      <SelectItem key={a} value={a}>
                        {tk(`audiens.${a}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {galat.audience ? <p className="text-xs text-destructive">{galat.audience}</p> : null}
              </div>
              <Saklar id="peng-pinned" label={t("pinned")} hint={t("pinnedHint")} checked={pinned} onChange={setPinned} />
              <Saklar id="peng-ack" label={t("requireAck")} hint={t("requireAckHint")} checked={requireAck} onChange={setRequireAck} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("waktuJudul")}</CardTitle>
              <CardDescription>{t("waktuHint")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {awal.terbitTeks !== null ? (
                <div className="space-y-1">
                  <p className="text-sm font-medium">{t("terbitPada")}</p>
                  <p className="text-sm tabular-nums">{awal.terbitTeks}</p>
                  <p className="text-xs text-muted-foreground">{t("terbitTerkunci")}</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <Saklar
                    id="peng-jadwal"
                    label={t("jadwalkan")}
                    hint={t("jadwalkanHint")}
                    checked={jadwalkan}
                    onChange={(v) => {
                      setJadwalkan(v);
                      if (v && !publishedAt) setPublishedAt(awal.saran.terbit);
                    }}
                  />
                  {jadwalkan ? (
                    <div className="space-y-1">
                      <Label htmlFor="peng-terbit">{t("publishedAt")}</Label>
                      <TanggalJamInput
                        id="peng-terbit"
                        value={publishedAt}
                        onChange={(e) => setPublishedAt(e.target.value)}
                        aria-invalid={!!galat.publishedAt}
                      />
                      {galat.publishedAt ? <p className="text-xs text-destructive">{galat.publishedAt}</p> : null}
                    </div>
                  ) : null}
                </div>
              )}
              <div className="space-y-3">
                <Saklar
                  id="peng-berakhir"
                  label={t("berakhir")}
                  hint={t("berakhirHint")}
                  checked={berakhir}
                  onChange={(v) => {
                    setBerakhir(v);
                    if (v && !expiresAt) setExpiresAt(awal.saran.berakhir);
                  }}
                />
                {berakhir ? (
                  <div className="space-y-1">
                    <Label htmlFor="peng-kedaluwarsa">{t("expiresAt")}</Label>
                    <TanggalJamInput
                      id="peng-kedaluwarsa"
                      value={expiresAt}
                      onChange={(e) => setExpiresAt(e.target.value)}
                      aria-invalid={!!galat.expiresAt}
                    />
                    {galat.expiresAt ? <p className="text-xs text-destructive">{galat.expiresAt}</p> : null}
                  </div>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">{t("zonaWaktu")}</p>
            </CardContent>
          </Card>

          <div className="flex gap-2">
            <Button asChild variant="outline" className="flex-1" disabled={sibuk}>
              <Link href={kembali}>{t("batal")}</Link>
            </Button>
            <Button type="submit" className="flex-1" disabled={sibuk}>
              {sibuk ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
              {awal.id ? t("simpan") : jadwalkan ? t("jadwalkanTombol") : t("terbitkan")}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}

function Info({ id, galat, hitung, lebih }: { id: string; galat?: string; hitung: string; lebih?: boolean }) {
  return (
    <div id={id} className="flex items-start justify-between gap-2 text-xs">
      <span className="text-destructive">{galat}</span>
      <span className={cn("shrink-0 tabular-nums", lebih ? "text-destructive" : "text-muted-foreground")}>{hitung}</span>
    </div>
  );
}

function Saklar({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="space-y-0.5">
        <Label htmlFor={id}>{label}</Label>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
