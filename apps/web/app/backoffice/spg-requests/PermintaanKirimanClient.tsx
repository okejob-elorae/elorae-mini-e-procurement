"use client";

import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, ChevronDown, ChevronRight, Loader2, PackageOpen, PlayCircle, Truck, X } from "lucide-react";
import { ubahStatusPermintaanAction } from "@/app/actions/spg-stok";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { dinamis } from "@/lib/i18n/dinamis";
import type { StatusPermintaan } from "@/lib/spg/kantor-queries";

export type SaringanPermintaan = "aktif" | StatusPermintaan | "semua";

export type BarisPermintaan = {
  id: string;
  toko: string;
  peminta: string;
  status: StatusPermintaan;
  catatan: string | null;
  /** Sudah diformat di server. */
  waktu: string;
  ditangani: { oleh: string; pada: string; catatan: string | null } | null;
  barang: { productName: string; variantSku: string; qty: number }[];
  totalQty: number;
};

type StatusTujuan = "DIPROSES" | "SELESAI" | "DITOLAK";

const NADA: Record<StatusPermintaan, StatusTone> = {
  BARU: "waiting",
  DIPROSES: "progress",
  SELESAI: "settled",
  DITOLAK: "inactive",
};

/**
 * Transisi yang ditawarkan. Sama persis dengan `LANJUTAN` di penulisnya —
 * tombol yang tidak boleh tidak pernah ditampilkan, supaya kantor tidak
 * diajari mencoba lalu ditolak.
 */
const LANJUTAN: Record<StatusPermintaan, StatusTujuan[]> = {
  BARU: ["DIPROSES", "SELESAI", "DITOLAK"],
  DIPROSES: ["SELESAI", "DITOLAK"],
  SELESAI: [],
  DITOLAK: [],
};

const TAB: SaringanPermintaan[] = ["aktif", "BARU", "DIPROSES", "SELESAI", "DITOLAK", "semua"];
const KODE_DIKENAL = new Set(["FORBIDDEN", "VALIDATION", "TIDAK_DITEMUKAN", "STATUS_TIDAK_BOLEH", "ALASAN_WAJIB"]);

