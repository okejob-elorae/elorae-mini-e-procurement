"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { CalendarPlus, Check, ChevronDown, Clapperboard, ExternalLink, Loader2, Pencil, PenLine, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { setujuiDrafAction } from "@/app/actions/kreatif-konten";
import type { AmbangKreatif } from "@/lib/creative/ambang";
import { angkaTitik } from "@/lib/creative/angka-konten";
import { KOLOM_ANGKA, labelTitikAngka } from "@/lib/creative/konten-kol";
import type { DataPanelKonten, KontenPanel } from "@/lib/creative/konten-kol-queries";
import { labelTanggal } from "@/lib/tanggal-isian";
import { cn } from "@/lib/utils";
import { DialogCatatAngka } from "./DialogCatatAngka";
import { DialogKontenKol } from "./DialogKontenKol";
import { DialogMintaRevisi } from "./DialogMintaRevisi";
import { IsianAngkaKonten } from "./IsianAngkaKonten";
import { TabelRiwayatAngka } from "./RiwayatAngka";
import { useKabarKonten } from "./kabar-konten";

type Keadaan = "TAYANG" | "MENUNGGU" | "REVISI" | "DISETUJUI" | "RENCANA";

function keadaan(k: KontenPanel): Keadaan {
  if (k.link) return "TAYANG";
  if (k.draftStatus === "MENUNGGU" || k.draftStatus === "REVISI" || k.draftStatus === "DISETUJUI") return k.draftStatus;
  return "RENCANA";
}

const NADA: Record<Keadaan, StatusTone> = {
  TAYANG: "settled",
  MENUNGGU: "waiting",
  REVISI: "attention",
  DISETUJUI: "progress",
  RENCANA: "inactive",
};

