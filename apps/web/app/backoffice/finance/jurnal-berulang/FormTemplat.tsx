"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeft, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TanggalInput } from "@/components/ui/tanggal-input";
import { Textarea } from "@/components/ui/textarea";
import { formatDisplayDate } from "@/lib/date-only";
import { formatRupiah } from "@/lib/format/rupiah";
import { newLocalId } from "@/lib/pwa/id-lokal";
import { LABEL_KANAL_JURNAL, SEMUA_KANAL_JURNAL } from "@/lib/finance/journals/kanal";
import { periksaTemplat, periodeJatuhTempo, postingBerikutnya } from "@/lib/finance/berulang/aturan";
import type { PilihanAkun } from "@/lib/finance/aset/queries";
import { buatTemplatAction, ubahTemplatAction } from "@/app/actions/finance-berulang";
import { pesanGalatBerulang } from "./pesan";

export type BarisIsian = { id: string; akunId: string; debit: string; kredit: string; memo: string; kanal: string };

export type NilaiAwalTemplat = {
  nama: string;
  keterangan: string;
  hari: number;
  mulai: string;
  selesai: string;
  balikOtomatis: boolean;
  baris: Omit<BarisIsian, "id">[];
};

type Props = {
  akun: PilihanAkun[];
  hariIni: string;
  ubah?: { id: string; nilai: NilaiAwalTemplat };
};

const TANPA_KANAL = "__tanpa__";

const barisKosong = (): BarisIsian => ({ id: newLocalId(), akunId: "", debit: "", kredit: "", memo: "", kanal: "" });

