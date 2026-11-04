"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { ChevronRight, Loader2, LogOut } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { bersihkanDataPerangkat } from "@/lib/pwa/offline/bersihkan";
import { hitungBelumTerkirim } from "@/lib/pwa/offline/hitung";

/**
 * Keluar yang membersihkan HP.
 *
 * Kiriman yang belum terkirim TIDAK dihapus diam-diam: kalau ada, salesman
 * diberi tahu jumlahnya dan memilih sendiri — tunggu sinyal dulu, atau keluar
 * dan kehilangannya. Pesanan yang lenyap tanpa kabar lebih mahal daripada satu
 * ketukan tambahan.
 */
export function TombolKeluar({
  onLogout,
  tampilan = "ikon",
}: {
  onLogout: () => Promise<void>;
  tampilan?: "ikon" | "baris";
}) {
  const t = useTranslations("pwa.keluar");
  const tAuth = useTranslations("auth");
  const [tertahan, setTertahan] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  const keluar = () =>
    startTransition(async () => {
      try {
        await bersihkanDataPerangkat();
      } catch (err) {
        // Gagal membersihkan tidak boleh mengurung orang di dalam akunnya.
        console.error("bersihkanDataPerangkat gagal:", err);
      }
      await onLogout();
    });

  const mulai = () =>
    startTransition(async () => {
      const n = await hitungBelumTerkirim().catch(() => 0);
      if (n > 0) setTertahan(n);
      else keluar();
    });

  const pemicu =
    tampilan === "ikon" ? (
      <Button type="button" variant="ghost" size="icon" aria-label={tAuth("logout")} onClick={mulai} disabled={pending}>
        {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : <LogOut className="h-5 w-5" />}
      </Button>
    ) : (
      <button
        type="button"
        onClick={mulai}
        disabled={pending}
        className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left text-destructive transition-colors hover:bg-muted/60 disabled:opacity-60"
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-destructive/10">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" aria-hidden />}
        </span>
        <span className="flex-1 font-medium">{tAuth("logout")}</span>
        <ChevronRight className="h-4 w-4 shrink-0 opacity-60" aria-hidden />
      </button>
    );

  return (
    <>
      {pemicu}
      <AlertDialog open={tertahan !== null} onOpenChange={(buka) => !buka && setTertahan(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("title", { count: tertahan ?? 0 })}</AlertDialogTitle>
            <AlertDialogDescription>{t("body")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("stay")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setTertahan(null);
                keluar();
              }}
            >
              {t("leave")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
