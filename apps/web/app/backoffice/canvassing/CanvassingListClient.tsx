"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Truck } from "lucide-react";
import type { CanvasserSummary } from "@/lib/canvassing/queries";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Props = {
  canvassers: CanvasserSummary[];
};

export function CanvassingListClient({ canvassers }: Props) {
  const t = useTranslations("canvassing");
  const router = useRouter();
  const [, startTransition] = useTransition();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("pageTitle")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Truck className="h-5 w-5" />
            {t("listCardTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {canvassers.length === 0 ? (
            <div className="text-center py-12">
              <Truck className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">{t("emptyCanvassers")}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("colCanvasser")}</TableHead>
                    <TableHead className="text-right">{t("colLines")}</TableHead>
                    <TableHead className="text-right">{t("colTotalQty")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {canvassers.map((c) => (
                    <TableRow
                      key={c.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() =>
                        startTransition(() => router.push(`/backoffice/canvassing/${c.id}`))
                      }
                    >
                      <TableCell className="font-medium">
                        <div>{c.name}</div>
                        <div className="text-xs text-muted-foreground">{c.email}</div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{c.lineCount}</TableCell>
                      <TableCell className="text-right tabular-nums">{c.totalQty}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
