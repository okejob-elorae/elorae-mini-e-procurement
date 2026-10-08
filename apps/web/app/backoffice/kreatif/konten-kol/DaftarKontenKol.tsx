"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ArrowUpRight, Check, ExternalLink, FileText, Loader2, PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusPill } from "@/components/ui/status-pill";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TanggalInput } from "@/components/ui/tanggal-input";
import { TombolWa } from "@/components/kreatif/TombolWa";
import { IsianAngkaKonten } from "@/components/kreatif/IsianAngkaKonten";
import { RiwayatAngkaPopover } from "@/components/kreatif/RiwayatAngka";
import { DialogMintaRevisi } from "@/components/kreatif/DialogMintaRevisi";
import { useKabarKonten } from "@/components/kreatif/kabar-konten";
import { kirimDrafAction, setujuiDrafAction, simpanKontenKolAction } from "@/app/actions/kreatif-konten";
import type { AmbangKreatif } from "@/lib/creative/ambang";
import { angkaTitik } from "@/lib/creative/angka-konten";
import { cuplikan, labelTitikAngka, sahLink } from "@/lib/creative/konten-kol";
import type { BarisDisetujui, BarisDraf, BarisMenunggu, BarisTayang, DasarBaris } from "@/lib/creative/konten-kol-queries";
import { labelTanggal } from "@/lib/tanggal-isian";
import { cn } from "@/lib/utils";

/*
 * Empat daftar layar Konten KOL. Isian langsung di baris (tempel link, isi
 * angka) — tanpa membuka kolaborasinya. Sesudah tersimpan halaman disegarkan,
 * jadi baris yang sudah dikerjakan pindah ke chip berikutnya.
 */

const RUTE_KOLABORASI = (id: string) => `/backoffice/kreatif/kolaborasi/${id}`;

function SelKol({ b }: { b: DasarBaris }) {
  return (
    <div className="min-w-0 max-w-56">
      <Link href={RUTE_KOLABORASI(b.kolaborasiId)} className="font-medium hover:underline">
        {b.kolNama}
      </Link>
      <p className="truncate text-xs text-muted-foreground">{[b.handle ? `@${b.handle}` : null, b.docNo].filter(Boolean).join(" · ")}</p>
      {b.campaignNama ? <p className="truncate text-xs text-muted-foreground">{b.campaignNama}</p> : null}
    </div>
  );
}

function Aksi({ b, bolehMengelola, children }: { b: DasarBaris; bolehMengelola: boolean; children?: React.ReactNode }) {
  const t = useTranslations("kreatifRuang.kontenKol");
  return (
    <div className="flex items-center justify-end gap-0.5">
      {children}
      <TombolWa kolId={b.kolId} kolaborasiId={b.kolaborasiId} bolehMengelola={bolehMengelola} label={t("pengingat")} />
      <Button asChild variant="ghost" size="icon-sm" title={t("buka")} aria-label={t("buka")}>
        <Link href={RUTE_KOLABORASI(b.kolaborasiId)}>
          <ArrowUpRight className="h-4 w-4" />
        </Link>
      </Button>
    </div>
  );
}

function Tanggal({ hari }: { hari: string | null }) {
  const locale = useLocale();
  return <>{hari ? labelTanggal(hari, locale) : "—"}</>;
}

/**
 * Tempel link → Tayang (link konten) atau Draf (link draf). `kontenId` diisi
 * bila sudah ada konten yang menunggu link ini; tanpa itu konten baru dibuat
 * dan platformnya ditebak dari link-nya.
 */