export function PermintaanKirimanClient({
  saringan,
  baris,
  jumlahAktif,
  terpotong,
  bolehUbah,
}: {
  saringan: SaringanPermintaan;
  baris: BarisPermintaan[];
  jumlahAktif: number;
  terpotong: boolean;
  bolehUbah: boolean;
}) {
  const t = useTranslations("spgRequests");
  const td = dinamis(t);
  const router = useRouter();
  const [sibuk, mulai] = useTransition();
  const [pindah, mulaiPindah] = useTransition();
  const [terbuka, setTerbuka] = useState<Set<string>>(new Set());
  // `open` terpisah dari isi dialog: judulnya tidak boleh berganti selama
  // animasi menutup.
  const [dialog, setDialog] = useState<{ id: string; status: "SELESAI" | "DITOLAK"; open: boolean } | null>(null);
  const [catatan, setCatatan] = useState("");

  const bukaTutup = (id: string) =>
    setTerbuka((s) => {
      const baru = new Set(s);
      if (baru.has(id)) baru.delete(id);
      else baru.add(id);
      return baru;
    });

  const ubah = (id: string, status: StatusTujuan, note?: string) =>
    mulai(async () => {
      try {
        const hasil = await ubahStatusPermintaanAction({ requestId: id, status, note: note?.trim() || undefined });
        if (!hasil.ok) {
          toast.error(td(`err.${KODE_DIKENAL.has(hasil.code) ? hasil.code : "GAGAL"}`));
          // Status sudah digeser orang lain: muat ulang supaya tombolnya ikut benar.
          if (hasil.code === "STATUS_TIDAK_BOLEH") router.refresh();
          return;
        }
        toast.success(status === "DIPROSES" ? t("okProcess") : status === "SELESAI" ? t("okDone") : t("okReject"));
        setDialog((d) => (d ? { ...d, open: false } : d));
        router.refresh();
      } catch {
        toast.error(t("err.GAGAL"));
      }
    });

  const gantiTab = (v: string) =>
    mulaiPindah(() =>
      router.push(v === "aktif" ? "/backoffice/spg-requests" : `/backoffice/spg-requests?status=${v}`),
    );

  const menolak = dialog?.status === "DITOLAK";
  const bolehKirimDialog = !sibuk && (!menolak || catatan.trim().length > 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("pageTitle")}
        meta={!bolehUbah ? <span className="text-amber-700 dark:text-amber-400">{t("readOnly")}</span> : undefined}
      />

      <Tabs value={saringan} onValueChange={gantiTab} className="overflow-x-auto">
        <TabsList>
          {TAB.map((k) => (
            <TabsTrigger key={k} value={k} disabled={pindah}>
              {td(`tabs.${k}`)}
              {k === "aktif" && jumlahAktif > 0 ? (
                <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground tabular-nums">
                  {jumlahAktif}
                </span>
              ) : null}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Truck className="h-5 w-5" />
            {t("cardTitle")}
            <span className="ml-2 text-sm font-normal text-muted-foreground">({t("count", { count: baris.length })})</span>
          </CardTitle>
          {terpotong ? <p className="text-sm text-muted-foreground">{t("capNote")}</p> : null}
        </CardHeader>
        <CardContent>
          {baris.length === 0 ? (
            <EmptyState
              icon={PackageOpen}
              title={t("emptyTitle")}
              description={saringan === "aktif" ? t("emptyActive") : t("emptyOther")}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <span className="sr-only">{t("showLines")}</span>
                    </TableHead>
                    <TableHead>{t("col.store")}</TableHead>
                    <TableHead>{t("col.requester")}</TableHead>
                    <TableHead>{t("col.time")}</TableHead>
                    <TableHead className="text-right">{t("col.qty")}</TableHead>
                    <TableHead>{t("col.status")}</TableHead>
                    <TableHead className="hidden 2xl:table-cell">{t("col.note")}</TableHead>
                    {bolehUbah ? <TableHead className="text-right">{t("col.actions")}</TableHead> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {baris.map((r) => {
                    const buka = terbuka.has(r.id);
                    const lanjut = LANJUTAN[r.status];
                    return (
                      <Fragment key={r.id}>
                        <TableRow className={buka ? "border-b-0" : undefined}>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-expanded={buka}
                              aria-label={buka ? t("hideLines") : t("showLines")}
                              title={buka ? t("hideLines") : t("showLines")}
                              onClick={() => bukaTutup(r.id)}
                            >
                              {buka ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </Button>
                          </TableCell>
                          <TableCell className="min-w-[10rem] whitespace-normal font-medium">{r.toko}</TableCell>
                          <TableCell className="min-w-[8rem] whitespace-normal text-muted-foreground">{r.peminta}</TableCell>
                          <TableCell className="whitespace-nowrap text-muted-foreground">{r.waktu}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            <div>{t("qtyPcs", { qty: r.totalQty })}</div>
                            <div className="text-xs text-muted-foreground">{t("lineCount", { count: r.barang.length })}</div>
                          </TableCell>
                          <TableCell>
                            <StatusPill
                              tone={NADA[r.status]}
                              detail={r.ditangani ? t("handledBy", { name: r.ditangani.oleh }) : undefined}
                            >
                              {td(`status.${r.status}`)}
                            </StatusPill>
                          </TableCell>
                          <TableCell className="hidden max-w-xs whitespace-normal text-sm text-muted-foreground 2xl:table-cell">
                            {r.catatan ?? t("noNote")}
                          </TableCell>
                          {bolehUbah ? (
                            <TableCell className="text-right">
                              {lanjut.length > 0 ? (
                                <div className="flex flex-wrap justify-end gap-1.5">
                                  {lanjut.includes("DIPROSES") ? (
                                    <Button size="sm" variant="outline" disabled={sibuk} onClick={() => ubah(r.id, "DIPROSES")}>
                                      <PlayCircle className="h-4 w-4" />
                                      {t("actProcess")}
                                    </Button>
                                  ) : null}
                                  {lanjut.includes("SELESAI") ? (
                                    <Button
                                      size="sm"
                                      disabled={sibuk}
                                      onClick={() => {
                                        setCatatan("");
                                        setDialog({ id: r.id, status: "SELESAI", open: true });
                                      }}
                                    >
                                      <Check className="h-4 w-4" />
                                      {t("actDone")}
                                    </Button>
                                  ) : null}
                                  {lanjut.includes("DITOLAK") ? (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="text-destructive hover:text-destructive"
                                      disabled={sibuk}
                                      onClick={() => {
                                        setCatatan("");
                                        setDialog({ id: r.id, status: "DITOLAK", open: true });
                                      }}
                                    >
                                      <X className="h-4 w-4" />
                                      {t("actReject")}
                                    </Button>
                                  ) : null}
                                </div>
                              ) : (
                                <span className="text-sm text-muted-foreground">—</span>
                              )}
                            </TableCell>
                          ) : null}
                        </TableRow>
                        {buka ? (
                          <TableRow className="hover:bg-transparent">
                            <TableCell />
                            <TableCell colSpan={bolehUbah ? 7 : 6} className="whitespace-normal pb-4">
                              <div className="space-y-3 rounded-md border bg-muted/30 p-3">
                                {r.catatan ? (
                                  <p className="text-sm">{t("requestNote", { note: r.catatan })}</p>
                                ) : null}
                                {r.ditangani ? (
                                  <div className="space-y-0.5 text-sm text-muted-foreground">
                                    <p>{t("handledInfo", { name: r.ditangani.oleh, time: r.ditangani.pada })}</p>
                                    {r.ditangani.catatan ? <p>{t("handledNote", { note: r.ditangani.catatan })}</p> : null}
                                  </div>
                                ) : null}
                                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                  {t("linesTitle")}
                                </p>
                                <Table>
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead>{t("colItem")}</TableHead>
                                      <TableHead>{t("colVariant")}</TableHead>
                                      <TableHead className="text-right">{t("colQty")}</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {r.barang.map((b, i) => (
                                      <TableRow key={`${b.variantSku}-${i}`}>
                                        <TableCell className="whitespace-normal">{b.productName}</TableCell>
                                        <TableCell className="font-mono text-xs text-muted-foreground">
                                          {b.variantSku || "—"}
                                        </TableCell>
                                        <TableCell className="text-right tabular-nums">{b.qty}</TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              </div>
                            </TableCell>
                          </TableRow>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={dialog?.open ?? false}
        onOpenChange={(o) => {
          if (!o && !sibuk) setDialog((d) => (d ? { ...d, open: false } : d));
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{menolak ? t("rejectTitle") : t("doneTitle")}</DialogTitle>
            <DialogDescription>{menolak ? t("rejectBody") : t("doneBody")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="catatan-permintaan">{menolak ? t("rejectNoteLabel") : t("doneNoteLabel")}</Label>
            <Textarea
              id="catatan-permintaan"
              value={catatan}
              maxLength={500}
              placeholder={menolak ? t("rejectPlaceholder") : t("donePlaceholder")}
              onChange={(e) => setCatatan(e.target.value)}
              disabled={sibuk}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={sibuk} onClick={() => setDialog((d) => (d ? { ...d, open: false } : d))}>
              {t("cancel")}
            </Button>
            <Button
              variant={menolak ? "destructive" : "default"}
              disabled={!bolehKirimDialog}
              onClick={() => dialog && ubah(dialog.id, dialog.status, catatan)}
            >
              {sibuk ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {sibuk ? t("saving") : menolak ? t("confirmReject") : t("confirmDone")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
