"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { FolderPlus, Loader2, Pencil, Plus, Search, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { Select, SelectContent, SelectItem, SelectLabel, SelectGroup, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Pager } from "@/components/Pager";
import { PilihTampilan } from "@/components/tampilan/PilihTampilan";
import { TombolWa } from "@/components/kreatif/TombolWa";
import { ambilFormKolAction } from "@/app/actions/kreatif-kol";
import { SEMUA_PLATFORM, type Platform, type Tier } from "@/lib/creative/aturan";
import { inisial } from "@/lib/creative/kol-aturan";
import { nadaTahap } from "@/lib/creative/kolaborasi-tampil";
import {
  adaSaringanKol,
  alamatSaringKol,
  SEMUA_TIER,
  TAMPILAN_KOL,
  UKURAN_HALAMAN_KOL,
  URUT_KOL,
  type SaringKol,
  type StatusSaringKol,
  type UrutKol,
} from "@/lib/creative/kol-saring";
import { SEMUA_TAHAP } from "@/lib/creative/tahap";
import type { PilihanCampaign } from "@/lib/creative/campaign-queries";
import type { BarisDaftarKol, DataFormKol, HasilDaftarKol, PilihanSaringKol } from "@/lib/creative/kol-queries";
import { formatDisplayDate } from "@/lib/date-only";
import { ambilTampilanTersimpan, ingatTampilan, kunciSimpanTampilan, type JenisTampilan } from "@/lib/tampilan/tampilan";
import { cn } from "@/lib/utils";
import { DialogKol } from "./DialogKol";
import { DialogMasukCampaign } from "./DialogMasukCampaign";
import { TombolCekKembar } from "./DialogCekKembar";
import { TombolMassal } from "./TombolMassal";
import { angkaPenuh, NADA_TIER, persenTeks, pesanGagalKol, ringkasAngka, rupiahLayar } from "./format-kol";

const PATH = "/backoffice/kreatif/kol";
const SEMUA = "semua";

