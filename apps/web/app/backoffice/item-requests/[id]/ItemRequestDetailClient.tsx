"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowLeft } from "lucide-react";
import type { getRequestDetail } from "@/lib/item-requests/queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Request = NonNullable<Awaited<ReturnType<typeof getRequestDetail>>>;

const day = (d: Date | string) => new Date(d).toLocaleDateString("id-ID");

export function ItemRequestDetailClient({ request }: { request: Request }) {
  const t = useTranslations("itemRequests");

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/backoffice/item-requests">
          <Button variant="ghost" size="icon" aria-label={t("back")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">{request.docNumber}</h1>
          <p className="text-muted-foreground">{request.notes}</p>
        </div>
        <Badge className="ml-auto">{t(`statusLabel.${request.status}`)}</Badge>
      </div>

      <Card>
        <CardContent className="grid gap-4 pt-6 text-sm sm:grid-cols-4">
          <div>
            <p className="text-muted-foreground">{t("colSource")}</p>
            {request.sourceWo ? (
              <Link className="font-medium hover:underline" href={`/backoffice/work-orders/${request.sourceWo.id}`}>
                {request.sourceWo.docNumber}
              </Link>
            ) : (
              <p>-</p>
            )}
          </div>
          <div>
            <p className="text-muted-foreground">{t("colDate")}</p>
            <p>{day(request.createdAt)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">{t("neededBy")}</p>
            <p>{request.neededBy ? day(request.neededBy) : "-"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">{t("createdBy")}</p>
            <p>{request.createdBy.name ?? "-"}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("linesTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("colItem")}</TableHead>
                <TableHead className="text-right">{t("colQty")}</TableHead>
                <TableHead>{t("colUnit")}</TableHead>
                <TableHead>{t("status")}</TableHead>
                <TableHead>PO</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {request.lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>
                    <div>{l.itemName}</div>
                    <div className="text-xs text-muted-foreground">
                      {l.itemSku}
                      {l.variantSku ? ` · ${l.variantSku}` : ""}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">{l.qty.toLocaleString()}</TableCell>
                  <TableCell>{l.uomCode}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{t(`statusLabel.${l.status}`)}</Badge>
                  </TableCell>
                  <TableCell>
                    {l.po ? (
                      <Link className="hover:underline" href={`/backoffice/purchase-orders/${l.po.id}`}>
                        {l.po.docNumber}
                      </Link>
                    ) : (
                      "-"
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
