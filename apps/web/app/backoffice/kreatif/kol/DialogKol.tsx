"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, ClipboardPaste, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusPill } from "@/components/ui/status-pill";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { simpanKolAction } from "@/app/actions/kreatif-kol";
import { bacaAngka, bacaBilanganBulat } from "@/lib/creative/angka-masuk";
import { samaDenganTerukur, TOLERANSI_ER } from "@/lib/creative/angka-terukur";
import { bacaBalasanWa, type KolomTempel } from "@/lib/creative/tempel-data-kol";
import { dinamis } from "@/lib/i18n/dinamis";
import { formatDisplayDate } from "@/lib/date-only";
import { SEMUA_PLATFORM, type Platform } from "@/lib/creative/aturan";
import { bacaLabel } from "@/lib/creative/kol-aturan";
import type { DataFormKol } from "@/lib/creative/kol-queries";
import type { IsiKol, KembarDitemukan } from "@/lib/creative/kol-writer";
import { pesanGagalKol } from "./format-kol";

type AkunForm = { kunci: string; id: string | null; platform: Platform; handle: string; pengikut: string; url: string };

type Form = {
  name: string;
  recipientName: string;
  niche: string;
  phone: string;
  email: string;
  er: string;
  avgViews: string;
  address: string;
  city: string;
  province: string;
  postalCode: string;
  atasan: string;
  bawahan: string;
  tinggi: string;
  hijab: "" | "ya" | "tidak";
  catatanFit: string;
  rateCard: string;
  rateNote: string;
  label: string;
  note: string;
  akun: AkunForm[];
};

let urutKunci = 0;
const kunciBaru = () => `a${++urutKunci}`;
const angkaKeTeks = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n).replace(".", ","));

function dariAwal(awal: DataFormKol | null): Form {
  return {
    name: awal?.name ?? "",
    recipientName: awal?.recipientName ?? "",
    niche: awal?.niche ?? "",
    phone: awal?.phone ?? "",
    email: awal?.email ?? "",
    er: angkaKeTeks(awal?.engagementRate),
    avgViews: angkaKeTeks(awal?.avgViews),
    address: awal?.address ?? "",
    city: awal?.city ?? "",
    province: awal?.province ?? "",
    postalCode: awal?.postalCode ?? "",
    atasan: awal?.ukuran.atasan ?? "",
    bawahan: awal?.ukuran.bawahan ?? "",
    tinggi: angkaKeTeks(awal?.ukuran.tinggiCm),
    hijab: awal?.ukuran.hijab === true ? "ya" : awal?.ukuran.hijab === false ? "tidak" : "",
    catatanFit: awal?.ukuran.catatan ?? "",
    rateCard: angkaKeTeks(awal?.rateCard),
    rateNote: awal?.rateNote ?? "",
    label: awal?.label ?? "",
    note: awal?.note ?? "",
    akun: awal?.akun.length
      ? awal.akun.map((a) => ({
          kunci: kunciBaru(),
          id: a.id,
          platform: a.platform,
          handle: a.handle,
          pengikut: a.followers ? String(a.followers) : "",
          url: a.url ?? "",
        }))
      : [{ kunci: kunciBaru(), id: null, platform: "TIKTOK", handle: "", pengikut: "", url: "" }],
  };
}

/** Bentuk pembanding untuk "ada perubahan yang belum disimpan" — tanpa kunci baris akun. */
const sidik = (f: Form) =>
  JSON.stringify({ ...f, akun: f.akun.map((a) => [a.id, a.platform, a.handle, a.pengikut, a.url]) });

/** Teks angka → angka; kosong → null; tidak terbaca → NaN (ditandai galat di kolomnya). */
const bacaOpsional = (v: string, bulat = false): number | null => {
  if (!v.trim()) return null;
  const n = bulat ? bacaBilanganBulat(v) : bacaAngka(v);
  return n === null ? Number.NaN : n;
};

/**
 * Dialog Tambah/Ubah KOL. Dipasang hanya saat terbuka (lihat `DialogKol`),
 * jadi isiannya selalu mulai dari data `awal` yang terbaru.
 */
