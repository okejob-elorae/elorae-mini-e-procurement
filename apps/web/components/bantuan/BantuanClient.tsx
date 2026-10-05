"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowUpRight, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { DAFTAR_BANTUAN } from "@/lib/bantuan/daftar";
import {
  BAGIAN_HP,
  BAGIAN_KANTOR,
  bisaDibuka,
  cocokPencarian,
  jangkarEntri,
  sebagaiDaftar,
  untukHp,
  type BagianBantuan,
  type BagianHp,
  type EntriBantuan,
} from "@/lib/bantuan/jenis";
import { cn } from "@/lib/utils";
import { IsiEntri, useTeksBantuan } from "./teks";

/**
 * Halaman Bantuan: semua penjelasan halaman, dikelompokkan seperti menu
 * samping — tempat pemilik membaca sendiri apa yang dulu tertulis di bawah
 * setiap judul (2026-10-05).
 *
 * `area` "kantor" memuat kantor DAN HP (pemilik memeriksa semuanya dari
 * laptop); "hp" hanya HP, dan `bagianHp` menyempitkannya ke peran pembaca
 * (salesman tidak perlu membaca layar SPG, dan sebaliknya). Versi HP tidak memakai breakpoint `lg:` — di laptop
 * aplikasi HP adalah kolom selebar ponsel, dan breakpoint mengikuti lebar
 * jendela, bukan kolomnya.
 */
export function BantuanClient({ area, bagianHp }: { area: "kantor" | "hp"; bagianHp?: readonly BagianHp[] }) {
  const t = useTranslations("bantuan");
  const tNav = useTranslations("navigation");
  const teks = useTeksBantuan();
  const [kueri, setKueri] = useState("");

  const urutan: readonly BagianBantuan[] = area === "hp" ? (bagianHp ?? BAGIAN_HP) : [...BAGIAN_KANTOR, ...BAGIAN_HP];
  const judulBagian = (b: BagianBantuan) =>
    (BAGIAN_HP as readonly string[]).includes(b) ? t(`bagian.${b}` as never) : tNav(b as never);

  const gabungan = useMemo(() => {
    const peta = new Map<string, string>();
    for (const e of DAFTAR_BANTUAN) {
      const semua = [
        e.judul,
        ...sebagaiDaftar(e.isi),
        ...(e.kartu ?? []).flatMap((k) => [k.judul, ...sebagaiDaftar(k.isi)]),
      ].map(teks);
      peta.set(e.rute, semua.join(" "));
    }
    return peta;
    // `teks` berganti identitas setiap render; isinya hanya bergantung pada bahasa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const kelompok = urutan
    .map((b) => ({
      bagian: b,
      entri: DAFTAR_BANTUAN.filter(
        (e) => e.bagian === b && (area === "kantor" || untukHp(e)) && cocokPencarian(gabungan.get(e.rute) ?? "", kueri),
      ),
    }))
    .filter((g) => g.entri.length > 0);
  const jumlah = kelompok.reduce((n, g) => n + g.entri.length, 0);

  const bolehBuka = (e: EntriBantuan) => bisaDibuka(e.rute) && (area === "hp") === untukHp(e);

  const daftarIsi = (
    <ul className="space-y-3">
      {kelompok.map((g) => (
        <li key={g.bagian}>
          <a href={`#bagian-${g.bagian}`} className="font-medium hover:underline">
            {judulBagian(g.bagian)}
          </a>
          <ul className="mt-1 space-y-0.5 border-l pl-3">
            {g.entri.map((e) => (
              <li key={e.rute}>
                <a href={`#${jangkarEntri(e.rute)}`} className="block py-0.5 text-muted-foreground hover:text-foreground">
                  {teks(e.judul)}
                </a>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="space-y-6">
      <div className={cn("flex flex-col gap-3", area === "kantor" && "sm:flex-row sm:items-end sm:justify-between")}>
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">{t("judulHalaman")}</h1>
          <p className="text-sm text-muted-foreground tabular-nums">{t("jumlah", { n: jumlah })}</p>
        </div>
        <div className={cn("relative w-full", area === "kantor" && "sm:w-80")}>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            value={kueri}
            onChange={(e) => setKueri(e.target.value)}
            placeholder={t("cari")}
            aria-label={t("cari")}
            className="pl-9"
          />
        </div>
      </div>

      <details className={cn("rounded-lg border bg-card text-sm", area === "kantor" && "lg:hidden", kelompok.length === 0 && "hidden")}>
        <summary className="cursor-pointer select-none px-4 py-3 font-medium">{t("daftarIsi")}</summary>
        <div className="border-t px-4 py-3">{daftarIsi}</div>
      </details>

      <div className={cn(area === "kantor" && "lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-10")}>
        {area === "kantor" ? (
          <nav aria-label={t("daftarIsi")} className="hidden text-sm lg:block">
            <div className="sticky top-20 max-h-[calc(100dvh-6rem)] overflow-y-auto pr-2">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("daftarIsi")}</p>
              {daftarIsi}
            </div>
          </nav>
        ) : null}

        <div className="min-w-0 space-y-10">
          {kelompok.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {kueri.trim() ? t("tidakCocok", { kueri: kueri.trim() }) : t("kosong")}
            </p>
          ) : null}
          {kelompok.map((g) => (
            <section key={g.bagian} id={`bagian-${g.bagian}`} className="scroll-mt-24" aria-labelledby={`judul-${g.bagian}`}>
              <h2 id={`judul-${g.bagian}`} className="border-b pb-2 text-lg font-semibold tracking-tight">
                {judulBagian(g.bagian)}
              </h2>
              <div className="divide-y">
                {g.entri.map((e) => (
                  <article
                    key={e.rute}
                    id={jangkarEntri(e.rute)}
                    className="-mx-3 scroll-mt-24 rounded-lg px-3 py-5 target:bg-muted/50"
                  >
                    <div className="mb-2 flex items-baseline justify-between gap-3">
                      <h3 className="font-semibold">{teks(e.judul)}</h3>
                      {bolehBuka(e) ? (
                        <Link
                          href={e.rute}
                          className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                        >
                          {t("bukaHalaman")}
                          <ArrowUpRight className="h-3 w-3" aria-hidden />
                        </Link>
                      ) : null}
                    </div>
                    <div className="max-w-prose text-sm leading-relaxed">
                      <IsiEntri entri={e} judulKartu={t("bagianHalaman")} />
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
