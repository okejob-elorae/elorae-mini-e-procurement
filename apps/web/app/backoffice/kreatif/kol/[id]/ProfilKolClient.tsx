"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeft, Ban, Copy, ExternalLink, FileVideo, Pencil, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TombolWa } from "@/components/kreatif/TombolWa";
import { inisial, urlProfil } from "@/lib/creative/kol-aturan";
import { alamatLengkap, nadaTahap, teksAlamatKirim } from "@/lib/creative/kolaborasi-tampil";
import type { ProfilKol, RiwayatPengikut } from "@/lib/creative/kol-queries";
import { formatDisplayDate } from "@/lib/date-only";
import { cn } from "@/lib/utils";
import { DialogKol } from "../DialogKol";
import { angkaPenuh, NADA_TIER, persenTeks, ringkasAngka, roasTeks, rupiahLayar } from "../format-kol";
import { TombolBlokir } from "./TombolBlokir";

/** Garis kecil pertumbuhan pengikut — murni SVG, tanpa pustaka grafik. */
function Garis({ titik }: { titik: readonly RiwayatPengikut[] }) {
  if (titik.length < 2) return null;
  const nilai = titik.map((x) => x.followers);
  const min = Math.min(...nilai);
  const maks = Math.max(...nilai);
  const L = 160;
  const T = 36;
  const xy = nilai.map((v, i) => {
    const x = (i / (nilai.length - 1)) * L;
    const y = maks === min ? T / 2 : T - 2 - ((v - min) / (maks - min)) * (T - 4);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg viewBox={`0 0 ${L} ${T}`} className="h-9 w-40 text-primary" aria-hidden>
      <polyline points={xy.join(" ")} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function Ubin({ label, nilai, detail, nada }: { label: string; nilai: ReactNode; detail?: ReactNode; nada?: "merah" }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-0.5 text-lg font-semibold tabular-nums", nada === "merah" && "text-red-600 dark:text-red-400")}>{nilai}</p>
      {detail ? <p className="text-xs text-muted-foreground tabular-nums">{detail}</p> : null}
    </div>
  );
}

export function ProfilKolClient({
  profil,
  bolehMengelola,
  niche,
  labelSaran,
  panelCatatan,
}: {
  profil: ProfilKol;
  bolehMengelola: boolean;
  niche: readonly string[];
  labelSaran: readonly string[];
  panelCatatan: ReactNode;
}) {
  const t = useTranslations("kreatifRuang");
  const tc = useTranslations("creative");
  const locale = useLocale();
  const router = useRouter();
  const [bukaUbah, setBukaUbah] = useState(false);
  const f = profil.form;
  const r = profil.ringkas;
  const alamatTeks = teksAlamatKirim({
    name: f.name,
    recipientName: f.recipientName,
    phone: f.phone,
    address: f.address,
    city: f.city,
    province: f.province,
    postalCode: f.postalCode,
  });
  const adaAlamat = Boolean(f.address?.trim() || f.city?.trim());
  const lengkap = alamatLengkap({ ...f, name: f.name });

  const salinAlamat = async () => {
    try {
      await navigator.clipboard.writeText(alamatTeks);
      toast.success(t("kol.profil.disalin"));
    } catch {
      toast.error(t("kol.profil.gagalSalin"));
    }
  };

  const baris = (label: string, nilai: ReactNode) =>
    nilai ? (
      <div className="grid grid-cols-[7rem_1fr] gap-2 py-1 text-sm">
        <dt className="text-muted-foreground">{label}</dt>
        <dd className="min-w-0 whitespace-pre-wrap break-words">{nilai}</dd>
      </div>
    ) : null;

  return (
    <div className="space-y-6">
      <Link href="/backoffice/kreatif/kol" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />
        {t("kol.profil.kembali")}
      </Link>

      <PageHeader
        title={profil.nama}
        meta={[
          tc(`tier_${profil.tier}`),
          `${ringkasAngka(profil.pengikut)} ${t("kol.kolom.pengikut").toLowerCase()}`,
          profil.kontakTerakhir
            ? t("kol.profil.kontakTerakhir", { tanggal: formatDisplayDate(profil.kontakTerakhir, locale) })
            : t("kol.profil.belumDihubungi"),
          t("kol.profil.sejak", { tanggal: formatDisplayDate(profil.dibuat, locale) }),
        ].join(" · ")}
        actions={
          <>
            <TombolWa kolId={f.id} bolehMengelola={bolehMengelola} bentuk="tombol" />
            {bolehMengelola && (
              <Button variant="outline" onClick={() => setBukaUbah(true)}>
                <Pencil className="mr-1.5 h-4 w-4" />
                {t("kol.profil.ubah")}
              </Button>
            )}
            {bolehMengelola && <TombolBlokir kolId={f.id} nama={profil.nama} diblokir={profil.diblokir} />}
          </>
        }
      />

      {profil.diblokir && (
        <div className="flex items-start gap-3 rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm" role="status">
          <Ban className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" aria-hidden />
          <div>
            <p className="font-medium text-red-700 dark:text-red-300">
              {t("kol.blokir.banner")}
              {profil.blockedAt && <span className="font-normal"> · {t("kol.blokir.sejak", { tanggal: formatDisplayDate(profil.blockedAt, locale) })}</span>}
            </p>
            {profil.alasanBlokir && <p className="mt-0.5 whitespace-pre-wrap text-muted-foreground">{profil.alasanBlokir}</p>}
          </div>
        </div>
      )}

      <Card className="py-0">
        <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary text-lg font-semibold text-primary-foreground">
            {inisial(profil.nama)}
          </span>
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill tone={NADA_TIER[profil.tier]}>{tc(`tier_${profil.tier}`)}</StatusPill>
              {profil.label.map((l) => (
                <span key={l} className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                  {l}
                </span>
              ))}
            </div>
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {profil.akun.map((a) => {
                const url = urlProfil(a.platform, a.handle, a.url);
                const isi = (
                  <>
                    @{a.handle}
                    <span className="ml-1 text-xs text-muted-foreground">
                      {tc(`platform${a.platform}`)} · {ringkasAngka(a.followers)}
                    </span>
                  </>
                );
                return (
                  <li key={a.id}>
                    {url ? (
                      <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-tautan hover:underline">
                        {isi}
                        <ExternalLink className="h-3 w-3" aria-hidden />
                      </a>
                    ) : (
                      isi
                    )}
                  </li>
                );
              })}
            </ul>
            <dl className="grid gap-x-6 sm:grid-cols-2">
              {baris(t("kol.profil.niche"), f.niche)}
              {baris(t("kol.kolom.er"), f.engagementRate !== null ? persenTeks(f.engagementRate) : null)}
              {baris(t("kol.form.avgViews"), f.avgViews !== null ? angkaPenuh(f.avgViews) : null)}
              {baris(t("kol.profil.rateCard"), f.rateCard !== null ? rupiahLayar(f.rateCard) : null)}
              {baris(t("kol.profil.rateNote"), f.rateNote)}
            </dl>
            {f.note && <p className="rounded-md bg-amber-500/10 px-3 py-2 text-sm whitespace-pre-wrap">{f.note}</p>}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Ubin label={t("kol.profil.kpi.selesai")} nilai={angkaPenuh(r.selesai)} />
        <Ubin label={t("kol.profil.kpi.berjalan")} nilai={angkaPenuh(r.berjalan)} />
        <Ubin label={t("kol.profil.kpi.ghosting")} nilai={angkaPenuh(r.ghosting)} nada={r.ghosting > 0 ? "merah" : undefined} />
        <Ubin label={t("kol.profil.kpi.ditolak")} nilai={angkaPenuh(r.ditolak)} />
        <Ubin label={t("kol.profil.kpi.views")} nilai={ringkasAngka(r.views)} />
        <Ubin label={t("kol.profil.kpi.gmv")} nilai={rupiahLayar(r.gmv)} />
        <Ubin label={t("kol.profil.kpi.roas")} nilai={roasTeks(r.roas)} />
        <Ubin label={t("kol.profil.kpi.feeTerakhir")} nilai={r.feeTerakhir !== null ? rupiahLayar(r.feeTerakhir) : "—"} />
        <Ubin
          label={t("kol.profil.kpi.tepatWaktu")}
          nilai={r.tepatWaktu.persen !== null ? `${r.tepatWaktu.persen}%` : "—"}
          detail={
            r.tepatWaktu.dinilai
              ? t("kol.profil.kpi.tepatDetail", { tepat: r.tepatWaktu.tepat, dinilai: r.tepatWaktu.dinilai })
              : t("kol.profil.kpi.belumDinilai")
          }
        />
      </div>

      <Tabs defaultValue="kolaborasi">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="kolaborasi">
            {t("kol.profil.tab.kolaborasi")} <span className="ml-1 tabular-nums text-muted-foreground">{profil.kolaborasi.length}</span>
          </TabsTrigger>
          <TabsTrigger value="konten">
            {t("kol.profil.tab.konten")} <span className="ml-1 tabular-nums text-muted-foreground">{profil.konten.length}</span>
          </TabsTrigger>
          <TabsTrigger value="ukuran">{t("kol.profil.tab.ukuran")}</TabsTrigger>
          <TabsTrigger value="pengikut">{t("kol.profil.tab.pengikut")}</TabsTrigger>
          <TabsTrigger value="catatan">{t("kol.profil.tab.catatan")}</TabsTrigger>
        </TabsList>

        <TabsContent value="kolaborasi">
          <Card>
            <CardContent className={profil.kolaborasi.length ? "px-0 sm:px-6" : undefined}>
              {profil.kolaborasi.length === 0 ? (
                <EmptyState icon={Users} title={t("kol.profil.kolabKosong")} />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("kol.profil.kolom.docNo")}</TableHead>
                        <TableHead>{t("kol.profil.kolom.campaign")}</TableHead>
                        <TableHead>{t("kol.profil.kolom.tahap")}</TableHead>
                        <TableHead className="text-right">{t("kol.profil.kolom.fee")}</TableHead>
                        <TableHead className="text-right">{t("kol.profil.kolom.views")}</TableHead>
                        <TableHead className="text-right">{t("kol.profil.kolom.gmv")}</TableHead>
                        <TableHead className="text-right">{t("kol.profil.kolom.roas")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {profil.kolaborasi.map((k) => (
                        <TableRow key={k.id}>
                          <TableCell>
                            <Link href={`/backoffice/kreatif/kolaborasi/${k.id}`} className="font-medium text-tautan hover:underline">
                              {k.docNo}
                            </Link>
                            <span className="block text-xs text-muted-foreground">{formatDisplayDate(k.dibuat, locale)}</span>
                          </TableCell>
                          <TableCell className="whitespace-normal">
                            {k.campaign ? (
                              <Link href={`/backoffice/kreatif/campaign/${k.campaign.id}`} className="hover:underline">
                                {k.campaign.nama}
                              </Link>
                            ) : (
                              <span className="text-muted-foreground">{t("kol.profil.tanpaCampaign")}</span>
                            )}
                            <span className="block text-xs text-muted-foreground">{t(`jenis.${k.jenis}`)}</span>
                          </TableCell>
                          <TableCell>
                            <StatusPill tone={nadaTahap(k.tahap)}>{t(`tahap.${k.tahap}`)}</StatusPill>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{rupiahLayar(k.fee)}</TableCell>
                          <TableCell className="text-right tabular-nums">{ringkasAngka(k.views)}</TableCell>
                          <TableCell className="text-right tabular-nums">{rupiahLayar(k.gmv)}</TableCell>
                          <TableCell className="text-right tabular-nums">{roasTeks(k.roas)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="konten">
          {profil.konten.length === 0 ? (
            <Card>
              <CardContent>
                <EmptyState icon={FileVideo} title={t("kol.profil.kontenKosong")} />
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {profil.konten.map((c) => {
                const tautan = c.link ?? c.draftLink;
                return (
                  <div key={c.id} className="flex flex-col gap-2 rounded-lg border bg-card p-4 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">
                        {tc(`platform${c.platform}`)} · {tc(`format${c.format}`)}
                      </span>
                      <Link href={`/backoffice/kreatif/kolaborasi/${c.kolaborasiId}`} className="text-xs text-tautan hover:underline">
                        {c.docNo}
                      </Link>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {c.link && c.liveAt
                        ? t("kol.profil.kontenTayang", { tanggal: formatDisplayDate(c.liveAt, locale) })
                        : c.draftLink
                          ? `${t("kol.profil.kontenDraf")}${c.draftStatus ? ` · ${t(`draf.${c.draftStatus}`)}` : ""}`
                          : c.plannedAt
                            ? t("kol.profil.kontenRencana", { tanggal: formatDisplayDate(c.plannedAt, locale) })
                            : t("kol.profil.kontenBelum")}
                    </p>
                    {c.angka ? (
                      <dl className="grid grid-cols-5 gap-1 text-center">
                        {(["views", "likes", "comments", "shares", "saves"] as const).map((k) => (
                          <div key={k}>
                            <dd className="font-semibold tabular-nums">{ringkasAngka(c.angka![k])}</dd>
                            <dt className="text-[11px] text-muted-foreground">{t(`kol.profil.metrik.${k}`)}</dt>
                          </div>
                        ))}
                      </dl>
                    ) : (
                      <p className="text-xs text-muted-foreground">{t("kol.profil.angkaBelum")}</p>
                    )}
                    <div className="mt-auto flex items-center justify-between gap-2 pt-1 text-xs text-muted-foreground">
                      <span>{c.angka ? t("kol.profil.angkaPada", { tanggal: formatDisplayDate(c.angka.recordedAt, locale) }) : null}</span>
                      {tautan && (
                        <a href={tautan} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-tautan hover:underline">
                          {t("kol.profil.bukaLink")}
                          <ExternalLink className="h-3 w-3" aria-hidden />
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="ukuran">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2">
                <CardTitle className="text-base">{t("kol.form.bagianAlamat")}</CardTitle>
                <Button size="sm" variant="outline" onClick={salinAlamat} disabled={!adaAlamat}>
                  <Copy className="mr-1.5 h-4 w-4" />
                  {t("kol.profil.salinAlamat")}
                </Button>
              </CardHeader>
              <CardContent className="space-y-2">
                {!adaAlamat ? (
                  <p className="text-sm text-muted-foreground">{t("kol.profil.alamatKosong")}</p>
                ) : (
                  <>
                    {!lengkap && <p className="text-xs text-amber-700 dark:text-amber-300">{t("kol.profil.alamatBelumLengkap")}</p>}
                    <dl>
                      {baris(t("kol.profil.penerima"), f.recipientName || f.name)}
                      {baris(t("kol.profil.wa"), f.phone)}
                      {baris(t("kol.profil.alamat"), f.address)}
                      {baris(t("kol.profil.kotaDst"), [f.city, f.province, f.postalCode].filter(Boolean).join(", "))}
                      {baris(t("kol.profil.email"), f.email)}
                    </dl>
                  </>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("kol.form.bagianUkuran")}</CardTitle>
              </CardHeader>
              <CardContent>
                {f.ukuran.atasan || f.ukuran.bawahan || f.ukuran.tinggiCm !== null || f.ukuran.hijab !== null || f.ukuran.catatan ? (
                  <dl>
                    {baris(t("kol.form.atasan"), f.ukuran.atasan)}
                    {baris(t("kol.form.bawahan"), f.ukuran.bawahan)}
                    {baris(t("kol.form.tinggi"), f.ukuran.tinggiCm !== null ? t("kol.profil.tinggiCm", { n: f.ukuran.tinggiCm }) : null)}
                    {baris(
                      t("kol.form.hijab"),
                      f.ukuran.hijab === null ? null : f.ukuran.hijab ? t("kol.profil.berhijab") : t("kol.profil.tidakBerhijab"),
                    )}
                    {baris(t("kol.form.catatanFit"), f.ukuran.catatan)}
                  </dl>
                ) : (
                  <p className="text-sm text-muted-foreground">{t("kol.profil.ukuranKosong")}</p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="pengikut">
          <div className="grid gap-4 lg:grid-cols-2">
            {profil.akun.map((a) => (
              <Card key={a.id}>
                <CardHeader className="flex flex-row items-center justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="truncate text-base">@{a.handle}</CardTitle>
                    <p className="text-xs text-muted-foreground">
                      {tc(`platform${a.platform}`)} · {angkaPenuh(a.followers)}
                    </p>
                  </div>
                  <Garis titik={a.riwayat} />
                </CardHeader>
                <CardContent className="px-0 sm:px-6">
                  {a.riwayat.length === 0 ? (
                    <p className="px-6 text-sm text-muted-foreground sm:px-0">{t("kol.profil.pengikutKosong")}</p>
                  ) : (
                    <div className="max-h-72 overflow-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{t("kol.profil.kolom.tanggal")}</TableHead>
                            <TableHead className="text-right">{t("kol.profil.kolom.pengikut")}</TableHead>
                            <TableHead className="text-right">{t("kol.profil.kolom.perubahan")}</TableHead>
                            <TableHead>{t("kol.profil.kolom.sumber")}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {a.riwayat
                            .map((s, i) => ({ ...s, beda: i === 0 ? null : s.followers - a.riwayat[i - 1].followers }))
                            .reverse()
                            .map((s, i) => (
                              <TableRow key={`${s.recordedAt}-${i}`}>
                                <TableCell>{formatDisplayDate(s.recordedAt, locale)}</TableCell>
                                <TableCell className="text-right tabular-nums">{angkaPenuh(s.followers)}</TableCell>
                                <TableCell
                                  className={cn(
                                    "text-right tabular-nums",
                                    s.beda !== null && s.beda > 0 && "text-emerald-700 dark:text-emerald-300",
                                    s.beda !== null && s.beda < 0 && "text-red-600 dark:text-red-400",
                                  )}
                                >
                                  {s.beda === null ? "—" : `${s.beda > 0 ? "+" : ""}${angkaPenuh(s.beda)}`}
                                </TableCell>
                                <TableCell className="text-sm text-muted-foreground">
                                  {s.source && t.has(`kol.profil.sumber.${s.source}`) ? t(`kol.profil.sumber.${s.source}`) : (s.source ?? "—")}
                                </TableCell>
                              </TableRow>
                            ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="catatan">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("kol.catatan.judul")}</CardTitle>
            </CardHeader>
            <CardContent>{panelCatatan}</CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {bolehMengelola && (
        <DialogKol
          buka={bukaUbah}
          onBukaUbah={setBukaUbah}
          awal={f}
          niche={niche}
          labelSaran={labelSaran}
          onTersimpan={() => router.refresh()}
        />
      )}
    </div>
  );
}
