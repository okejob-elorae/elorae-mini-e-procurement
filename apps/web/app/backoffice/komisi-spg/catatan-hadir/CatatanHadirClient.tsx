"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowLeft, ClipboardList, FileDown, Loader2 } from "lucide-react";
import {
  imporCatatanHadirAction,
  kembalikanCatatanHadirAction,
  periksaCatatanHadirAction,
  simpanCatatanHadirAction,
  unduhTemplateCatatanHadirAction,
} from "@/app/actions/spg-komisi-hadir";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { dinamis } from "@/lib/i18n/dinamis";
import type { BarisCatatanHadirKantor, RincianCatatanHadir as DataRincian } from "@/lib/spg/absen-catatan-hadir-queries";
import { RincianCatatanHadir } from "./RincianCatatanHadir";

/** Saringan daftar (`?perlu=`) — tautan lonceng dan Beranda membuka salah satunya. */
export type SaringanCatatan = "semua" | "masukkan" | "periksa" | "dikembalikan";
const SARINGAN: readonly SaringanCatatan[] = ["semua", "masukkan", "periksa", "dikembalikan"];

/** `kind` kosong = hari itu tidak ada di catatan (catatan boleh hanya mencakup sebagian hari, B13). */
type IsianHari = { day: string; kind: "KERJA" | "LIBUR" | ""; present: boolean; note: string };
const TANPA_CATATAN = "KOSONG";

