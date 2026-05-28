"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
  getJubelioApiCalls,
  getJubelioApiCallStats,
} from "@/app/actions/jubelio-api-calls";
import {
  getJubelioWebhookEvents,
  getJubelioWebhookStats,
  retryJubelioWebhookEvent,
} from "@/app/actions/jubelio-webhooks";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ChevronDown, ChevronRight, Loader2, RefreshCw } from "lucide-react";

type CallsResult = Awaited<ReturnType<typeof getJubelioApiCalls>>;
type CallRow = CallsResult["calls"][number];
type Stats = Awaited<ReturnType<typeof getJubelioApiCallStats>>;

type WebhookCalls = Awaited<ReturnType<typeof getJubelioWebhookEvents>>;
type WebhookRow = WebhookCalls["events"][number];
type WebhookStats = Awaited<ReturnType<typeof getJubelioWebhookStats>>;

const PAGE_SIZE = 50;

function statusVariant(call: CallRow): "default" | "secondary" | "destructive" {
  if (!call.ok) return "destructive";
  if (call.rateLimited) return "secondary";
  return "default";
}

export default function JubelioAdminPage() {
  const { status } = useSession();
  const router = useRouter();
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<Stats>(null);
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [whEvents, setWhEvents] = useState<WebhookRow[]>([]);
  const [whTotal, setWhTotal] = useState(0);
  const [whStats, setWhStats] = useState<WebhookStats>(null);
  const [whFilter, setWhFilter] = useState<"all" | "errors" | "DEAD">("all");
  const [expandedWebhookId, setExpandedWebhookId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [callsRes, statsRes] = await Promise.all([
        getJubelioApiCalls({ limit: PAGE_SIZE, offset: 0, onlyErrors }),
        getJubelioApiCallStats(),
      ]);
      setCalls(callsRes.calls);
      setTotal(callsRes.total);
      setStats(statsRes);
    } finally {
      setIsLoading(false);
    }
  }, [onlyErrors]);

  const loadWebhooks = useCallback(async () => {
    const statusFilter = whFilter === "DEAD" ? "DEAD" : undefined;
    const [eventsRes, statsRes] = await Promise.all([
      getJubelioWebhookEvents({ limit: 50, offset: 0, status: statusFilter as any }),
      getJubelioWebhookStats(),
    ]);
    let events = eventsRes.events;
    if (whFilter === "errors") {
      events = events.filter((e) => e.status === "DEAD" || e.status === "SKIPPED");
    }
    setWhEvents(events);
    setWhTotal(eventsRes.total);
    setWhStats(statsRes);
  }, [whFilter]);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login");
      return;
    }
    if (status === "authenticated") void load();
  }, [status, onlyErrors, load, router]);

  useEffect(() => {
    if (status === "authenticated") void loadWebhooks();
  }, [status, whFilter, loadWebhooks]);

  const handleRetry = async (id: string) => {
    const result = await retryJubelioWebhookEvent(id);
    if (result.ok) {
      toast.success("Re-queued. Sweeper picks up within 10 min.");
      void loadWebhooks();
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
            <CardDescription>Total calls (last {stats?.windowHours ?? 24}h)</CardDescription>
            <CardTitle className="text-3xl">{stats?.total ?? 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Error rate</CardDescription>
            <CardTitle className="text-3xl">
              {errorRate}%
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                ({stats?.errors ?? 0} failed)
              </span>
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Rate-limited (429)</CardDescription>
            <CardTitle className="text-3xl">{stats?.rateLimited ?? 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Avg latency</CardDescription>
            <CardTitle className="text-3xl">{stats?.avgLatencyMs ?? 0}ms</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Recent calls</CardTitle>
              <CardDescription>{total} total entries</CardDescription>
            </div>
            <Button
              variant={onlyErrors ? "default" : "outline"}
              size="sm"
              onClick={() => setOnlyErrors((v) => !v)}
            >
              {onlyErrors ? "Showing errors only" : "Show errors only"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
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
                      <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
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
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {(["RECEIVED", "PROCESSING", "PROCESSED", "SKIPPED", "DEAD"] as const).map((s) => (
          <Card key={s}>
            <CardHeader className="pb-2">
              <CardDescription>{s}</CardDescription>
              <CardTitle className="text-2xl">{whStats?.byStatus?.[s] ?? 0}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Webhook events</CardTitle>
              <CardDescription>{whTotal} total entries</CardDescription>
            </div>
            <div className="flex gap-2">
              {(["all", "errors", "DEAD"] as const).map((f) => (
                <Button
                  key={f}
                  size="sm"
                  variant={whFilter === f ? "default" : "outline"}
                  onClick={() => setWhFilter(f)}
                >
                  {f}
                </Button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
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
                    <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
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
                              onClick={() => setExpandedWebhookId(isExpanded ? null : e.id)}
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
                          <TableCell className="text-right text-sm tabular-nums">{e.attempts}</TableCell>
                          <TableCell className="text-xs">
                            {e.skipReason ?? e.lastError?.slice(0, 60) ?? "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            {(e.status === "DEAD" || e.status === "SKIPPED") && (
                              <Button size="sm" variant="outline" onClick={() => void handleRetry(e.id)}>
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
                                  <span className="font-mono text-xs break-all">{e.signature ?? "—"}</span>
                                </p>
                                <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                                  <p>
                                    <span className="font-medium">receivedAt:</span>{" "}
                                    {e.receivedAt ? new Date(e.receivedAt).toLocaleString() : "—"}
                                  </p>
                                  <p>
                                    <span className="font-medium">processedAt:</span>{" "}
                                    {e.processedAt ? new Date(e.processedAt).toLocaleString() : "—"}
                                  </p>
                                  <p>
                                    <span className="font-medium">deadAt:</span>{" "}
                                    {e.deadAt ? new Date(e.deadAt).toLocaleString() : "—"}
                                  </p>
                                  <p>
                                    <span className="font-medium">lastEnqueuedAt:</span>{" "}
                                    {e.lastEnqueuedAt ? new Date(e.lastEnqueuedAt).toLocaleString() : "—"}
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
        </CardContent>
      </Card>
    </div>
  );
}
