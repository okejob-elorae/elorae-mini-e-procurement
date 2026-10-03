"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowLeftRight, Boxes, ClipboardCheck, PackagePlus, Search, Truck, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { BarisStok } from "@/lib/spg/queries";
import { hampirHabis } from "@/lib/spg/stok";
import { cn } from "@/lib/utils";
import { DaftarPermintaan, type PermintaanTampil } from "./DaftarPermintaan";

type Saringan = "semua" | "hampir";

const UBIN: Array<{ href: string; kunci: "receive" | "opname" | "request" | "transfer"; ikon: LucideIcon }> = [
  { href: "/pwa/spg/terima", kunci: "receive", ikon: Truck },
  { href: "/pwa/spg/opname", kunci: "opname", ikon: ClipboardCheck },
  { href: "/pwa/spg/stok/minta", kunci: "request", ikon: PackagePlus },
  { href: "/pwa/spg/mutasi", kunci: "transfer", ikon: ArrowLeftRight },
];

/**
 * Stok toko untuk SPG. Saldo NEGATIF ditampilkan apa adanya: penjualan tidak
 * pernah ditolak karena buku stok nol, jadi minus berarti "terjual lebih
 * banyak dari yang tercatat masuk" — dibereskan lewat opname, bukan disembunyikan.
 */
export function StokClient({
  namaToko,
  baris,
  batasHampirHabis,
  permintaan,
  saringAwal = "semua",
}: {
  namaToko: string;
  baris: BarisStok[];
  batasHampirHabis: number;
  permintaan: PermintaanTampil[];
  saringAwal?: Saringan;
}) {
  const t = useTranslations("pwa.spgStok");
  const [cari, setCari] = useState("");
  const [saring, setSaring] = useState<Saringan>(saringAwal);

  const menipis = useMemo(() => hampirHabis(baris, batasHampirHabis), [baris, batasHampirHabis]);
  const adaMinus = baris.some((b) => b.qty < 0);
  const totalPotong = baris.reduce((n, b) => n + b.qty, 0);

  const tampil = useMemo(() => {
    const q = cari.trim().toLowerCase();
    const sumber = saring === "hampir" ? menipis : baris;
    if (!q) return sumber;
    return sumber.filter((b) => [b.nama, b.sku, b.varian ?? ""].some((s) => s.toLowerCase().includes(q)));
  }, [baris, menipis, saring, cari]);

  return (
    <div className="space-y-4 p-4">
      <header className="min-w-0">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="truncate text-sm text-muted-foreground">{namaToko}</p>
      </header>

      {/* Pekerjaan stok selalu di depan mata, bukan hanya saat stok masih kosong.
          Ubin, bukan tombol sebaris: label boleh dua baris tanpa terpotong. */}
      <nav className="grid grid-cols-2 gap-2" aria-label={t("quick.label")}>
        {UBIN.map(({ href, kunci, ikon: Ikon }) => (
          <Link
            key={href}
            href={href}
            className="flex min-h-16 items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm font-medium leading-tight transition-colors hover:bg-muted active:bg-muted"
          >
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
              <Ikon className="h-4 w-4" aria-hidden />
            </span>
            <span className="min-w-0">{t(`quick.${kunci}`)}</span>
          </Link>
        ))}
      </nav>

      {baris.length === 0 ? (
        <section className="beranda-kartu space-y-3">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
              <Boxes className="h-4 w-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <h2 className="font-semibold leading-tight">{t("empty.title")}</h2>
              <p className="text-sm text-muted-foreground">{t("empty.body")}</p>
            </div>
          </div>
          {/* Tombol "Terima kiriman" dan "Opname" ada di ubin di atas. */}
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>{t("empty.receive")}</li>
            <li>{t("empty.opname")}</li>
          </ul>
        </section>
      ) : (
        <>
          <div className="space-y-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                type="search"
                value={cari}
                onChange={(e) => setCari(e.target.value)}
                placeholder={t("searchPlaceholder")}
                aria-label={t("searchPlaceholder")}
                className="pl-9"
              />
            </div>
            <div className="flex gap-2" role="group" aria-label={t("filterLabel")}>
              <Button
                type="button"
                size="sm"
                variant={saring === "semua" ? "default" : "outline"}
                aria-pressed={saring === "semua"}
                onClick={() => setSaring("semua")}
              >
                {t("filterAll", { count: baris.length })}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={saring === "hampir" ? "default" : "outline"}
                aria-pressed={saring === "hampir"}
                onClick={() => setSaring("hampir")}
              >
                {t("filterLow", { count: menipis.length })}
              </Button>
            </div>
          </div>

          <p className="px-1 text-xs text-muted-foreground">{t("summary", { rows: baris.length, pcs: totalPotong })}</p>

          <section className="beranda-kartu beranda-kartu-daftar">
            {tampil.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                {saring === "hampir" && !cari.trim() ? t("noLow") : t("noMatch")}
              </p>
            ) : (
              <ul className="divide-y">
                {tampil.map((b) => {
                  const minus = b.qty < 0;
                  const tipis = !minus && b.qty <= batasHampirHabis;
                  return (
                    <li key={`${b.itemId}::${b.variantSku}`} className="flex min-h-14 items-center gap-3 px-4 py-2">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium leading-tight">{b.nama}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {[b.varian, b.sku].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                      <span
                        className={cn(
                          "shrink-0 text-right tabular-nums",
                          minus && "text-destructive",
                          tipis && "text-amber-700 dark:text-amber-300",
                        )}
                      >
                        <span className="block text-lg font-semibold leading-tight">{b.qty}</span>
                        {minus ? (
                          <span className="block text-[11px] font-medium">{t("badgeNegative")}</span>
                        ) : tipis ? (
                          <span className="block text-[11px] font-medium">{t("badgeLow")}</span>
                        ) : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {adaMinus ? (
            <p className="px-1 text-xs text-muted-foreground">
              {t("negativeHint")}{" "}
              <Link href="/pwa/spg/opname" className="font-medium text-primary underline-offset-4 hover:underline">
                {t("negativeHintCta")}
              </Link>
            </p>
          ) : null}
        </>
      )}

      <DaftarPermintaan permintaan={permintaan} />
    </div>
  );
}
