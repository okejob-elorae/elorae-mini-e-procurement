"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { OpnameDetailReviewTable } from "@/components/inventory/OpnameDetailReviewTable";
import {
  approveOpname,
  cancelOpname,
  getOpnameById,
  submitOpname,
} from "@/app/actions/stock-opname";
import {
  buildItemLines,
  buildRollLines,
  summarizeLines,
} from "@/lib/inventory/opname-detail-utils";
import { hasPermission } from "@/lib/rbac";
import { useSession } from "next-auth/react";

type OpnameDetail = NonNullable<Awaited<ReturnType<typeof getOpnameById>>>;

function formatWhen(value: unknown): string {
  if (!value) return "—";
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold tabular-nums mt-1">{value.toLocaleString()}</p>
      </CardContent>
    </Card>
  );
}

export function StockOpnameDetailClient({ opnameId }: { opnameId: string }) {
  const t = useTranslations("stockOpname");
  const { data: session } = useSession();
  const perms = session?.user?.permissions ?? [];
  const [opname, setOpname] = useState<OpnameDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [driftOpen, setDriftOpen] = useState(false);
  const [driftRows, setDriftRows] = useState<
    Array<{ label: string; snapshotQty: number; currentQty: number }>
  >([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getOpnameById(opnameId);
      setOpname(data);
    } finally {
      setLoading(false);
    }
  }, [opnameId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSubmit = async () => {
    setBusy(true);
    try {
      const r = await submitOpname(opnameId);
      if (!r.success) toast.error(r.error);
      else {
        toast.success(t("submitted"));
        await load();
      }
    } finally {
      setBusy(false);
    }
  };

  const handleApprove = async (confirmDrift = false) => {
    setBusy(true);
    try {
      const r = await approveOpname(opnameId, confirmDrift);
      if (r.driftRows?.length && !confirmDrift) {
        setDriftRows(
          r.driftRows.map((d) => ({
            label: d.label,
            snapshotQty: d.snapshotQty,
            currentQty: d.currentQty,
          })),
        );
        setDriftOpen(true);
        return;
      }
      if (!r.success) {
        toast.error(r.error ?? t("selfApprovalError"));
        return;
      }
      toast.success(t("approved"));
      setDriftOpen(false);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async () => {
    setBusy(true);
    try {
      const r = await cancelOpname(opnameId);
      if (!r.success) toast.error(r.error);
      else {
        toast.success(t("cancelled"));
        await load();
      }
    } finally {
      setBusy(false);
    }
  };

  const isFabric = opname?.scope === "FABRIC";

  const lines = useMemo(() => {
    if (!opname) return [];
    if (isFabric && Array.isArray(opname.rolls)) {
      return buildRollLines(
        opname.rolls as Array<{
          id: string;
          rollCode: string;
          itemName: string;
          snapshotLength: number;
          countedLength?: number | null;
          variance?: number | null;
        }>,
      );
    }
    if (Array.isArray(opname.items)) {
      return buildItemLines(
        opname.items as Array<{
          id: string;
          itemName: string;
          variantSku?: string | null;
          snapshotQty: number;
          countedQty?: number | null;
          variance?: number | null;
          hadDriftWarning?: boolean;
        }>,
      );
    }
    return [];
  }, [isFabric, opname]);

  const summary = useMemo(() => summarizeLines(lines), [lines]);

  if (loading || !opname) {
    return <p className="text-muted-foreground py-8">{loading ? "Loading..." : "Not found"}</p>;
  }

  const status = String(opname.status);
  const scope = String(opname.scope);
  const canCount = hasPermission(perms, "inventory_opname:count");
  const canApprove = hasPermission(perms, "inventory_opname:approve");
  const countProgress =
    summary.totalLines > 0
      ? Math.round((summary.countedLines / summary.totalLines) * 100)
      : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="space-y-2">
          <Link
            href="/backoffice/inventory/stock-opname"
            className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4 mr-1" />
            {t("backToList")}
          </Link>
          <div>
            <h1 className="text-2xl font-bold">{String(opname.docNumber)}</h1>
            <p className="text-muted-foreground text-sm mt-1">{t("detailSubtitle")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge>{t(`scopes.${scope}`)}</Badge>
            <Badge variant="secondary">{t(`statuses.${status}`)}</Badge>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canCount && (status === "CREATED" || status === "COUNTING") && (
            <Link href={`/backoffice/inventory/stock-opname/${opnameId}/count`}>
              <Button variant="outline">{t("count")}</Button>
            </Link>
          )}
          {canCount && (status === "COUNTING" || status === "CREATED") && (
            <Button onClick={handleSubmit} disabled={busy}>
              {t("submit")}
            </Button>
          )}
          {canApprove && status === "SUBMITTED" && (
            <Button onClick={() => handleApprove(false)} disabled={busy}>
              {t("approve")}
            </Button>
          )}
          {(canApprove || canCount) && status !== "APPROVED" && status !== "CANCELLED" && (
            <Button variant="destructive" onClick={handleCancel} disabled={busy}>
              {t("cancel")}
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t("statTotal")} value={summary.totalLines} />
        <StatCard label={t("statCounted")} value={summary.countedLines} />
        <StatCard label={t("statPending")} value={summary.pendingLines} />
        <StatCard label={t("statVariance")} value={summary.varianceLines} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("progress")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">{t("countProgress")}</span>
            <span className="font-medium tabular-nums">
              {summary.countedLines} / {summary.totalLines} ({countProgress}%)
            </span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${countProgress}%` }}
            />
          </div>
          {status === "SUBMITTED" && summary.varianceLines > 0 ? (
            <p className="text-sm text-amber-700">{t("varianceReviewHint")}</p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("sessionInfo")}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 sm:grid-cols-2 text-sm">
            <div>
              <dt className="text-muted-foreground">{t("snapshotAt")}</dt>
              <dd className="font-medium">{formatWhen(opname.snapshotAt)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("created")}</dt>
              <dd className="font-medium">
                {formatWhen(opname.createdAt)}
                {opname.createdByName ? ` · ${String(opname.createdByName)}` : ""}
              </dd>
            </div>
            {opname.assignedToName ? (
              <div>
                <dt className="text-muted-foreground">{t("assignedTo")}</dt>
                <dd className="font-medium">{String(opname.assignedToName)}</dd>
              </div>
            ) : null}
            {opname.submittedAt ? (
              <div>
                <dt className="text-muted-foreground">{t("submittedAt")}</dt>
                <dd className="font-medium">
                  {formatWhen(opname.submittedAt)}
                  {opname.submittedByName ? ` · ${String(opname.submittedByName)}` : ""}
                </dd>
              </div>
            ) : null}
            {opname.approvedAt ? (
              <div>
                <dt className="text-muted-foreground">{t("approvedAt")}</dt>
                <dd className="font-medium">
                  {formatWhen(opname.approvedAt)}
                  {opname.approvedByName ? ` · ${String(opname.approvedByName)}` : ""}
                </dd>
              </div>
            ) : null}
            {opname.cancelledAt ? (
              <div>
                <dt className="text-muted-foreground">{t("cancelledAt")}</dt>
                <dd className="font-medium">{formatWhen(opname.cancelledAt)}</dd>
              </div>
            ) : null}
          </dl>
          {opname.notes ? (
            <div className="mt-4 pt-4 border-t">
              <p className="text-sm text-muted-foreground">{t("notes")}</p>
              <p className="text-sm mt-1">{String(opname.notes)}</p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <OpnameDetailReviewTable lines={lines} isFabric={isFabric} />

      <Dialog open={driftOpen} onOpenChange={setDriftOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("driftTitle")}</DialogTitle>
            <DialogDescription>{t("driftMessage")}</DialogDescription>
          </DialogHeader>
          <ul className="text-sm space-y-2 max-h-60 overflow-auto">
            {driftRows.map((d, i) => (
              <li key={i}>
                <strong>{d.label}</strong>: snapshot {d.snapshotQty} → current {d.currentQty}
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDriftOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => handleApprove(true)} disabled={busy}>
              Confirm & Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
