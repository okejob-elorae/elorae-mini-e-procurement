"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Boxes, Loader2, PackagePlus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { dinamis } from "@/lib/i18n/dinamis";
import { newLocalId } from "@/lib/pwa/id-lokal";
import { denganBatasWaktu, galatJaringan } from "@/lib/field-sales/jaringan-lemah";
import type { KartuStokDiToko } from "@/lib/konsinyasi/stok-di-toko";
import type { TandaStok } from "@/lib/konsinyasi/isi-ulang";
import { cn } from "@/lib/utils";
import { kirimPesananIsiUlang } from "./isi-ulang-actions";

/**
 * Kartu "Stok di toko ini" untuk salesman di toko KONSINYASI.
 *
 * Hanya JUMLAH — tidak ada harga maupun nilai: salesman tidak pernah diberi
 * harga konsinyasi. Baris bertanda (minus, hampir habis, tidak laku) dan yang
 * perlu diisi ulang tampil lebih dulu; sisanya dilipat.
 *
 * "Buat pesanan isi ulang" membuka lembar konfirmasi berisi saran dari target
 * min/maks. Salesman boleh mengubah jumlah dan menghapus baris; kirimnya lewat
 * jalur pesanan konsinyasi yang sama dengan katalog, jadi wajib check-in di
 * toko ini (`visitId`).
 */

const BARIS_AWAL = 6;

const WARNA_TANDA: Record<TandaStok, string> = {
  MINUS: "border-red-500/50 text-red-700 dark:text-red-300",
  HAMPIR_HABIS: "border-amber-500/50 text-amber-800 dark:text-amber-300",
  TIDAK_LAKU: "border-sky-500/50 text-sky-700 dark:text-sky-300",
};

/** Titik ribuan tanpa `Intl` — keluaran server dan browser harus sama persis. */
const ribuan = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

type BarisLembar = { kunci: string; itemId: string; variantSku: string; nama: string; varian: string | null; qty: string; tersedia: number };

