"use client";

import Link from "next/link";
import { TAUTAN_DOKUMEN } from "@/app/backoffice/purchase-orders/tautan-dokumen";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronRight, Truck } from "lucide-react";
import type { CanvasserSummary } from "@/lib/canvassing/queries";
import type { AlasanBukanKanvas } from "@/lib/canvassing/kelayakan-kanvas";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Props = {
  /** `bukanKanvas` terisi hanya untuk yang masih memegang stok mobil padahal bukan sales kanvas. */
  canvassers: Array<CanvasserSummary & { bukanKanvas?: AlasanBukanKanvas | null }>;
};

export function CanvassingListClient({ canvassers }: Props) {
  const t = useTranslations("canvassing");
  const router = useRouter();
  const [, startTransition] = useTransition();

  return (
    <div className="space-y-6">
      <PageHeader title={t("pageTitle")} />

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
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {canvassers.map((c) => (
                    <TableRow
                      key={c.id}
                      className="group cursor-pointer hover:bg-muted/50"
                      onClick={() =>
                        startTransition(() => router.push(`/backoffice/canvassing/${c.id}`))
                      }
                    >
                      <TableCell className="font-medium">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            href={`/backoffice/canvassing/${c.id}`}
                            className={TAUTAN_DOKUMEN}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {c.name}
                          </Link>
                          {c.bukanKanvas && (
                            <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-300">
                              {t(`lencanaBukanKanvas.${c.bukanKanvas}`)}
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">{c.email}</div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{c.lineCount}</TableCell>
                      <TableCell className="text-right tabular-nums">{c.totalQty}</TableCell>
                      <TableCell className="w-10 text-right">
                        <ChevronRight
                          className="ml-auto h-4 w-4 text-muted-foreground transition-colors group-hover:text-foreground"
                          aria-hidden
                        />
                      </TableCell>
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
