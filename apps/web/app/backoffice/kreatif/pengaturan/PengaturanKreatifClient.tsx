"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, MessageSquareText, Plus, SlidersHorizontal, Trash2, UserRound } from "lucide-react";
import {
  simpanAmbangKreatifAction,
  simpanIdentitasKreatifAction,
  simpanTemplateWaKreatifAction,
} from "@/app/actions/kreatif-pengaturan";
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
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { Textarea } from "@/components/ui/textarea";
import { AMBANG_BAWAAN, BATAS_AMBANG, DAFTAR_KUNCI_AMBANG, validasiAmbang, type AmbangKreatif } from "@/lib/creative/ambang";
import type { PengaturanKreatif } from "@/lib/creative/pengaturan";
import {
  BATAS_IDENTITAS,
  BATAS_TEMPLATE,
  isiTemplate,
  susunVariabel,
  TEMPLATE_BAWAAN,
  VARIABEL_WA,
  variabelTakDikenal,
  type IdentitasKreatif,
  type TemplateWa,
} from "@/lib/creative/wa";
import { dinamis } from "@/lib/i18n/dinamis";
import { cn } from "@/lib/utils";


const KodeVar = ({ nama }: { nama: string }) => <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{`{${nama}}`}</code>;

/**
 * Pengaturan Ruang KOL. Tiga kartu yang disimpan terpisah (masing-masing satu
 * baris `SystemSetting` dan satu jejak): ambang hari, identitas pesan, dan
 * daftar template WhatsApp. Penjelasan fungsinya ada di Bantuan; di layar
 * hanya keterangan satu baris per isian.
 */
export function PengaturanKreatifClient({ awal, bolehMengelola }: { awal: PengaturanKreatif; bolehMengelola: boolean }) {
  const t = useTranslations("kreatifRuang");
  const [identitas, setIdentitas] = useState<IdentitasKreatif>(awal.identitas);
  return (
    <div className="space-y-6">
      <PageHeader title={t("halaman.pengaturan")} />
      {!bolehMengelola ? (
        <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">{t("pengaturan.hanyaBaca")}</p>
      ) : null}
      <KartuAmbang awal={awal.ambang} bolehMengelola={bolehMengelola} />
      <KartuIdentitas awal={awal.identitas} bolehMengelola={bolehMengelola} onTersimpan={setIdentitas} />
      <KartuTemplate awal={awal.templateWa} identitas={identitas} bolehMengelola={bolehMengelola} />
    </div>
  );
}

