"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type CatalogItem = {
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
}: {
  storeId: string;
  storeName: string;
  termsType: "PUTUS" | "KONSI";
}) {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const [page, setPage] = useState(1);

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
        {shown.map((it) => (
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
            <div className="flex flex-col items-end gap-1">
              <Badge variant={it.available > 0 ? "secondary" : "destructive"}>
                {it.available > 0 ? `${it.available} tersedia` : "Habis"}
              </Badge>
              {it.price != null && (
                <>
                  {it.priceLabel && (
                    <span className="text-xs text-muted-foreground">{it.priceLabel}</span>
                  )}
                  <span className="text-sm font-semibold">{rupiah(it.price)}</span>
                </>
              )}
            </div>
          </Card>
        ))}
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
    </div>
  );
}
