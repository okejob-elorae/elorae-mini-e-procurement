"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, Loader2, Minus, Plus, Sparkles, WifiOff } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cartCount, cartTotal, buildOrderLines, type CartLine } from "@/lib/field-sales/cart";
import { enqueueOrder, newLocalId } from "@/lib/pwa/offline/queue";
import { submitFieldSalesOrder, previewFieldSalesPromos, type PromoPreviewResult } from "./actions";

type CatalogItem = {
  itemId: string;
  sku: string;
  nameId: string;
  categoryId: string | null;
  categoryName: string | null;
  primaryImageUrl: string | null;
  available: number;
  price: number | null;
  priceLabel: string | null;
  neverSent: boolean;
  minOrderQty: number;
};

type Payload = { items: CatalogItem[] };
type LoadState = "loading" | "ready" | "error";

const rupiah = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
const PAGE_SIZE = 10;

export function CatalogShell({
  storeId,
  storeName,
  termsType,
  hasActiveVisit,
  visitId,
}: {
  storeId: string;
  storeName: string;
  termsType: "PUTUS" | "KONSI";
  hasActiveVisit: boolean;
  visitId: string | null;
}) {
  const t = useTranslations("pwa.catalog");
  const isKonsi = termsType === "KONSI";
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [cart, setCart] = useState<Map<string, CartLine>>(new Map());
  const [view, setView] = useState<"catalog" | "review">("catalog");
  const [note, setNote] = useState("");
  const [online, setOnline] = useState(true);
  const [preview, setPreview] = useState<PromoPreviewResult | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const cartBarRef = useRef<HTMLDivElement | null>(null);
  const [cartBarHeight, setCartBarHeight] = useState(0);
  const reviewBarRef = useRef<HTMLDivElement | null>(null);
  const [reviewBarHeight, setReviewBarHeight] = useState(0);

  function setQty(it: CatalogItem, qty: number) {
    setCart((prev) => {
      const next = new Map(prev);
      if (qty <= 0) next.delete(it.sku);
      else
        next.set(it.sku, {
          itemId: it.itemId,
          variantSku: "",
          sku: it.sku,
          nameId: it.nameId,
          unitPrice: isKonsi ? 0 : (it.price ?? 0),
          available: it.available,
          qty,
        });
      return next;
    });
  }

  const cartLines = useMemo(() => Array.from(cart.values()), [cart]);
  const showCartBar = cartLines.length > 0 && view === "catalog";

  useLayoutEffect(() => {
    if (!showCartBar) {
      setCartBarHeight(0);
      return;
    }
    const el = cartBarRef.current;
    if (!el) return;
    const measure = () => setCartBarHeight(el.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [showCartBar]);

  useLayoutEffect(() => {
    if (view !== "review" || cartLines.length === 0) {
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
  }, [view, online, pending, cartLines.length]);

  useEffect(() => {
    const set = () => setOnline(navigator.onLine);
    set();
    window.addEventListener("online", set);
    window.addEventListener("offline", set);
    return () => {
      window.removeEventListener("online", set);
      window.removeEventListener("offline", set);
    };
  }, []);

  // Read-only promo quote for the putus review — never blocks Kirim; a stale/failed/in-flight
  // call just falls back to the undiscounted cartTotal (guarded via the `alive` flag below).
  useEffect(() => {
    if (view !== "review" || isKonsi || cartLines.length === 0) {
      setPreview(null);
      return;
    }
    let alive = true;
    // Reset immediately so a cart change never renders a discount computed for the old lines.
    setPreview(null);
    const requestLines = cartLines.map((l) => ({ itemId: l.itemId, qty: l.qty, unitPrice: l.unitPrice }));
    previewFieldSalesPromos({ storeId, lines: requestLines })
      .then((res) => {
        if (alive) setPreview(res);
      })
      .catch(() => {
        // Silent fallback to undiscounted totals — promo quote is informational only.
      });
    return () => {
      alive = false;
    };
  }, [view, cartLines, isKonsi, storeId]);

  function onSubmit() {
    const localId = newLocalId();
    startTransition(async () => {
      try {
        if (!online) {
          if (!isKonsi) {
            const violations = cartLines
              .map((line) => {
                const min = items.find((i) => i.itemId === line.itemId)?.minOrderQty ?? 0;
                return line.qty < min ? `${line.nameId} (min ${min})` : null;
              })
              .filter((v): v is string => v !== null);
            if (violations.length > 0) {
              toast.error(`Jumlah di bawah minimum: ${violations.join(", ")}.`);
              return;
            }
          }
          await enqueueOrder({
            localId,
            storeId,
            storeName,
            visitId,
            note: note.trim() || undefined,
            lines: buildOrderLines(cartLines),
          });
          toast.success("Pesanan disimpan — dikirim otomatis saat online");
          setCart(new Map());
          setNote("");
          // Offline: stay on the already-loaded catalog (a router.push to the dynamic
          // store page has no offline cache → Chrome dino). Salesman keeps browsing.
          setView("catalog");
          return;
        }

        const res = await submitFieldSalesOrder({
          storeId,
          visitId: visitId ?? undefined,
          note: note.trim() || undefined,
          lines: buildOrderLines(cartLines),
          idempotencyKey: localId,
        });
        if (res.ok) {
          toast.success(`Pesanan ${res.orderNo} terkirim`);
          setCart(new Map());
          router.push(`/pwa/stores/${storeId}`);
          return;
        }
        let msg: string;
        if (res.code === "MIN_QTY") {
          const parts = res.violations.map((v) => {
            const name = cartLines.find((l) => l.itemId === v.itemId)?.nameId ?? "produk";
            return `${name} (min ${v.requiredMin})`;
          });
          msg = `Jumlah di bawah minimum: ${parts.join(", ")}.`;
        } else if (res.code === "NO_ACTIVE_VISIT") {
          msg = "Check in dulu untuk memesan.";
        } else if (res.code === "UNAUTHORIZED") {
          msg = "Sesi berakhir. Masuk lagi.";
        } else {
          msg = "Tidak ada item.";
        }
        toast.error(msg);
      } catch {
        toast.error("Gagal mengirim pesanan. Coba lagi.");
      }
    });
  }

  useEffect(() => {
    let alive = true;
    setState("loading");
    fetch(`/pwa/api/catalog?storeId=${encodeURIComponent(storeId)}`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json() as Promise<Payload>;
      })
      .then((data) => {
        if (!alive) return;
        setItems(data.items);
        setState("ready");
      })
      .catch(() => {
        if (alive) setState("error");
      });
    return () => {
      alive = false;
    };
  }, [storeId]);

  const categories = useMemo(() => {
    const map = new Map<string, string>();
    for (const it of items) if (it.categoryId && it.categoryName) map.set(it.categoryId, it.categoryName);
    return Array.from(map, ([id, name]) => ({ id, name }));
  }, [items]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((it) => {
      if (cat && it.categoryId !== cat) return false;
      if (!needle) return true;
      return it.sku.toLowerCase().includes(needle) || it.nameId.toLowerCase().includes(needle);
    });
  }, [items, q, cat]);

  // Reset to page 1 whenever the filtered set changes (new search or category).
  useEffect(() => {
    setPage(1);
  }, [q, cat]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const shown = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="flex flex-col gap-3 p-4">
      <header className="-ml-2">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/pwa/stores/${storeId}`}>
            <ArrowLeft className="h-4 w-4" />
            Kembali
          </Link>
        </Button>
      </header>

      <div>
        <h1 className="text-lg font-semibold">{storeName}</h1>
        <p className="text-sm text-muted-foreground">Katalog produk · {termsType}</p>
      </div>

      {view === "catalog" && (
        <>
          <Input
            placeholder="Cari SKU atau nama"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />

          {categories.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant={cat === null ? "default" : "outline"} onClick={() => setCat(null)}>
                Semua
              </Button>
              {categories.map((c) => (
                <Button
                  key={c.id}
                  size="sm"
                  variant={cat === c.id ? "default" : "outline"}
                  onClick={() => setCat(c.id)}
                >
                  {c.name}
                </Button>
              ))}
            </div>
          )}

          {isKonsi && hasActiveVisit && items.some((it) => it.neverSent && it.available > 0 && !cart.has(it.sku)) && (
            <Button
              type="button"
              variant="outline"
              className="justify-start"
              onClick={() =>
                setCart((prev) => {
                  const next = new Map(prev);
                  let added = 0;
                  for (const it of items) {
                    if (it.neverSent && it.available > 0 && !next.has(it.sku)) {
                      next.set(it.sku, {
                        itemId: it.itemId,
                        variantSku: "",
                        sku: it.sku,
                        nameId: it.nameId,
                        unitPrice: 0,
                        available: it.available,
                        qty: 1,
                      });
                      added += 1;
                    }
                  }
                  if (added > 0) toast.success(`${added} produk baru ditambahkan`);
                  return next;
                })
              }
            >
              <Sparkles className="h-4 w-4" />
              Sarankan produk baru
            </Button>
          )}

          {state === "loading" && <p className="text-sm text-muted-foreground">Memuat katalog…</p>}
          {state === "error" && (
            <p className="text-sm text-destructive">
              Gagal memuat katalog. Periksa koneksi lalu coba lagi.
            </p>
          )}
          {state === "ready" && filtered.length === 0 && (
            <p className="text-sm text-muted-foreground">Tidak ada produk cocok.</p>
          )}

          <div className="flex flex-col gap-2">
            {shown.map((it) => {
              const qty = cart.get(it.sku)?.qty ?? 0;
              const canOrder = (isKonsi || it.price != null) && it.available > 0;
              return (
                <Card key={it.sku} className="flex flex-row items-center gap-3 p-3">
                  <div className="h-12 w-12 shrink-0 overflow-hidden rounded bg-muted">
                    {it.primaryImageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={it.primaryImageUrl} alt={it.nameId} className="h-full w-full object-cover" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{it.nameId}</p>
                    <p className="truncate text-xs text-muted-foreground">{it.sku}</p>
                    {it.categoryName && <p className="truncate text-xs text-muted-foreground">{it.categoryName}</p>}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    {isKonsi ? (
                      <div className="flex items-center gap-1.5">
                        <Badge variant={it.available > 0 ? "secondary" : "destructive"}>
                          {it.available > 0 ? `${it.available} tersedia` : "Habis"}
                        </Badge>
                        {it.neverSent && <Badge variant="default">Baru</Badge>}
                      </div>
                    ) : (
                      <Badge variant={it.available > 0 ? "secondary" : "destructive"}>
                        {it.available > 0 ? `${it.available} tersedia` : "Habis"}
                      </Badge>
                    )}
                    {!isKonsi && (
                      <>
                        {it.price != null && (
                          <>
                            {it.priceLabel && (
                              <span className="text-xs text-muted-foreground">{it.priceLabel}</span>
                            )}
                            <span className="text-sm font-semibold tabular-nums">{rupiah(it.price)}</span>
                          </>
                        )}
                        {it.price == null && it.available > 0 && (
                          <span className="text-xs italic text-muted-foreground">Harga belum diset</span>
                        )}
                      </>
                    )}
                    {canOrder && hasActiveVisit && (
                      <div className="flex items-center gap-1.5">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon-lg"
                          disabled={qty <= 0}
                          onClick={() => setQty(it, qty - 1)}
                          aria-label={`Kurangi ${it.nameId}`}
                        >
                          <Minus className="h-4 w-4" />
                        </Button>
                        <span className="w-5 text-center text-sm font-semibold tabular-nums">{qty}</span>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon-lg"
                          disabled={qty >= it.available}
                          onClick={() => setQty(it, qty + 1)}
                          aria-label={`Tambah ${it.nameId}`}
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                    {canOrder && !hasActiveVisit && (
                      <span className="text-xs text-muted-foreground">Check in untuk pesan</span>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>

          {state === "ready" && filtered.length > 0 && (
            <div className="flex items-center justify-center gap-3 pt-1">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                aria-label="Halaman sebelumnya"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm tabular-nums text-muted-foreground">
                {page} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                aria-label="Halaman berikutnya"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}

          {showCartBar && <div aria-hidden style={{ height: cartBarHeight }} />}
        </>
      )}

      {view === "review" && (
        <>
          <div className="-ml-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setView("catalog")}>
              <ArrowLeft className="h-4 w-4" />
              Kembali ke katalog
            </Button>
          </div>

          {cartLines.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <p className="text-sm text-muted-foreground">Keranjang kosong.</p>
              <Button type="button" onClick={() => setView("catalog")}>
                Kembali ke katalog
              </Button>
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-2">
                {cartLines.map((line, lineIdx) => {
                  const lineTotal = line.qty * line.unitPrice;
                  const lineDiscount = preview?.lineDiscounts[lineIdx] ?? 0;
                  const netLineTotal = lineTotal - lineDiscount;
                  const it: CatalogItem =
                    items.find((i) => i.sku === line.sku) ?? {
                      itemId: line.itemId,
                      sku: line.sku,
                      nameId: line.nameId,
                      categoryId: null,
                      categoryName: null,
                      primaryImageUrl: null,
                      available: line.available,
                      price: line.unitPrice,
                      priceLabel: null,
                      neverSent: false,
                      minOrderQty: 0,
                    };
                  return (
                    <Card key={line.sku} className="flex flex-row items-center gap-3 p-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{line.nameId}</p>
                        <p className="truncate text-xs text-muted-foreground">{line.sku}</p>
                        {!isKonsi && (
                          <p className="text-xs text-muted-foreground tabular-nums">
                            {rupiah(line.unitPrice)} / pcs
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1.5">
                        <div className="flex items-center gap-1.5">
                          <Button
                            type="button"
                            variant="outline"
                            size="icon-lg"
                            onClick={() => setQty(it, line.qty - 1)}
                            aria-label={`Kurangi ${line.nameId}`}
                          >
                            <Minus className="h-4 w-4" />
                          </Button>
                          <span className="w-5 text-center text-sm font-semibold tabular-nums">{line.qty}</span>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon-lg"
                            disabled={line.qty >= it.available}
                            onClick={() => setQty(it, line.qty + 1)}
                            aria-label={`Tambah ${line.nameId}`}
                          >
                            <Plus className="h-4 w-4" />
                          </Button>
                        </div>
                        {!isKonsi && (
                          lineDiscount > 0 ? (
                            <div className="flex flex-col items-end gap-0.5">
                              <span className="text-xs text-muted-foreground line-through tabular-nums">
                                {rupiah(lineTotal)}
                              </span>
                              <div className="flex items-center gap-1">
                                <span className="text-sm font-semibold tabular-nums">{rupiah(netLineTotal)}</span>
                                <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                                  {t("promoTag")}
                                </Badge>
                              </div>
                            </div>
                          ) : (
                            <span className="text-sm font-semibold tabular-nums">{rupiah(lineTotal)}</span>
                          )
                        )}
                      </div>
                    </Card>
                  );
                })}
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="catatan" className="text-sm font-medium">
                  Catatan (opsional)
                </label>
                <Textarea
                  id="catatan"
                  placeholder="Tulis catatan untuk pesanan ini…"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                />
              </div>

              {!isKonsi && (
                <div className="flex flex-col gap-1 border-t pt-3">
                  {preview && preview.orderDiscount > 0 && (
                    <div className="flex items-center justify-between text-sm text-muted-foreground">
                      <span>{t("promoOrderDiscount")}</span>
                      <span className="tabular-nums">−{rupiah(preview.orderDiscount)}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Total</span>
                    <span className="text-base font-semibold tabular-nums">
                      {rupiah(preview ? preview.netTotal : cartTotal(cartLines))}
                    </span>
                  </div>
                </div>
              )}
            </>
          )}

          <div aria-hidden style={{ height: reviewBarHeight }} />
        </>
      )}

      {view === "review" && cartLines.length > 0 && (
        <div
          ref={reviewBarRef}
          className="sticky bottom-0 -mx-4 -mb-4 border-t bg-background px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
        >
          {!online && (
            <p className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <WifiOff className="h-3.5 w-3.5 shrink-0" />
              Offline — pesanan disimpan & dikirim otomatis saat online
            </p>
          )}
          <Button
            type="button"
            className="w-full"
            size="lg"
            onClick={onSubmit}
            disabled={pending || cartLines.length === 0}
          >
            {pending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Mengirim…
              </>
            ) : (
              "Kirim"
            )}
          </Button>
        </div>
      )}

      {showCartBar && (
        <div
          ref={cartBarRef}
          className="sticky bottom-0 -mx-4 -mb-4 border-t bg-background px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
        >
          <div className="flex min-w-0 items-center justify-between gap-3">
            <p className="truncate text-sm font-medium">
              {isKonsi ? (
                `${cartCount(cartLines)} item · ${cartLines.length} SKU`
              ) : (
                <>
                  {cartCount(cartLines)} item · <span className="tabular-nums">{rupiah(cartTotal(cartLines))}</span>
                </>
              )}
            </p>
            <Button onClick={() => setView("review")}>
              Tinjau
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