function KartuAmbang({ awal, bolehMengelola }: { awal: AmbangKreatif; bolehMengelola: boolean }) {
  const t = useTranslations("kreatifRuang");
  const td = dinamis(t);
  const [nilai, setNilai] = useState<Record<keyof AmbangKreatif, string>>(
    () => Object.fromEntries(DAFTAR_KUNCI_AMBANG.map((k) => [k, String(awal[k])])) as Record<keyof AmbangKreatif, string>,
  );
  const [galat, setGalat] = useState<Set<keyof AmbangKreatif>>(new Set());
  const [menyimpan, mulai] = useTransition();

  const keAngka = (teks: string): number => (/^\s*-?\d+\s*$/.test(teks) ? Number(teks.trim()) : Number.NaN);

  const simpan = () => {
    const kirim = Object.fromEntries(DAFTAR_KUNCI_AMBANG.map((k) => [k, keAngka(nilai[k])]));
    const v = validasiAmbang(kirim);
    if (!v.ok) {
      setGalat(new Set(v.galat.map((g) => g.kunci)));
      return;
    }
    setGalat(new Set());
    mulai(async () => {
      const r = await simpanAmbangKreatifAction(kirim);
      if (r.ok) {
        toast.success(t("pengaturan.ambang.ok"));
        return;
      }
      if (r.kode === "TIDAK_VALID" && "galat" in r) setGalat(new Set(r.galat.map((g) => g.kunci)));
      toast.error(r.kode === "TANPA_AKSES" ? t("pengaturan.errAkses") : r.kode === "TIDAK_VALID" ? t("err.TIDAK_VALID") : t("pengaturan.errGagal"));
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SlidersHorizontal className="h-5 w-5" aria-hidden />
          {t("pengaturan.ambang.judul")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            simpan();
          }}
        >
          <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
            {DAFTAR_KUNCI_AMBANG.map((k) => {
              const b = BATAS_AMBANG[k];
              const salah = galat.has(k);
              return (
                <div key={k} className="space-y-1.5">
                  <Label htmlFor={`ambang-${k}`}>{td(`ambang.${k}`)}</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id={`ambang-${k}`}
                      type="number"
                      inputMode="numeric"
                      min={b.min}
                      max={b.maks}
                      step={1}
                      value={nilai[k]}
                      disabled={!bolehMengelola}
                      onChange={(e) => setNilai((x) => ({ ...x, [k]: e.target.value }))}
                      className="w-24 tabular-nums"
                      aria-invalid={salah}
                      aria-describedby={`ambang-${k}-petunjuk`}
                    />
                    <span className="text-sm text-muted-foreground">{t("pengaturan.ambang.satuan")}</span>
                  </div>
                  <p id={`ambang-${k}-petunjuk`} className={cn("text-xs", salah ? "text-destructive" : "text-muted-foreground")}>
                    {salah ? t("pengaturan.ambang.galat", { min: b.min, maks: b.maks }) : td(`pengaturan.ambang.petunjuk.${k}`)}
                  </p>
                </div>
              );
            })}
          </div>
          {bolehMengelola ? (
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={menyimpan}>
                {menyimpan ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                {t("pengaturan.ambang.simpan")}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={menyimpan}
                onClick={() => {
                  setNilai(Object.fromEntries(DAFTAR_KUNCI_AMBANG.map((k) => [k, String(AMBANG_BAWAAN[k])])) as Record<keyof AmbangKreatif, string>);
                  setGalat(new Set());
                }}
              >
                {t("pengaturan.ambang.bawaan")}
              </Button>
            </div>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}

function KartuIdentitas({
  awal,
  bolehMengelola,
  onTersimpan,
}: {
  awal: IdentitasKreatif;
  bolehMengelola: boolean;
  onTersimpan: (i: IdentitasKreatif) => void;
}) {
  const t = useTranslations("kreatifRuang");
  const td = dinamis(t);
  const [isi, setIsi] = useState<IdentitasKreatif>(awal);
  const [menyimpan, mulai] = useTransition();
  const kunci: (keyof IdentitasKreatif)[] = ["pengirim", "brand", "produk"];

  const simpan = () =>
    mulai(async () => {
      const r = await simpanIdentitasKreatifAction(isi);
      if (r.ok) {
        setIsi(r.identitas);
        onTersimpan(r.identitas);
        toast.success(t("pengaturan.identitas.ok"));
        return;
      }
      toast.error(
        r.kode === "TANPA_AKSES"
          ? t("pengaturan.errAkses")
          : r.kode === "TERLALU_PANJANG"
            ? t("pengaturan.identitas.TERLALU_PANJANG")
            : r.kode === "TIDAK_VALID"
              ? t("err.TIDAK_VALID")
              : t("pengaturan.errGagal"),
      );
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserRound className="h-5 w-5" aria-hidden />
          {t("pengaturan.identitas.judul")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            simpan();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-3">
            {kunci.map((k) => (
              <div key={k} className="space-y-1.5">
                <Label htmlFor={`identitas-${k}`}>{td(`pengaturan.identitas.${k}`)}</Label>
                <Input
                  id={`identitas-${k}`}
                  value={isi[k]}
                  maxLength={BATAS_IDENTITAS}
                  disabled={!bolehMengelola}
                  onChange={(e) => setIsi((x) => ({ ...x, [k]: e.target.value }))}
                />
                <p className="text-xs text-muted-foreground">
                  {t("pengaturan.identitas.dipakai")} <KodeVar nama={k} />
                </p>
              </div>
            ))}
          </div>
          {bolehMengelola ? (
            <Button type="submit" disabled={menyimpan}>
              {menyimpan ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {t("pengaturan.identitas.simpan")}
            </Button>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}

type DialogTemplate = { indeks: number | null; nama: string; isi: string };

function KartuTemplate({ awal, identitas, bolehMengelola }: { awal: TemplateWa[]; identitas: IdentitasKreatif; bolehMengelola: boolean }) {
  const t = useTranslations("kreatifRuang");
  const td = dinamis(t);
  const [templates, setTemplates] = useState<TemplateWa[]>(awal);
  const [dialog, setDialog] = useState<DialogTemplate | null>(null);
  const [menyimpan, mulai] = useTransition();

  const contoh = useMemo(
    () =>
      susunVariabel({
        namaKol: "Nadia Putri",
        username: "nadia.daily",
        platform: "TikTok",
        campaign: "Koleksi Lebaran",
        produk: null,
        resi: "JNE0012345678",
        ekspedisi: "JNE",
        fee: 1_500_000,
        link: "https://elorae.cloud/data-kol/contoh",
        identitas,
      }),
    [identitas],
  );

  const kirim = (daftar: TemplateWa[], pesanOk: string, sesudah?: () => void) =>
    mulai(async () => {
      const r = await simpanTemplateWaKreatifAction(daftar);
      if (r.ok) {
        setTemplates(r.templates);
        toast.success(pesanOk);
        sesudah?.();
        return;
      }
      if (r.kode === "VARIABEL_TAK_DIKENAL" && "variabel" in r) {
        toast.error(t("pengaturan.template.VARIABEL_TAK_DIKENAL", { daftar: r.variabel.map((v) => `{${v}}`).join(", ") }));
      } else if (r.kode === "TANPA_AKSES") toast.error(t("pengaturan.errAkses"));
      else if (r.kode === "GAGAL") toast.error(t("pengaturan.errGagal"));
      else toast.error(td(`err.${r.kode}`));
    });

  const simpanDialog = (d: DialogTemplate) => {
    const baru: TemplateWa = {
      kunci: d.indeks === null ? `template-${Date.now().toString(36)}` : templates[d.indeks].kunci,
      nama: d.nama.trim(),
      isi: d.isi,
    };
    const daftar = d.indeks === null ? [...templates, baru] : templates.map((x, i) => (i === d.indeks ? baru : x));
    kirim(daftar, t("pengaturan.template.ok"), () => setDialog(null));
  };

  const hapusDialog = (indeks: number) =>
    kirim(
      templates.filter((_, i) => i !== indeks),
      t("pengaturan.template.okHapus"),
      () => setDialog(null),
    );

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <div>
          <CardTitle className="flex items-center gap-2">
            <MessageSquareText className="h-5 w-5" aria-hidden />
            {t("pengaturan.template.judul")}
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">{t("pengaturan.template.meta", { n: templates.length })}</p>
        </div>
        {bolehMengelola && templates.length < BATAS_TEMPLATE.jumlah ? (
          <Button type="button" variant="outline" onClick={() => setDialog({ indeks: null, nama: "", isi: "" })}>
            <Plus className="h-4 w-4" aria-hidden />
            {t("pengaturan.template.tambah")}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          {t("pengaturan.template.variabel")}:
          {VARIABEL_WA.map((v) => (
            <KodeVar key={v} nama={v} />
          ))}
        </p>
        {templates.length === 0 ? (
          <div className="space-y-3 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            <p>{t("pengaturan.template.kosong")}</p>
            {bolehMengelola ? (
              <Button type="button" variant="outline" size="sm" disabled={menyimpan} onClick={() => kirim(TEMPLATE_BAWAAN, t("pengaturan.template.ok"))}>
                {t("pengaturan.template.pakaiBawaan")}
              </Button>
            ) : null}
          </div>
        ) : (
          <ul className="divide-y rounded-md border">
            {templates.map((x, i) => (
              <li key={x.kunci} className="flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{x.nama}</p>
                  <p className="truncate text-xs text-muted-foreground">{isiTemplate(x.isi, contoh).replace(/\s+/g, " ")}</p>
                </div>
                {bolehMengelola ? (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setDialog({ indeks: i, nama: x.nama, isi: x.isi })}>
                    {t("pengaturan.template.ubah")}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog open={dialog !== null} onOpenChange={(o) => (!o && !menyimpan ? setDialog(null) : undefined)}>
        {dialog ? (
          <DialogTemplateIsi
            key={dialog.indeks ?? "baru"}
            awal={dialog}
            contoh={contoh}
            menyimpan={menyimpan}
            onBatal={() => setDialog(null)}
            onSimpan={simpanDialog}
            onHapus={dialog.indeks === null ? null : () => hapusDialog(dialog.indeks!)}
          />
        ) : null}
      </Dialog>
    </Card>
  );
}

function DialogTemplateIsi({
  awal,
  contoh,
  menyimpan,
  onBatal,
  onSimpan,
  onHapus,
}: {
  awal: DialogTemplate;
  contoh: Record<string, string | null>;
  menyimpan: boolean;
  onBatal: () => void;
  onSimpan: (d: DialogTemplate) => void;
  onHapus: (() => void) | null;
}) {
  const t = useTranslations("kreatifRuang");
  const [d, setD] = useState<DialogTemplate>(awal);
  const [konfirmasi, setKonfirmasi] = useState(false);
  const [coba, setCoba] = useState(false);
  const isiRef = useRef<HTMLTextAreaElement>(null);

  const takDikenal = variabelTakDikenal(d.isi);
  const namaKosong = !d.nama.trim();
  const isiKosong = !d.isi.trim();
  const terlaluPanjang = d.nama.trim().length > BATAS_TEMPLATE.nama || d.isi.length > BATAS_TEMPLATE.isi;
  const bisaSimpan = !namaKosong && !isiKosong && !terlaluPanjang && takDikenal.length === 0;

  const sisipkan = (v: string) => {
    const el = isiRef.current;
    const token = `{${v}}`;
    if (!el) {
      setD((x) => ({ ...x, isi: x.isi + token }));
      return;
    }
    const awalPilih = el.selectionStart ?? d.isi.length;
    const akhirPilih = el.selectionEnd ?? d.isi.length;
    const baru = d.isi.slice(0, awalPilih) + token + d.isi.slice(akhirPilih);
    setD((x) => ({ ...x, isi: baru }));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(awalPilih + token.length, awalPilih + token.length);
    });
  };

  return (
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>{awal.indeks === null ? t("pengaturan.template.dialogBaru") : t("pengaturan.template.dialogUbah")}</DialogTitle>
      </DialogHeader>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setCoba(true);
          if (bisaSimpan) onSimpan(d);
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="template-nama">{t("pengaturan.template.nama")}</Label>
          <Input
            id="template-nama"
            value={d.nama}
            maxLength={BATAS_TEMPLATE.nama}
            placeholder={t("pengaturan.template.namaPlaceholder")}
            onChange={(e) => setD((x) => ({ ...x, nama: e.target.value }))}
            aria-invalid={coba && namaKosong}
            autoFocus
          />
          {coba && namaKosong ? <p className="text-xs text-destructive">{t("err.NAMA_WAJIB")}</p> : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="template-isi">{t("pengaturan.template.isi")}</Label>
          <Textarea
            id="template-isi"
            ref={isiRef}
            rows={11}
            value={d.isi}
            maxLength={BATAS_TEMPLATE.isi}
            onChange={(e) => setD((x) => ({ ...x, isi: e.target.value }))}
            aria-invalid={takDikenal.length > 0 || (coba && isiKosong)}
            aria-describedby="template-isi-galat"
          />
          <div id="template-isi-galat">
            {takDikenal.length ? (
              <p className="text-xs text-destructive">{t("pengaturan.template.takDikenal", { daftar: takDikenal.map((v) => `{${v}}`).join(", ") })}</p>
            ) : null}
            {coba && isiKosong ? <p className="text-xs text-destructive">{t("err.ISI_WAJIB")}</p> : null}
            {terlaluPanjang ? <p className="text-xs text-destructive">{t("err.TERLALU_PANJANG")}</p> : null}
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-xs text-muted-foreground">{t("pengaturan.template.variabel")}:</span>
            {VARIABEL_WA.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => sisipkan(v)}
                className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={t("pengaturan.template.sisipkan", { variabel: `{${v}}` })}
              >
                <KodeVar nama={v} />
              </button>
            ))}
          </div>
        </div>
        {d.isi.trim() ? (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">{t("pengaturan.template.pratinjau")}</p>
            <p className="whitespace-pre-wrap rounded-md bg-muted/60 p-3 text-sm">{isiTemplate(d.isi, contoh)}</p>
          </div>
        ) : null}
        <DialogFooter className="gap-2 sm:justify-between">
          {onHapus ? (
            <Button type="button" variant="ghost" className="text-destructive hover:text-destructive" disabled={menyimpan} onClick={() => setKonfirmasi(true)}>
              <Trash2 className="h-4 w-4" aria-hidden />
              {t("pengaturan.template.hapus")}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="outline" disabled={menyimpan} onClick={onBatal}>
              {t("pengaturan.template.batal")}
            </Button>
            <Button type="submit" disabled={menyimpan || (coba && !bisaSimpan) || takDikenal.length > 0}>
              {menyimpan ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {t("pengaturan.template.simpan")}
            </Button>
          </div>
        </DialogFooter>
      </form>

      {onHapus ? (
        <AlertDialog open={konfirmasi} onOpenChange={setKonfirmasi}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("pengaturan.template.hapusJudul")}</AlertDialogTitle>
              <AlertDialogDescription>{t("pengaturan.template.hapusIsi", { nama: awal.nama })}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={menyimpan}>{t("pengaturan.template.batal")}</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={menyimpan}
                onClick={(e) => {
                  e.preventDefault();
                  setKonfirmasi(false);
                  onHapus();
                }}
              >
                {t("pengaturan.template.hapus")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </DialogContent>
  );
}
