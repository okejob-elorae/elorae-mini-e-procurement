"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, Loader2, Minus, Plus, WifiOff } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cartCount, cartTotal, buildOrderLines, type CartLine } from "@/lib/field-sales/cart";
import { submitFieldSalesOrder } from "./actions";

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
}: {
  storeId: string;
  storeName: string;
  termsType: "PUTUS" | "KONSI";
  hasActiveVisit: boolean;
}) {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [cart, setCart] = useState<Map<string, CartLine>>(new Map());
  const [view, setView] = useState<"catalog" | "review">("catalog");
  const [note, setNote] = useState("");
  const [online, setOnline] = useState(true);
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
          unitPrice: it.price ?? 0,
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
    if (view !== "review") {
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

  function onSubmit() {
    startTransition(async () => {
      const res = await submitFieldSalesOrder({
        storeId,
        note: note.trim() || undefined,
        lines: buildOrderLines(cartLines),
      });
      if (res.ok) {
        toast.success(`Pesanan ${res.orderNo} terkirim`);
        setCart(new Map());
        router.push(`/pwa/stores/${storeId}`);
        return;
      }
      const msg =
        res.code === "MIN_QTY" ? "Jumlah di bawah minimum pesanan." :
        res.code === "NO_ACTIVE_VISIT" ? "Check in dulu untuk memesan." :
        res.code === "UNAUTHORIZED" ? "Sesi berakhir. Masuk lagi." :
        "Tidak ada item.";
      toast.error(msg);
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
              const canOrder = it.price != null && it.available > 0;
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
                    <Badge variant={it.available > 0 ? "secondary" : "destructive"}>
                      {it.available > 0 ? `${it.available} tersedia` : "Habis"}
                    </Badge>
                    {it.price != null && (
                      <>
                        {it.priceLabel && (
                          <span className="text-xs text-muted-foreground">{it.priceLabel}</span>
                        )}
                        <span className="text-sm font-semibold tabular-nums">{rupiah(it.price)}</span>
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
                {cartLines.map((line) => {
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
                    };
                  return (
                    <Card key={line.sku} className="flex flex-row items-center gap-3 p-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{line.nameId}</p>
                        <p className="truncate text-xs text-muted-foreground">{line.sku}</p>
                        <p className="text-xs text-muted-foreground tabular-nums">
                          {rupiah(line.unitPrice)} / pcs
                        </p>
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
                        <span className="text-sm font-semibold tabular-nums">{rupiah(line.qty * line.unitPrice)}</span>
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

              <div className="flex items-center justify-between border-t pt-3">
                <span className="text-sm font-medium">Total</span>
                <span className="text-base font-semibold tabular-nums">{rupiah(cartTotal(cartLines))}</span>
              </div>
            </>
          )}

          <div aria-hidden style={{ height: reviewBarHeight }} />
        </>
      )}

      {view === "review" && (
        <div
          ref={reviewBarRef}
          className="sticky bottom-0 -mx-4 -mb-4 border-t bg-background px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
        >
          {!online && (
            <p className="mb-2 flex items-center gap-1.5 text-xs text-destructive">
              <WifiOff className="h-3.5 w-3.5 shrink-0" />
              Sambungkan internet untuk mengirim pesanan
            </p>
          )}
          <Button
            type="button"
            className="w-full"
            size="lg"
            onClick={onSubmit}
            disabled={pending || cartLines.length === 0 || !online}
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
              {cartCount(cartLines)} item · <span className="tabular-nums">{rupiah(cartTotal(cartLines))}</span>
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