function TempelLink({
  kolaborasiId,
  kontenId,
  denganDraf,
  bolehMengelola,
}: {
  kolaborasiId: string;
  kontenId: string | null;
  denganDraf: boolean;
  bolehMengelola: boolean;
}) {
  const t = useTranslations("kreatifRuang.kontenKol");
  const router = useRouter();
  const kabar = useKabarKonten();
  const [link, setLink] = useState("");
  const [pending, start] = useTransition();
  if (!bolehMengelola) return <span className="text-xs text-muted-foreground">—</span>;

  const kirim = (jenis: "tayang" | "draf") => {
    if (!sahLink(link)) {
      kabar.gagal("LINK_TIDAK_SAH");
      return;
    }
    start(async () => {
      const r =
        jenis === "tayang"
          ? await simpanKontenKolAction({ id: kontenId, kolaborasiId, link })
          : await kirimDrafAction({ kontenId, kolaborasiId, draftLink: link });
      if (r.ok) {
        kabar.sukses(jenis === "tayang" ? "kontenKol.ok.tayang" : "kontenKol.ok.draf", r.maju);
        setLink("");
        router.refresh();
      } else {
        kabar.gagal(r.kode);
      }
    });
  };

  return (
    <div className="flex min-w-[300px] items-center gap-1.5">
      <Input
        value={link}
        onChange={(e) => setLink(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && link.trim()) {
            e.preventDefault();
            kirim("tayang");
          }
        }}
        placeholder={denganDraf ? t("tempel.placeholder") : t("tempel.placeholderTayang")}
        aria-label={denganDraf ? t("tempel.placeholder") : t("tempel.placeholderTayang")}
        className="h-8 min-w-0 flex-1 text-sm"
        disabled={pending}
        inputMode="url"
      />
      <Button size="sm" onClick={() => kirim("tayang")} disabled={pending || !link.trim()}>
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
        {t("tempel.tayang")}
      </Button>
      {denganDraf ? (
        <Button size="sm" variant="outline" onClick={() => kirim("draf")} disabled={pending || !link.trim()}>
          {t("tempel.draf")}
        </Button>
      ) : null}
    </div>
  );
}

/* ──────────────────────────── Menunggu konten ──────────────────────────── */

