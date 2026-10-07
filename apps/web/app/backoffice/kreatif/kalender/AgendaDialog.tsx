"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Trash2, X } from "lucide-react";
import { hapusAgendaAction, selesaiAgendaAction, simpanAgendaAction } from "@/app/actions/kreatif-agenda";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { JamInput, TanggalInput } from "@/components/ui/tanggal-input";
import { Textarea } from "@/components/ui/textarea";
import { BATAS_AGENDA, checklistKeTeks, validasiAgenda, type GalatAgenda, type KolomAgenda } from "@/lib/creative/agenda-aturan";
import type { AgendaKalender, OpsiAgenda } from "@/lib/creative/agenda-queries";
import { SEMUA_JENIS_AGENDA, type JenisAgenda } from "@/lib/creative/tahap";
import { dinamis } from "@/lib/i18n/dinamis";

const TANPA = "__tanpa__";

type Isian = {
  judul: string;
  tanggal: string;
  jam: string;
  jenis: JenisAgenda;
  checklist: string;
  catatan: string;
  campaignId: string;
  kolaborasiId: string;
  kolId: string;
  ingatHari: string;
  selesai: boolean;
};

export type BukaAgenda = { mode: "baru"; tanggal: string } | { mode: "ubah"; agenda: AgendaKalender };

function isianAwal(b: BukaAgenda): Isian {
  if (b.mode === "baru") {
    return { judul: "", tanggal: b.tanggal, jam: "", jenis: "TUGAS", checklist: "", catatan: "", campaignId: "", kolaborasiId: "", kolId: "", ingatHari: "0", selesai: false };
  }
  const a = b.agenda;
  return {
    judul: a.judul,
    tanggal: a.tanggal,
    jam: a.jam ?? "",
    jenis: a.jenis,
    checklist: checklistKeTeks(a.checklist),
    catatan: a.catatan ?? "",
    campaignId: a.campaignId ?? "",
    kolaborasiId: a.kolaborasiId ?? "",
    kolId: a.kolId ?? "",
    ingatHari: String(a.ingatHari),
    selesai: a.selesai,
  };
}

/**
 * Dialog agenda baru / ubah. Isian diperiksa di sini dengan aturan yang sama
 * dengan server (`validasiAgenda`) supaya setiap isian yang salah ditandai di
 * tempatnya — jam yang salah dan "ingatkan H-n" di luar 0–30 tidak pernah
 * diam-diam dikosongkan atau dijepit (bug KOL Manager §6.21).
 */
export function AgendaDialog({
  buka,
  opsi,
  onTutup,
  onTersimpan,
}: {
  buka: BukaAgenda | null;
  opsi: OpsiAgenda;
  onTutup: () => void;
  /** Dipanggil dengan tanggal agenda sesudah disimpan/dihapus. */
  onTersimpan: (tanggal: string) => void;
}) {
  return (
    <Dialog open={buka !== null} onOpenChange={(o) => (!o ? onTutup() : undefined)}>
      {buka ? (
        <IsiDialog key={buka.mode === "ubah" ? buka.agenda.id : `baru:${buka.tanggal}`} buka={buka} opsi={opsi} onTutup={onTutup} onTersimpan={onTersimpan} />
      ) : null}
    </Dialog>
  );
}