export function FormTemplat({ akun, hariIni, ubah }: Props) {
  const t = useTranslations("jurnalBerulang");
  const locale = useLocale();
  const router = useRouter();
  const [pending, mulai] = useTransition();
  const [kunci] = useState(() => newLocalId());
  const awal = ubah?.nilai;
  const [nama, setNama] = useState(awal?.nama ?? "");
  const [keterangan, setKeterangan] = useState(awal?.keterangan ?? "");
  const [hari, setHari] = useState(String(awal?.hari ?? 1));
  const [mulaiTgl, setMulaiTgl] = useState(awal?.mulai ?? hariIni);
  const [selesai, setSelesai] = useState(awal?.selesai ?? "");
  const [balik, setBalik] = useState(awal?.balikOtomatis ?? false);
  const [baris, setBaris] = useState<BarisIsian[]>(() =>
    awal?.baris.length ? awal.baris.map((b) => ({ ...b, id: newLocalId() })) : [barisKosong(), barisKosong()],
  );

  const opsiAkun = useMemo(() => akun.map((a) => ({ value: a.id, label: `${a.kode} — ${a.nama}` })), [akun]);
  const ubahBaris = (id: string, isi: Partial<BarisIsian>) => setBaris((xs) => xs.map((b) => (b.id === id ? { ...b, ...isi } : b)));

  const isian = {
    nama,
    keterangan,
    hari: Number(hari),
    mulai: mulaiTgl,
    selesai: selesai || null,
    balikOtomatis: balik,
    baris: baris.map((b) => ({ akunId: b.akunId, debit: b.debit, kredit: b.kredit, memo: b.memo, kanal: b.kanal || null })),
  };
  const periksa = periksaTemplat(isian);
  const dr = baris.reduce((s, b) => s + Math.round((Number(b.debit.replace(",", ".")) || 0) * 100), 0) / 100;
  const cr = baris.reduce((s, b) => s + Math.round((Number(b.kredit.replace(",", ".")) || 0) * 100), 0) / 100;
  const jadwal = periksa.ok ? { hari: periksa.templat.hari, mulai: periksa.templat.mulai, selesai: periksa.templat.selesai } : null;
  const terlewat = jadwal ? periodeJatuhTempo(jadwal, hariIni).length : 0;
  const berikut = jadwal ? postingBerikutnya(jadwal, hariIni) : null;

  const kirim = () =>
    mulai(async () => {
      if (!periksa.ok) return;
      const r = ubah ? await ubahTemplatAction({ ...isian, id: ubah.id }) : await buatTemplatAction({ ...isian, idempotencyKey: kunci });
      if (!r.ok) {
        toast.error(pesanGalatBerulang(t, r.kode, "baris" in r ? r.baris : undefined));
        return;
      }
      toast.success(t("form.tersimpan"));
      router.push(`/backoffice/finance/jurnal-berulang/${r.id}`);
      router.refresh();
    });

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild>
        <Link href={ubah ? `/backoffice/finance/jurnal-berulang/${ubah.id}` : "/backoffice/finance/jurnal-berulang"}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          {t("kembali")}
        </Link>
      </Button>
      <PageHeader title={ubah ? t("form.judulUbah") : t("form.judulBaru")} />

      <Card>
        <CardHeader>
          <CardTitle>{t("form.bagianJadwal")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="tpl-nama">{t("form.nama")}</Label>
              <Input id="tpl-nama" value={nama} maxLength={191} placeholder={t("form.namaContoh")} onChange={(e) => setNama(e.target.value)} disabled={pending} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tpl-hari">{t("form.hari")}</Label>
              <Select value={hari} onValueChange={setHari} disabled={pending}>
                <SelectTrigger id="tpl-hari" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 31 }, (_, i) => String(i + 1)).map((h) => (
                    <SelectItem key={h} value={h}>
                      {t("setiapTanggal", { hari: h })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {Number(hari) > 28 ? <p className="text-xs text-muted-foreground">{t("form.hariPendek")}</p> : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tpl-mulai">{t("form.mulai")}</Label>
              <TanggalInput id="tpl-mulai" value={mulaiTgl} required onChange={(e) => setMulaiTgl(e.target.value)} disabled={pending} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tpl-selesai">{t("form.selesai")}</Label>
              <TanggalInput id="tpl-selesai" value={selesai} min={mulaiTgl} onChange={(e) => setSelesai(e.target.value)} disabled={pending} />
            </div>
          </div>
          <div className="flex items-start gap-2">
            <Checkbox id="tpl-balik" checked={balik} onCheckedChange={(v) => setBalik(v === true)} disabled={pending} className="mt-0.5" />
            <div>
              <Label htmlFor="tpl-balik">{t("form.balik")}</Label>
              <p className="text-xs text-muted-foreground">{t("form.balikPetunjuk")}</p>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tpl-ket">{t("form.keterangan")}</Label>
            <Textarea id="tpl-ket" rows={2} maxLength={2000} value={keterangan} onChange={(e) => setKeterangan(e.target.value)} disabled={pending} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("form.bagianBaris")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {baris.map((b, i) => (
            <div key={b.id} className="space-y-2 rounded-md border p-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Label className="text-xs">{t("form.akun")}</Label>
                  <SearchableCombobox options={opsiAkun} value={b.akunId} onValueChange={(v) => ubahBaris(b.id, { akunId: v })} placeholder={t("form.pilihAkun")} disabled={pending} triggerClassName="w-full" />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="mt-6 shrink-0"
                  disabled={pending || baris.length <= 2}
                  onClick={() => setBaris((xs) => xs.filter((x) => x.id !== b.id))}
                  aria-label={t("form.hapusBaris")}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">{t("form.debit")}</Label>
                  <Input inputMode="decimal" value={b.debit} placeholder="0" onChange={(e) => ubahBaris(b.id, { debit: e.target.value, kredit: e.target.value ? "" : b.kredit })} disabled={pending} className="text-right" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t("form.kredit")}</Label>
                  <Input inputMode="decimal" value={b.kredit} placeholder="0" onChange={(e) => ubahBaris(b.id, { kredit: e.target.value, debit: e.target.value ? "" : b.debit })} disabled={pending} className="text-right" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t("form.kanal")}</Label>
                  <Select value={b.kanal || TANPA_KANAL} onValueChange={(v) => ubahBaris(b.id, { kanal: v === TANPA_KANAL ? "" : v })} disabled={pending}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={TANPA_KANAL}>{t("form.tanpaKanal")}</SelectItem>
                      {SEMUA_KANAL_JURNAL.map((k) => (
                        <SelectItem key={k} value={k}>
                          {LABEL_KANAL_JURNAL[k]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t("form.memo")}</Label>
                  <Input value={b.memo} maxLength={191} placeholder={t("form.memoBaris", { n: i + 1 })} onChange={(e) => ubahBaris(b.id, { memo: e.target.value })} disabled={pending} />
                </div>
              </div>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={() => setBaris((xs) => [...xs, barisKosong()])} disabled={pending}>
            <Plus className="mr-2 h-4 w-4" />
            {t("form.tambahBaris")}
          </Button>
          <p className="text-sm tabular-nums">
            {t("form.jumlah", { debit: formatRupiah(dr), kredit: formatRupiah(cr) })}
          </p>
        </CardContent>
      </Card>

      {periksa.ok ? (
        <Card className="py-0">
          <CardContent className="space-y-1 p-4 text-sm">
            <p>{berikut ? t("form.pratinjauBerikut", { tanggal: formatDisplayDate(berikut, locale) }) : t("form.pratinjauBerakhir")}</p>
            {terlewat > 0 ? <p className="text-amber-700 dark:text-amber-400">{t("form.pratinjauTerlewat", { n: terlewat })}</p> : null}
            <p className="text-muted-foreground">{t("form.pratinjauPersetujuan")}</p>
          </CardContent>
        </Card>
      ) : null}

      <div className="space-y-2">
        <Button onClick={kirim} disabled={pending || !periksa.ok}>
          {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {t("form.simpan")}
        </Button>
        {!periksa.ok && !pending ? (
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {pesanGalatBerulang(t, periksa.kode, "baris" in periksa ? periksa.baris : undefined)}
          </p>
        ) : null}
      </div>
    </div>
  );
}