export function KolClient({
  hasil,
  saring,
  tampilanDariAlamat,
  pilihan,
  campaign,
  bolehMengelola,
  userId,
}: {
  hasil: HasilDaftarKol;
  saring: SaringKol;
  tampilanDariAlamat: boolean;
  pilihan: PilihanSaringKol;
  campaign: PilihanCampaign[];
  bolehMengelola: boolean;
  userId: string;
}) {
  const t = useTranslations("kreatifRuang");
  const tc = useTranslations("creative");
  const locale = useLocale();
  const router = useRouter();
  const [berpindah, startPindah] = useTransition();
  const [memuatUbah, startMuatUbah] = useTransition();

  const pergi = (ubah: Partial<SaringKol>, cara: "push" | "replace" = "replace") => {
    const tujuan = alamatSaringKol(PATH, { ...saring, halaman: 1, ...ubah });
    startPindah(() => (cara === "push" ? router.push(tujuan, { scroll: false }) : router.replace(tujuan, { scroll: false })));
  };

  /* — kotak cari: ditunda 350 ms, dan mengikuti alamat bila alamat berubah dari luar — */
  const [cari, setCari] = useState(saring.cari);
  const [cariDiAlamat, setCariDiAlamat] = useState(saring.cari);
  const [cariDikirim, setCariDikirim] = useState(saring.cari);
  if (saring.cari !== cariDiAlamat) {
    setCariDiAlamat(saring.cari);
    if (saring.cari !== cariDikirim) setCari(saring.cari);
  }
  useEffect(() => {
    const v = cari.trim();
    if (v === saring.cari) return;
    const id = setTimeout(() => {
      setCariDikirim(v);
      startPindah(() => router.replace(alamatSaringKol(PATH, { ...saring, cari: v, halaman: 1 }), { scroll: false }));
    }, 350);
    return () => clearTimeout(id);
  }, [cari, saring, router]);

  /* — tampilan tersimpan per orang (alamat menang) — */
  const kunciTampilan = kunciSimpanTampilan("kol", userId);
  useEffect(() => {
    if (tampilanDariAlamat) return;
    const tersimpan = ambilTampilanTersimpan(typeof window === "undefined" ? null : window.localStorage, kunciTampilan, TAMPILAN_KOL);
    if (tersimpan && tersimpan !== saring.tampilan) {
      router.replace(alamatSaringKol(PATH, { ...saring, tampilan: tersimpan }), { scroll: false });
    }
  }, [tampilanDariAlamat, kunciTampilan, saring, router]);
  const ubahTampilan = (v: JenisTampilan) => {
    ingatTampilan(window.localStorage, kunciTampilan, v);
    pergi({ tampilan: v, halaman: saring.halaman });
  };

  /* — pilihan baris, bertahan lintas halaman — */
  const [dipilih, setDipilih] = useState<ReadonlySet<string>>(new Set());
  const idHalaman = hasil.baris.map((b) => b.id);
  const semuaHalaman = idHalaman.length > 0 && idHalaman.every((id) => dipilih.has(id));
  const sebagianHalaman = !semuaHalaman && idHalaman.some((id) => dipilih.has(id));
  const pilih = (id: string, ya: boolean) =>
    setDipilih((s) => {
      const n = new Set(s);
      if (ya) n.add(id);
      else n.delete(id);
      return n;
    });
  const pilihHalaman = (ya: boolean) =>
    setDipilih((s) => {
      const n = new Set(s);
      for (const id of idHalaman) {
        if (ya) n.add(id);
        else n.delete(id);
      }
      return n;
    });
  const [bukaCampaign, setBukaCampaign] = useState(false);

  /* — tambah/ubah — */
  const [bukaForm, setBukaForm] = useState(false);
  const [awalForm, setAwalForm] = useState<DataFormKol | null>(null);
  const [memuatId, setMemuatId] = useState<string | null>(null);
  const ubah = (id: string) => {
    setMemuatId(id);
    startMuatUbah(async () => {
      const r = await ambilFormKolAction(id);
      setMemuatId(null);
      if (!r.ok) {
        toast.error(pesanGagalKol(t, r.kode));
        return;
      }
      setAwalForm(r.data);
      setBukaForm(true);
    });
  };

  const adaSaring = adaSaringanKol(saring);
  const labelTahap = (x: string) => t(`tahap.${x}`);

  const sel = (nilai: string, onUbah: (v: string) => void, isi: ReactNode, label: string, lebar = "w-[160px]") => (
    <Select value={nilai || SEMUA} onValueChange={(v) => onUbah(v === SEMUA ? "" : v)}>
      <SelectTrigger className={lebar} aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>{isi}</SelectContent>
    </Select>
  );

  const pilTahap = (k: BarisDaftarKol) =>
    k.tahapTerakhir && k.kolaborasiTerakhirId ? (
      <Link href={`/backoffice/kreatif/kolaborasi/${k.kolaborasiTerakhirId}`} className="inline-block">
        <StatusPill tone={nadaTahap(k.tahapTerakhir)}>{labelTahap(k.tahapTerakhir)}</StatusPill>
      </Link>
    ) : (
      <span className="text-sm text-muted-foreground">{t("kol.belumAda")}</span>
    );

  const pilLabel = (k: BarisDaftarKol) =>
    k.label.length || k.diblokir ? (
      <div className="mt-1 flex flex-wrap gap-1">
        {k.diblokir && (
          <span title={k.alasanBlokir ?? undefined}>
            <StatusPill tone="attention">{t("kol.diblokirPill")}</StatusPill>
          </span>
        )}
        {k.label.map((l) => (
          <span key={l} className="rounded-full border px-1.5 py-0 text-[11px] leading-5 text-muted-foreground">
            {l}
          </span>
        ))}
      </div>
    ) : null;

  const tombolUbah = (k: BarisDaftarKol) =>
    bolehMengelola ? (
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        aria-label={t("kol.ubahNama", { nama: k.nama })}
        title={t("kol.ubahNama", { nama: k.nama })}
        disabled={memuatUbah}
        onClick={() => ubah(k.id)}
      >
        {memuatId === k.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />}
      </Button>
    ) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("kol.judul")}
        meta={adaSaring ? t("kol.metaSaring", { total: angkaPenuh(hasil.total), semua: angkaPenuh(pilihan.jumlahSemua) }) : t("kol.meta", { semua: angkaPenuh(pilihan.jumlahSemua) })}
        actions={
          <>
            <TombolCekKembar />
            {bolehMengelola && <TombolMassal campaign={campaign} />}
            {bolehMengelola && (
              <Button
                onClick={() => {
                  setAwalForm(null);
                  setBukaForm(true);
                }}
              >
                <Plus className="mr-1.5 h-4 w-4" />
                {t("kol.tambah")}
              </Button>
            )}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input className="pl-9" placeholder={t("kol.cari")} aria-label={t("kol.cari")} value={cari} onChange={(e) => setCari(e.target.value)} />
        </div>
        {sel(
          saring.platform,
          (v) => pergi({ platform: v as Platform | "" }),
          <>
            <SelectItem value={SEMUA}>{t("kol.semuaPlatform")}</SelectItem>
            {SEMUA_PLATFORM.map((p) => (
              <SelectItem key={p} value={p}>
                {tc(`platform${p}`)}
              </SelectItem>
            ))}
          </>,
          t("kol.kolom.platform"),
          "w-[150px]",
        )}
        {sel(
          saring.tier,
          (v) => pergi({ tier: v as Tier | "" }),
          <>
            <SelectItem value={SEMUA}>{t("kol.semuaTier")}</SelectItem>
            {SEMUA_TIER.map((x) => (
              <SelectItem key={x} value={x}>
                {tc(`tier_${x}`)}
              </SelectItem>
            ))}
          </>,
          t("kol.semuaTier"),
          "w-[130px]",
        )}
        {(pilihan.label.length > 0 || saring.label) &&
          sel(
            saring.label,
            (v) => pergi({ label: v }),
            <>
              <SelectItem value={SEMUA}>{t("kol.semuaLabel")}</SelectItem>
              {[...new Set([...pilihan.label, ...(saring.label ? [saring.label] : [])])].map((l) => (
                <SelectItem key={l} value={l}>
                  {l}
                </SelectItem>
              ))}
            </>,
            t("kol.semuaLabel"),
            "w-[150px]",
          )}
        {sel(
          saring.status,
          (v) => pergi({ status: v as StatusSaringKol }),
          <>
            <SelectItem value={SEMUA}>{t("kol.semuaStatus")}</SelectItem>
            <SelectItem value="BELUM">{t("kol.statusBelum")}</SelectItem>
            <SelectItem value="DIBLOKIR">{t("kol.statusDiblokir")}</SelectItem>
            <SelectSeparator />
            <SelectGroup>
              <SelectLabel>{t("kol.statusTahap")}</SelectLabel>
              {SEMUA_TAHAP.map((x) => (
                <SelectItem key={x} value={x}>
                  {labelTahap(x)}
                </SelectItem>
              ))}
            </SelectGroup>
          </>,
          t("kol.semuaStatus"),
          "w-[180px]",
        )}
        {sel(
          saring.urut === "terbaru" ? "" : saring.urut,
          (v) => pergi({ urut: (v || "terbaru") as UrutKol }),
          <>
            {URUT_KOL.map((u) => (
              <SelectItem key={u} value={u === "terbaru" ? SEMUA : u}>
                {t("kol.urutLabel")}: {t(`kol.urut.${u}`)}
              </SelectItem>
            ))}
          </>,
          t("kol.urutLabel"),
          "w-[200px]",
        )}
        {adaSaring && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setCari("");
              pergi({ cari: "", platform: "", tier: "", label: "", status: "" });
            }}
          >
            {t("kol.hapusSaringan")}
          </Button>
        )}
        <PilihTampilan className="ml-auto" nilai={saring.tampilan} pilihan={TAMPILAN_KOL} onUbah={ubahTampilan} />
      </div>

      {bolehMengelola && dipilih.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
          <span className="font-medium tabular-nums">{t("kol.dipilih", { n: dipilih.size })}</span>
          <Button size="sm" onClick={() => setBukaCampaign(true)}>
            <FolderPlus className="mr-1.5 h-4 w-4" />
            {t("kol.masukkanCampaign")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDipilih(new Set())}>
            {t("kol.batalPilih")}
          </Button>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            {t("kol.judul")}
            {berpindah && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label={t("kol.memuat")} />}
          </CardTitle>
        </CardHeader>
        <CardContent className={cn(hasil.baris.length === 0 ? "" : "px-0 sm:px-6", berpindah && "opacity-60 transition-opacity")} aria-busy={berpindah}>
          {hasil.baris.length === 0 ? (
            adaSaring ? (
              <EmptyState
                icon={Users}
                title={t("kol.kosongSaringJudul")}
                description={t("kol.kosongSaringIsi")}
                action={
                  <Button
                    variant="outline"
                    onClick={() => {
                      setCari("");
                      pergi({ cari: "", platform: "", tier: "", label: "", status: "" });
                    }}
                  >
                    {t("kol.hapusSaringan")}
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={Users}
                title={t("kol.kosongJudul")}
                description={t("kol.kosongIsi")}
                action={
                  bolehMengelola ? (
                    <Button
                      onClick={() => {
                        setAwalForm(null);
                        setBukaForm(true);
                      }}
                    >
                      <Plus className="mr-1.5 h-4 w-4" />
                      {t("kol.tambah")}
                    </Button>
                  ) : undefined
                }
              />
            )
          ) : saring.tampilan === "galeri" ? (
            <div className="grid gap-3 px-4 sm:grid-cols-2 sm:px-0 lg:grid-cols-3 2xl:grid-cols-4">
              {hasil.baris.map((k) => (
                <div
                  key={k.id}
                  className={cn(
                    "relative flex flex-col gap-3 rounded-lg border bg-card p-4",
                    dipilih.has(k.id) && "ring-2 ring-primary",
                  )}
                >
                  <div className="flex items-start gap-3">
                    {bolehMengelola && (
                      <Checkbox
                        className="mt-1"
                        checked={dipilih.has(k.id)}
                        onCheckedChange={(v) => pilih(k.id, v === true)}
                        aria-label={t("kol.pilihBaris", { nama: k.nama })}
                      />
                    )}
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                      {inisial(k.nama)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <Link href={`${PATH}/${k.id}`} className="block truncate font-medium hover:underline">
                        {k.nama}
                      </Link>
                      {k.akunUtama && (
                        <p className="truncate text-xs text-muted-foreground">
                          @{k.akunUtama.handle} · {tc(`platform${k.akunUtama.platform}`)}
                        </p>
                      )}
                    </div>
                    <StatusPill tone={NADA_TIER[k.tier]}>{tc(`tier_${k.tier}`)}</StatusPill>
                  </div>
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                    <dt className="text-muted-foreground">{t("kol.kolom.pengikut")}</dt>
                    <dd className="text-right tabular-nums">{ringkasAngka(k.pengikut)}</dd>
                    <dt className="text-muted-foreground">{t("kol.kolom.er")}</dt>
                    <dd className="text-right tabular-nums">{persenTeks(k.er)}</dd>
                    <dt className="text-muted-foreground">{t("kol.kolom.gmv")}</dt>
                    <dd className="text-right tabular-nums">{rupiahLayar(k.gmv)}</dd>
                  </dl>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {k.jumlahKolaborasi > 0 && <span className="tabular-nums">{t("kol.jumlahKolaborasi", { n: k.jumlahKolaborasi })}</span>}
                    {pilTahap(k)}
                  </div>
                  {pilLabel(k)}
                  <div className="mt-auto flex items-center justify-end gap-1 border-t pt-2">
                    <TombolWa kolId={k.id} bolehMengelola={bolehMengelola} />
                    {tombolUbah(k)}
                    <Button asChild variant="outline" size="sm">
                      <Link href={`${PATH}/${k.id}`} aria-label={t("kol.bukaProfil", { nama: k.nama })}>
                        {t("kol.buka")}
                      </Link>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {bolehMengelola && (
                      <TableHead className="w-10">
                        <Checkbox
                          checked={semuaHalaman ? true : sebagianHalaman ? "indeterminate" : false}
                          onCheckedChange={(v) => pilihHalaman(v === true)}
                          aria-label={t("kol.pilihHalaman")}
                        />
                      </TableHead>
                    )}
                    <TableHead className="min-w-[200px]">{t("kol.kolom.kol")}</TableHead>
                    <TableHead>{t("kol.kolom.platform")}</TableHead>
                    <TableHead className="text-right">{t("kol.kolom.pengikut")}</TableHead>
                    <TableHead className="text-right">{t("kol.kolom.er")}</TableHead>
                    <TableHead>{t("kol.kolom.kolaborasi")}</TableHead>
                    <TableHead className="hidden text-right 2xl:table-cell">{t("kol.kolom.views")}</TableHead>
                    <TableHead className="text-right">{t("kol.kolom.gmv")}</TableHead>
                    <TableHead className="hidden xl:table-cell">{t("kol.kolom.kontak")}</TableHead>
                    <TableHead className="sticky right-0 bg-card">
                      <span className="sr-only">{t("kol.kolom.aksi")}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="baris-berurutan">
                  {hasil.baris.map((k) => (
                    <TableRow key={k.id} data-state={dipilih.has(k.id) ? "selected" : undefined}>
                      {bolehMengelola && (
                        <TableCell>
                          <Checkbox
                            checked={dipilih.has(k.id)}
                            onCheckedChange={(v) => pilih(k.id, v === true)}
                            aria-label={t("kol.pilihBaris", { nama: k.nama })}
                          />
                        </TableCell>
                      )}
                      <TableCell className="whitespace-normal">
                        <Link href={`${PATH}/${k.id}`} className="font-medium hover:underline">
                          {k.akunUtama ? `@${k.akunUtama.handle}` : k.nama}
                        </Link>
                        <span className="block text-xs text-muted-foreground">
                          {[k.akunUtama ? k.nama : null, k.niche, k.kota].filter(Boolean).join(" · ")}
                        </span>
                        {pilLabel(k)}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col items-start gap-1">
                          <span className="text-sm">
                            {k.akunUtama ? tc(`platform${k.akunUtama.platform}`) : "—"}
                            {k.akun.length > 1 && <span className="ml-1 text-xs text-muted-foreground">+{k.akun.length - 1}</span>}
                          </span>
                          <StatusPill tone={NADA_TIER[k.tier]}>{tc(`tier_${k.tier}`)}</StatusPill>
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums" title={angkaPenuh(k.pengikut)}>
                        {ringkasAngka(k.pengikut)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{persenTeks(k.er)}</TableCell>
                      <TableCell>
                        {pilTahap(k)}
                        {k.jumlahKolaborasi > 1 && (
                          <span className="block text-xs text-muted-foreground tabular-nums">{t("kol.jumlahKolaborasi", { n: k.jumlahKolaborasi })}</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums 2xl:table-cell">{ringkasAngka(k.views)}</TableCell>
                      <TableCell className="text-right tabular-nums">{rupiahLayar(k.gmv)}</TableCell>
                      <TableCell className="hidden text-sm xl:table-cell">
                        {k.kontakTerakhir ? formatDisplayDate(k.kontakTerakhir, locale) : <span className="text-muted-foreground">{t("kol.belumDihubungi")}</span>}
                      </TableCell>
                      <TableCell className="sticky right-0 bg-card">
                        <div className="flex items-center gap-0.5">
                          <TombolWa kolId={k.id} bolehMengelola={bolehMengelola} />
                          {tombolUbah(k)}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {hasil.total > 0 && (
            <Pager
              className="mt-4 px-4 sm:px-0"
              page={hasil.halaman}
              pageSize={hasil.ukuran}
              total={hasil.total}
              pageSizeOptions={[...UKURAN_HALAMAN_KOL]}
              onPageChange={(p) => pergi({ halaman: p }, "push")}
              onPageSizeChange={(n) => pergi({ ukuran: n })}
            />
          )}
        </CardContent>
      </Card>

      <DialogKol
        buka={bukaForm}
        onBukaUbah={setBukaForm}
        awal={awalForm}
        niche={pilihan.niche}
        labelSaran={pilihan.label}
        onTersimpan={() => router.refresh()}
      />
      <DialogMasukCampaign
        buka={bukaCampaign}
        onBukaUbah={setBukaCampaign}
        kolIds={[...dipilih]}
        campaign={campaign}
        onSelesai={() => {
          setDipilih(new Set());
          router.refresh();
        }}
      />
    </div>
  );
}