export function DaftarMenunggu({ baris, ambang, bolehMengelola }: { baris: BarisMenunggu[]; ambang: AmbangKreatif; bolehMengelola: boolean }) {
  const t = useTranslations("kreatifRuang.kontenKol");
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("kolom.kol")}</TableHead>
            <TableHead>{t("kolom.sejak")}</TableHead>
            <TableHead>{t("kolom.rencana")}</TableHead>
            <TableHead>{t("kolom.linkKonten")}</TableHead>
            <TableHead className="text-right">
              <span className="sr-only">{t("kolom.aksi")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="baris-berurutan">
          {baris.map((b) => (
            <TableRow key={b.kolaborasiId}>
              <TableCell className="whitespace-normal">
                <SelKol b={b} />
              </TableCell>
              <TableCell className="text-sm tabular-nums">
                <Tanggal hari={b.sejak} />
                <span
                  className={cn("block text-xs", b.merah ? "font-semibold text-destructive" : "text-muted-foreground")}
                  title={b.merah ? t("lewatAmbang", { n: ambang.terimaKeTayangHari }) : undefined}
                >
                  {b.tanpaSampel ? t("sejakDeal", { n: Math.max(0, b.umurHari) }) : t("sejakTerima", { n: Math.max(0, b.umurHari) })}
                </span>
              </TableCell>
              <TableCell className="text-sm tabular-nums">
                {b.rencanaTayang ? <Tanggal hari={b.rencanaTayang} /> : <span className="text-muted-foreground">{t("belumDiatur")}</span>}
              </TableCell>
              <TableCell>
                <TempelLink kolaborasiId={b.kolaborasiId} kontenId={b.kontenKosongId} denganDraf bolehMengelola={bolehMengelola} />
              </TableCell>
              <TableCell>
                <Aksi b={b} bolehMengelola={bolehMengelola} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/* ──────────────────────────── Draf masuk ──────────────────────────── */

export function DaftarDraf({ baris, ambang, bolehMengelola }: { baris: BarisDraf[]; ambang: AmbangKreatif; bolehMengelola: boolean }) {
  const t = useTranslations("kreatifRuang.kontenKol");
  const tr = useTranslations("kreatifRuang");
  const router = useRouter();
  const kabar = useKabarKonten();
  const [revisi, setRevisi] = useState<BarisDraf | null>(null);
  const [sibuk, setSibuk] = useState<string | null>(null);
  const [, start] = useTransition();

  const setujui = (b: BarisDraf) => {
    setSibuk(b.kontenId);
    start(async () => {
      const r = await setujuiDrafAction(b.kontenId);
      setSibuk(null);
      if (r.ok) {
        kabar.sukses("kontenKol.ok.setuju", r.maju);
        router.refresh();
      } else {
        kabar.gagal(r.kode);
      }
    });
  };

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("kolom.kol")}</TableHead>
            <TableHead>{t("kolom.draf")}</TableHead>
            <TableHead>{t("kolom.status")}</TableHead>
            <TableHead>{t("kolom.rencana")}</TableHead>
            <TableHead>{t("kolom.menunggu")}</TableHead>
            <TableHead className="text-right">
              <span className="sr-only">{t("kolom.aksi")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="baris-berurutan">
          {baris.map((b) => (
            <TableRow key={b.kontenId}>
              <TableCell className="whitespace-normal">
                <SelKol b={b} />
              </TableCell>
              <TableCell className="max-w-64 whitespace-normal text-sm">
                {b.draftLink ? (
                  <a href={b.draftLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-tautan hover:underline">
                    <FileText className="h-3.5 w-3.5" />
                    {t("lihatDraf")}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                ) : (
                  "—"
                )}
                {b.draftStatus === "REVISI" && b.draftNote ? (
                  <span className="block text-xs text-muted-foreground" title={b.draftNote}>
                    {cuplikan(b.draftNote)}
                  </span>
                ) : null}
              </TableCell>
              <TableCell>
                <StatusPill tone={b.draftStatus === "REVISI" ? "attention" : "waiting"}>{tr(`draf.${b.draftStatus}`)}</StatusPill>
              </TableCell>
              <TableCell className="text-sm tabular-nums">
                {b.rencanaTayang ? <Tanggal hari={b.rencanaTayang} /> : <span className="text-muted-foreground">{t("belumDiatur")}</span>}
              </TableCell>
              <TableCell
                className={cn("text-sm tabular-nums", b.merah ? "font-semibold text-destructive" : "text-muted-foreground")}
                title={b.merah ? t("lewatAmbang", { n: ambang.reviewDrafHari }) : undefined}
              >
                {t("nHari", { n: b.menungguHari })}
              </TableCell>
              <TableCell>
                <Aksi b={b} bolehMengelola={bolehMengelola}>
                  {bolehMengelola ? (
                    <>
                      <Button size="sm" onClick={() => setujui(b)} disabled={sibuk === b.kontenId}>
                        {sibuk === b.kontenId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                        {t("setujui")}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setRevisi(b)}>
                        <PenLine className="h-3.5 w-3.5" />
                        {t("mintaRevisi")}
                      </Button>
                    </>
                  ) : null}
                </Aksi>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <DialogMintaRevisi
        kontenId={revisi?.kontenId ?? null}
        namaKol={revisi ? `${revisi.kolNama} · ${revisi.docNo}` : undefined}
        buka={revisi !== null}
        onBuka={(o) => !o && setRevisi(null)}
      />
    </div>
  );
}

/* ──────────────────────────── Disetujui, belum tayang ──────────────────────────── */

function RencanaKonten({ b, bolehMengelola }: { b: BarisDisetujui; bolehMengelola: boolean }) {
  const t = useTranslations("kreatifRuang.kontenKol");
  const router = useRouter();
  const kabar = useKabarKonten();
  const [pending, start] = useTransition();
  const [nilai, setNilai] = useState(b.rencanaKonten ?? "");
  if (!bolehMengelola) {
    return b.rencanaKonten || b.rencanaKolaborasi ? <Tanggal hari={b.rencanaKonten ?? b.rencanaKolaborasi} /> : <span className="text-muted-foreground">{t("belumDiatur")}</span>;
  }
  return (
    <div className="w-40">
      <TanggalInput
        value={nilai}
        aria-label={t("kolom.rencana")}
        placeholder={b.rencanaKolaborasi ? labelTanggal(b.rencanaKolaborasi) : t("belumDiatur")}
        disabled={pending}
        onChange={(e) => {
          const v = e.target.value;
          setNilai(v);
          start(async () => {
            const r = await simpanKontenKolAction({ id: b.kontenId, kolaborasiId: b.kolaborasiId, plannedAt: v || null });
            if (r.ok) {
              kabar.sukses("kontenKol.ok.rencana", r.maju);
              router.refresh();
            } else {
              setNilai(b.rencanaKonten ?? "");
              kabar.gagal(r.kode);
            }
          });
        }}
      />
    </div>
  );
}

export function DaftarDisetujui({ baris, bolehMengelola }: { baris: BarisDisetujui[]; bolehMengelola: boolean }) {
  const t = useTranslations("kreatifRuang.kontenKol");
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("kolom.kol")}</TableHead>
            <TableHead>{t("kolom.disetujui")}</TableHead>
            <TableHead>{t("kolom.rencana")}</TableHead>
            <TableHead>{t("kolom.linkTayang")}</TableHead>
            <TableHead className="text-right">
              <span className="sr-only">{t("kolom.aksi")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="baris-berurutan">
          {baris.map((b) => (
            <TableRow key={b.kontenId}>
              <TableCell className="whitespace-normal">
                <SelKol b={b} />
              </TableCell>
              <TableCell className="text-sm">
                <span className="tabular-nums">
                  <Tanggal hari={b.disetujuiHari} />
                </span>
                {b.penyetuju ? <span className="block text-xs text-muted-foreground">{b.penyetuju}</span> : null}
                {b.draftLink ? (
                  <a href={b.draftLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-tautan hover:underline">
                    {t("lihatDraf")}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                ) : null}
              </TableCell>
              <TableCell className="text-sm">
                <RencanaKonten b={b} bolehMengelola={bolehMengelola} />
              </TableCell>
              <TableCell>
                <TempelLink kolaborasiId={b.kolaborasiId} kontenId={b.kontenId} denganDraf={false} bolehMengelola={bolehMengelola} />
              </TableCell>
              <TableCell>
                <Aksi b={b} bolehMengelola={bolehMengelola} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/* ──────────────────────────── Tayang ──────────────────────────── */

function teksEr(er: number | null, locale: string): string {
  if (er === null) return "—";
  return `${new Intl.NumberFormat(locale.startsWith("en") ? "en-GB" : "id-ID", { maximumFractionDigits: 2 }).format(er)}%`;
}

export function DaftarTayang({ baris, ambang, bolehMengelola }: { baris: BarisTayang[]; ambang: AmbangKreatif; bolehMengelola: boolean }) {
  const t = useTranslations("kreatifRuang.kontenKol");
  const locale = useLocale();
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("kolom.kol")}</TableHead>
            <TableHead>{t("kolom.tayang")}</TableHead>
            <TableHead>{t("kolom.angka")}</TableHead>
            <TableHead className="text-right">{t("kolom.er")}</TableHead>
            <TableHead>{t("kolom.angkaTerakhir")}</TableHead>
            <TableHead className="text-right">
              <span className="sr-only">{t("kolom.aksi")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="baris-berurutan">
          {baris.map((b) => (
            <TableRow key={b.kontenId}>
              <TableCell className="whitespace-normal">
                <SelKol b={b} />
              </TableCell>
              <TableCell className="text-sm">
                <span className="tabular-nums">
                  <Tanggal hari={b.tayangHari} />
                </span>
                <a href={b.link} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-tautan hover:underline">
                  {t("bukaKonten")}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </TableCell>
              <TableCell>
                {bolehMengelola ? (
                  <IsianAngkaKonten kontenId={b.kontenId} terakhir={b.angkaTerakhir} className="flex-nowrap" />
                ) : b.angkaTerakhir ? (
                  <span className="text-sm tabular-nums">{t("viewsLikes", { views: angkaTitik(b.angkaTerakhir.views), likes: angkaTitik(b.angkaTerakhir.likes) })}</span>
                ) : (
                  <span className="text-sm text-muted-foreground">{t("angka.belumAda")}</span>
                )}
              </TableCell>
              <TableCell className="text-right text-sm tabular-nums">{teksEr(b.er, locale)}</TableCell>
              <TableCell className="whitespace-normal text-sm">
                {b.angkaTerakhir ? (
                  <span className="tabular-nums">
                    <Tanggal hari={b.angkaTerakhir.hari} />
                  </span>
                ) : (
                  <span className="text-muted-foreground">{t("angka.belumAda")}</span>
                )}
                <div className="mt-0.5 flex flex-wrap gap-1">
                  {b.peringatan.kosong.map((p) => (
                    <StatusPill key={p.jenis} tone="attention">
                      {t("angka.kosong", { titik: labelTitikAngka(p.jenis, ambang) })}
                    </StatusPill>
                  ))}
                </div>
                {b.peringatan.berikut ? (
                  <span className="block text-xs text-muted-foreground">
                    {t("angka.berikut", { titik: labelTitikAngka(b.peringatan.berikut.jenis, ambang), tanggal: labelTanggal(b.peringatan.berikut.tanggal, locale) })}
                  </span>
                ) : null}
              </TableCell>
              <TableCell>
                <Aksi b={b} bolehMengelola={bolehMengelola}>
                  <RiwayatAngkaPopover kontenId={b.kontenId} jumlah={b.jumlahAngka} />
                </Aksi>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
