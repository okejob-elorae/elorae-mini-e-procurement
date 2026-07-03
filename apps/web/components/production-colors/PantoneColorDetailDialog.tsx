"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Copy, Droplets, X } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FavoriteButton } from "@/components/production-colors/FavoriteButton";
import { BookPositionCallout } from "@/components/production-colors/BookPositionCallout";
import type { PantoneDetail } from "@/components/production-colors/types";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type PantoneColorDetailDialogProps = {
  tcx: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectSimilar?: (tcx: string) => void;
  onGoToBook?: (pos: {
    tcx: string;
    section: number;
    page: number;
    column: number;
    row: number;
  }) => void;
};

type InfoCardProps = {
  label: string;
  value: string;
  onCopy: () => void;
  copyLabel: string;
};

function InfoCard({ label, value, onCopy, copyLabel }: InfoCardProps) {
  return (
    <div className="relative min-w-0 rounded-lg border bg-card p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 pr-8 font-semibold leading-tight break-all">{value}</p>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute right-1.5 bottom-1.5 h-7 w-7 text-muted-foreground"
        onClick={onCopy}
        aria-label={copyLabel}
      >
        <Copy className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

export function PantoneColorDetailDialog({
  tcx,
  open,
  onOpenChange,
  onSelectSimilar,
  onGoToBook,
}: PantoneColorDetailDialogProps) {
  const t = useTranslations("productionColors");
  const [detail, setDetail] = useState<PantoneDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !tcx) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/production/colors/${encodeURIComponent(tcx)}`)
      .then((r) => {
        if (!r.ok) throw new Error("Failed");
        return r.json();
      })
      .then((data: PantoneDetail) => {
        if (!cancelled) setDetail(data);
      })
      .catch(() => {
        if (!cancelled) toast.error("Failed to load color");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, tcx]);

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    toast.success(t("copied"));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[92vh] w-full max-w-[calc(100%-2rem)] flex-col gap-0 overflow-y-auto p-0 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden sm:max-w-2xl md:max-w-3xl"
      >
        <DialogTitle className="sr-only">
          {detail
            ? `${detail.name} (${detail.tcx})`
            : tcx ?? t("detailTitle")}
        </DialogTitle>

        {loading && (
          <p className="px-6 py-12 text-center text-sm text-muted-foreground">
            Loading…
          </p>
        )}

        {detail && !loading && (
          <>
            <div
              className="relative min-h-36 w-full min-w-0 px-6 pb-5 pt-4 sm:min-h-40"
              style={{ backgroundColor: detail.hex }}
            >
              <div className="absolute right-3 top-3 flex items-center gap-1">
                <FavoriteButton
                  tcx={detail.tcx}
                  initialFavorited={detail.isFavorite}
                  className="h-9 w-9 rounded-full bg-black/20 text-white hover:bg-black/30 hover:text-white"
                  onToggle={(f) =>
                    setDetail((d) => (d ? { ...d, isFavorite: f } : d))
                  }
                />
                <DialogClose asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 rounded-full bg-black/20 text-white hover:bg-black/30 hover:text-white"
                  >
                    <X className="h-4 w-4" />
                    <span className="sr-only">Close</span>
                  </Button>
                </DialogClose>
              </div>

              <div className="mt-10 max-w-[85%] text-white">
                <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
                  {detail.name}
                </h2>
                <p className="mt-1 font-mono text-sm text-white/90 sm:text-base">
                  {detail.tcx} · {detail.hex}
                </p>
              </div>
            </div>

            <div className="min-w-0 w-full max-w-full space-y-4 p-5 sm:p-6">
              <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
                <InfoCard
                  label={t("pantoneCodeLabel")}
                  value={detail.tcx}
                  onCopy={() => copy(detail.tcx)}
                  copyLabel={t("copyTcx")}
                />
                <InfoCard
                  label={t("colorNameLabel")}
                  value={detail.name}
                  onCopy={() => copy(detail.name)}
                  copyLabel={t("copy")}
                />
                <InfoCard
                  label={t("hexLabel")}
                  value={detail.hex}
                  onCopy={() => copy(detail.hex)}
                  copyLabel={t("copyHex")}
                />
                <InfoCard
                  label={t("rgbLabel")}
                  value={detail.rgb}
                  onCopy={() => copy(detail.rgb)}
                  copyLabel={t("copy")}
                />
              </div>

              <BookPositionCallout
                tcx={detail.tcx}
                bookPosition={detail.bookPosition}
                onPositionChange={(position) =>
                  setDetail((d) => (d ? { ...d, bookPosition: position } : d))
                }
                onCopy={copy}
              />

              {detail.bookPosition && onGoToBook && (
                <Button
                  type="button"
                  variant="link"
                  className="h-auto p-0 text-xs"
                  onClick={() =>
                    onGoToBook({
                      tcx: detail.tcx,
                      ...detail.bookPosition!,
                    })
                  }
                >
                  {t("bookGoToPage")}
                </Button>
              )}

              {detail.groupName && (
                <Badge variant="secondary" className="rounded-full px-3 py-1">
                  {t("groupLabel", { group: detail.groupName })}
                </Badge>
              )}

              <div className="min-w-0 w-full max-w-full">
                <div className="mb-2 flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
                  <div className="flex items-center gap-1.5 text-sm font-medium">
                    <Droplets className="h-4 w-4 shrink-0 text-muted-foreground" />
                    {t("gradientTitle")}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {t("gradientCopyHint")}
                  </span>
                </div>
                <div className="grid w-full min-w-0 grid-cols-10 gap-1 rounded-md border p-1">
                  {detail.gradient.map((h, index) => (
                    <button
                      key={`${index}-${h}`}
                      type="button"
                      className="h-10 min-w-0 w-full rounded-sm hover:opacity-90"
                      style={{ backgroundColor: h }}
                      title={h}
                      onClick={() => copy(h)}
                    />
                  ))}
                </div>
              </div>

              {detail.similar.length > 0 && (
                <div className="min-w-0 w-full max-w-full">
                  <p className="mb-2 text-sm font-medium">
                    {t("similarColorsTitle")}
                  </p>
                  <div className="-mx-1 flex min-w-0 gap-2 overflow-x-auto overscroll-x-contain px-1 pb-2 [-webkit-overflow-scrolling:touch]">
                    {detail.similar.map((s) => (
                      <div
                        key={s.tcx}
                        role="button"
                        tabIndex={0}
                        className={cn(
                          "w-19 shrink-0 cursor-pointer overflow-hidden rounded-md border text-left",
                          "hover:ring-2 hover:ring-primary/40"
                        )}
                        onClick={() => onSelectSimilar?.(s.tcx)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onSelectSimilar?.(s.tcx);
                          }
                        }}
                      >
                        <div
                          className="h-14 w-full"
                          style={{ backgroundColor: s.hex }}
                        />
                        <div className="space-y-0.5 p-1.5">
                          <div className="flex items-start justify-between gap-0.5">
                            <span
                              className="line-clamp-2 text-[10px] leading-tight font-medium"
                              title={s.name}
                            >
                              {s.name}
                            </span>
                            <FavoriteButton
                              tcx={s.tcx}
                              initialFavorited={!!s.isFavorite}
                              className="h-5 w-5 shrink-0 -mr-0.5 -mt-0.5"
                            />
                          </div>
                          <p className="text-[10px] text-muted-foreground">
                            {t("deltaE")} {s.deltaE.toFixed(2)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