export function StokDiToko({ data, storeId, visitId }: { data: KartuStokDiToko; storeId: string; visitId: string | null }) {
  const t = useTranslations("pwa.stokDiToko");
  const td = dinamis(t);
  const router = useRouter();
  const [semua, setSemua] = useState(false);
  const [buka, setBuka] = useState(false);
  const [lembar, setLembar] = useState<BarisLembar[]>([]);
  const [catatan, setCatatan] = useState("");
  const [pending, startTransition] = useTransition();
  // Kiriman ulang setelah sinyal putus memakai kunci yang sama, jadi server
  // mengembalikan pesanan yang sudah ada — bukan dua.
  const kunciKirim = useRef<string>("");

  const { ringkas, baris } = data;
  const saran = useMemo(() => baris.filter((b) => b.saranQty > 0), [baris]);
  const penting = baris.filter((b) => b.tanda.length > 0 || b.saranQty > 0);
  const tampil = semua ? baris : penting.length > 0 ? penting.slice(0, BARIS_AWAL) : baris.slice(0, BARIS_AWAL);
  const tersembunyi = baris.length - tampil.length;

  function bukaLembar() {
    setLembar(
      saran.map((b) => ({
        kunci: b.kunci,
        itemId: b.itemId,
        variantSku: b.variantSku,
        nama: b.nama,
        varian: b.varian,
        qty: String(b.saranQty),
        tersedia: b.tersediaGudang,
      })),
    );
    setCatatan(t("defaultNote"));
    // Kunci baru HANYA sesudah kiriman berhasil: lembar yang dibuka ulang setelah
    // sinyal putus memakai kunci lama, jadi pesanan yang ternyata sudah tercatat
    // tidak terbuat dua kali.
    if (!kunciKirim.current) kunciKirim.current = newLocalId();
    setBuka(true);
  }

  const barisKirim = lembar
    .map((l) => ({ ...l, n: Number(l.qty) }))
    .filter((l) => Number.isInteger(l.n) && l.n > 0);
  const adaTidakValid = lembar.some((l) => {
    const n = Number(l.qty);
    return l.qty.trim() === "" || !Number.isInteger(n) || n < 0;
  });
  const totalPcs = barisKirim.reduce((s, l) => s + l.n, 0);

  function kirim() {
    if (!visitId || barisKirim.length === 0 || adaTidakValid) return;
    startTransition(async () => {
      try {
        const res = await denganBatasWaktu(
          kirimPesananIsiUlang({
            storeId,
            visitId,
            note: catatan.trim() || undefined,
            idempotencyKey: kunciKirim.current,
            lines: barisKirim.map((l) => ({ itemId: l.itemId, variantSku: l.variantSku, qty: l.n })),
          }),
        );
        if (res.ok) {
          kunciKirim.current = "";
          toast.success(t("success", { orderNo: res.orderNo }));
          setBuka(false);
          router.refresh();
        } else {
          toast.error(td(`err.${res.code}`));
        }
      } catch (err) {
        toast.error(galatJaringan(err, typeof navigator === "undefined" ? true : navigator.onLine) ? t("err.JARINGAN") : t("err.GAGAL"));
      }
    });
  }

  return (
    <section className="beranda-kartu">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="beranda-judul flex items-center gap-2">
          <Boxes className="h-4 w-4" aria-hidden />
          {t("title")}
        </h2>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{data.source === "BUKU_TOKO" ? t("sourceBuku") : t("sourceTitipan")}</p>

      {baris.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <>
          <p className="mt-2 text-sm font-medium">{t("summary", { sku: ribuan(ringkas.sku), pcs: ribuan(ringkas.pcs) })}</p>
          {ringkas.minus + ringkas.hampirHabis + ringkas.tidakLaku > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {ringkas.minus > 0 ? (
                <Badge variant="outline" className={WARNA_TANDA.MINUS}>{t("chipMinus", { count: ringkas.minus })}</Badge>
              ) : null}
              {ringkas.hampirHabis > 0 ? (
                <Badge variant="outline" className={WARNA_TANDA.HAMPIR_HABIS}>{t("chipLow", { count: ringkas.hampirHabis })}</Badge>
              ) : null}
              {ringkas.tidakLaku > 0 ? (
                <Badge variant="outline" className={WARNA_TANDA.TIDAK_LAKU}>{t("chipSlow", { count: ringkas.tidakLaku })}</Badge>
              ) : null}
            </div>
          ) : null}

          <ul className="mt-3 divide-y rounded-lg border">
            {tampil.map((b) => (
              <li key={b.kunci} className="flex items-start gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{b.nama}</p>
                  {b.varian ? <p className="truncate text-xs text-muted-foreground">{b.varian}</p> : null}
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {t("sold30", { qty: ribuan(b.soldLast30) })}
                    {" · "}
                    {b.terakhirLaku ? t("lastSold", { date: b.terakhirLaku }) : t("neverSold")}
                  </p>
                  {b.target || b.dalamProses > 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {b.target ? t("target", { min: b.target.minQty, max: b.target.maxQty }) : null}
                      {b.target && b.dalamProses > 0 ? " · " : null}
                      {b.dalamProses > 0 ? t("onTheWay", { qty: ribuan(b.dalamProses) }) : null}
                    </p>
                  ) : null}
                  {b.tanda.length > 0 || b.saranQty > 0 ? (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {b.tanda.map((x) => (
                        <Badge key={x} variant="outline" className={cn("text-[11px]", WARNA_TANDA[x])}>
                          {td(`flag.${x}`)}
                        </Badge>
                      ))}
                      {b.saranQty > 0 ? (
                        <Badge className="text-[11px]">{t("suggest", { qty: ribuan(b.saranQty) })}</Badge>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <span
                  className={cn(
                    "shrink-0 text-lg font-semibold tabular-nums",
                    b.qty < 0 && "text-red-600 dark:text-red-400",
                  )}
                >
                  {b.perkiraan ? "≈" : null}
                  {ribuan(b.qty)}
                </span>
              </li>
            ))}
          </ul>

          {tersembunyi > 0 || semua ? (
            <Button type="button" variant="ghost" className="mt-1 w-full" onClick={() => setSemua((v) => !v)}>
              {semua ? t("showLess") : t("showAll", { count: baris.length })}
            </Button>
          ) : null}

          {data.adaPerkiraan ? <p className="mt-2 text-xs text-muted-foreground">{t("approxNote")}</p> : null}
          {ringkas.minus > 0 ? <p className="mt-1 text-xs text-muted-foreground">{t("minusNote")}</p> : null}
        </>
      )}

      <div className="mt-3">
        {saran.length > 0 ? (
          <Button type="button" className="w-full" onClick={bukaLembar}>
            <PackagePlus className="h-4 w-4" aria-hidden />
            {t("refillButton", { count: saran.length })}
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">{ringkas.adaTarget ? t("nothingToRefill") : t("noTargets")}</p>
        )}
      </div>

      <Sheet open={buka} onOpenChange={(v) => !pending && setBuka(v)}>
        <SheetContent side="bottom" className="flex max-h-[90vh] flex-col gap-0 p-0">
          <SheetHeader className="border-b pb-3">
            <SheetTitle>{t("sheetTitle")}</SheetTitle>
            <SheetDescription>{t("sheetDesc")}</SheetDescription>
          </SheetHeader>

          <div className="flex-1 space-y-2 overflow-y-auto p-4">
            {lembar.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{t("sheetEmpty")}</p>
            ) : (
              lembar.map((l) => {
                const n = Number(l.qty);
                const salah = l.qty.trim() === "" || !Number.isInteger(n) || n < 0;
                const idInput = `isi-ulang-${l.kunci}`;
                return (
                  <div key={l.kunci} className="flex items-center gap-3 rounded-lg border p-3">
                    <div className="min-w-0 flex-1">
                      <Label htmlFor={idInput} className="block truncate text-sm font-medium">
                        {l.nama}
                      </Label>
                      {l.varian ? <p className="truncate text-xs text-muted-foreground">{l.varian}</p> : null}
                      {Number.isInteger(n) && n > Math.max(l.tersedia, 0) ? (
                        <p className="text-xs text-amber-700 dark:text-amber-300">
                          {t("warehouseShort", { qty: ribuan(Math.max(l.tersedia, 0)) })}
                        </p>
                      ) : null}
                    </div>
                    <Input
                      id={idInput}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      step={1}
                      className={cn("w-20 text-center tabular-nums", salah && "border-destructive")}
                      value={l.qty}
                      aria-invalid={salah}
                      onChange={(e) =>
                        setLembar((xs) => xs.map((x) => (x.kunci === l.kunci ? { ...x, qty: e.target.value } : x)))
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-lg"
                      aria-label={t("remove", { nama: l.varian ? `${l.nama} ${l.varian}` : l.nama })}
                      onClick={() => setLembar((xs) => xs.filter((x) => x.kunci !== l.kunci))}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  </div>
                );
              })
            )}

            <div className="space-y-1.5 pt-2">
              <Label htmlFor="isi-ulang-catatan">{t("noteLabel")}</Label>
              <Textarea id="isi-ulang-catatan" value={catatan} maxLength={500} onChange={(e) => setCatatan(e.target.value)} />
            </div>
          </div>

          <SheetFooter className="border-t pt-3">
            {!visitId ? <p className="text-center text-xs text-muted-foreground">{t("needCheckIn")}</p> : null}
            <p className="text-center text-sm text-muted-foreground">
              {t("totalLine", { lines: barisKirim.length, pcs: ribuan(totalPcs) })}
            </p>
            <Button
              type="button"
              className="w-full"
              disabled={!visitId || pending || barisKirim.length === 0 || adaTidakValid}
              onClick={kirim}
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {pending ? t("sending") : t("submit")}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </section>
  );
}
