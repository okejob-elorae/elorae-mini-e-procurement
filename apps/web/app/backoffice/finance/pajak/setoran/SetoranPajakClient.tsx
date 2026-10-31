"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Ban, ChevronLeft, ChevronRight, Landmark, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusPill } from "@/components/ui/status-pill";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TanggalInput } from "@/components/ui/tanggal-input";
import { Textarea } from "@/components/ui/textarea";
import { formatRupiah } from "@/lib/format/rupiah";
import { labelTanggal } from "@/lib/tanggal-isian";
import { newLocalId } from "@/lib/pwa/id-lokal";
import { cn } from "@/lib/utils";
import { geserMasaPajak } from "@/lib/finance/pajak/masa";
import { INFO_SETORAN, SEMUA_JENIS_SETORAN, type JenisSetoran } from "@/lib/finance/pajak/setoran";
import { batalkanSetoranAction, catatSetoranAction } from "@/app/actions/finance-pajak";
import type { BarisSetoran, RekeningKasBank } from "@/lib/finance/pajak/setoran-queries";
import { NavPajak, SpandukPajak, type AksesPajak } from "../_bersama/NavPajak";
import { labelMasa } from "../_bersama/akses";

type Props = {
  tahun: number;
  jenis: JenisSetoran | null;
  sorot: string | null;
  baris: BarisSetoran[];
  rekening: RekeningKasBank[];
  isiAwal: { jenis: JenisSetoran; masa: string; jumlah: string } | null;
  hariIni: string;
  statusPkp: string;
  rezimPph: string;
  akses: AksesPajak & { kelola: boolean };
  gagal: boolean;
};

const REKENING_PERAN = "__peran_bank__";
const SEMUA = "__semua__";

type Isian = { jenis: JenisSetoran; masa: string; jumlah: string; tanggalBayar: string; ntpn: string; kodeBilling: string; rekeningId: string; catatan: string };

