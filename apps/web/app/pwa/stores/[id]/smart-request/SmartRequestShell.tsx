"use client";

import { useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Loader2,
  Minus,
  PackageX,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import {
  buildSmartRequestAction,
  submitSmartRequestOrder,
  type BuildSmartRequestResult,
  type SmartRequestDrop,
  type SmartRequestLine,
} from "./actions";

type Category = { id: string; name: string };
type Underfill = Extract<BuildSmartRequestResult, { ok: true }>["underfill"][number];
type Phase = "pick" | "review";

const rupiah = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
const lineKey = (l: SmartRequestLine) => `${l.itemId}::${l.variantSku}`;

export function SmartRequestShell({
  storeId,
  storeName,
  visitId,
  categories,
}: {
  storeId: string;
  storeName: string;
  visitId: string;
  categories: Category[];
}) {
  const t = useTranslations("pwa.smartRequest");
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>("pick");
  const [selected, setSelected] = useState<Map<string, number>>(new Map());
  const [buildError, setBuildError] = useState<"NO_RATIO" | null>(null);
  const [building, startBuild] = useTransition();

  const [lines, setLines] = useState<SmartRequestLine[]>([]);
  const [dropped, setDropped] = useState<SmartRequestDrop[]>([]);
  const [underfill, setUnderfill] = useState<Underfill[]>([]);
  const [dropsOpen, setDropsOpen] = useState(false);
  const [sending, startSend] = useTransition();

  const pickBarRef = useRef<HTMLDivElement | null>(null);
  const [pickBarHeight, setPickBarHeight] = useState(0);
  const reviewBarRef = useRef<HTMLDivElement | null>(null);
  const [reviewBarHeight, setReviewBarHeight] = useState(0);

  useLayoutEffect(() => {
    if (phase !== "pick" || categories.length === 0) {
      setPickBarHeight(0);
      return;
    }
    const el = pickBarRef.current;
    if (!el) return;
    const measure = () => setPickBarHeight(el.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [phase, categories.length, selected.size, building]);

  useLayoutEffect(() => {
    if (phase !== "review" || lines.length === 0) {
      setReviewBarHeight(0);
      return;
    }
    const el = reviewBarRef.current;
    if (!el) return;
    const measure = () => setReviewBarHeight(el.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [phase, lines.length, sending]);

  function toggleCategory(id: string) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(id)) next.delete(id);
      else next.set(id, 1);
      return next;
    });
  }

  function setPacks(id: string, packs: number) {
    if (packs < 1) return;
    setSelected((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.set(id, packs);
      return next;
    });
  }

  function onBuild() {
    setBuildError(null);
    startBuild(async () => {
      try {
        const res = await buildSmartRequestAction({
          storeId,
          categories: Array.from(selected, ([categoryId, packs]) => ({ categoryId, packs })),
        });
        if (!res.ok) {
          if (res.code === "NO_RATIO") setBuildError("NO_RATIO");
          else toast.error(t("buildError"));
          return;
        }
        setLines(res.lines);
        setDropped(res.dropped);
        setUnderfill(res.underfill);
        setDropsOpen(false);
        setPhase("review");
      } catch {
        toast.error(t("buildError"));
      }
    });
  }

  function setLineQty(itemId: string, variantSku: string, qty: number) {
    if (qty < 1) return;
    setLines((prev) => prev.map((l) => (l.itemId === itemId && l.variantSku === variantSku ? { ...l, qty } : l)));
  }

  function removeLine(itemId: string, variantSku: string) {
    setLines((prev) => prev.filter((l) => !(l.itemId === itemId && l.variantSku === variantSku)));
  }

  function onSubmit() {
    startSend(async () => {
      try {
        const res = await submitSmartRequestOrder({
          storeId,
          visitId,
          lines: lines.map((l) => ({
            itemId: l.itemId,
            variantSku: l.variantSku,
            productName: l.productName,
            qty: l.qty,
            unitPrice: l.unitPrice,
          })),
          idempotencyKey: crypto.randomUUID(),
        });
        if (res.ok) {
          toast.success(res.creditHold ? t("creditHoldNote", { orderNo: res.orderNo }) : t("sentSuccess", { orderNo: res.orderNo }));
          router.push(`/pwa/stores/${storeId}`);
          return;
        }
        let msg: string;
        if (res.code === "NO_ACTIVE_VISIT") msg = t("errorNoActiveVisit");
        else if (res.code === "UNAUTHORIZED") msg = t("errorUnauthorized");
        else if (res.code === "MIN_QTY") msg = t("errorMinQty");
        else msg = t("errorEmpty");
        toast.error(msg);
      } catch {
        toast.error(t("errorGeneric"));
      }
    });
  }

  const grouped = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, SmartRequestLine[]>();
    for (const l of lines) {
      if (!map.has(l.itemId)) {
        map.set(l.itemId, []);
        order.push(l.itemId);
      }
      map.get(l.itemId)!.push(l);
    }
    return order.map((itemId) => ({ itemId, productName: map.get(itemId)![0].productName, items: map.get(itemId)! }));
  }, [lines]);

  const total = useMemo(() => lines.reduce((s, l) => s + l.qty * l.unitPrice, 0), [lines]);

  function dropReasonLabel(d: SmartRequestDrop): string {
    if (d.reason === "MISSING_SIZE") return t("dropMissingSize", { detail: d.detail ?? "" });
    if (d.reason === "INSUFFICIENT_STOCK") return t("dropInsufficientStock", { detail: d.detail ?? "" });
    return t("dropEmptyRatio");
  }

  function underfillLabel(u: Underfill): string {
    const name = categories.find((c) => c.id === u.categoryId)?.name ?? u.categoryId;
    return t("underfill", { category: name, requested: u.requestedPacks, placed: u.placedPacks });
  }

  function renderDrops() {
    return (
      <div className="flex flex-col gap-2">
        {dropped.map((d, i) => (
          <div key={`${d.itemId}-${i}`} className="flex items-start gap-2 rounded-md border border-dashed p-2.5 text-xs">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{d.sku}</p>
              <p className="text-muted-foreground">{dropReasonLabel(d)}</p>
            </div>
          </div>
        ))}
        {underfill.map((u) => (
          <div key={u.categoryId} className="flex items-start gap-2 rounded-md border border-dashed p-2.5 text-xs">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
            <p className="text-muted-foreground">{underfillLabel(u)}</p>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <header className="-ml-2">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/pwa/stores/${storeId}`}>
            <ArrowLeft className="h-4 w-4" />
            {t("back")}
          </Link>
        </Button>
      </header>

      <div>
        <h1 className="text-lg font-semibold">{storeName}</h1>
      </div>

      {phase === "pick" && (
        <>
          <div>
            <h2 className="text-base font-semibold">{t("pickTitle")}</h2>
            <p className="text-sm text-muted-foreground">{t("pickSubtitle")}</p>
          </div>

          {categories.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-center text-sm text-muted-foreground">{t("categoriesEmpty")}</CardContent>
            </Card>
          ) : (
            <div className="flex flex-col gap-2">
              {categories.map((c) => {
                const isSelected = selected.has(c.id);
                const packs = selected.get(c.id) ?? 1;
                return (
                  <Card
                    key={c.id}
                    role="checkbox"
                    aria-checked={isSelected}
                    tabIndex={0}
                    onClick={() => toggleCategory(c.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggleCategory(c.id);
                      }
                    }}
                    className={cn(
                      "flex cursor-pointer flex-col gap-2 p-3 transition-colors",
                      isSelected && "border-primary bg-primary/5",
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleCategory(c.id)}
                        tabIndex={-1}
                        className="pointer-events-none"
                      />
                      <span className="flex-1 text-sm font-medium">{c.name}</span>
                    </div>
                    {isSelected && (
                      <div
                        className="flex items-center justify-between pl-7"
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                      >
                        <span className="text-xs text-muted-foreground">{t("packsLabel")}</span>
                        <div className="flex items-center gap-1.5">
                          <Button
                            type="button"
                            variant="outline"
                            size="icon-lg"
                            disabled={packs <= 1}
                            onClick={() => setPacks(c.id, packs - 1)}
                            aria-label={`Kurangi pack ${c.name}`}
                          >
                            <Minus className="h-4 w-4" />
                          </Button>
                          <span className="w-8 text-center text-sm font-semibold tabular-nums">{packs}</span>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon-lg"
                            onClick={() => setPacks(c.id, packs + 1)}
                            aria-label={`Tambah pack ${c.name}`}
                          >
                            <Plus className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          )}

          {buildError === "NO_RATIO" && (
            <Card className="border-destructive/50">
              <CardContent className="p-4 text-sm text-destructive">{t("noRatio")}</CardContent>
            </Card>
          )}

          {categories.length > 0 && <div aria-hidden style={{ height: pickBarHeight }} />}
        </>
      )}

      {phase === "review" && (
        <>
          <div className="-ml-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setPhase("pick")}>
              <ArrowLeft className="h-4 w-4" />
              {t("retry")}
            </Button>
          </div>

          <h2 className="text-base font-semibold">{t("reviewTitle")}</h2>

          {lines.length === 0 && dropped.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <PackageX className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">{t("emptyResult")}</p>
              <Button type="button" onClick={() => setPhase("pick")}>
                {t("retry")}
              </Button>
            </div>
          )}

          {lines.length === 0 && dropped.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">{t("notIncluded", { count: dropped.length + underfill.length })}</p>
              {renderDrops()}
            </div>
          )}

          {lines.length > 0 && (
            <>
              <div className="flex flex-col gap-3">
                {grouped.map((g) => (
                  <div key={g.itemId} className="flex flex-col gap-1.5">
                    <p className="truncate text-sm font-medium">{g.productName}</p>
                    <div className="flex flex-col gap-2">
                      {g.items.map((line) => (
                        <Card key={lineKey(line)} className="flex flex-row items-center gap-3 p-3">
                          <div className="min-w-0 flex-1">
                            {line.variantLabel && (
                              <p className="truncate text-xs text-muted-foreground">{line.variantLabel}</p>
                            )}
                            <p className="text-xs text-muted-foreground tabular-nums">{rupiah(line.unitPrice)} / pcs</p>
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            <Button
                              type="button"
                              variant="outline"
                              size="icon-lg"
                              disabled={line.qty <= 1}
                              onClick={() => setLineQty(line.itemId, line.variantSku, line.qty - 1)}
                              aria-label={`Kurangi ${g.productName}`}
                            >
                              <Minus className="h-4 w-4" />
                            </Button>
                            <span className="w-6 text-center text-sm font-semibold tabular-nums">{line.qty}</span>
                            <Button
                              type="button"
                              variant="outline"
                              size="icon-lg"
                              onClick={() => setLineQty(line.itemId, line.variantSku, line.qty + 1)}
                              aria-label={`Tambah ${g.productName}`}
                            >
                              <Plus className="h-4 w-4" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-lg"
                              onClick={() => removeLine(line.itemId, line.variantSku)}
                              aria-label={t("remove")}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </Card>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {(dropped.length > 0 || underfill.length > 0) && (
                <Collapsible open={dropsOpen} onOpenChange={setDropsOpen}>
                  <CollapsibleTrigger asChild>
                    <Button type="button" variant="outline" size="sm" className="h-10 w-full justify-between">
                      <span>{t("notIncluded", { count: dropped.length + underfill.length })}</span>
                      {dropsOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pt-2">{renderDrops()}</CollapsibleContent>
                </Collapsible>
              )}

              <div className="flex items-center justify-between border-t pt-3">
                <span className="text-sm font-medium">{t("total")}</span>
                <span className="text-base font-semibold tabular-nums">{rupiah(total)}</span>
              </div>
            </>
          )}

          <div aria-hidden style={{ height: reviewBarHeight }} />
        </>
      )}

      {phase === "pick" && categories.length > 0 && (
        <div
          ref={pickBarRef}
          className="sticky bottom-0 -mx-4 -mb-4 border-t bg-background px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
        >
          <Button type="button" className="w-full" size="lg" disabled={selected.size === 0 || building} onClick={onBuild}>
            {building ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("building")}
              </>
            ) : (
              t("build")
            )}
          </Button>
        </div>
      )}

      {phase === "review" && lines.length > 0 && (
        <div
          ref={reviewBarRef}
          className="sticky bottom-0 -mx-4 -mb-4 border-t bg-background px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
        >
          <Button type="button" className="w-full" size="lg" onClick={onSubmit} disabled={sending}>
            {sending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("sending")}
              </>
            ) : (
              t("send")
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