function IsiDialogKol({
  awal,
  niche,
  labelSaran,
  onTutup,
  onTersimpan,
}: {
  awal: DataFormKol | null;
  niche: readonly string[];
  labelSaran: readonly string[];
  onTutup: () => void;
  onTersimpan?: (r: { id: string; dibuat: boolean }) => void;
}) {
  const t = useTranslations("kreatifRuang");
  const tc = useTranslations("creative");
  const mulai = useMemo(() => dariAwal(awal), [awal]);
  const [form, setFormMentah] = useState<Form>(mulai);
  const [kembar, setKembar] = useState<KembarDitemukan[] | null>(null);
  const [alasanKembar, setAlasanKembar] = useState("");
  const [tanyaBuang, setTanyaBuang] = useState(false);
  const [menyimpan, startSimpan] = useTransition();

  const kotor = sidik(form) !== sidik(mulai);

  const setForm = (ubah: Partial<Form>) => {
    setFormMentah((f) => ({ ...f, ...ubah }));
    // Data yang dicocokkan berubah — daftar kembar lama tidak berlaku lagi.
    setKembar(null);
  };
  const setAkun = (kunci: string, ubah: Partial<AkunForm>) =>
    setForm({ akun: form.akun.map((a) => (a.kunci === kunci ? { ...a, ...ubah } : a)) });

  const er = bacaOpsional(form.er);
  const avgViews = bacaOpsional(form.avgViews, true);

  // "Tempel balasan WhatsApp": teks balasan KOL dipilah ke isian formulir; pemilik memeriksa lalu menyimpan.
  const td = dinamis(t);
  const [tempelBuka, setTempelBuka] = useState(false);
  const [tempelTeks, setTempelTeks] = useState("");
  const [tempelHasil, setTempelHasil] = useState<string | null>(null);
  const labelKolomTempel = (k: KolomTempel) => td(`formulirKol.kolom.${k === "tinggi" ? "tinggiCm" : k}`);
  const isiDariTempel = () => {
    const r = bacaBalasanWa(tempelTeks);
    const kolom = Object.keys(r.isi) as KolomTempel[];
    if (!kolom.length) {
      setTempelHasil(t("kol.form.tempel.kosong"));
      return;
    }
    setForm(r.isi as Partial<Form>);
    const bagian = [t("kol.form.tempel.terisi", { daftar: kolom.map(labelKolomTempel).join(", ") })];
    if (r.tidakTerbaca.length) bagian.push(t("kol.form.tempel.takTerbaca", { n: r.tidakTerbaca.length }));
    setTempelHasil(bagian.join(" "));
  };

  // Angka terukur akun TikTok utama: isian ER/rata-rata views mengikutinya selama tidak diketik lain.
  const locale = useLocale();
  const terukur = awal?.terukur ?? null;
  const keteranganTerukur = (jenis: "er" | "avgViews") => {
    const nilai = terukur?.[jenis] ?? null;
    if (terukur === null || nilai === null) return null;
    const tanggal = terukur.pada ? formatDisplayDate(terukur.pada, locale) : "—";
    const isian = jenis === "er" ? er : avgViews;
    if (samaDenganTerukur(isian, nilai, jenis === "er" ? TOLERANSI_ER : 0)) {
      return <p className="text-xs text-muted-foreground">{t("kol.form.terukurIkut", { tanggal })}</p>;
    }
    const angka = new Intl.NumberFormat(locale === "en" ? "en-GB" : "id-ID", { maximumFractionDigits: 2 }).format(nilai);
    const teks = jenis === "er" ? `${angka}%` : angka;
    return (
      <p className="text-xs text-muted-foreground">
        {t(isian === null ? "kol.form.terukurKosong" : "kol.form.terukurBeda", { nilai: teks, tanggal })}{" "}
        <button type="button" className="font-medium text-tautan underline underline-offset-2" onClick={() => setForm({ [jenis]: angkaKeTeks(nilai) })}>
          {t("kol.form.terukurPakai")}
        </button>
      </p>
    );
  };
  const rateCard = bacaOpsional(form.rateCard);
  const tinggi = bacaOpsional(form.tinggi, true);
  const pengikut = form.akun.map((a) => bacaOpsional(a.pengikut, true));
  const adaHandle = form.akun.some((a) => a.handle.trim());
  const angkaRusak = [er, avgViews, rateCard, tinggi, ...pengikut].some((n) => Number.isNaN(n));
  const labelSekarang = bacaLabel(form.label).map((l) => l.toLowerCase());

  const tutup = () => {
    if (kotor && !menyimpan) setTanyaBuang(true);
    else onTutup();
  };

  const simpan = (alasan: string | null) => {
    if (!adaHandle || angkaRusak) return;
    const isi: IsiKol = {
      name: form.name,
      recipientName: form.recipientName || null,
      niche: form.niche || null,
      phone: form.phone || null,
      email: form.email || null,
      engagementRate: er,
      avgViews,
      address: form.address || null,
      city: form.city || null,
      province: form.province || null,
      postalCode: form.postalCode || null,
      ukuran: {
        atasan: form.atasan || null,
        bawahan: form.bawahan || null,
        tinggiCm: tinggi,
        hijab: form.hijab === "ya" ? true : form.hijab === "tidak" ? false : null,
        catatan: form.catatanFit || null,
      },
      rateCard,
      rateNote: form.rateNote || null,
      label: form.label || null,
      note: form.note || null,
      akun: form.akun
        .map((a, i) => ({ id: a.id, platform: a.platform, handle: a.handle, followers: pengikut[i] ?? 0, url: a.url || null }))
        .filter((a) => a.handle.trim()),
    };
    startSimpan(async () => {
      const r = await simpanKolAction({ id: awal?.id ?? null, isi, alasanKembar: alasan });
      if (!r.ok) {
        if (r.kode === "KEMBAR" && r.kembar?.length) {
          setKembar(r.kembar);
          return;
        }
        toast.error(pesanGagalKol(t, r.kode, r.detail));
        return;
      }
      toast.success(
        r.dibuat ? t("kol.form.okBaru") : r.riwayatPengikut > 0 ? t("kol.form.okRiwayat", { n: r.riwayatPengikut }) : t("kol.form.okUbah"),
      );
      onTersimpan?.({ id: r.id, dibuat: r.dibuat });
      onTutup();
    });
  };

  const bidang = (id: string, label: string, el: ReactNode, galat?: string | null) => (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {el}
      {galat ? <p className="text-xs text-destructive">{galat}</p> : null}
    </div>
  );
  const galatAngka = (n: number | null) => (Number.isNaN(n) ? t("kol.form.angkaTakTerbaca") : null);

  return (
    <Dialog
      open
      onOpenChange={(b) => {
        // Esc, klik di luar, dan tombol × lewat sini: isian yang belum disimpan ditanyakan dulu.
        if (!b) tutup();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{awal ? t("kol.form.judulUbah", { nama: awal.name }) : t("kol.form.judulBaru")}</DialogTitle>
        </DialogHeader>

        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">{t("kol.form.akun")}</h3>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() =>
                setForm({ akun: [...form.akun, { kunci: kunciBaru(), id: null, platform: "INSTAGRAM", handle: "", pengikut: "", url: "" }] })
              }
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              {t("kol.form.tambahAkun")}
            </Button>
          </div>
          {form.akun.map((a, i) => (
            <div key={a.kunci} className="grid gap-2 rounded-md border p-2 sm:grid-cols-[9rem_1fr_8rem_auto]">
              <Select value={a.platform} onValueChange={(v) => setAkun(a.kunci, { platform: v as Platform })}>
                <SelectTrigger className="w-full" aria-label={t("kol.form.platform")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEMUA_PLATFORM.map((p) => (
                    <SelectItem key={p} value={p}>
                      {tc(`platform${p}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                aria-label={t("kol.form.handle")}
                placeholder={t("kol.form.handlePh")}
                value={a.handle}
                onChange={(e) => setAkun(a.kunci, { handle: e.target.value })}
                autoFocus={i === 0 && !awal}
              />
              <Input
                aria-label={t("kol.form.pengikut")}
                aria-invalid={Number.isNaN(pengikut[i])}
                placeholder={t("kol.form.pengikutPh")}
                inputMode="decimal"
                className="tabular-nums"
                value={a.pengikut}
                onChange={(e) => setAkun(a.kunci, { pengikut: e.target.value })}
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={t("kol.form.hapusAkun")}
                title={t("kol.form.hapusAkun")}
                disabled={form.akun.length === 1}
                onClick={() => setForm({ akun: form.akun.filter((x) => x.kunci !== a.kunci) })}
              >
                <X className="h-4 w-4" />
              </Button>
              <Input
                className="sm:col-span-3"
                aria-label={t("kol.form.url")}
                placeholder={`${t("kol.form.url")} — ${t("kol.form.urlPh")}`}
                value={a.url}
                onChange={(e) => setAkun(a.kunci, { url: e.target.value })}
              />
              {Number.isNaN(pengikut[i]) && <p className="text-xs text-destructive sm:col-span-4">{t("kol.form.angkaTakTerbaca")}</p>}
            </div>
          ))}
          {!adaHandle && <p className="text-xs text-muted-foreground">{t("kol.form.akunWajib")}</p>}
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium">{t("kol.form.bagianKontak")}</h3>
            <Button type="button" size="sm" variant="ghost" onClick={() => setTempelBuka((b) => !b)} aria-expanded={tempelBuka}>
              <ClipboardPaste className="h-4 w-4" aria-hidden />
              {t("kol.form.tempel.judul")}
            </Button>
          </div>
          {tempelBuka ? (
            <div className="space-y-2 rounded-md border border-dashed p-3">
              <p className="text-xs text-muted-foreground">{t("kol.form.tempel.petunjuk")}</p>
              <Textarea
                rows={6}
                value={tempelTeks}
                onChange={(e) => {
                  setTempelTeks(e.target.value);
                  setTempelHasil(null);
                }}
                aria-label={t("kol.form.tempel.judul")}
                placeholder={"Nama penerima: …\nNo. HP: …\nAlamat lengkap: …\nKota: …\nKode pos: …\nUkuran: M / 28"}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" onClick={isiDariTempel} disabled={!tempelTeks.trim()}>
                  {t("kol.form.tempel.baca")}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setTempelBuka(false)}>
                  {t("kol.form.tempel.tutup")}
                </Button>
              </div>
              {tempelHasil ? (
                <p className="text-xs" role="status">
                  {tempelHasil}
                </p>
              ) : null}
            </div>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            {bidang("kol-nama", t("kol.form.nama"), (
              <Input id="kol-nama" placeholder={t("kol.form.namaPh")} value={form.name} onChange={(e) => setForm({ name: e.target.value })} />
            ))}
            {bidang("kol-penerima", t("kol.form.penerima"), (
              <Input id="kol-penerima" value={form.recipientName} onChange={(e) => setForm({ recipientName: e.target.value })} />
            ))}
            {bidang("kol-niche", t("kol.form.niche"), (
              <>
                <Input id="kol-niche" list="kol-daftar-niche" placeholder={t("kol.form.nichePh")} value={form.niche} onChange={(e) => setForm({ niche: e.target.value })} />
                <datalist id="kol-daftar-niche">
                  {niche.map((n) => (
                    <option key={n} value={n} />
                  ))}
                </datalist>
              </>
            ))}
            <div className="grid grid-cols-2 gap-3">
              {bidang("kol-er", t("kol.form.er"), (
                <>
                  <Input id="kol-er" inputMode="decimal" className="tabular-nums" placeholder={t("kol.form.erPh")} aria-invalid={Number.isNaN(er)} value={form.er} onChange={(e) => setForm({ er: e.target.value })} />
                  {keteranganTerukur("er")}
                </>
              ), galatAngka(er))}
              {bidang("kol-views", t("kol.form.avgViews"), (
                <>
                  <Input id="kol-views" inputMode="decimal" className="tabular-nums" placeholder={t("kol.form.avgViewsPh")} aria-invalid={Number.isNaN(avgViews)} value={form.avgViews} onChange={(e) => setForm({ avgViews: e.target.value })} />
                  {keteranganTerukur("avgViews")}
                </>
              ), galatAngka(avgViews))}
            </div>
            {bidang("kol-wa", t("kol.form.wa"), (
              <Input id="kol-wa" inputMode="tel" placeholder={t("kol.form.waPh")} value={form.phone} onChange={(e) => setForm({ phone: e.target.value })} />
            ))}
            {bidang("kol-email", t("kol.form.email"), (
              <Input id="kol-email" type="email" value={form.email} onChange={(e) => setForm({ email: e.target.value })} />
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-medium">{t("kol.form.bagianAlamat")}</h3>
          {bidang("kol-alamat", t("kol.form.alamat"), (
            <Textarea id="kol-alamat" rows={2} value={form.address} onChange={(e) => setForm({ address: e.target.value })} />
          ))}
          <div className="grid gap-3 sm:grid-cols-3">
            {bidang("kol-kota", t("kol.form.kota"), <Input id="kol-kota" value={form.city} onChange={(e) => setForm({ city: e.target.value })} />)}
            {bidang("kol-provinsi", t("kol.form.provinsi"), (
              <Input id="kol-provinsi" value={form.province} onChange={(e) => setForm({ province: e.target.value })} />
            ))}
            {bidang("kol-kodepos", t("kol.form.kodePos"), (
              <Input id="kol-kodepos" inputMode="numeric" value={form.postalCode} onChange={(e) => setForm({ postalCode: e.target.value })} />
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-medium">{t("kol.form.bagianUkuran")}</h3>
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
            {bidang("kol-atasan", t("kol.form.atasan"), (
              <Input id="kol-atasan" placeholder={t("kol.form.atasanPh")} value={form.atasan} onChange={(e) => setForm({ atasan: e.target.value })} />
            ))}
            {bidang("kol-bawahan", t("kol.form.bawahan"), (
              <Input id="kol-bawahan" placeholder={t("kol.form.bawahanPh")} value={form.bawahan} onChange={(e) => setForm({ bawahan: e.target.value })} />
            ))}
            {bidang("kol-tinggi", t("kol.form.tinggi"), (
              <Input id="kol-tinggi" inputMode="numeric" className="tabular-nums" aria-invalid={Number.isNaN(tinggi)} value={form.tinggi} onChange={(e) => setForm({ tinggi: e.target.value })} />
            ), galatAngka(tinggi))}
            {bidang("kol-hijab", t("kol.form.hijab"), (
              <Select value={form.hijab || "kosong"} onValueChange={(v) => setForm({ hijab: v === "kosong" ? "" : (v as Form["hijab"]) })}>
                <SelectTrigger id="kol-hijab" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="kosong">{t("kol.form.hijabKosong")}</SelectItem>
                  <SelectItem value="ya">{t("kol.form.hijabYa")}</SelectItem>
                  <SelectItem value="tidak">{t("kol.form.hijabTidak")}</SelectItem>
                </SelectContent>
              </Select>
            ))}
          </div>
          {bidang("kol-fit", t("kol.form.catatanFit"), (
            <Input id="kol-fit" placeholder={t("kol.form.catatanFitPh")} value={form.catatanFit} onChange={(e) => setForm({ catatanFit: e.target.value })} />
          ))}
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-medium">{t("kol.form.bagianLain")}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {bidang("kol-rate", t("kol.form.rateCard"), (
              <Input id="kol-rate" inputMode="decimal" className="tabular-nums" placeholder={t("kol.form.rateCardPh")} aria-invalid={Number.isNaN(rateCard)} value={form.rateCard} onChange={(e) => setForm({ rateCard: e.target.value })} />
            ), galatAngka(rateCard))}
            {bidang("kol-ratenote", t("kol.form.rateNote"), (
              <Input id="kol-ratenote" value={form.rateNote} onChange={(e) => setForm({ rateNote: e.target.value })} />
            ))}
          </div>
          {bidang("kol-label", t("kol.form.label"), (
            <>
              <Input id="kol-label" placeholder={t("kol.form.labelPh")} value={form.label} onChange={(e) => setForm({ label: e.target.value })} />
              {labelSaran.some((l) => !labelSekarang.includes(l.toLowerCase())) && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {labelSaran
                    .filter((l) => !labelSekarang.includes(l.toLowerCase()))
                    .slice(0, 12)
                    .map((l) => (
                      <button
                        key={l}
                        type="button"
                        className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                        onClick={() => setForm({ label: [...bacaLabel(form.label), l].join(", ") })}
                      >
                        + {l}
                      </button>
                    ))}
                </div>
              )}
            </>
          ))}
          {bidang("kol-catatan", t("kol.form.catatan"), (
            <Textarea id="kol-catatan" rows={2} value={form.note} onChange={(e) => setForm({ note: e.target.value })} />
          ))}
        </section>

        {kembar && (
          <div className="space-y-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3" role="alert">
            <p className="flex items-center gap-2 text-sm font-medium">
              <AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden />
              {t("kol.kembar.judul")}
            </p>
            <p className="text-sm text-muted-foreground">{t("kol.kembar.isi")}</p>
            <ul className="space-y-1.5">
              {kembar.map((k) => (
                <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-background px-2 py-1.5 text-sm">
                  <span className="min-w-0">
                    <span className="font-medium">{k.nama}</span>
                    <span className="ml-2 text-muted-foreground">
                      {k.handles.slice(0, 3).map((h) => `@${h}`).join(", ")} · {k.sebab.map((s) => t(`kol.kembar.sebab${s}`)).join(", ")}
                    </span>
                    {k.diblokir && (
                      <StatusPill tone="attention" className="ml-2 align-middle">
                        {t("kol.kembar.diblokir")}
                      </StatusPill>
                    )}
                  </span>
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/backoffice/kreatif/kol/${k.id}`}>{t("kol.kembar.buka")}</Link>
                  </Button>
                </li>
              ))}
            </ul>
            <div className="space-y-1.5">
              <Label htmlFor="kol-alasan-kembar">{t("kol.kembar.alasan")}</Label>
              <Textarea
                id="kol-alasan-kembar"
                rows={2}
                placeholder={t("kol.kembar.alasanPh")}
                value={alasanKembar}
                onChange={(e) => setAlasanKembar(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setKembar(null)}>
                {t("kol.kembar.batal")}
              </Button>
              <Button size="sm" disabled={menyimpan || !alasanKembar.trim()} onClick={() => simpan(alasanKembar.trim())}>
                {menyimpan && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                {t("kol.kembar.tetap")}
              </Button>
            </div>
          </div>
        )}

        {!kembar && (
          <DialogFooter>
            <Button variant="outline" onClick={tutup}>
              {t("kol.form.batal")}
            </Button>
            <Button disabled={menyimpan || !adaHandle || angkaRusak} onClick={() => simpan(null)}>
              {menyimpan && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {awal ? t("kol.form.simpanUbah") : t("kol.form.simpan")}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>

      <AlertDialog open={tanyaBuang} onOpenChange={setTanyaBuang}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("kol.form.buangJudul")}</AlertDialogTitle>
            <AlertDialogDescription>{t("kol.form.buangIsi")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("kol.form.lanjutIsi")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={onTutup}>
              {t("kol.form.buang")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}

/**
 * Tambah/Ubah KOL. `awal` = null untuk KOL baru. Akun diubah di tempat oleh
 * penulisnya; kembar ditampilkan di dialog ini dengan pilihan Buka yang ada /
 * Tetap simpan (beralasan) / Batal.
 */
export function DialogKol({
  buka,
  onBukaUbah,
  awal,
  niche,
  labelSaran,
  onTersimpan,
}: {
  buka: boolean;
  onBukaUbah: (b: boolean) => void;
  awal: DataFormKol | null;
  niche: readonly string[];
  labelSaran: readonly string[];
  onTersimpan?: (r: { id: string; dibuat: boolean }) => void;
}) {
  if (!buka) return null;
  return (
    <IsiDialogKol
      key={awal?.id ?? "baru"}
      awal={awal}
      niche={niche}
      labelSaran={labelSaran}
      onTutup={() => onBukaUbah(false)}
      onTersimpan={onTersimpan}
    />
  );
}
