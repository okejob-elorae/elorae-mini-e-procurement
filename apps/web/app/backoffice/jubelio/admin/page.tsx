"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import {
  getJubelioApiCalls,
  getJubelioApiCallStats,
} from "@/app/actions/jubelio-api-calls";
import {
  getJubelioWebhookEvents,
  getJubelioWebhookStats,
  retryJubelioWebhookEvent,
} from "@/app/actions/jubelio-webhooks";
import {
  bulkPushAllStockToJubelio,
  countBulkStockPushItems,
  getJubelioOutboxRows,
  getJubelioOutboxStats,
  retryJubelioOutboxRow,
} from "@/app/actions/jubelio-outbox";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import { formatDisplayDateTime } from "@/lib/date-only";
import { mulaiProses, selesaiProses } from "@/lib/pulau/pulau";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { PageHeader } from "@/components/ui/page-header";
import { ChevronDown, ChevronRight, Loader2, RefreshCw, UploadCloud } from "lucide-react";
import { Pager } from "@/components/Pager";

type CallsResult = Awaited<ReturnType<typeof getJubelioApiCalls>>;
type CallRow = CallsResult["calls"][number];
type Stats = Awaited<ReturnType<typeof getJubelioApiCallStats>>;

type WebhookCalls = Awaited<ReturnType<typeof getJubelioWebhookEvents>>;
type WebhookRow = WebhookCalls["events"][number];
type WebhookStats = Awaited<ReturnType<typeof getJubelioWebhookStats>>;

type OutboxRows = Awaited<ReturnType<typeof getJubelioOutboxRows>>;
type OutboxRow = OutboxRows["rows"][number];
type OutboxStats = Awaited<ReturnType<typeof getJubelioOutboxStats>>;

function statusVariant(call: CallRow): "default" | "secondary" | "destructive" {
  if (!call.ok) return "destructive";
  if (call.rateLimited) return "secondary";
  return "default";
}

type WebhookStatus = "RECEIVED" | "PROCESSING" | "PROCESSED" | "SKIPPED" | "DEAD";
type OutboxStatus = "PENDING" | "PROCESSING" | "DONE" | "SKIPPED" | "DEAD";

