"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ExternalLink, Loader2, UploadCloud } from "lucide-react";
import {
  enqueueBulkMigration,
  type EligibleItem,
  type MigrationSummary,
} from "@/app/actions/jubelio-bulk-migration";

type Props = {
  initialItems: EligibleItem[];
  initialSummary: MigrationSummary;
};

export function MigrationClient({ initialItems, initialSummary }: Props) {
  const [items, setItems] = useState<EligibleItem[]>(initialItems);
  const [summary] = useState<MigrationSummary>(initialSummary);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === items.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(items.map((it) => it.id)));
    }
  };

  const handleConfirm = () => {
    startTransition(async () => {
      try {
        const ids = Array.from(selected);
        const result = await enqueueBulkMigration(ids);
        toast.success(`Queued ${result.enqueued} item(s). Worker drains over ~5 min.`);
        setItems((prev) => prev.filter((it) => !selected.has(it.id)));
        setSelected(new Set());
        setConfirmOpen(false);
      } catch (err) {
        toast.error((err as Error).message);
        setConfirmOpen(false);
      }
    });
  };

  const allSelected = items.length > 0 && selected.size === items.length;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Bulk migration</CardTitle>
          <CardDescription>
            Push ERP-source FINISHED_GOOD items to Jubelio in bulk. Only items without an
            existing Jubelio mapping are shown. Worker drains queued rows over time —
            watch progress on the{" "}
            <Link href="/backoffice/jubelio/admin" className="underline">
              outbox dashboard
            </Link>
            .
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <SummaryStat label="Done (24h)" value={summary.done} />
        <SummaryStat label="Pending" value={summary.pending} />
        <SummaryStat label="Processing" value={summary.processing} />
        <SummaryStat label="Skipped" value={summary.skipped} />
        <SummaryStat label="Dead" value={summary.dead} />
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Eligible items</CardTitle>
              <CardDescription>{items.length} candidate(s)</CardDescription>
            </div>
            <Button
              variant="destructive"
              disabled={selected.size === 0 || isPending}
              onClick={() => setConfirmOpen(true)}
            >
              <UploadCloud className="mr-2 h-4 w-4" />
              Migrate {selected.size} selected
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No items to migrate. All ERP-source finished goods are already mapped.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">
                      <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="Select all" />
                    </TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Variants</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((it) => (
                    <TableRow key={it.id}>
                      <TableCell>
                        <Checkbox
                          checked={selected.has(it.id)}
                          onCheckedChange={() => toggle(it.id)}
                          aria-label={`Select ${it.sku}`}
                        />
                      </TableCell>
                      <TableCell className="font-mono text-xs">{it.sku}</TableCell>
                      <TableCell>{it.nameEn || it.nameId}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {it.categoryName ?? "—"}
                      </TableCell>
                      <TableCell className="text-right">{it.variantCount}</TableCell>
                      <TableCell>
                        {it.hasJubelioCategoryMapping ? (
                          <Badge variant="default">Ready</Badge>
                        ) : (
                          <Badge variant="secondary" title="Category lacks Jubelio mapping — will SKIP">
                            Category unmapped
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
        <CardContent className="flex items-center justify-between border-t pt-4 text-xs text-muted-foreground">
          <span>
            Window since {new Date(summary.windowStart).toLocaleString()} — total {summary.total}
          </span>
          <Link href="/backoffice/jubelio/admin" className="inline-flex items-center gap-1 underline">
            Open outbox dashboard
            <ExternalLink className="h-3 w-3" />
          </Link>
        </CardContent>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Push {selected.size} item(s) to Jubelio?</AlertDialogTitle>
            <AlertDialogDescription>
              This creates real product listings on the production Jubelio account. Items
              with unmapped categories will SKIP — fix them on{" "}
              <Link href="/backoffice/jubelio/categories" className="underline">
                /backoffice/jubelio/categories
              </Link>{" "}
              first to avoid SKIP rows. Rollback for individual items is available on the{" "}
              <Link href="/backoffice/jubelio/settings" className="underline">
                Jubelio settings
              </Link>{" "}
              page (Test cleanup card).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm} disabled={isPending}>
              {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Confirm migrate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-3xl tabular-nums">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}
