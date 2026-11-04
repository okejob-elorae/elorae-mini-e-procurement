"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type TabPajak = "kalender" | "ppn" | "setoran" | "pphFinal" | "faktur";

const TAB: { kunci: TabPajak; href: string; faktur?: boolean }[] = [
  { kunci: "kalender", href: "/backoffice/finance/pajak" },
  { kunci: "ppn", href: "/backoffice/finance/pajak/ppn" },
  { kunci: "setoran", href: "/backoffice/finance/pajak/setoran" },
  { kunci: "pphFinal", href: "/backoffice/finance/pajak/pph-final" },
  { kunci: "faktur", href: "/backoffice/finance/pajak/faktur-keluaran", faktur: true },
];

export type AksesPajak = {
  /** `journals:view` — kalender, rekap, setoran, PPh final. */
  bacaJurnal: boolean;
  /** `tax_invoices:view` — ekspor faktur keluaran. */
  faktur: boolean;
  /** `settings_tax:view` — tautan ke Pengaturan → Pajak. */
  pengaturan: boolean;
};

/** Tab halaman pajak; tab yang tidak boleh dibuka penonton tidak ditampilkan. */
export function NavPajak({ aktif, akses }: { aktif: TabPajak; akses: AksesPajak }) {
  const t = useTranslations("financeTax.nav");
  const tampil = TAB.filter((x) => (x.faktur ? akses.faktur : akses.bacaJurnal));
  return (
    <nav className="flex flex-wrap gap-2" aria-label={t("label")}>
      {tampil.map((x) => (
        <Button key={x.kunci} asChild size="sm" variant={x.kunci === aktif ? "default" : "outline"} aria-current={x.kunci === aktif ? "page" : undefined}>
          <Link href={x.href}>{t(x.kunci)}</Link>
        </Button>
      ))}
    </nav>
  );
}

/**
 * Spanduk status pajak perusahaan: tampil selama status PKP atau rezim PPh
 * masih "belum ditetapkan" — selama itu tidak ada PPN yang dipisah di jurnal
 * mana pun (keputusan sementara pemilik no. 35).
 */
export function SpandukPajak({
  statusPkp,
  rezimPph,
  akses,
  className,
}: {
  statusPkp: string;
  rezimPph: string;
  akses: AksesPajak;
  className?: string;
}) {
  const t = useTranslations("financeTax.spanduk");
  const pkpBelum = statusPkp === "BELUM_DITETAPKAN";
  const rezimBelum = rezimPph === "BELUM_DITETAPKAN";
  if (!pkpBelum && !rezimBelum) return null;
  return (
    <div role="status" className={cn("flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm", className)}>
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
      <div className="min-w-0 flex-1 space-y-2">
        <p className="font-medium">{t("judul")}</p>
        <ul className="list-disc space-y-1 pl-5">
          {pkpBelum ? <li>{t("pkpBelum")}</li> : null}
          {rezimBelum ? <li>{t("rezimBelum")}</li> : null}
        </ul>
        {akses.pengaturan ? (
          <Button asChild size="sm" variant="outline">
            <Link href="/backoffice/settings/tax">{t("atur")}</Link>
          </Button>
        ) : (
          <p className="text-muted-foreground">{t("mintaAtur")}</p>
        )}
      </div>
    </div>
  );
}
