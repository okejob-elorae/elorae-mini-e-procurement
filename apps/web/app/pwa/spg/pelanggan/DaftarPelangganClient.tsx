"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ChevronRight, Search, UserPlus, UserRound, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TautanKembali } from "@/app/pwa/TautanKembali";
import type { BarisPelangganHp } from "@/lib/spg/pelanggan-queries";

/**
 * Daftar pelanggan toko SPG. Pencarian ditulis ke alamat dengan `replace`,
 * supaya "Kembali" tidak berjalan mundur melewati setiap pencarian.
 */
export function DaftarPelangganClient({
  namaToko,
  q,
  data,
}: {
  namaToko: string;
  q: string | null;
  data: { baris: BarisPelangganHp[]; total: number };
}) {
  const t = useTranslations("spgPelanggan");
  const bahasa = useLocale() === "en" ? "en" : "id";
  const router = useRouter();
  const [teks, setTeks] = useState(q ?? "");

  const cari = (nilai: string | null) => router.replace(nilai ? `/pwa/spg/pelanggan?q=${encodeURIComponent(nilai)}` : "/pwa/spg/pelanggan", { scroll: false });

  return (
    <div className="space-y-4 p-4">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <TautanKembali cadangan="/pwa/spg/lainnya" />
      </Button>
      <header>
        <h1 className="text-2xl font-bold">{t("judul")}</h1>
        <p className="truncate text-sm text-muted-foreground">{namaToko}</p>
      </header>

      <Button asChild size="lg" className="w-full">
        <Link href="/pwa/spg/pelanggan/baru">
          <UserPlus className="h-4 w-4" aria-hidden />
          {t("tambah")}
        </Link>
      </Button>

      <form
        className="flex gap-2"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          cari(teks.trim() || null);
        }}
      >
        <Input
          type="search"
          value={teks}
          onChange={(e) => {
            setTeks(e.target.value);
            if (e.target.value === "" && q) cari(null);
          }}
          placeholder={t("cari")}
          aria-label={t("cari")}
          enterKeyHint="search"
          autoComplete="off"
        />
        <Button type="submit" variant="outline" size="icon" aria-label={t("cari")}>
          <Search className="h-4 w-4" />
        </Button>
      </form>

      {data.baris.length === 0 ? (
        <section className="beranda-kartu flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
            <Users className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="font-semibold leading-tight">{q ? t("kosongCariJudul") : t("kosongJudul")}</h2>
            <p className="text-sm text-muted-foreground">{q ? t("kosongCariIsi") : t("kosongIsi")}</p>
          </div>
        </section>
      ) : (
        <section className="beranda-kartu beranda-kartu-daftar">
          <ul className="divide-y">
            {data.baris.map((p) => (
              <li key={p.id}>
                <Link href={`/pwa/spg/pelanggan/${p.id}`} className="flex min-h-14 items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/60">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                    <UserRound className="h-4 w-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1 space-y-0.5">
                    <span className="block break-words font-medium leading-tight">{p.nama}</span>
                    <span className="block text-xs text-muted-foreground tabular-nums">{p.hp}</span>
                    <span className="block text-xs text-muted-foreground">
                      {p.belanjaTerakhir ? t("ringkasBelanja", { n: p.jumlahNota, tanggal: p.belanjaTerakhir[bahasa] }) : t("belumBelanja")}
                    </span>
                    {p.titipTerbuka > 0 ? (
                      <span className="inline-block rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-300">
                        {t("titipTerbuka", { n: p.titipTerbuka })}
                      </span>
                    ) : null}
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {data.total > data.baris.length ? <p className="px-1 text-xs text-muted-foreground">{t("terpotong", { tampil: data.baris.length, total: data.total })}</p> : null}
      <p className="px-1 text-xs text-muted-foreground">{t("petunjuk")}</p>
    </div>
  );
}
