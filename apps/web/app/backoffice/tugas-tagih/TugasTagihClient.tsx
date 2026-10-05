"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ClipboardCheck, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatIDR } from "@/lib/sales-orders/format";
import { dinamis } from "@/lib/i18n/dinamis";
import { batalkanTugasTagihAction } from "@/app/actions/tugas-tagih";
import type { KeadaanTugas, StatusTugas } from "@/lib/receivables/tugas-tagih";
import type { KeadaanPiutang } from "@/lib/receivables/rules";

/** Satu baris tugas siap tampil; semua tanggal sudah diformat di server. */
export type BarisTugasTampil = {
  id: string;
  storeId: string;
  storeName: string;
  assigneeName: string;
  status: StatusTugas;
  keadaan: KeadaanTugas;
  note: string | null;
  totalSisa: number;
  hilang: number;
  faktur: { id: string; invoiceNo: string; sisa: number; keadaan: KeadaanPiutang }[];
  tenggatTeks: string | null;
  dibuat: { nama: string; tanggal: string };
  penutup: { catatan: string | null; oleh: string | null; otomatis: boolean; tanggal: string } | null;
};

/*
 * Merah hanya untuk yang lewat tenggat — itu satu-satunya yang menuntut kantor
 * bertindak. "Bayar dilaporkan" biru: ada yang sudah bekerja dan sedang menunggu
 * keuangan, bukan kelalaian petugas.
 */
const NADA: Record<KeadaanTugas, StatusTone> = {
  BERJALAN: "waiting",
  TERLAMBAT: "attention",
  DILAPORKAN: "progress",
  LUNAS: "settled",
  SELESAI: "settled",
  DIBATALKAN: "inactive",
};

const SEMUA_PETUGAS = "__semua";