export function SetoranPajakClient({ tahun, jenis, sorot, baris, rekening, isiAwal, hariIni, statusPkp, rezimPph, akses, gagal }: Props) {
  const t = useTranslations("financeTax.setoran");
  const tp = useTranslations("financeTax.pajak");
  const locale = useLocale();
  const router = useRouter();
  const [pindah, mulaiPindah] = useTransition();
  const [pending, mulai] = useTransition();
  const masaIni = hariIni.slice(0, 7);
  const isiKosong = (): Isian => ({
    jenis: isiAwal?.jenis ?? "PPN",
    masa: isiAwal?.masa || geserMasaPajak(masaIni, -1),
    jumlah: isiAwal?.jumlah ?? "",
    tanggalBayar: hariIni,
    ntpn: "",
    kodeBilling: "",
    rekeningId: REKENING_PERAN,
    catatan: "",
  });
  const [baru, setBaru] = useState<Isian | null>(isiAwal && akses.kelola ? isiKosong() : null);
  const [kunci, setKunci] = useState(() => newLocalId());
  const [batal, setBatal] = useState<BarisSetoran | null>(null);
  const [alasan, setAlasan] = useState("");

  const pilihanMasa = useMemo(() => Array.from({ length: 24 }, (_, i) => geserMasaPajak(masaIni, -i)), [masaIni]);
  const total = baris.filter((b) => b.status === "POSTED").reduce((s, b) => s + Math.round(b.jumlah * 100), 0) / 100;

  const pergi = (q: URLSearchParams) => mulaiPindah(() => router.replace(`/backoffice/finance/pajak/setoran?${q.toString()}`, { scroll: false }));
  const qsDasar = (ubah: Record<string, string | null>) => {
    const q = new URLSearchParams({ tahun: String(tahun), ...(jenis ? { jenis } : {}) });
    for (const [k, v] of Object.entries(ubah)) {
      if (v == null) q.delete(k);
      else q.set(k, v);
    }
    return q;
  };

  const bukaBaru = () => {
    setKunci(newLocalId());
    setBaru(isiKosong());
  };

  const pesan = (kode: string, peran?: string) =>
    kode === "UNMAPPED_ROLE" ? t("err.UNMAPPED_ROLE", { peran: peran ?? "" }) : t.has(`err.${kode}`) ? t(`err.${kode}`) : t("err.GAGAL");

  const simpan = () =>
    mulai(async () => {
      if (!baru) return;
      const h = await catatSetoranAction({
        jenis: baru.jenis,
        masa: baru.masa,
        jumlah: baru.jumlah,
        tanggalBayar: baru.tanggalBayar,
        ntpn: baru.ntpn,
        kodeBilling: baru.kodeBilling || null,
        rekeningId: baru.rekeningId === REKENING_PERAN ? null : baru.rekeningId,
        catatan: baru.catatan || null,
        idempotencyKey: kunci,
      });
      if (!h.ok) {
        toast.error(pesan(h.kode, "peran" in h ? h.peran : undefined));
        return;
      }
      toast.success(h.ulang ? t("sudahTercatat") : t("tersimpan"));
      setBaru(null);
      router.replace(`/backoffice/finance/pajak/setoran?tahun=${baru.masa.slice(0, 4)}`, { scroll: false });
      router.refresh();
    });

  const batalkan = () =>
    mulai(async () => {
      if (!batal) return;
      const h = await batalkanSetoranAction({ id: batal.id, alasan });
      if (!h.ok) {
        toast.error(pesan(h.kode));
        return;
      }
      toast.success(t("dibatalkan"));
      setBatal(null);
      setAlasan("");
      router.refresh();
    });

  const kurangIsian = !baru
    ? null
    : !baru.masa
      ? t("kurang.masa")
      : !/^\d+$/.test(baru.jumlah.replace(/\./g, "")) || Number(baru.jumlah.replace(/\./g, "")) <= 0
        ? t("kurang.jumlah")
        : !baru.tanggalBayar
          ? t("kurang.tanggal")
          : baru.ntpn.replace(/[\s-]/g, "").length !== 16
            ? t("kurang.ntpn")
            : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("judul")}
        meta={t("meta", { n: baris.length, tahun, total: formatRupiah(total) })}
        actions={
          akses.kelola ? (
            <Button onClick={bukaBaru}>
              <Plus className="h-4 w-4" aria-hidden />
              {t("baru")}
            </Button>
          ) : null
        }
      />
      <NavPajak aktif="setoran" akses={akses} />
      <SpandukPajak statusPkp={statusPkp} rezimPph={rezimPph} akses={akses} />

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" aria-label={t("tahunSebelum")} onClick={() => pergi(qsDasar({ tahun: String(tahun - 1) }))} disabled={pindah}>
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </Button>
          <p className="min-w-16 text-center font-medium tabular-nums">{tahun}</p>
          <Button variant="outline" size="icon" aria-label={t("tahunSesudah")} onClick={() => pergi(qsDasar({ tahun: String(tahun + 1) }))} disabled={pindah}>
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Button>
        </div>
        <Select value={jenis ?? SEMUA} onValueChange={(v) => pergi(qsDasar({ jenis: v === SEMUA ? null : v }))}>
          <SelectTrigger className="w-56" aria-label={t("saringJenis")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SEMUA}>{t("semuaJenis")}</SelectItem>
            {SEMUA_JENIS_SETORAN.map((j) => (
              <SelectItem key={j} value={j}>
                {tp(j)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Landmark className="h-5 w-5" aria-hidden />
            {t("daftar")}
          </CardTitle>
        </CardHeader>
        <CardContent className={pindah ? "opacity-60 transition-opacity" : undefined}>
          {gagal ? (
            <p className="text-sm text-destructive">{t("gagal")}</p>
          ) : baris.length === 0 ? (
            <EmptyState icon={Landmark} title={t("kosong", { tahun })} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("kolom.tanggal")}</TableHead>
                    <TableHead>{t("kolom.jenis")}</TableHead>
                    <TableHead>{t("kolom.masa")}</TableHead>
                    <TableHead className="text-right">{t("kolom.jumlah")}</TableHead>
                    <TableHead>{t("kolom.ntpn")}</TableHead>
                    <TableHead className="hidden 2xl:table-cell">{t("kolom.rekening")}</TableHead>
                    <TableHead>{t("kolom.status")}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {baris.map((b) => (
                    <TableRow key={b.id} className={cn(b.id === sorot && "bg-muted/60")}>
                      <TableCell className="tabular-nums">{labelTanggal(b.tanggalBayar, locale)}</TableCell>
                      <TableCell>{tp(b.jenis)}</TableCell>
                      <TableCell className="whitespace-nowrap capitalize">{labelMasa(b.masa, locale)}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{formatRupiah(b.jumlah)}</TableCell>
                      <TableCell className="whitespace-normal">
                        <span className="tabular-nums">{b.ntpn ?? "—"}</span>
                        {b.kodeBilling ? <span className="block text-xs text-muted-foreground">{t("billing", { kode: b.kodeBilling })}</span> : null}
                      </TableCell>
                      <TableCell className="hidden whitespace-normal 2xl:table-cell">{b.rekening ?? t("rekeningPeran")}</TableCell>
                      <TableCell className="whitespace-normal">
                        <StatusPill tone={b.status === "POSTED" ? "settled" : "inactive"}>{t(`status.${b.status}`)}</StatusPill>
                        {b.alasanBatal ? <span className="block text-xs text-muted-foreground">{b.alasanBatal}</span> : null}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {b.jurnalId ? (
                            <Button asChild size="sm" variant="ghost">
                              <Link href={`/backoffice/finance/journals/${b.jurnalId}`}>{t("jurnal")}</Link>
                            </Button>
                          ) : null}
                          {akses.kelola && b.status === "POSTED" ? (
                            <Button size="sm" variant="ghost" onClick={() => setBatal(b)} aria-label={t("batalkanUntuk", { ntpn: b.ntpn ?? "" })}>
                              <Ban className="h-4 w-4" aria-hidden />
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={baru !== null} onOpenChange={(v) => !v && !pending && setBaru(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("dialog.judul")}</DialogTitle>
            <DialogDescription>{baru ? t("dialog.kap", { kap: INFO_SETORAN[baru.jenis].kapKjs }) : null}</DialogDescription>
          </DialogHeader>
          {baru ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="setor-jenis">{t("dialog.jenis")}</Label>
                <Select value={baru.jenis} onValueChange={(v) => setBaru({ ...baru, jenis: v as JenisSetoran })}>
                  <SelectTrigger id="setor-jenis">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SEMUA_JENIS_SETORAN.map((j) => (
                      <SelectItem key={j} value={j}>
                        {tp(j)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="setor-masa">{t("dialog.masa")}</Label>
                <Select value={baru.masa} onValueChange={(v) => setBaru({ ...baru, masa: v })}>
                  <SelectTrigger id="setor-masa" className="capitalize">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(pilihanMasa.includes(baru.masa) || !baru.masa ? pilihanMasa : [baru.masa, ...pilihanMasa]).map((m) => (
                      <SelectItem key={m} value={m} className="capitalize">
                        {labelMasa(m, locale)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="setor-jumlah">{t("dialog.jumlah")}</Label>
                <Input id="setor-jumlah" inputMode="numeric" value={baru.jumlah} onChange={(e) => setBaru({ ...baru, jumlah: e.target.value.replace(/[^\d]/g, "") })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="setor-tanggal">{t("dialog.tanggal")}</Label>
                <TanggalInput id="setor-tanggal" value={baru.tanggalBayar} max={hariIni} required onChange={(e) => setBaru({ ...baru, tanggalBayar: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="setor-ntpn">{t("dialog.ntpn")}</Label>
                <Input id="setor-ntpn" maxLength={24} value={baru.ntpn} onChange={(e) => setBaru({ ...baru, ntpn: e.target.value.toUpperCase() })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="setor-billing">{t("dialog.billing")}</Label>
                <Input id="setor-billing" inputMode="numeric" maxLength={20} value={baru.kodeBilling} onChange={(e) => setBaru({ ...baru, kodeBilling: e.target.value })} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="setor-rekening">{t("dialog.rekening")}</Label>
                <Select value={baru.rekeningId} onValueChange={(v) => setBaru({ ...baru, rekeningId: v })}>
                  <SelectTrigger id="setor-rekening">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={REKENING_PERAN}>{t("rekeningPeran")}</SelectItem>
                    {rekening.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.kode} {r.nama}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="setor-catatan">{t("dialog.catatan")}</Label>
                <Textarea id="setor-catatan" rows={2} maxLength={500} value={baru.catatan} onChange={(e) => setBaru({ ...baru, catatan: e.target.value })} />
              </div>
            </div>
          ) : null}
          <DialogFooter className="flex-col gap-2 sm:flex-col">
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setBaru(null)} disabled={pending}>
                {t("dialog.batal")}
              </Button>
              <Button onClick={simpan} disabled={pending || kurangIsian != null}>
                {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                {t("dialog.simpan")}
              </Button>
            </div>
            {kurangIsian ? <p className="text-right text-xs text-muted-foreground">{kurangIsian}</p> : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={batal !== null} onOpenChange={(v) => !v && !pending && setBatal(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("batalJudul")}</DialogTitle>
            <DialogDescription>
              {batal ? t("batalIsi", { jenis: tp(batal.jenis), masa: labelMasa(batal.masa, locale), jumlah: formatRupiah(batal.jumlah) }) : null}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="alasan-batal-setoran">{t("alasan")}</Label>
            <Textarea id="alasan-batal-setoran" rows={3} maxLength={500} value={alasan} onChange={(e) => setAlasan(e.target.value)} />
            {alasan.trim().length < 5 ? <p className="text-xs text-muted-foreground">{t("alasanMin")}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBatal(null)} disabled={pending}>
              {t("dialog.batal")}
            </Button>
            <Button variant="destructive" onClick={batalkan} disabled={pending || alasan.trim().length < 5}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {t("batalkan")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
