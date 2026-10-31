"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { BookOpen, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cariEntri, jangkarEntri, type EntriBantuan } from "@/lib/bantuan/jenis";
import { IsiEntri, useTeksBantuan } from "./teks";

/**
 * Ikon ⓘ di samping judul halaman. Penjelasan halaman dibaca di panel, bukan
 * di layar (keputusan pemilik 2026-10-05).
 *
 * Isinya diambil dari daftar Bantuan (`lib/bantuan/daftar`) untuk rute yang
 * sedang dibuka; daftarnya dimuat saat panel dibuka, jadi tidak ikut membebani
 * setiap halaman. `isi` hanya cadangan untuk halaman yang belum punya entri.
 *
 * `sisi` dan `semuaHref` mengikuti tempat tombol berada bila tidak diberikan:
 * di bawah `/pwa` panel naik dari bawah dan "semua penjelasan" membuka
 * `/pwa/bantuan` — komponen kantor yang juga dipakai di HP (formulir BKM)
 * dulu menaut salesman ke Bantuan kantor yang tidak bisa ia buka.
 */
export function TombolBantuan({
  judul,
  isi,
  sisi: sisiDiminta,
  semuaHref: semuaDiminta,
}: {
  judul: ReactNode;
  isi?: ReactNode;
  sisi?: "right" | "bottom";
  semuaHref?: string;
}) {
  const t = useTranslations("bantuan");
  const teks = useTeksBantuan();
  const pathname = usePathname();
  const diHp = pathname === "/pwa" || (pathname ?? "").startsWith("/pwa/");
  const sisi = sisiDiminta ?? (diHp ? "bottom" : "right");
  const semuaHref = semuaDiminta ?? (diHp ? "/pwa/bantuan" : "/backoffice/bantuan");
  const [buka, setBuka] = useState(false);
  const [daftar, setDaftar] = useState<readonly EntriBantuan[] | null>(null);

  const bukaPanel = () => {
    setBuka(true);
    if (!daftar) {
      void import("@/lib/bantuan/daftar").then((m) => setDaftar(m.DAFTAR_BANTUAN));
    }
  };

  const entri = daftar ? cariEntri(pathname ?? "", daftar) : null;
  const tautanSemua = entri ? `${semuaHref}#${jangkarEntri(entri.rute)}` : semuaHref;

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
        onClick={bukaPanel}
        aria-label={t("tombol")}
        title={t("tombol")}
      >
        <Info className="h-4 w-4" aria-hidden />
      </Button>
      <Sheet open={buka} onOpenChange={setBuka}>
        <SheetContent
          side={sisi}
          className={
            sisi === "bottom"
              ? "mx-auto flex max-h-[85dvh] w-full max-w-xl flex-col gap-0 rounded-t-2xl p-0"
              : "flex w-full flex-col gap-0 p-0 sm:max-w-md"
          }
        >
          <SheetHeader className="border-b pb-3">
            <SheetTitle className="flex items-center gap-2 pr-6">
              <BookOpen className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <span>{entri ? teks(entri.judul) : judul}</span>
            </SheetTitle>
            <SheetDescription className="sr-only">{t("tombol")}</SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto p-4 text-sm leading-relaxed">
            {entri ? (
              <IsiEntri entri={entri} judulKartu={t("bagianHalaman")} />
            ) : daftar && isi ? (
              <div className="space-y-2">{isi}</div>
            ) : daftar ? (
              <p className="text-muted-foreground">{t("kosongHalaman")}</p>
            ) : (
              <p className="text-muted-foreground">{t("memuat")}</p>
            )}
          </div>
          <div className="border-t p-3">
            <Button asChild variant="outline" className="w-full">
              <Link href={tautanSemua} onClick={() => setBuka(false)}>
                {t("semua")}
              </Link>
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