function IsiDialog({
  buka,
  opsi,
  onTutup,
  onTersimpan,
}: {
  buka: BukaAgenda;
  opsi: OpsiAgenda;
  onTutup: () => void;
  onTersimpan: (tanggal: string) => void;
}) {
  const t = useTranslations("kreatifRuang");
  const td = dinamis(t);
  const [isi, setIsi] = useState<Isian>(() => isianAwal(buka));
  const [galat, setGalat] = useState<GalatAgenda[]>([]);
  const [konfirmasiHapus, setKonfirmasiHapus] = useState(false);
  const [menyimpan, mulai] = useTransition();
  const ubah = buka.mode === "ubah" ? buka.agenda : null;

  const set = <K extends keyof Isian>(k: K, v: Isian[K]) => setIsi((x) => ({ ...x, [k]: v }));
  const galatDi = (kolom: KolomAgenda) => galat.find((g) => g.kolom === kolom);
  const pesan = (kolom: KolomAgenda) => {
    const g = galatDi(kolom);
    return g ? (
      <p className="text-xs text-destructive" id={`agenda-${kolom}-galat`}>
        {td(`kalender.form.galat.${g.kode}`)}
      </p>
    ) : null;
  };

  // Pilihan kaitan + kaitan agenda ini sendiri (campaign yang sudah diarsip,
  // kolaborasi yang sudah selesai) supaya tidak tampil sebagai kosong.
  const opsiCampaign = [
    { value: TANPA, label: t("kalender.form.tanpa") },
    ...opsi.campaign.map((c) => ({ value: c.id, label: c.nama })),
    ...(ubah?.campaignId && !opsi.campaign.some((c) => c.id === ubah.campaignId) ? [{ value: ubah.campaignId, label: ubah.campaignNama ?? ubah.campaignId }] : []),
  ];
  const opsiKolaborasi = [
    { value: TANPA, label: t("kalender.form.tanpa") },
    ...opsi.kolaborasi.map((c) => ({ value: c.id, label: c.label })),
    ...(ubah?.kolaborasiId && !opsi.kolaborasi.some((c) => c.id === ubah.kolaborasiId)
      ? [{ value: ubah.kolaborasiId, label: [ubah.kolaborasiDocNo, ubah.kolNama].filter(Boolean).join(" · ") || ubah.kolaborasiId }]
      : []),
  ];
  const opsiKol = [
    { value: TANPA, label: t("kalender.form.tanpa") },
    ...opsi.kol.map((k) => ({ value: k.id, label: k.nama })),
    ...(ubah?.kolId && !opsi.kol.some((k) => k.id === ubah.kolId) ? [{ value: ubah.kolId, label: ubah.kolNama ?? ubah.kolId }] : []),
  ];

  const pilihKolaborasi = (v: string) => {
    const id = v && v !== TANPA ? v : "";
    const kolDari = opsi.kolaborasi.find((c) => c.id === id)?.kolId;
    setIsi((x) => ({ ...x, kolaborasiId: id, kolId: kolDari ?? x.kolId }));
  };

  const simpan = () => {
    const kirim = {
      ...(ubah ? { id: ubah.id } : {}),
      judul: isi.judul,
      tanggal: isi.tanggal,
      jam: isi.jam,
      jenis: isi.jenis,
      checklist: isi.checklist,
      catatan: isi.catatan,
      campaignId: isi.campaignId || null,
      kolaborasiId: isi.kolaborasiId || null,
      kolId: isi.kolaborasiId ? null : isi.kolId || null,
      ingatHari: isi.ingatHari,
    };
    const cek = validasiAgenda(kirim);
    if (!cek.ok) {
      setGalat(cek.galat);
      return;
    }
    setGalat([]);
    mulai(async () => {
      const r = await simpanAgendaAction(kirim);
      if (!r.ok) {
        if (r.kode === "TIDAK_VALID" && "galat" in r) setGalat(r.galat);
        toast.error(td(`kalender.err.${r.kode}`));
        return;
      }
      if (ubah && ubah.selesai !== isi.selesai) {
        const s = await selesaiAgendaAction({ id: r.id, selesai: isi.selesai });
        if (!s.ok) toast.error(td(`kalender.err.${s.kode}`));
      }
      toast.success(t("kalender.form.okSimpan"));
      onTersimpan(r.tanggal);
    });
  };

  const hapus = () =>
    mulai(async () => {
      if (!ubah) return;
      const r = await hapusAgendaAction({ id: ubah.id });
      if (!r.ok) {
        toast.error(td(`kalender.err.${r.kode}`));
        return;
      }
      toast.success(t("kalender.form.okHapus"));
      setKonfirmasiHapus(false);
      onTersimpan(ubah.tanggal);
    });

  return (
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>{ubah ? t("kalender.form.judulUbah") : t("kalender.form.judulBaru")}</DialogTitle>
      </DialogHeader>

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          simpan();
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="agenda-judul">{t("kalender.form.judul")}</Label>
          <Input
            id="agenda-judul"
            value={isi.judul}
            maxLength={BATAS_AGENDA.judul}
            placeholder={t("kalender.form.judulPlaceholder")}
            onChange={(e) => set("judul", e.target.value)}
            aria-invalid={Boolean(galatDi("judul"))}
            aria-describedby={galatDi("judul") ? "agenda-judul-galat" : undefined}
            autoFocus
          />
          {pesan("judul")}
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="agenda-tanggal">{t("kalender.form.tanggal")}</Label>
            <TanggalInput id="agenda-tanggal" value={isi.tanggal} onChange={(e) => set("tanggal", e.target.value)} required aria-invalid={Boolean(galatDi("tanggal"))} />
            {pesan("tanggal")}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="agenda-jam">{t("kalender.form.jam")}</Label>
            <div className="flex items-center gap-1">
              <JamInput id="agenda-jam" value={isi.jam} onChange={(e) => set("jam", e.target.value)} aria-invalid={Boolean(galatDi("jam"))} />
              {isi.jam ? (
                <Button type="button" variant="ghost" size="icon-sm" aria-label={t("kalender.form.hapusJam")} title={t("kalender.form.hapusJam")} onClick={() => set("jam", "")}>
                  <X className="h-4 w-4" />
                </Button>
              ) : null}
            </div>
            {pesan("jam")}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="agenda-jenis">{t("kalender.form.jenis")}</Label>
            <Select value={isi.jenis} onValueChange={(v) => set("jenis", v as JenisAgenda)}>
              <SelectTrigger id="agenda-jenis" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SEMUA_JENIS_AGENDA.map((j) => (
                  <SelectItem key={j} value={j}>
                    {td(`agenda.${j}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="agenda-checklist">{t("kalender.form.checklist")}</Label>
          <Textarea
            id="agenda-checklist"
            rows={6}
            value={isi.checklist}
            onChange={(e) => set("checklist", e.target.value)}
            aria-invalid={Boolean(galatDi("checklist"))}
            aria-describedby="agenda-checklist-petunjuk"
          />
          <p id="agenda-checklist-petunjuk" className="text-xs text-muted-foreground">
            {t("kalender.form.checklistPetunjuk")}
          </p>
          {pesan("checklist")}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="agenda-catatan">{t("kalender.form.catatan")}</Label>
          <Textarea
            id="agenda-catatan"
            rows={3}
            value={isi.catatan}
            maxLength={BATAS_AGENDA.catatan}
            onChange={(e) => set("catatan", e.target.value)}
            aria-invalid={Boolean(galatDi("catatan"))}
          />
          {pesan("catatan")}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>{t("kalender.form.campaign")}</Label>
            <SearchableCombobox
              options={opsiCampaign}
              value={isi.campaignId || TANPA}
              onValueChange={(v) => set("campaignId", v && v !== TANPA ? v : "")}
              placeholder={t("kalender.form.tanpa")}
              searchPlaceholder={t("kalender.form.cari")}
              emptyMessage={t("kalender.form.tidakAda")}
              className="w-full"
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t("kalender.form.kolaborasi")}</Label>
            <SearchableCombobox
              options={opsiKolaborasi}
              value={isi.kolaborasiId || TANPA}
              onValueChange={pilihKolaborasi}
              placeholder={t("kalender.form.tanpa")}
              searchPlaceholder={t("kalender.form.cari")}
              emptyMessage={t("kalender.form.tidakAda")}
              className="w-full"
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t("kalender.form.kol")}</Label>
            <SearchableCombobox
              options={opsiKol}
              value={isi.kolId || TANPA}
              onValueChange={(v) => set("kolId", v && v !== TANPA ? v : "")}
              placeholder={t("kalender.form.tanpa")}
              searchPlaceholder={t("kalender.form.cari")}
              emptyMessage={t("kalender.form.tidakAda")}
              disabled={Boolean(isi.kolaborasiId)}
              className="w-full"
            />
            {isi.kolaborasiId ? <p className="text-xs text-muted-foreground">{t("kalender.form.kolDariKolaborasi")}</p> : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="agenda-ingat">{t("kalender.form.ingat")}</Label>
            <Input
              id="agenda-ingat"
              type="number"
              inputMode="numeric"
              min={0}
              max={BATAS_AGENDA.ingatMaks}
              step={1}
              value={isi.ingatHari}
              onChange={(e) => set("ingatHari", e.target.value)}
              className="w-28 tabular-nums"
              aria-invalid={Boolean(galatDi("ingatHari"))}
              aria-describedby="agenda-ingat-petunjuk"
            />
            <p id="agenda-ingat-petunjuk" className="text-xs text-muted-foreground">
              {t("kalender.form.ingatPetunjuk")}
            </p>
            {pesan("ingatHari")}
          </div>
        </div>

        {ubah ? (
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={isi.selesai} onCheckedChange={(v) => set("selesai", v === true)} />
            {t("kalender.form.selesai")}
          </label>
        ) : null}

        <DialogFooter className="gap-2 sm:justify-between">
          {ubah ? (
            <Button type="button" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setKonfirmasiHapus(true)} disabled={menyimpan}>
              <Trash2 className="h-4 w-4" aria-hidden />
              {t("kalender.form.hapus")}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={onTutup} disabled={menyimpan}>
              {t("kalender.form.batal")}
            </Button>
            <Button type="submit" disabled={menyimpan}>
              {menyimpan ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {menyimpan ? t("kalender.form.menyimpan") : t("kalender.form.simpan")}
            </Button>
          </div>
        </DialogFooter>
      </form>

      <AlertDialog open={konfirmasiHapus} onOpenChange={setKonfirmasiHapus}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("kalender.form.hapusJudul")}</AlertDialogTitle>
            <AlertDialogDescription>{t("kalender.form.hapusIsi", { judul: ubah?.judul ?? "" })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={menyimpan}>{t("kalender.form.batal")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={menyimpan}
              onClick={(e) => {
                e.preventDefault();
                hapus();
              }}
            >
              {t("kalender.form.hapus")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DialogContent>
  );
}
