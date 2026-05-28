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
  getJubelioOutboxRows,
  getJubelioOutboxStats,
  retryJubelioOutboxRow,
} from "@/app/actions/jubelio-outbox";
import { toast } from "sonner";
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
import { ChevronDown, ChevronRight, Loader2, RefreshCw } from "lucide-react";
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

export default function JubelioAdminPage() {
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
      toast.success("Re-queued. Sweeper picks up within 10 min.");
      void loadWebhooks();
    } else {
      toast.error("Retry not allowed (status must be DEAD or SKIPPED).");
    }
  };

  const handleBulkPush = async () => {
    if (!confirm("Push stock for all mapped items to Jubelio?")) return;
    setBulkPushing(true);
    try {
      const r = await bulkPushAllStockToJubelio();
      if (r.ok) toast.success(`Queued ${r.count} items. Pushes drain over the next few minutes.`);
      else toast.error("Bulk push failed (admin only).");
      void loadOutbox();
    } finally {
      setBulkPushing(false);
    }
  };

  const handleOutboxRetry = async (id: string) => {
    if (!confirm("Re-queue this row? Worker will re-push to Jubelio.")) return;
    const r = await retryJubelioOutboxRow(id);
    if (r.ok) {
      toast.success("Re-queued. Poller picks up within ~5 seconds.");
      void loadOutbox();
    } else {
      toast.error("Retry not allowed (status must be DEAD or SKIPPED).");
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
      <Card>
        <CardContent className="flex items-center justify-between gap-4 pt-6">
          <div>
            <p className="font-medium">Bulk push stock to Jubelio</p>
            <p className="text-sm text-muted-foreground">
              Creates one outbox row per mapped item. Worker drains within minutes.
            </p>
          </div>
          <Button onClick={() => void handleBulkPush()} disabled={bulkPushing}>
            {bulkPushing ? "Queuing…" : "Sync all stock"}
          </Button>
        </CardContent>
      </Card>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Jubelio API Calls</h1>
          <p className="text-muted-foreground">
            Outbound call log, latency, and rate-limit activity.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <div className="text-sm text-muted-foreground">
              Total calls (last {stats?.windowHours ?? 24}h)
            </div>
            <div className="text-3xl font-bold">{stats?.total ?? 0}</div>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <div className="text-sm text-muted-foreground">Error rate</div>
            <div className="text-3xl font-bold">
              {errorRate}%
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                ({stats?.errors ?? 0} failed)
              </span>
            </div>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <div className="text-sm text-muted-foreground">Rate-limited (429)</div>
            <div className="text-3xl font-bold">{stats?.rateLimited ?? 0}</div>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <div className="text-sm text-muted-foreground">Avg latency</div>
            <div className="text-3xl font-bold">{stats?.avgLatencyMs ?? 0}ms</div>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Recent calls</CardTitle>
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
              {callsFilter === "errors" ? "Showing errors only" : "Show errors only"}
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
                      <TableHead>Time</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead>Path</TableHead>
                      <TableHead className="text-right">Status</TableHead>
                      <TableHead className="text-right">Latency</TableHead>
                      <TableHead>Flags</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {calls.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={6}
                          className="py-8 text-center text-muted-foreground"
                        >
                          No API calls logged yet.
                        </TableCell>
                      </TableRow>
                    ) : (
                      calls.map((call) => (
                        <TableRow key={call.id}>
                          <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                            {new Date(call.createdAt).toLocaleString()}
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
                          <TableCell>
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
              <div className="text-sm text-muted-foreground">{s}</div>
              <div className="text-2xl font-bold">{whStats?.byStatus?.[s] ?? 0}</div>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Webhook events</CardTitle>
            <div className="flex gap-2">
              {(["all", "errors", "DEAD"] as const).map((f) => (
                <Button
                  key={f}
                  size="sm"
                  variant={whFilter === f ? "default" : "outline"}
                  onClick={() => updateUrl({ whFilter: f === "all" ? null : f, whPage: "1" })}
                >
                  {f}
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
                    <TableHead className="w-8"></TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Attempts</TableHead>
                    <TableHead>Flags / reason</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {whEvents.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={7}
                        className="py-8 text-center text-muted-foreground"
                      >
                        No webhook events.
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
                              >
                                {isExpanded ? (
                                  <ChevronDown className="h-4 w-4" />
                                ) : (
                                  <ChevronRight className="h-4 w-4" />
                                )}
                              </Button>
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                              {new Date(e.receivedAt).toLocaleString()}
                            </TableCell>
                            <TableCell className="font-mono text-xs">{e.event}</TableCell>
                            <TableCell>
                              <Badge
                                variant={
                                  e.status === "DEAD"
                                    ? "destructive"
                                    : e.status === "SKIPPED"
                                      ? "secondary"
                                      : "default"
                                }
                              >
                                {e.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right text-sm tabular-nums">
                              {e.attempts}
                            </TableCell>
                            <TableCell className="text-xs">
                              {e.skipReason ?? e.lastError?.slice(0, 60) ?? "—"}
                            </TableCell>
                            <TableCell className="text-right">
                              {(e.status === "DEAD" || e.status === "SKIPPED") && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => void handleRetry(e.id)}
                                >
                                  Retry
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                          {isExpanded && (
                            <TableRow key={`${e.id}-detail`}>
                              <TableCell colSpan={7} className="bg-muted/50">
                                <div className="p-4 space-y-2 text-sm">
                                  <p>
                                    <span className="font-medium">Signature:</span>{" "}
                                    <span className="font-mono text-xs break-all">
                                      {e.signature ?? "—"}
                                    </span>
                                  </p>
                                  <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                                    <p>
                                      <span className="font-medium">receivedAt:</span>{" "}
                                      {e.receivedAt
                                        ? new Date(e.receivedAt).toLocaleString()
                                        : "—"}
                                    </p>
                                    <p>
                                      <span className="font-medium">processedAt:</span>{" "}
                                      {e.processedAt
                                        ? new Date(e.processedAt).toLocaleString()
                                        : "—"}
                                    </p>
                                    <p>
                                      <span className="font-medium">deadAt:</span>{" "}
                                      {e.deadAt
                                        ? new Date(e.deadAt).toLocaleString()
                                        : "—"}
                                    </p>
                                    <p>
                                      <span className="font-medium">lastEnqueuedAt:</span>{" "}
                                      {e.lastEnqueuedAt
                                        ? new Date(e.lastEnqueuedAt).toLocaleString()
                                        : "—"}
                                    </p>
                                  </div>
                                  {e.lastError && (
                                    <div>
                                      <p className="font-medium">lastError:</p>
                                      <pre className="bg-background p-3 rounded text-xs overflow-auto max-h-32 whitespace-pre-wrap break-all">
                                        {e.lastError}
                                      </pre>
                                    </div>
                                  )}
                                  <div>
                                    <p className="font-medium">Raw payload:</p>
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
              <div className="text-sm text-muted-foreground">{s}</div>
              <div className="text-2xl font-bold">{outboxStats?.byStatus?.[s] ?? 0}</div>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Outbox events</CardTitle>
            <div className="flex gap-2">
              {(["all", "errors", "DEAD"] as const).map((f) => (
                <Button
                  key={f}
                  size="sm"
                  variant={outboxFilter === f ? "default" : "outline"}
                  onClick={() =>
                    updateUrl({ outboxFilter: f === "all" ? null : f, outboxPage: "1" })
                  }
                >
                  {f}
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
                    <TableHead className="w-8" />
                    <TableHead>Time</TableHead>
                    <TableHead>Entity</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Attempts</TableHead>
                    <TableHead>Flags / reason</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {outboxRows.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={7}
                        className="py-8 text-center text-muted-foreground"
                      >
                        No outbox events.
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
                              >
                                {expanded ? (
                                  <ChevronDown className="h-4 w-4" />
                                ) : (
                                  <ChevronRight className="h-4 w-4" />
                                )}
                              </Button>
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                              {new Date(r.createdAt).toLocaleString()}
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              {r.entityType}:{r.entityId.slice(0, 8)}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={
                                  r.status === "DEAD"
                                    ? "destructive"
                                    : r.status === "SKIPPED"
                                      ? "secondary"
                                      : "default"
                                }
                              >
                                {r.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right text-sm tabular-nums">
                              {r.attempts}
                            </TableCell>
                            <TableCell className="text-xs">
                              {r.skipReason ?? r.lastError?.slice(0, 60) ?? "—"}
                            </TableCell>
                            <TableCell className="text-right">
                              {(r.status === "DEAD" || r.status === "SKIPPED") && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => void handleOutboxRetry(r.id)}
                                >
                                  Retry
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                          {expanded && (
                            <TableRow key={`${r.id}-detail`}>
                              <TableCell colSpan={7} className="bg-muted/50">
                                <div className="space-y-2 p-4 text-sm">
                                  <p>
                                    <span className="font-medium">Enqueued by:</span>{" "}
                                    {enqueuedByLabel}
                                  </p>
                                  <p>
                                    <span className="font-medium">createdAt:</span>{" "}
                                    {new Date(r.createdAt).toLocaleString()}
                                  </p>
                                  <p>
                                    <span className="font-medium">lastEnqueuedAt:</span>{" "}
                                    {r.lastEnqueuedAt
                                      ? new Date(r.lastEnqueuedAt).toLocaleString()
                                      : "—"}
                                  </p>
                                  <p>
                                    <span className="font-medium">processedAt:</span>{" "}
                                    {r.processedAt
                                      ? new Date(r.processedAt).toLocaleString()
                                      : "—"}
                                  </p>
                                  <p>
                                    <span className="font-medium">deadAt:</span>{" "}
                                    {r.deadAt
                                      ? new Date(r.deadAt).toLocaleString()
                                      : "—"}
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
    </div>
  );
}