const NADA: Record<string, StatusTone> = { DIAJUKAN: "waiting", DIPERIKSA: "settled", DIKEMBALIKAN: "attention" };
const hariTampil = (d: string) =>
  new Date(`${d}T00:00:00+07:00`).toLocaleDateString("id-ID", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Jakarta" });

function hariMasa(m: { hariAwal: string; hariAkhir: string }): string[] {
  const hasil: string[] = [];
  for (let t = Date.parse(`${m.hariAwal}T00:00:00Z`); t <= Date.parse(`${m.hariAkhir}T00:00:00Z`); t += 86_400_000) hasil.push(new Date(t).toISOString().slice(0, 10));
  return hasil;
}

export function CatatanHadirClient({
  baris,
  perlu,
  rincian,
  bolehCatat,
  bolehPeriksa,
  penggunaId,
}: {
  baris: BarisCatatanHadirKantor[];
  perlu: SaringanCatatan;
  rincian: DataRincian | null;
  bolehCatat: boolean;
  bolehPeriksa: boolean;
  penggunaId: string;
}) {
  const t = useTranslations("komisiSpg.catatanHadir");
  const td = dinamis(useTranslations("komisiSpg.catatanHadir"));
  const router = useRouter();
  const [sibuk, mulai] = useTransition();
  const [isi, setIsi] = useState<{ b: BarisCatatanHadirKantor; hari: IsianHari[] } | null>(null);
  const [impor, setImpor] = useState<BarisCatatanHadirKantor | null>(null);
  const [berkas, setBerkas] = useState<File | null>(null);
  const [kembali, setKembali] = useState<BarisCatatanHadirKantor | null>(null);
  const [alasan, setAlasan] = useState("");
  const [fotoKertas, setFotoKertas] = useState<File | null>(null);

  const galat = (r: { code?: string; galat?: { baris: number; kode: string }[] }) => {
    const pertama = r.galat?.[0];
    toast.error(pertama && pertama.baris > 0 ? t("errBaris", { baris: pertama.baris, pesan: td(`err.${pertama.kode}`) }) : td(`err.${r.code}`));
  };

  const jalankan = (
    kerja: () => Promise<{ ok: boolean; code?: string; galat?: { baris: number; kode: string }[]; tanpaBerkas?: boolean }>,
    pesan: string,
    bersih: () => void,
  ) =>
    mulai(async () => {
      try {
        const r = await kerja();
        if (!r.ok) {
          galat(r);
          if (r.code === "CATATAN_BERUBAH") router.refresh();
          return;
        }
        toast.success(pesan);
        // Lampiran itu boleh, bukan wajib (B13): catatannya tersimpan, berkasnya tidak.
        if (r.tanpaBerkas) toast.warning(t("tanpaBerkas"));
        bersih();
        router.refresh();
      } catch {
        toast.error(td("err.GAGAL"));
      }
    });

  const bukaIsi = (b: BarisCatatanHadirKantor) => {
    if (!b.masa) return;
    setFotoKertas(null);
    const ada = new Map((b.catatan?.hari ?? []).map((h) => [h.day, h]));
    setIsi({
      b,
      hari: hariMasa(b.masa).map((day) => {
        const h = ada.get(day);
        if (h) return { day, kind: h.kind, present: h.present, note: h.note ?? "" };
        // Catatan yang sudah ada tidak diam-diam diperluas: hari yang belum dicatatnya tetap "tidak
        // dicatat" sampai kantor mengisinya. Catatan baru mulai dari isian bawaan formulir ini.
        return { day, kind: b.catatan ? "" : "KERJA", present: true, note: "" };
      }),
    });
  };

  const unduhTemplate = (b: BarisCatatanHadirKantor) =>
    mulai(async () => {
      const r = await unduhTemplateCatatanHadirAction({ userId: b.userId, bulan: b.bulan });
      if (!r.ok) {
        toast.error(td(`err.${r.code}`));
        return;
      }
      const a = document.createElement("a");
      a.href = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${r.base64}`;
      a.download = r.filename;
      a.click();
    });

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link href="/backoffice/komisi-spg">
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          {t("kembali")}
        </Link>
      </Button>
      <PageHeader title={t("judul")} meta={t("ringkas")} />

      <div className="flex flex-wrap gap-2">
        {SARINGAN.map((x) => (
          <Button key={x} size="sm" variant={x === perlu ? "default" : "outline"} asChild>
            <Link href={x === "semua" ? "/backoffice/komisi-spg/catatan-hadir" : `/backoffice/komisi-spg/catatan-hadir?perlu=${x}`}>{td(`saring.${x}`)}</Link>
          </Button>
        ))}
      </div>

      {rincian ? <RincianCatatanHadir data={rincian} tutupHref={perlu === "semua" ? "/backoffice/komisi-spg/catatan-hadir" : `/backoffice/komisi-spg/catatan-hadir?perlu=${perlu}`} /> : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5" aria-hidden />
            {t("daftar")}
          </CardTitle>
          <CardDescription>{t("isi")}</CardDescription>
        </CardHeader>
        <CardContent className={baris.length === 0 ? undefined : "px-0"}>
          {baris.length === 0 ? (
            <EmptyState icon={ClipboardList} title={t("kosongJudul")} description={t("kosongIsi")} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("kolom.spg")}</TableHead>
                    <TableHead>{t("kolom.bulan")}</TableHead>
                    <TableHead>{t("kolom.status")}</TableHead>
                    <TableHead className="text-right">{t("kolom.aksi")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {baris.map((b) => {
                    const c = b.catatan;
                    const pemeriksaSama = c !== null && c.penyimpanIds.includes(penggunaId);
                    const bandingHref = `/backoffice/komisi-spg/catatan-hadir?${new URLSearchParams({
                      ...(perlu === "semua" ? {} : { perlu }),
                      user: b.userId,
                      bulan: b.bulan,
                    }).toString()}`;
                    return (
                      <TableRow key={`${b.userId}:${b.bulan}`}>
                        <TableCell className="min-w-[10rem] whitespace-normal">
                          <span className="font-medium">{b.nama}</span>
                          <span className="block text-xs text-muted-foreground">{b.namaToko}</span>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{b.label}</TableCell>
                        <TableCell className="min-w-[12rem] whitespace-normal text-xs">
                          {c ? (
                            <>
                              <StatusPill tone={NADA[c.status] ?? "inactive"}>{td(`status.${c.status}`)}</StatusPill>
                              <span className="mt-1 block text-muted-foreground">
                                {t("dimasukkan", { nama: c.dimasukkanOleh, tanggal: c.dimasukkanLabel, sumber: td(`sumber.${c.sumber}`) })}
                              </span>
                              {c.diperiksaOleh ? <span className="block text-muted-foreground">{t("diperiksa", { nama: c.diperiksaOleh, tanggal: c.diperiksaLabel ?? "" })}</span> : null}
                              {c.catatanKembali ? <span className="block text-destructive">{c.catatanKembali}</span> : null}
                            </>
                          ) : (
                            <span className="text-amber-800 dark:text-amber-300">{t("perlu")}</span>
                          )}
                          {b.hariPerlu.length > 0 && !b.sudahDibayar ? (
                            <span className="block text-amber-800 dark:text-amber-300">{t("hariPerlu", { hari: b.hariPerlu.map(hariTampil).join(", ") })}</span>
                          ) : null}
                          {!b.masa ? <span className="block text-amber-800 dark:text-amber-300">{t("tanpaMulai")}</span> : null}
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="inline-flex flex-wrap justify-end gap-2">
                            {b.masa ? (
                              <Button size="sm" variant="ghost" asChild>
                                <Link href={bandingHref}>{t("bandingkan")}</Link>
                              </Button>
                            ) : null}
                            {/* Catatan yang sudah diperiksa pun boleh disimpan ulang selama gajinya belum dibayar (B13):
                                menyimpannya kembali ke "menunggu diperiksa". Hari yang belum dicakupnya
                                hanya bisa diisi dari sini — SPG dan kisi kantor tidak bisa mengisi hari lewat. */}
                            {bolehCatat && !b.sudahDibayar && b.masa ? (
                              <>
                                <Button size="sm" variant="outline" disabled={sibuk} onClick={() => bukaIsi(b)}>
                                  {c ? t("ubah") : t("ketik")}
                                </Button>
                                <Button size="sm" variant="outline" disabled={sibuk} onClick={() => { setBerkas(null); setImpor(b); }}>
                                  {t("impor")}
                                </Button>
                              </>
                            ) : null}
                            {bolehPeriksa && c?.status === "DIAJUKAN" && !b.sudahDibayar ? (
                              <>
                                <Button
                                  size="sm"
                                  disabled={sibuk || pemeriksaSama}
                                  title={pemeriksaSama ? t("pemeriksaSama") : undefined}
                                  onClick={() => jalankan(() => periksaCatatanHadirAction({ recordId: c.id, versi: c.versi }), t("okPeriksa"), () => {})}
                                >
                                  {t("periksa")}
                                </Button>
                                <Button size="sm" variant="ghost" disabled={sibuk || pemeriksaSama} onClick={() => { setAlasan(""); setKembali(b); }}>
                                  {t("kembalikan")}
                                </Button>
                              </>
                            ) : null}
                            {b.sudahDibayar ? <span className="text-xs text-muted-foreground">{t("sudahDibayar")}</span> : null}
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={isi !== null} onOpenChange={(o) => !o && !sibuk && setIsi(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("ketikJudul", { nama: isi?.b.nama ?? "", bulan: isi?.b.label ?? "" })}</DialogTitle>
            <DialogDescription>{t("ketikIsi")}</DialogDescription>
          </DialogHeader>
          {isi?.b.catatan?.status === "DIPERIKSA" ? (
            <p className="rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">{t("ubahDiperiksa")}</p>
          ) : null}
          <div className="space-y-2">
            {isi?.hari.map((h, i) => (
              <div key={h.day} className="grid grid-cols-[7rem_7rem_6rem_1fr] items-center gap-2 text-sm">
                <span>{hariTampil(h.day)}</span>
                <Select
                  value={h.kind || TANPA_CATATAN}
                  onValueChange={(v) =>
                    setIsi((s) => (s ? { ...s, hari: s.hari.map((x, n) => (n === i ? { ...x, kind: v === TANPA_CATATAN ? "" : (v as "KERJA" | "LIBUR") } : x)) } : s))
                  }
                >
                  <SelectTrigger aria-label={t("jadwal")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="KERJA">{t("kerja")}</SelectItem>
                    <SelectItem value="LIBUR">{t("libur")}</SelectItem>
                    <SelectItem value={TANPA_CATATAN}>{t("tidakDicatat")}</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  disabled={!h.kind}
                  value={h.present ? "YA" : "TIDAK"}
                  onValueChange={(v) => setIsi((s) => (s ? { ...s, hari: s.hari.map((x, n) => (n === i ? { ...x, present: v === "YA" } : x)) } : s))}
                >
                  <SelectTrigger aria-label={t("hadir")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="YA">{t("hadirYa")}</SelectItem>
                    <SelectItem value="TIDAK">{t("hadirTidak")}</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  aria-label={t("catatan")}
                  disabled={!h.kind}
                  value={h.note}
                  maxLength={300}
                  onChange={(e) => setIsi((s) => (s ? { ...s, hari: s.hari.map((x, n) => (n === i ? { ...x, note: e.target.value } : x)) } : s))}
                />
              </div>
            ))}
          </div>
          <div className="space-y-2">
            <Label htmlFor="catatan-foto">{t("fotoKertas")}</Label>
            <Input id="catatan-foto" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setFotoKertas(e.target.files?.[0] ?? null)} />
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={sibuk} onClick={() => setIsi(null)}>
              {t("tutup")}
            </Button>
            <Button
              disabled={sibuk || !isi || isi.hari.every((h) => !h.kind)}
              onClick={() => {
                const x = isi;
                if (!x) return;
                const f = new FormData();
                f.set("userId", x.b.userId);
                f.set("bulan", x.b.bulan);
                f.set("versi", x.b.catatan ? String(x.b.catatan.versi) : "");
                f.set(
                  "hari",
                  JSON.stringify(x.hari.filter((h) => h.kind).map((h) => ({ day: h.day, kind: h.kind, present: h.present, note: h.note.trim() || null }))),
                );
                if (fotoKertas) f.set("foto", fotoKertas);
                jalankan(() => simpanCatatanHadirAction(f), t("okSimpan"), () => setIsi(null));
              }}
            >
              {sibuk ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t("simpan")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={impor !== null} onOpenChange={(o) => !o && !sibuk && setImpor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("imporJudul", { nama: impor?.nama ?? "", bulan: impor?.label ?? "" })}</DialogTitle>
            <DialogDescription>{t("imporIsi")}</DialogDescription>
          </DialogHeader>
          {impor?.catatan?.status === "DIPERIKSA" ? (
            <p className="rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">{t("ubahDiperiksa")}</p>
          ) : null}
          <div className="space-y-3">
            <Button size="sm" variant="outline" disabled={sibuk || !impor} onClick={() => impor && unduhTemplate(impor)}>
              <FileDown className="mr-1.5 h-4 w-4" />
              {t("unduhTemplate")}
            </Button>
            <div className="space-y-2">
              <Label htmlFor="catatan-berkas">{t("berkas")}</Label>
              <Input id="catatan-berkas" type="file" accept=".xlsx,.xls,.csv" onChange={(e) => setBerkas(e.target.files?.[0] ?? null)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={sibuk} onClick={() => setImpor(null)}>
              {t("tutup")}
            </Button>
            <Button
              disabled={sibuk || !impor || !berkas}
              onClick={() => {
                const b = impor;
                if (!b || !berkas) return;
                const f = new FormData();
                f.set("userId", b.userId);
                f.set("bulan", b.bulan);
                f.set("versi", b.catatan ? String(b.catatan.versi) : "");
                f.set("berkas", berkas);
                jalankan(() => imporCatatanHadirAction(f), t("okImpor"), () => setImpor(null));
              }}
            >
              {sibuk ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t("imporSimpan")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={kembali !== null} onOpenChange={(o) => !o && !sibuk && setKembali(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("kembalikanJudul", { nama: kembali?.nama ?? "" })}</DialogTitle>
            <DialogDescription>{t("kembalikanIsi")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="catatan-alasan">{t("alasan")}</Label>
            <Textarea id="catatan-alasan" rows={3} maxLength={500} value={alasan} onChange={(e) => setAlasan(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={sibuk} onClick={() => setKembali(null)}>
              {t("tutup")}
            </Button>
            <Button
              disabled={sibuk || !alasan.trim() || !kembali?.catatan}
              onClick={() => {
                const c = kembali?.catatan;
                if (!c) return;
                jalankan(() => kembalikanCatatanHadirAction({ recordId: c.id, versi: c.versi, catatan: alasan }), t("okKembali"), () => setKembali(null));
              }}
            >
              {sibuk ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t("kembalikan")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