export default function JubelioAdminPage() {
  const t = useTranslations("jubelio.admin");
  const tPulau = useTranslations("pulau.proses");
  const locale = useLocale();
  const { status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();

  const updateUrl = useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams?.toString() ?? "");
      for (const [k, v] of Object.entries(updates)) {
        if (v === null || v === "") next.delete(k);
        else next.set(k, v);
      }
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [searchParams, pathname, router],
  );

  const readNum = (key: string, fallback: number) => {
    const raw = searchParams?.get(key);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  const readStr = <T extends string>(
    key: string,
    allowed: readonly T[],
    fallback: T,
  ): T => {
    const raw = searchParams?.get(key);
    return raw && (allowed as readonly string[]).includes(raw)
      ? (raw as T)
      : fallback;
  };

  const callsPage = readNum("callsPage", 1);
  const callsSize = readNum("callsSize", 10);
  const callsFilter = readStr(
    "callsFilter",
    ["all", "errors"] as const,
    "all",
  );

  const whPage = readNum("whPage", 1);
  const whSize = readNum("whSize", 10);
  const whFilter = readStr(
    "whFilter",
    ["all", "errors", "DEAD"] as const,
    "all",
  );

  const outboxPage = readNum("outboxPage", 1);
  const outboxSize = readNum("outboxSize", 10);
  const outboxFilter = readStr(
    "outboxFilter",
    ["all", "errors", "DEAD"] as const,
    "all",
  );

  const [calls, setCalls] = useState<CallRow[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<Stats>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [whEvents, setWhEvents] = useState<WebhookRow[]>([]);
  const [whTotal, setWhTotal] = useState(0);
  const [whStats, setWhStats] = useState<WebhookStats>(null);
  const [expandedWebhookId, setExpandedWebhookId] = useState<string | null>(null);
  const [outboxRows, setOutboxRows] = useState<OutboxRow[]>([]);
  const [outboxTotal, setOutboxTotal] = useState(0);
  const [outboxStats, setOutboxStats] = useState<OutboxStats>(null);
  const [expandedOutboxId, setExpandedOutboxId] = useState<string | null>(null);
  const [bulkPushing, setBulkPushing] = useState(false);
  // Dialog kirim massal: null = jumlah barang masih dihitung.
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  const [bulkCount, setBulkCount] = useState<number | null>(null);
  const [retryOutboxRow, setRetryOutboxRow] = useState<OutboxRow | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const offset = (callsPage - 1) * callsSize;
      const [callsRes, statsRes] = await Promise.all([
        getJubelioApiCalls({
          limit: callsSize,
          offset,
          onlyErrors: callsFilter === "errors",
        }),
        getJubelioApiCallStats(),
      ]);
      setCalls(callsRes.calls);
      setTotal(callsRes.total);
      setStats(statsRes);
    } finally {
      setIsLoading(false);
    }
  }, [callsPage, callsSize, callsFilter]);

  const loadWebhooks = useCallback(async () => {
    const statusFilter =
      whFilter === "DEAD"
        ? ("DEAD" as const)
        : whFilter === "errors"
          ? (["DEAD", "SKIPPED"] as ("RECEIVED" | "PROCESSING" | "PROCESSED" | "SKIPPED" | "DEAD")[])
          : undefined;
    const offset = (whPage - 1) * whSize;
    const [eventsRes, statsRes] = await Promise.all([
      getJubelioWebhookEvents({ limit: whSize, offset, status: statusFilter }),
      getJubelioWebhookStats(),
    ]);
    setWhEvents(eventsRes.events);
    setWhTotal(eventsRes.total);
    setWhStats(statsRes);
  }, [whPage, whSize, whFilter]);

  const loadOutbox = useCallback(async () => {
    const statusFilter =
      outboxFilter === "DEAD"
        ? ("DEAD" as const)
        : outboxFilter === "errors"
          ? (["DEAD", "SKIPPED"] as ("PENDING" | "PROCESSING" | "DONE" | "SKIPPED" | "DEAD")[])
          : undefined;
    const offset = (outboxPage - 1) * outboxSize;
    const [rowsRes, statsRes] = await Promise.all([
      getJubelioOutboxRows({ limit: outboxSize, offset, status: statusFilter }),
      getJubelioOutboxStats(),
    ]);
    setOutboxRows(rowsRes.rows);
    setOutboxTotal(rowsRes.total);
    setOutboxStats(statsRes);
  }, [outboxPage, outboxSize, outboxFilter]);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login");
      return;
    }
    if (status === "authenticated") void load();
  }, [status, load, router]);

  useEffect(() => {
    if (status === "authenticated") void loadWebhooks();
  }, [status, loadWebhooks]);

  useEffect(() => {
    if (status === "authenticated") void loadOutbox();
  }, [status, loadOutbox]);

  const handleRetry = async (id: string) => {
    const result = await retryJubelioWebhookEvent(id);
    if (result.ok) {
      toast.success(t("webhookRetryOk"));
      void loadWebhooks();
    } else {
      toast.error(t("retryNotAllowed"));
    }
  };

  const openBulkDialog = async () => {
    setBulkCount(null);
    setBulkDialogOpen(true);
    const r = await countBulkStockPushItems();
    if (!r.ok) {
      setBulkDialogOpen(false);
      toast.error(t("bulkPushFailed"));
      return;
    }
    setBulkCount(r.count);
  };

  const handleBulkPush = async () => {
    setBulkDialogOpen(false);
    setBulkPushing(true);
    // Pulau status: tanpa persen — servernya mengantrekan sekaligus, tidak melapor kemajuan.
    mulaiProses("jubelio-push-stok", tPulau("pushStokJubelio"));
    try {
      const r = await bulkPushAllStockToJubelio();
      if (r.ok) toast.success(t("bulkPushOk", { count: r.count }));
      else toast.error(t("bulkPushFailed"));
      void loadOutbox();
    } finally {
      selesaiProses("jubelio-push-stok");
      setBulkPushing(false);
    }
  };

  const handleOutboxRetry = async (id: string) => {
    setRetryOutboxRow(null);
    const r = await retryJubelioOutboxRow(id);
    if (r.ok) {
      toast.success(t("outboxRetryOk"));
      void loadOutbox();
    } else {
      toast.error(t("retryNotAllowed"));
    }
  };

  if (status === "loading") {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const errorRate =
    stats && stats.total > 0
      ? Math.round((stats.errors / stats.total) * 100)
      : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              {t("refresh")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void openBulkDialog()}
              disabled={bulkPushing}
            >
              {bulkPushing ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <UploadCloud className="mr-1.5 h-3.5 w-3.5" />
              )}
              {bulkPushing ? t("bulkPushQueuing") : t("bulkPushButton")}
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <div className="text-sm text-muted-foreground">
              {t("kpiTotal", { hours: stats?.windowHours ?? 24 })}
            </div>
            <div className="text-3xl font-bold">{stats?.total ?? 0}</div>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <div className="text-sm text-muted-foreground">{t("kpiErrorRate")}</div>
            <div className="text-3xl font-bold">
              {errorRate}%
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {t("kpiFailed", { count: stats?.errors ?? 0 })}
              </span>
            </div>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <div className="text-sm text-muted-foreground">{t("kpiRateLimited")}</div>
            <div className="text-3xl font-bold">{stats?.rateLimited ?? 0}</div>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <div className="text-sm text-muted-foreground">{t("kpiLatency")}</div>
            <div className="text-3xl font-bold">{stats?.avgLatencyMs ?? 0}ms</div>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>{t("recentCalls")}</CardTitle>
            <Button
              variant={callsFilter === "errors" ? "default" : "outline"}
              size="sm"
              onClick={() =>
                updateUrl({
                  callsFilter: callsFilter === "errors" ? null : "errors",
                  callsPage: "1",
                })
              }
            >
              {callsFilter === "errors" ? t("showingErrorsOnly") : t("showErrorsOnly")}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("col.time")}</TableHead>
                      <TableHead>{t("col.method")}</TableHead>
                      <TableHead>{t("col.path")}</TableHead>
                      <TableHead className="text-right">{t("col.status")}</TableHead>
                      <TableHead className="text-right">{t("col.latency")}</TableHead>
                      <TableHead>{t("col.flags")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {calls.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={6}
                          className="py-8 text-center text-muted-foreground"
                        >
                          {t("emptyCalls")}
                        </TableCell>
                      </TableRow>
                    ) : (
                      calls.map((call) => (
                        <TableRow key={call.id}>
                          <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                            {formatDisplayDateTime(call.createdAt, locale)}
                          </TableCell>
                          <TableCell className="font-mono text-xs">{call.method}</TableCell>
                          <TableCell className="max-w-[280px] truncate font-mono text-xs">
                            {call.path}
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge variant={statusVariant(call)}>
                              {call.statusCode ?? "ERR"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right text-sm tabular-nums">
                            {call.latencyMs}ms
                          </TableCell>
                          <TableCell className="min-w-[180px] whitespace-normal">
                            {call.rateLimited && (
                              <Badge variant="secondary" className="mr-1">
                                429
                              </Badge>
                            )}
                            {!call.ok && call.errorMessage && (
                              <span
                                className="text-xs text-destructive"
                                title={call.errorMessage}
                              >
                                {call.errorMessage.slice(0, 40)}
                                {call.errorMessage.length > 40 ? "…" : ""}
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
              <Pager
                page={callsPage}
                pageSize={callsSize}
                total={total}
                onPageChange={(p) => updateUrl({ callsPage: String(p) })}
                onPageSizeChange={(s) =>
                  updateUrl({ callsSize: String(s), callsPage: "1" })
                }
              />
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {(["RECEIVED", "PROCESSING", "PROCESSED", "SKIPPED", "DEAD"] as const).map((s) => (
          <Card key={s}>
            <CardHeader className="pb-2">
              <StatusTileLabel label={t(`status.${s}`)} code={s} />
              <div className="text-2xl font-bold">{whStats?.byStatus?.[s] ?? 0}</div>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>{t("webhookEvents")}</CardTitle>
            <div className="flex flex-wrap gap-2" role="group" aria-label={t("filterLabel")}>
              {(["all", "errors", "DEAD"] as const).map((f) => (
                <Button
                  key={f}
                  size="sm"
                  variant={whFilter === f ? "default" : "outline"}
                  onClick={() => updateUrl({ whFilter: f === "all" ? null : f, whPage: "1" })}
                >
                  {t(`filter.${f}`)}
                </Button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">
                      <span className="sr-only">{t("col.details")}</span>
                    </TableHead>
                    <TableHead>{t("col.time")}</TableHead>
                    <TableHead>{t("col.event")}</TableHead>
                    <TableHead>{t("col.status")}</TableHead>
                    <TableHead className="text-right">{t("col.attempts")}</TableHead>
                    <TableHead>{t("col.reason")}</TableHead>
                    <TableHead className="sticky right-0 bg-card text-right">{t("col.action")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {whEvents.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={7}
                        className="py-8 text-center text-muted-foreground"
                      >
                        {t("emptyWebhooks")}
                      </TableCell>
                    </TableRow>
                  ) : (
                    whEvents.map((e) => {
                      const isExpanded = expandedWebhookId === e.id;
                      return (
                        <React.Fragment key={e.id}>
                          <TableRow>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() =>
                                  setExpandedWebhookId(isExpanded ? null : e.id)
                                }
                                aria-expanded={isExpanded}
                                aria-label={isExpanded ? t("hideDetails") : t("showDetails")}
                                title={isExpanded ? t("hideDetails") : t("showDetails")}
                              >
                                {isExpanded ? (
                                  <ChevronDown className="h-4 w-4" />
                                ) : (
                                  <ChevronRight className="h-4 w-4" />
                                )}
                              </Button>
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                              {formatDisplayDateTime(e.receivedAt, locale)}
                            </TableCell>
                            <TableCell className="text-sm" title={e.event}>
                              {t.has(`event.${e.event}`) ? t(`event.${e.event}`) : e.event}
                            </TableCell>
                            <TableCell>
                              <Badge
                                title={e.status}
                                variant={
                                  e.status === "DEAD"
                                    ? "destructive"
                                    : e.status === "SKIPPED"
                                      ? "secondary"
                                      : "default"
                                }
                              >
                                {t(`status.${e.status as WebhookStatus}`)}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right text-sm tabular-nums">
                              {e.attempts}
                            </TableCell>
                            <TableCell className="min-w-[200px] max-w-[320px] whitespace-normal break-words text-xs">
                              {e.skipReason ?? e.lastError?.slice(0, 60) ?? "—"}
                            </TableCell>
                            <TableCell className="sticky right-0 bg-card text-right">
                              {(e.status === "DEAD" || e.status === "SKIPPED") && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => void handleRetry(e.id)}
                                >
                                  {t("retry")}
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                          {isExpanded && (
                            <TableRow key={`${e.id}-detail`}>
                              <TableCell colSpan={7} className="bg-muted/50">
                                <div className="p-4 space-y-2 text-sm">
                                  <p>
                                    <span className="font-medium">{t("detail.signature")}:</span>{" "}
                                    <span className="font-mono text-xs break-all">
                                      {e.signature ?? "—"}
                                    </span>
                                  </p>
                                  <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                                    <p>
                                      <span className="font-medium">{t("detail.receivedAt")}:</span>{" "}
                                      {formatDisplayDateTime(e.receivedAt, locale)}
                                    </p>
                                    <p>
                                      <span className="font-medium">{t("detail.processedAt")}:</span>{" "}
                                      {formatDisplayDateTime(e.processedAt, locale)}
                                    </p>
                                    <p>
                                      <span className="font-medium">{t("detail.deadAt")}:</span>{" "}
                                      {formatDisplayDateTime(e.deadAt, locale)}
                                    </p>
                                    <p>
                                      <span className="font-medium">{t("detail.lastEnqueuedAt")}:</span>{" "}
                                      {formatDisplayDateTime(e.lastEnqueuedAt, locale)}
                                    </p>
                                  </div>
                                  {e.lastError && (
                                    <div>
                                      <p className="font-medium">{t("detail.lastError")}:</p>
                                      <pre className="bg-background p-3 rounded text-xs overflow-auto max-h-32 whitespace-pre-wrap break-all">
                                        {e.lastError}
                                      </pre>
                                    </div>
                                  )}
                                  <div>
                                    <p className="font-medium">{t("detail.rawPayload")}:</p>
                                    <pre className="bg-background p-3 rounded text-xs overflow-auto max-h-64">
                                      {JSON.stringify(e.rawPayload, null, 2)}
                                    </pre>
                                  </div>
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </React.Fragment>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
            <Pager
              page={whPage}
              pageSize={whSize}
              total={whTotal}
              onPageChange={(p) => updateUrl({ whPage: String(p) })}
              onPageSizeChange={(s) =>
                updateUrl({ whSize: String(s), whPage: "1" })
              }
            />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {(["PENDING", "PROCESSING", "DONE", "SKIPPED", "DEAD"] as const).map((s) => (
          <Card key={s}>
            <CardHeader className="pb-2">
              <StatusTileLabel label={t(`status.${s}`)} code={s} />
              <div className="text-2xl font-bold">{outboxStats?.byStatus?.[s] ?? 0}</div>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>{t("outboxEvents")}</CardTitle>
            <div className="flex flex-wrap gap-2" role="group" aria-label={t("filterLabel")}>
              {(["all", "errors", "DEAD"] as const).map((f) => (
                <Button
                  key={f}
                  size="sm"
                  variant={outboxFilter === f ? "default" : "outline"}
                  onClick={() =>
                    updateUrl({ outboxFilter: f === "all" ? null : f, outboxPage: "1" })
                  }
                >
                  {t(`filter.${f}`)}
                </Button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">
                      <span className="sr-only">{t("col.details")}</span>
                    </TableHead>
                    <TableHead>{t("col.time")}</TableHead>
                    <TableHead>{t("col.entity")}</TableHead>
                    <TableHead>{t("col.status")}</TableHead>
                    <TableHead className="text-right">{t("col.attempts")}</TableHead>
                    <TableHead>{t("col.reason")}</TableHead>
                    <TableHead className="sticky right-0 bg-card text-right">{t("col.action")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {outboxRows.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={7}
                        className="py-8 text-center text-muted-foreground"
                      >
                        {t("emptyOutbox")}
                      </TableCell>
                    </TableRow>
                  ) : (
                    outboxRows.map((r) => {
                      const expanded = expandedOutboxId === r.id;
                      const enqueuedByLabel =
                        r.enqueuedBy?.name ?? r.enqueuedBy?.email ?? "—";
                      return (
                        <React.Fragment key={r.id}>
                          <TableRow>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() =>
                                  setExpandedOutboxId(expanded ? null : r.id)
                                }
                                aria-expanded={expanded}
                                aria-label={expanded ? t("hideDetails") : t("showDetails")}
                                title={expanded ? t("hideDetails") : t("showDetails")}
                              >
                                {expanded ? (
                                  <ChevronDown className="h-4 w-4" />
                                ) : (
                                  <ChevronRight className="h-4 w-4" />
                                )}
                              </Button>
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                              {formatDisplayDateTime(r.createdAt, locale)}
                            </TableCell>
                            <TableCell className="text-sm" title={`${r.entityType}:${r.entityId}`}>
                              {t.has(`entity.${r.entityType}`)
                                ? t(`entity.${r.entityType}`)
                                : r.entityType}
                            </TableCell>
                            <TableCell>
                              <Badge
                                title={r.status}
                                variant={
                                  r.status === "DEAD"
                                    ? "destructive"
                                    : r.status === "SKIPPED"
                                      ? "secondary"
                                      : "default"
                                }
                              >
                                {t(`status.${r.status as OutboxStatus}`)}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right text-sm tabular-nums">
                              {r.attempts}
                            </TableCell>
                            <TableCell className="min-w-[200px] max-w-[320px] whitespace-normal break-words text-xs">
                              {r.skipReason ?? r.lastError?.slice(0, 60) ?? "—"}
                            </TableCell>
                            <TableCell className="sticky right-0 bg-card text-right">
                              {(r.status === "DEAD" || r.status === "SKIPPED") && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setRetryOutboxRow(r)}
                                >
                                  {t("retry")}
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                          {expanded && (
                            <TableRow key={`${r.id}-detail`}>
                              <TableCell colSpan={7} className="bg-muted/50">
                                <div className="space-y-2 p-4 text-sm">
                                  <p>
                                    <span className="font-medium">{t("detail.enqueuedBy")}:</span>{" "}
                                    {enqueuedByLabel}
                                  </p>
                                  <p>
                                    <span className="font-medium">{t("detail.createdAt")}:</span>{" "}
                                    {formatDisplayDateTime(r.createdAt, locale)}
                                  </p>
                                  <p>
                                    <span className="font-medium">{t("detail.lastEnqueuedAt")}:</span>{" "}
                                    {formatDisplayDateTime(r.lastEnqueuedAt, locale)}
                                  </p>
                                  <p>
                                    <span className="font-medium">{t("detail.processedAt")}:</span>{" "}
                                    {formatDisplayDateTime(r.processedAt, locale)}
                                  </p>
                                  <p>
                                    <span className="font-medium">{t("detail.deadAt")}:</span>{" "}
                                    {formatDisplayDateTime(r.deadAt, locale)}
                                  </p>
                                  {r.lastError && (
                                    <pre className="bg-background max-h-32 overflow-auto rounded p-3 text-xs">
                                      {r.lastError}
                                    </pre>
                                  )}
                                  <pre className="bg-background max-h-64 overflow-auto rounded p-3 text-xs">
                                    {JSON.stringify(r.payload, null, 2)}
                                  </pre>
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </React.Fragment>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
            <Pager
              page={outboxPage}
              pageSize={outboxSize}
              total={outboxTotal}
              onPageChange={(p) => updateUrl({ outboxPage: String(p) })}
              onPageSizeChange={(s) =>
                updateUrl({ outboxSize: String(s), outboxPage: "1" })
              }
            />
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={bulkDialogOpen} onOpenChange={setBulkDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {bulkCount === null
                ? t("bulkPushTitle")
                : t("bulkPushDialogTitle", { count: bulkCount })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {bulkCount === null
                ? t("bulkPushCounting")
                : bulkCount === 0
                  ? t("bulkPushNone")
                  : t("bulkPushBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={!bulkCount}
              onClick={(ev) => {
                ev.preventDefault();
                void handleBulkPush();
              }}
            >
              {t("bulkPushDialogAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={retryOutboxRow !== null}
        onOpenChange={(open) => {
          if (!open) setRetryOutboxRow(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("outboxRetryTitle", {
                entity:
                  retryOutboxRow && t.has(`entity.${retryOutboxRow.entityType}`)
                    ? t(`entity.${retryOutboxRow.entityType}`)
                    : (retryOutboxRow?.entityType ?? ""),
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t("outboxRetryConfirm")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(ev) => {
                ev.preventDefault();
                if (retryOutboxRow) void handleOutboxRetry(retryOutboxRow.id);
              }}
            >
              {t("outboxRetryAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Label Indonesia saja; nama status teknisnya hanya di tooltip. */
function StatusTileLabel({ label, code }: { label: string; code: string }) {
  return (
    <div className="text-sm text-muted-foreground" title={code}>
      {label}
    </div>
  );
}