export function TugasTagihClient({
  baris,
  petugas,
  saring,
  bolehMengelola,
}: {
  baris: BarisTugasTampil[];
  petugas: { id: string; nama: string }[];
  saring: { petugas: string; status: StatusTugas | "SEMUA"; terlambat: boolean };
  bolehMengelola: boolean;
}) {
  const t = useTranslations("tugasTagih");
  const td = dinamis(t);
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [batalId, setBatalId] = useState<string | null>(null);
  const [alasan, setAlasan] = useState("");

  const terbuka = baris.filter((b) => b.status === "TERBUKA").length;
  const terlambat = baris.filter((b) => b.keadaan === "TERLAMBAT").length;
  const disaring = saring.petugas !== "" || saring.status !== "TERBUKA" || saring.terlambat;
  const batal = baris.find((b) => b.id === batalId) ?? null;

  /** Saringan hidup di alamat, supaya bisa dibagikan dan bertahan saat dimuat ulang. */
  const ganti = (ubah: Partial<{ petugas: string; status: string; terlambat: boolean }>) => {
    const s = { ...saring, ...ubah };
    const q = new URLSearchParams();
    if (s.petugas) q.set("petugas", s.petugas);
    if (s.status !== "TERBUKA") q.set("status", s.status);
    if (s.terlambat) q.set("terlambat", "1");
    const teks = q.toString();
    router.push(teks ? `${pathname}?${teks}` : pathname);
  };

  const batalkan = () => {
    if (!batalId) return;
    startTransition(async () => {
      const h = await batalkanTugasTagihAction(batalId, alasan);
      if (h.ok) {
        toast.success(t("okCancelled"));
        setBatalId(null);
        setAlasan("");
        router.refresh();
      } else {
        toast.error(td(`err_${h.kode}`));
      }
    });
  };

  const penjelasan = (b: BarisTugasTampil): string | null => {
    if (b.penutup) {
      if (b.status === "DIBATALKAN") return t("cancelledBy", { name: b.penutup.oleh ?? "—", date: b.penutup.tanggal });
      if (b.penutup.otomatis) return t("doneAuto", { date: b.penutup.tanggal });
      return t("doneBy", { name: b.penutup.oleh ?? "—", date: b.penutup.tanggal });
    }
    return b.status === "TERBUKA" ? td(`why_${b.keadaan}`) : null;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("pageTitle")}
        meta={t("summary", { open: terbuka, late: terlambat })}
        actions={
          bolehMengelola ? (
            <Button asChild>
              <Link href="/backoffice/tugas-tagih/baru">
                <Plus className="mr-1.5 h-4 w-4" />
                {t("create")}
              </Link>
            </Button>
          ) : undefined
        }
      />

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("filterLabel")}>
        <Select
          value={saring.petugas || SEMUA_PETUGAS}
          onValueChange={(v) => ganti({ petugas: v === SEMUA_PETUGAS ? "" : v })}
        >
          <SelectTrigger className="w-full sm:w-56" aria-label={t("colAssignee")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SEMUA_PETUGAS}>{t("filterAllAssignees")}</SelectItem>
            {petugas.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.nama}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={saring.status} onValueChange={(v) => ganti({ status: v })}>
          <SelectTrigger className="w-full sm:w-44" aria-label={t("colState")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(["TERBUKA", "SELESAI", "DIBATALKAN", "SEMUA"] as const).map((s) => (
              <SelectItem key={s} value={s}>
                {t(`status_${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant={saring.terlambat ? "default" : "outline"}
          aria-pressed={saring.terlambat}
          onClick={() => ganti({ terlambat: !saring.terlambat })}
        >
          {t("filterLate")}
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ClipboardCheck className="h-4 w-4" />
            {t("cardTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className={baris.length === 0 ? "p-0" : "px-0"}>
          {baris.length === 0 ? (
            disaring ? (
              <EmptyState icon={ClipboardCheck} title={t("emptyFilteredTitle")} description={t("emptyFilteredBody")} />
            ) : (
              <EmptyState
                icon={ClipboardCheck}
                title={t("emptyTitle")}
                description={t("emptyBody")}
                action={
                  bolehMengelola ? (
                    <Button asChild size="sm">
                      <Link href="/backoffice/tugas-tagih/baru">{t("create")}</Link>
                    </Button>
                  ) : undefined
                }
              />
            )
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("colStore")}</TableHead>
                    <TableHead>{t("colAssignee")}</TableHead>
                    <TableHead>{t("colInvoices")}</TableHead>
                    <TableHead className="text-right">{t("colRemaining")}</TableHead>
                    <TableHead>{t("colDue")}</TableHead>
                    <TableHead className="min-w-[16rem]">{t("colState")}</TableHead>
                    {bolehMengelola && <TableHead className="text-right">{t("colAction")}</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {baris.map((b) => {
                    const lewat = b.keadaan === "TERLAMBAT";
                    const jelas = penjelasan(b);
                    return (
                      <TableRow key={b.id} className={cn(lewat && "bg-destructive/[0.06]")}>
                        <TableCell className="min-w-[160px] max-w-[240px] whitespace-normal">
                          <span className="font-medium">{b.storeName}</span>
                          {b.note && <span className="block text-xs text-muted-foreground">{b.note}</span>}
                          <span className="block text-xs text-muted-foreground">
                            {t("createdBy", { name: b.dibuat.nama, date: b.dibuat.tanggal })}
                          </span>
                        </TableCell>
                        <TableCell className="whitespace-normal">{b.assigneeName}</TableCell>
                        <TableCell className="min-w-[140px] whitespace-normal">
                          <span className="text-sm">{t("invoiceCount", { count: b.faktur.length })}</span>
                          <span className="block text-xs text-muted-foreground">
                            {b.faktur.map((f) => f.invoiceNo).join(", ")}
                          </span>
                          {b.hilang > 0 && (
                            <span className="block text-xs text-destructive">
                              {t("missingInvoices", { count: b.hilang })}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">{formatIDR(b.totalSisa)}</TableCell>
                        <TableCell className={cn("whitespace-nowrap", lewat && "font-medium text-destructive")}>
                          {b.tenggatTeks ?? t("noDue")}
                        </TableCell>
                        <TableCell className="min-w-[16rem] max-w-[26rem] whitespace-normal">
                          <StatusPill tone={NADA[b.keadaan]}>{td(`keadaan_${b.keadaan}`)}</StatusPill>
                          {jelas && <span className="mt-1 block text-xs leading-snug text-muted-foreground">{jelas}</span>}
                          {b.penutup?.catatan && (
                            <span className="mt-1 block text-sm leading-snug">{b.penutup.catatan}</span>
                          )}
                        </TableCell>
                        {bolehMengelola && (
                          <TableCell className="text-right">
                            {b.status === "TERBUKA" && (
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={pending}
                                onClick={() => {
                                  setBatalId(b.id);
                                  setAlasan("");
                                }}
                              >
                                {t("cancel")}
                              </Button>
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={batalId !== null} onOpenChange={(buka) => !buka && setBatalId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("cancelTitle")}</DialogTitle>
            <DialogDescription>{t("cancelBody", { name: batal?.assigneeName ?? "—" })}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="tugas-alasan">{t("cancelReason")}</Label>
            <Textarea
              id="tugas-alasan"
              value={alasan}
              onChange={(e) => setAlasan(e.target.value)}
              placeholder={t("cancelPlaceholder")}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="destructive" disabled={pending || alasan.trim().length === 0} onClick={batalkan}>
              {t("cancel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