/** Panel Konten di rincian kolaborasi: daftar konten + draf + angka (dengan riwayat). */
export function PanelKontenKolKlien({
  data,
  ambang,
  bolehMengelola,
}: {
  data: DataPanelKonten;
  ambang: AmbangKreatif;
  bolehMengelola: boolean;
}) {
  const t = useTranslations("kreatifRuang.kontenKol");
  const [dialog, setDialog] = useState<{ konten: KontenPanel | null } | null>(null);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          <Clapperboard className="h-5 w-5" />
          {t("panel.judul")}
          <span className="text-sm font-normal text-muted-foreground tabular-nums">({data.konten.length})</span>
        </CardTitle>
        {bolehMengelola ? (
          <Button size="sm" onClick={() => setDialog({ konten: null })}>
            <Plus className="h-4 w-4" />
            {t("panel.tambah")}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {data.konten.length === 0 ? (
          <EmptyState icon={Clapperboard} title={t("panel.kosong")} description={t("panel.kosongIsi")} className="py-6" />
        ) : (
          data.konten.map((k) => (
            <ButirKonten
              key={k.id}
              k={k}
              ambang={ambang}
              bolehMengelola={bolehMengelola}
              onUbah={() => setDialog({ konten: k })}
            />
          ))
        )}
      </CardContent>
      <DialogKontenKol
        kolaborasiId={data.kolaborasiId}
        konten={dialog?.konten ?? null}
        buka={dialog !== null}
        onBuka={(o) => !o && setDialog(null)}
      />
    </Card>
  );
}

function ButirKonten({
  k,
  ambang,
  bolehMengelola,
  onUbah,
}: {
  k: KontenPanel;
  ambang: AmbangKreatif;
  bolehMengelola: boolean;
  onUbah: () => void;
}) {
  const t = useTranslations("kreatifRuang.kontenKol");
  const tc = useTranslations("creative");
  const locale = useLocale();
  const router = useRouter();
  const kabar = useKabarKonten();
  const [revisi, setRevisi] = useState(false);
  const [catat, setCatat] = useState(false);
  const [riwayat, setRiwayat] = useState(false);
  const [pending, start] = useTransition();
  const kd = keadaan(k);
  const terakhir = k.angka[0] ?? null;
  const tgl = (h: string | null) => (h ? labelTanggal(h, locale) : "—");

  const setujui = () =>
    start(async () => {
      const r = await setujuiDrafAction(k.id);
      if (r.ok) {
        kabar.sukses("kontenKol.ok.setuju", r.maju);
        router.refresh();
      } else {
        kabar.gagal(r.kode);
      }
    });

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">
              {tc(`platform${k.platform}`)} · {tc(`format${k.format}`)}
            </span>
            <StatusPill tone={NADA[kd]}>{t(`panel.keadaan.${kd}`)}</StatusPill>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
            {k.link ? (
              <a href={k.link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-tautan hover:underline">
                {t("bukaKonten")}
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : null}
            {k.draftLink ? (
              <a href={k.draftLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-tautan hover:underline">
                {t("lihatDraf")}
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : null}
            {k.tayangHari ? <span className="tabular-nums">{t("panel.tayangPada", { tanggal: tgl(k.tayangHari) })}</span> : null}
            {!k.link && k.rencanaHari ? <span className="tabular-nums">{t("panel.rencanaPada", { tanggal: tgl(k.rencanaHari) })}</span> : null}
            {k.disetujuiHari ? (
              <span>{t("panel.disetujuiOleh", { tanggal: tgl(k.disetujuiHari), oleh: k.disetujuiOleh ?? "—" })}</span>
            ) : null}
            {k.adCode ? (
              <span>
                {t("panel.kodeIklan", { kode: k.adCode })}
                {k.adCodeSampai ? ` · ${t("panel.sampai", { tanggal: tgl(k.adCodeSampai) })}` : ""}
              </span>
            ) : null}
          </div>
          {kd === "REVISI" && k.draftNote ? <p className="text-xs text-muted-foreground">{t("panel.catatanRevisi", { catatan: k.draftNote })}</p> : null}
        </div>
        {bolehMengelola ? (
          <div className="flex flex-wrap items-center gap-1">
            {(kd === "MENUNGGU" || kd === "REVISI") && k.draftLink ? (
              <>
                <Button size="sm" onClick={setujui} disabled={pending}>
                  {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  {t("setujui")}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setRevisi(true)}>
                  <PenLine className="h-3.5 w-3.5" />
                  {t("mintaRevisi")}
                </Button>
              </>
            ) : null}
            <Button size="sm" variant="ghost" onClick={onUbah}>
              <Pencil className="h-3.5 w-3.5" />
              {t("ubah")}
            </Button>
          </div>
        ) : null}
      </div>

      {k.link ? (
        <div className="space-y-2 border-t pt-3">
          <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm">
            {terakhir ? (
              <>
                {KOLOM_ANGKA.map((c) => (
                  <span key={c} className="tabular-nums">
                    <span className="text-xs text-muted-foreground">{t(`kolom.${c}`)} </span>
                    <span className="font-medium">{angkaTitik(terakhir[c])}</span>
                  </span>
                ))}
                <span className="tabular-nums">
                  <span className="text-xs text-muted-foreground">{t("kolom.er")} </span>
                  <span className="font-medium">
                    {k.er === null ? "—" : `${new Intl.NumberFormat(locale.startsWith("en") ? "en-GB" : "id-ID", { maximumFractionDigits: 2 }).format(k.er)}%`}
                  </span>
                </span>
                <span className="text-xs text-muted-foreground">{t("panel.per", { tanggal: tgl(terakhir.hari) })}</span>
              </>
            ) : (
              <span className="text-muted-foreground">{t("angka.belumAda")}</span>
            )}
            {k.peringatan.kosong.map((p) => (
              <StatusPill key={p.jenis} tone="attention">
                {t("angka.kosong", { titik: labelTitikAngka(p.jenis, ambang) })}
              </StatusPill>
            ))}
            {k.peringatan.berikut ? (
              <span className="text-xs text-muted-foreground">
                {t("angka.berikut", { titik: labelTitikAngka(k.peringatan.berikut.jenis, ambang), tanggal: tgl(k.peringatan.berikut.tanggal) })}
              </span>
            ) : null}
          </div>
          {bolehMengelola ? (
            <div className="flex flex-wrap items-end gap-2">
              <IsianAngkaKonten kontenId={k.id} terakhir={terakhir} berlabel />
              <Button size="sm" variant="outline" onClick={() => setCatat(true)}>
                <CalendarPlus className="h-3.5 w-3.5" />
                {t("angka.denganTanggal")}
              </Button>
            </div>
          ) : null}
          {k.angka.length > 0 ? (
            <div>
              <Button size="xs" variant="ghost" className="px-1.5 text-muted-foreground" onClick={() => setRiwayat((r) => !r)} aria-expanded={riwayat}>
                <ChevronDown className={cn("transition-transform", riwayat && "rotate-180")} />
                {t("angka.riwayat", { n: k.angka.length })}
              </Button>
              {riwayat ? <TabelRiwayatAngka baris={k.angka} /> : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <DialogMintaRevisi kontenId={k.id} buka={revisi} onBuka={setRevisi} />
      {k.link ? <DialogCatatAngka kontenId={k.id} tayangHari={k.tayangHari} terakhir={terakhir} buka={catat} onBuka={setCatat} /> : null}
    </div>
  );
}
