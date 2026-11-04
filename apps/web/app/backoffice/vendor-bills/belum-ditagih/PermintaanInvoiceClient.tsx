"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Send } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateOnlyJakarta, formatDisplayDate } from "@/lib/date-only";
import { formatIDR } from "@/lib/sales-orders/format";
import type { BarisPermintaanInvoice } from "@/lib/vendor-billing/permintaan-invoice-queries";
import { batalkanPermintaanInvoiceAction } from "@/app/actions/vendor-bill-permintaan";
import { AlasanDialog } from "./AlasanDialog";
import { MintaInvoiceDialog } from "./MintaInvoiceDialog";

/** Tab "Permintaan": permintaan invoice dengan status yang diturunkan dari sumbernya (Q18, P19). */
export function PermintaanInvoiceClient({ baris, canManage, status }: { baris: BarisPermintaanInvoice[]; canManage: boolean; status: "terbuka" | "terlambat" | "selesai" | null }) {
  const t = useTranslations("vendorBills.permintaan");
  const locale = useLocale();
  const router = useRouter();
  const [ulang, setUlang] = useState<BarisPermintaanInvoice | null>(null);
  const [batal, setBatal] = useState<BarisPermintaanInvoice | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {([null, "terbuka", "terlambat", "selesai"] as const).map((s) => (
          <Button key={s ?? "semua"} asChild size="sm" variant={status === s ? "default" : "outline"}>
            <Link replace href={`/backoffice/vendor-bills/belum-ditagih?tab=permintaan${s ? `&status=${s}` : ""}`}>
              {t(`saringan.${s ?? "semua"}`)}
            </Link>
          </Button>
        ))}
      </div>
      <Card className="py-0">
        <CardHeader className="pt-6">
          <CardTitle className="flex items-center gap-2">
            <Send className="h-5 w-5" />
            {t("judulTabel")}
          </CardTitle>
        </CardHeader>
        <CardContent className="pb-6">
          {baris.length === 0 ? (
            <EmptyState icon={Send} title={t("kosong")} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("kolomPemasok")}</TableHead>
                    <TableHead>{t("kolomPenerimaan")}</TableHead>
                    <TableHead>{t("kolomDiminta")}</TableHead>
                    <TableHead>{t("kolomStatus")}</TableHead>
                    <TableHead className="w-[220px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {baris.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="align-top whitespace-normal">
                        <div className="font-medium">{r.supplierName}</div>
                        <div className="text-xs text-muted-foreground">{t(`saluran.${r.channel}`)}</div>
                      </TableCell>
                      <TableCell className="align-top whitespace-normal">
                        <ul className="space-y-0.5 text-sm">
                          {r.lines.map((l) => (
                            <li key={l.id}>
                              {l.label} · {l.qty.toLocaleString("id-ID")} · {l.amountUnknown ? t("sebagianTakTercatat", { nilai: formatIDR(l.amount) }) : formatIDR(l.amount)}{" "}
                              <span className="text-xs text-muted-foreground">({t(`statusBaris.${l.status}`)})</span>
                            </li>
                          ))}
                        </ul>
                        {r.note && <p className="text-xs text-muted-foreground">{r.note}</p>}
                      </TableCell>
                      <TableCell className="align-top whitespace-normal text-sm">
                        {t("dimintaOleh", { tanggal: formatDisplayDate(r.lastRequestedAt, locale), oleh: r.lastRequestedBy })}
                        {r.askCount > 1 && <div className="text-xs text-muted-foreground">{t("kaliDiminta", { count: r.askCount })}</div>}
                      </TableCell>
                      <TableCell className="align-top whitespace-normal">
                        <Badge variant={r.terlambat ? "destructive" : r.status === "TERBUKA" ? "secondary" : "outline"}>
                          {r.terlambat ? t("terlambat") : t(`status.${r.status}`)}
                        </Badge>
                        {r.cancelReason && <div className="text-xs text-muted-foreground">{r.cancelReason}</div>}
                      </TableCell>
                      <TableCell className="align-top">
                        {canManage && r.status === "TERBUKA" && (
                          <div className="flex flex-wrap gap-1">
                            <Button size="sm" variant="outline" onClick={() => setUlang(r)}>
                              {t("mintaUlang")}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setBatal(r)}>
                              {t("batalkan")}
                            </Button>
                            <Button size="sm" variant="ghost" asChild>
                              <Link href={`/backoffice/vendor-bills/new?pemasok=${encodeURIComponent(r.supplierId)}&permintaan=${encodeURIComponent(r.id)}`}>
                                {t("catatInvoice")}
                              </Link>
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {ulang && (
        <MintaInvoiceDialog
          buka
          onTutup={() => setUlang(null)}
          supplierId={ulang.supplierId}
          namaPemasok={ulang.supplierName}
          telepon={ulang.supplierPhone}
          baris={ulang.lines.map((l) => ({ nomor: l.label, keterangan: "", tanggal: "", qty: l.qty, nilaiSen: l.amountUnknown ? null : Math.round(l.amount * 100) }))}
          ulang={{ requestId: ulang.id, tanggal: formatDateOnlyJakarta(new Date(ulang.lastRequestedAt)) }}
        />
      )}
      <AlasanDialog
        buka={batal != null}
        judul={t("batalJudul")}
        isi={t("batalIsi")}
        tombol={t("batalkan")}
        onTutup={() => setBatal(null)}
        onKirim={async (alasan) => {
          if (!batal) return false;
          const r = await batalkanPermintaanInvoiceAction({ requestId: batal.id, alasan });
          if (!r.ok) {
            toast.error(t.has(`galat.${r.kode}`) ? t(`galat.${r.kode}`) : t("galat.GAGAL"));
            return false;
          }
          toast.success(t("dibatalkanToast"));
          router.refresh();
          return true;
        }}
      />
    </div>
  );
}
