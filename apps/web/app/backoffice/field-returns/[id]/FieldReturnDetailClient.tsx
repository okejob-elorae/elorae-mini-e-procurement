"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowLeft } from "lucide-react";
import type { FieldReturnDetail, FieldReturnStatus } from "@/lib/field-sales/retur/queries";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Props = {
  fieldReturn: FieldReturnDetail;
};

const STATUS_BADGE_VARIANT: Record<FieldReturnStatus, "secondary" | "destructive"> = {
  PENDING_WAREHOUSE_RECEIVING: "secondary",
  CANCELLED: "destructive",
};

function Field({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

export function FieldReturnDetailClient({ fieldReturn: r }: Props) {
  const t = useTranslations("fieldReturns");

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap justify-between">
        <div className="flex items-center gap-3 flex-wrap">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/backoffice/field-returns">
              <ArrowLeft className="h-4 w-4 mr-2" />
              {t("detail.back")}
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold font-mono">{r.docNo}</h1>
        </div>
        <Badge variant={STATUS_BADGE_VARIANT[r.status]}>{t(`status.${r.status}`)}</Badge>
      </div>

      <Card className="p-4 space-y-2">
        <h2 className="font-semibold">{t("detail.summaryTitle")}</h2>
        <Field label={t("detail.store")} value={r.storeName} />
        <Field label={t("detail.raisedBy")} value={r.raisedByLabel} />
        <Field label={t("detail.raisedAt")} value={formatDateOnlyJakarta(r.createdAt)} />
        <Field label={t("detail.transport")} value={t(`transport.${r.transport}`)} />
        {r.transport === "EXPEDITION" && (
          <>
            <Field label={t("detail.expeditionName")} value={r.expeditionName} />
            <Field label={t("detail.resiNo")} value={r.resiNo} />
          </>
        )}
        <Field label={t("detail.note")} value={r.note} />
      </Card>

      <Card className="p-4 space-y-2">
        <h2 className="font-semibold">{t("detail.notaPhoto")}</h2>
        <div className="overflow-hidden rounded-md border bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element -- external R2-hosted photo, not an optimizable local asset */}
          <img
            src={r.notaPhotoUrl}
            alt={t("detail.notaPhoto")}
            className="max-h-[70vh] w-full object-contain"
          />
        </div>
      </Card>

      <Card className="p-4">
        <h2 className="font-semibold mb-2">{t("detail.linesTitle")}</h2>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("detail.colProduct")}</TableHead>
                <TableHead>{t("detail.colVariant")}</TableHead>
                <TableHead className="text-right">{t("detail.colQty")}</TableHead>
                <TableHead>{t("detail.colReason")}</TableHead>
                <TableHead>{t("detail.colReasonNote")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {r.lines.map((line) => (
                <TableRow key={line.id}>
                  <TableCell>
                    <div>
                      <p className="font-medium">{line.itemName}</p>
                      <p className="text-xs text-muted-foreground font-mono">{line.itemSku}</p>
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-sm">{line.variantSku || "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{line.qty}</TableCell>
                  <TableCell>{t(`reason.${line.reason}`)}</TableCell>
                  <TableCell className="text-muted-foreground">{line.reasonNote || "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
